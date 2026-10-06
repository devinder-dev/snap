# Snap — scaling plan: several servers + RabbitMQ

Status: **Step 0 in progress** (2026-10-06). The app is finished and runs on one server;
Steps 1–10 are not started.
Verified beforehand: `amqplib` 2.2 works under Bun 1.3.14, and every RabbitMQ feature used
below (topic routing, alternate exchange, TTL → dead-letter timer, nack → dead-letter queue)
was tested against RabbitMQ 4.

---

## 1. Goal

Run **several copies** of the backend at the same time, so the app keeps working when one
copy dies and can handle more users — without changing the API or the app.

Today that isn't possible: live pushes only reach users connected to the same copy. RabbitMQ
fixes that, and at the same time gives us proper background jobs (deleting expired snaps)
with retries and a place for failures to land.

Then **run it for real**: deployed on the internet, tested by CI on every push, measured,
and documented well enough that someone who has never seen it understands it in five minutes.

### What this project demonstrates

| Skill | Where to point in an interview |
|---|---|
| Scaling a realtime (stateful) service horizontally | The relay over RabbitMQ — the app doesn't change at all (Step 3) |
| Message-broker patterns | Topic routing, alternate exchange, TTL timer, retries, dead letters (Steps 4–5) |
| Reliability thinking | At-least-once + idempotency, ack after work, safety net, API survives a RabbitMQ outage (section 9) |
| Containers and load balancing | Dockerfile, nginx with WebSocket upgrade, no sticky sessions (Step 6) |
| Failure testing | Kill a server, kill RabbitMQ, break the S3 key — and watch it recover (section 13) |
| CI with real dependencies | Two API copies + RabbitMQ in GitHub Actions on every push (Step 7) |
| Running it for real | HTTPS, secrets, logs, real numbers from a load test (Steps 8–10) |

### Roadmap

| Step | What | Status |
|---|---|---|
| – | App on one server: auth, friends, snaps, chat, live pushes | ✅ 2026-09-30 |
| 0 | Public repo, own S3 account, end-to-end test back | 🟡 in progress |
| 1 | RabbitMQ running | ⬜ |
| 2 | Queue module | ⬜ |
| 3 | Live pushes across servers | ⬜ |
| 4 | Worker + snap timer | ⬜ |
| 5 | Retries, dead letters, alternate exchange | ⬜ |
| 6 | Several servers behind nginx | ⬜ |
| 7 | CI on every push | ⬜ |
| 8 | Ready for the public internet | ⬜ |
| 9 | Deploy | ⬜ |
| 10 | Proof and presentation | ⬜ |

After every step: run its end-to-end test, review it together, then commit and push.

### Decisions

| Question | Decision | Why |
|---|---|---|
| Message broker | **RabbitMQ 4** | Course topic; supports every pattern we need |
| Client library | **`amqplib`** (v2, ships its own types) | Most used, most examples; verified on Bun |
| Background jobs | **Separate worker process** | Scales and restarts independently of the API |
| Photo uploads | **Unchanged** (`POST /snaps` multipart through the API) | The API contract must not change |
| Cross-server pushes | **Own relay over RabbitMQ**, not the socket.io Redis adapter | Only one file emits today, so it's a small change — and it's RabbitMQ we're learning |
| Snap expiry | **RabbitMQ timer** (TTL → dead-letter) + **hourly safety-net sweep** | Exact timing from the timer, guaranteed cleanup from the sweep. Honest trade-off: the indexed sweep alone would do the job — the timer is here to learn TTL and dead-lettering |
| App changes | **None**, except pointing `EXPO_PUBLIC_API_URL` at the load balancer | Socket events stay exactly the same |
| Code on GitHub | **Public repo `devinder-dev/snap`**, committed step by step | The history shows how it was built |
| S3 account | **Own AWS account**, IAM user with object-only access | The course bucket's key has to be replaced anyway (section 10) |
| S3 in CI | **Local S3 stand-in** through `S3_ENDPOINT` | CI never holds real AWS keys |
| Hosting | **Chosen at Step 9**, once everything works locally | Nothing before Step 9 depends on it, and the requirements are known by then |

---

## 2. What exists today

### Built and tested

**Backend** — Fastify on Bun, one process (`backend/`)
- Auth: register / login / refresh. JWT access token 15 min, refresh token 10 years, bcrypt.
- Friends: add, remove, list, incoming requests.
- Snaps: photo upload to S3, inbox, view-once (5-minute presigned link), screenshot reports,
  deleted after 24 h by a sweep every 5 minutes (`src/jobs/snap-expiry.ts`).
- Chat: `messages` table, paged history, conversation list.
- Live pushes: socket.io, push-only, one room per user (`user:<username>`).
  **All emits live in one file:** `src/websocket/controllers.ts`.

**App** — Expo SDK 54, runs in Expo Go (`snap/`)
- All screens, real backend, one socket per login with automatic token refresh.
- On every socket (re)connect the app refetches its lists — so a missed push is never lost data.

**Not kept:** the end-to-end test from September (45 checks) lived in a temporary folder and
is gone. Step 0 rewrites it as a committed script.

### Integrations

| Integration | Used for | Today | Needed for scaling |
|---|---|---|---|
| Postgres 17 (Docker) | All data | ✅ | Shared by every copy. Bun pools ~10 connections per process; Postgres allows 100 by default — fine for 3 API + 1 worker |
| AWS S3 | Snap photos | ✅ course bucket `fos25-snap` → own account in Step 0 | Nothing. Every copy uses the same bucket |
| JWT | Auth | ✅ | Same `JWT_SECRET_KEY` on every copy. Stateless — nothing else |
| socket.io | Live pushes | ✅ one copy only | ❌ rooms live in one process's memory → **RabbitMQ relay** |
| RabbitMQ | Events + jobs | ❌ | **New** |
| nginx | Load balancer | ❌ | **New** (must pass WebSocket upgrades, allow 10 MB bodies) |
| Backend Docker image | Running N copies | ❌ | **New** `Dockerfile` + `.dockerignore` |
| Health route | Docker and the host checking a copy is alive | ❌ | **New** `GET /health` (Step 0) |
| CI | Testing every push | ❌ | **New** GitHub Actions (Step 7) |

### Why one copy is the limit

1. **Socket rooms are in memory.** Anna on server 1 sends Ben (on server 2) a message → it's saved,
   but server 1 can't reach Ben's socket, so Ben gets no live push.
2. **The expiry sweep runs in every copy.** Safe (deletes are idempotent) but wasteful.
3. **Uploads pass through API memory** (≤10 MB each). Acceptable; noted for later.

What already scales: JWT is stateless, photos are in S3, data is in Postgres, and the app
connects with **WebSocket-only transport**, so the load balancer needs **no sticky sessions**.

---

## 3. Target architecture

```
                          Phones (Expo app)
                                 │  HTTP + WebSocket
                                 ▼
                        ┌──────────────────┐
                        │  nginx  :8080    │  load balancer
                        └───┬─────┬─────┬──┘
                            ▼     ▼     ▼
                        ┌─────┐┌─────┐┌─────┐
                        │api 1││api 2││api 3│  identical copies, no local state
                        └──┬──┘└──┬──┘└──┬──┘
      publish events ──────┤      │      ├────── each reads its own realtime queue
                           ▼      ▼      ▼
                        ┌───────────────────┐        ┌──────────┐
                        │     RabbitMQ      │◀──────▶│  worker  │  expiry jobs, retries,
                        │ :5672  UI :15672  │        └────┬─────┘  hourly safety net
                        └───────────────────┘             │
                                                          │
          api 1–3 + worker ──▶ Postgres        api 1–3 + worker ──▶ S3
```

- **API copies** handle HTTP and sockets, and *publish* an event after every write.
- **RabbitMQ** copies each event to whoever needs it.
- **Worker** does slow or scheduled work nobody should wait for.
- **Postgres and S3** stay the source of truth. RabbitMQ never holds data we can't rebuild.

---

## 4. RabbitMQ in five minutes

Think of a post office.

| RabbitMQ | Post office | Snap |
|---|---|---|
| **Producer** | Person posting a letter | An API copy: "Anna sent Ben a message" |
| **Message** | The letter (bytes; we use JSON) | `{ "sender_username": "anna", … }` |
| **Routing key** | Address on the envelope | `message.created` |
| **Exchange** | Sorting desk — never stores letters | `snap.events` |
| **Binding** | Sorting rule: "addresses matching X → mailbox Y" | `message.*` → `realtime.api-2` |
| **Queue** | Mailbox — letters wait here | `snap.expire.queue` |
| **Consumer** | Whoever empties the mailbox | The worker |
| **Ack** | "Handled, throw it away" | Worker: "snap 42 deleted" |
| **Nack** | "Can't handle this" | Worker: "S3 is down" |

The sorting desk puts **a copy in every mailbox whose rule matches.** One event can end up in
several queues — that's what lets a single `snap.created` both trigger a live push *and* start a
24-hour timer.

Exchange types we use:
- **topic** — rules with wildcards: `snap.*` matches `snap.created` and `snap.screenshot`
  (`*` = exactly one word, `#` = zero or more words).
- **fanout** — no rules: every bound queue gets a copy.

Queue settings we use:
- **durable** — survives a RabbitMQ restart. *RabbitMQ 4 requires this for any shared queue.*
- **exclusive** — belongs to one connection and disappears when it closes.
- **TTL** (`x-message-ttl`) — how long a message may wait in the queue.
- **dead-letter exchange** (`x-dead-letter-exchange`) — where a message goes instead of being
  thrown away (expired TTL, nack without requeue, queue full).
- **max length** (`x-max-length`) — cap; the oldest message is dropped when full.

The two fallbacks:
- **Alternate exchange = routing fallback.** The exchange found *no* queue for a message.
- **Dead-letter exchange = processing fallback.** The message reached a queue but couldn't be
  handled (or its time ran out).

---

## 5. Topology — every exchange and queue

```
 api publishes
      │
      ▼
┌────────────────────────────────┐   no binding matches
│ snap.events        (topic)     │─────────────────────────▶ snap.unrouted (fanout)
│ alternate-exchange=snap.unrouted│                                 │
└──┬─────────────────────────┬───┘                                 ▼
   │ message.*               │ snap.created                 snap.unrouted.queue
   │ snap.*                  ▼                              (7 d, max 10 000, inspected by hand)
   │ friend.*     snap.expiry.wait
   ▼              (TTL 24 h, DLX=snap.expire, nobody reads it)
realtime.<server>            │ TTL runs out
(one per API copy)           ▼
   │              snap.expire (fanout) ──▶ snap.expire.queue ──▶ worker
   ▼                         ▲                                    │
socket.io emit               │                         failed, attempt < 3
to local users               │                                    ▼
                             └──── TTL 30 s ──── snap.retry.wait ◀┘
                                                                  │
                                                     failed, attempt = 3 → nack
                                                                  ▼
                                                    snap.dlx (fanout) ──▶ snap.dead.queue
                                                                   (7 d, max 10 000, inspected by hand)
```

### Exchanges

| Name | Type | Durable | Arguments |
|---|---|---|---|
| `snap.events` | topic | yes | `alternate-exchange: snap.unrouted` |
| `snap.unrouted` | fanout | yes | – |
| `snap.expire` | fanout | yes | – |
| `snap.dlx` | fanout | yes | – |

### Queues

| Name | Settings | Bound to | Read by |
|---|---|---|---|
| `realtime.<instance-id>` | exclusive, non-durable, TTL 60 s | `snap.events`: `message.*`, `snap.*`, `friend.*` | its API copy |
| `snap.expiry.wait` | durable, TTL = `SNAP_TTL_MS` (24 h), DLX `snap.expire` | `snap.events`: `snap.created` | **nobody** — a waiting room |
| `snap.expire.queue` | durable, DLX `snap.dlx` | `snap.expire` | worker |
| `snap.retry.wait` | durable, TTL = `SNAP_RETRY_DELAY_MS` (30 s), DLX `snap.expire` | – (worker sends directly) | **nobody** — a waiting room |
| `snap.dead.queue` | durable, TTL 7 d, max 10 000 | `snap.dlx` | a human (web UI / script) |
| `snap.unrouted.queue` | durable, TTL 7 d, max 10 000 | `snap.unrouted` | a human (web UI / script) |

Why the realtime queue has a 60 s TTL: a live push that's a minute late is useless — the app
refetches on reconnect anyway — and it stops a stuck server from piling up messages.

Why bindings are **specific** (`message.*`, not `#`): a `#` rule matches everything, including
typos, so the alternate exchange would never catch anything.

---

## 6. Events

Every write publishes **one** event to `snap.events`. Body = JSON. AMQP properties carry the
metadata: `messageId` (random UUID), `timestamp`, `type` (= routing key), `appId` (= instance id),
`contentType: application/json`, `persistent: true`.

| Routing key | Published by | Payload | Socket event the app receives (unchanged) |
|---|---|---|---|
| `message.created` | `services.sendMessage` | `ApiMessage` | `message_received` → sender **and** recipient |
| `snap.created` | `services.sendSnap` | `{ snap_id, sender_username, recipients[], type, created_at, expires_at }` | `snap_received` → each recipient |
| `snap.screenshot` | `services.reportScreenshot` | `{ snap_id, sender_username, by, created_at }` | `screenshot_taken` → sender |
| `friend.requested` | `services.addFriend` | `{ from, to, created_at }` | `friend_request` → `to` |
| `friend.accepted` | `services.addFriend` | `{ users: [a, b], created_at }` | `friend_accepted` → both, each gets the *other* name |

One behaviour change inside the backend: today `sendSnap` emits once **per recipient**. It
becomes **one** `snap.created` with a `recipients` list, because the snap needs exactly one timer.

---

## 7. Flows, step by step

### 7.1 Live message across servers

```
Anna ─POST /messages/ben─▶ api 1
  api 1: INSERT into messages                        (Postgres — the truth)
  api 1: 201 back to Anna
  api 1: publish message.created ─▶ snap.events
         snap.events copies it to realtime.api-1, realtime.api-2, realtime.api-3
  api 1: "is anna or ben connected to me?"  anna → emit to her other devices
  api 2: "is anna or ben connected to me?"  ben  → emit message_received 📱
  api 3: nobody here → nothing
  each copy: ack
```
The HTTP request never waits for RabbitMQ: publishing happens after the response is decided,
and a failed publish is logged, not returned as an error.

### 7.2 Snap expiry — the 24-hour timer

```
Mon 10:00  Anna sends snap 42 → row saved (expires_at = Tue 10:00), photo in S3
           publish snap.created → copies into realtime.* (live push)
                                  and snap.expiry.wait  (starts waiting)
Tue 10:00  the message's 24 h TTL runs out
           RabbitMQ dead-letters it → snap.expire → snap.expire.queue
Tue 10:00  worker: is snap 42 expired?  yes
                   delete photo from S3 → delete row → ack ✓
```
Works because **every snap has the same lifetime**: RabbitMQ only expires the message at the
*front* of a queue, and with one fixed TTL the front is always the oldest.

### 7.3 Retry, then dead letter

```
Tue 10:00  worker: delete snap 42 → S3 timeout ✗   (attempt 1)
           send a copy to snap.retry.wait with header x-attempt=2, ack the original
Tue 10:00:30  retry TTL runs out → back into snap.expire.queue
           worker: S3 timeout ✗ (attempt 2) → retry.wait again, x-attempt=3
Tue 10:01  worker: S3 timeout ✗ (attempt 3) → nack(requeue=false)
           → snap.dlx → snap.dead.queue
           worker logs: DEAD-LETTERED snap_id=42 after 3 attempts: S3 timeout
Tue 11:00  hourly safety net: S3 is back → snap 42 deleted ✓
```
A message that can **never** succeed (invalid JSON, missing `snap_id`) skips the retries and is
nacked straight to the dead-letter queue.

### 7.4 A typo'd routing key

```
publish "mesage.created" → snap.events: no binding matches
  → alternate exchange snap.unrouted → snap.unrouted.queue
worker (checks every 60 s): WARN snap.unrouted.queue has 1 message (+1)
```
Without the alternate exchange RabbitMQ would silently drop it and nobody would know why Ben
got nothing.

In our own code a typo is already a compile error — `publishEvent` only accepts a known
`RoutingKey`. The alternate exchange catches what the compiler can't: a hand-written publish
from a script, or an event published while **no** realtime queue is bound. That second case is
why each copy binds its realtime queue *before* it starts publishing (Step 3); otherwise every
startup would fill `snap.unrouted.queue` with real events that only look like typos.

### 7.5 An API copy dies

```
api 2 crashes
  → its phones' sockets drop → socket.io reconnects through nginx to api 1 or api 3
  → the app gets `connected` → refetches lists (nothing lost)
  → realtime.api-2-<random> was exclusive → RabbitMQ deletes it automatically
  → api 2 restarts with a NEW random suffix, so it never collides with its old queue
```

### 7.6 RabbitMQ is down

| What | Effect | Recovery |
|---|---|---|
| HTTP API | Works normally — all data goes to Postgres | – |
| Live pushes | Paused (publishes are logged and dropped) | App refetches on reconnect |
| Snap timers | Not started for snaps sent during the outage | Hourly safety net deletes them |
| API / worker | Keep retrying the connection (1 s → 30 s backoff) | Re-declare topology and consumers on reconnect |

---

## 8. Dead letters and unrouted messages

**Nothing happens to them automatically.** They wait until a human decides.

| Action | When | How |
|---|---|---|
| Look | Always first — find out why | Web UI → queue → *Get messages*; the `x-death` header says where it came from and how often |
| Replay | The cause is fixed | Web UI *Move messages* (shovel plugin) or `bun run dead-letters replay` |
| Delete | Can't ever succeed, or already cleaned up by the safety net | Web UI *Purge* or `bun run dead-letters purge` |
| Let expire | Automatically | 7-day TTL, max 10 000 (oldest dropped) |

In Snap a dead letter is **never lost work**: the only job is "delete expired snap X", the snap
is already invisible to users, and the hourly safety net deletes it once the cause is gone.

---

## 9. Reliability rules

1. **At least once, not exactly once.** A message can arrive twice, so every consumer must be
   safe to run twice (*idempotent*). Deleting a snap twice deletes nothing the second time;
   pushing a message twice is filtered by id in the app.
2. **Postgres first, then publish.** An event is only published after the write is committed.
3. **Ack after the work is done.** If the worker crashes mid-job, the unacked message is
   redelivered.
4. **Publisher confirms.** Channels run in confirm mode so RabbitMQ tells us it has the message.
   The worker waits for the confirm before acking the original when it schedules a retry.
5. **Prefetch.** Worker `prefetch(10)`, relay `prefetch(100)` — a consumer never holds more
   unacked messages than that.
6. **Never trust timing alone.** The worker re-checks `expires_at <= now()` in Postgres before
   deleting; a message that arrives early is acked and left to the safety net.
7. **Graceful shutdown.** On `SIGTERM`: stop consuming, finish in-flight jobs, close channel and
   connection.

---

## 10. Configuration

New variables in `backend/.env` (and `.env.example`):

| Variable | Example | Used by |
|---|---|---|
| `RABBITMQ_URL` | `amqp://snap:snap@localhost:5672` | api, worker |
| `INSTANCE_ID` | *(optional, defaults to hostname)* | api — names its realtime queue, plus a random suffix per start (see section 14) |
| `SNAP_TTL_MS` | `86400000` (24 h) | api (`expires_at`) **and** topology (timer TTL) — one value, so they can't drift |
| `SNAP_RETRY_DELAY_MS` | `30000` | worker, topology |
| `SNAP_MAX_ATTEMPTS` | `3` | worker |

⚠️ **Changing `SNAP_TTL_MS` or `SNAP_RETRY_DELAY_MS` after the queues exist:** RabbitMQ refuses to
redeclare a queue with different arguments (`PRECONDITION_FAILED`). Stop the apps, delete
`snap.expiry.wait` / `snap.retry.wait` in the web UI, restart. Timers that were waiting are lost;
the safety net covers them.

In Docker, `DATABASE_URL` and `RABBITMQ_URL` point at service names (`postgres`, `rabbitmq`)
instead of `localhost`.

### S3 credentials

Bun's `S3Client` takes credentials **only from environment variables** (`S3_*`, falling back
to `AWS_*`). Unlike the AWS SDK it can't use `~/.aws` profiles, SSO, or an IAM role on
EC2/ECS. So on every machine — laptop, CI, production — the keys arrive as env vars.

| Variable | Required | Note |
|---|---|---|
| `S3_BUCKET` | yes | |
| `S3_REGION` | yes | Must be the bucket's own region, or every request fails |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | An IAM user's key — never the root account's |
| `S3_ENDPOINT` | no | A local S3 stand-in (CI), or another S3-compatible store |
| `S3_SESSION_TOKEN` | no | Only with temporary credentials |

**Moving to your own AWS account** (Step 0):

1. **Bucket** in your region (e.g. `eu-north-1`, Stockholm). Leave *Block Public Access* on and
   default encryption on — both are the defaults. Nothing is ever public: the app only gets
   5-minute presigned links.
2. **Lifecycle rule** on the bucket: delete objects **2 days** after creation. A last-resort
   backstop if the timer, the retries and the sweep all miss a photo. (S3 counts in whole days,
   so it can't replace the 24-hour timer.)
3. **IAM user** `snap-api`, no console access, with `backend/infra/s3-policy.json` — your bucket
   name in the `Resource` ARN. It can put, get and delete objects in that one bucket, nothing else.
4. **Access key** for that user → `backend/.env`.
5. **Old key:** deactivate the `fos25-snap` key (it was exposed in a session log on 2026-10-06),
   check nothing breaks, then delete it.

Where the keys may live: `backend/.env` locally, the host's secret settings in production.
Never in the app — every `EXPO_PUBLIC_*` value is bundled into the app and readable by anyone
who has it.

---

## 11. Files

```
README.md                          new — what it is, diagrams, how to run (final version: Step 10)
.github/workflows/ci.yml           new — Step 7
docs/architecture-decisions.md     new — Step 10
docs/deployment.md                 new — Step 9
docker-compose.yml                 + rabbitmq, api, worker, nginx
infra/nginx.conf                   new — load balancer, WebSocket upgrade, 11 MB body limit
infra/rabbitmq/enabled_plugins     new — management + shovel (for "Move messages")
backend/Dockerfile                 new
backend/.dockerignore              new — keeps .env and the Mac's node_modules out of the image
backend/package-lock.json          deleted — leftover from npm; Bun uses bun.lock
backend/.env.example               + RABBITMQ_URL, SNAP_TTL_MS, S3_ENDPOINT, …
backend/package.json               + amqplib; scripts: worker, e2e, dead-letters, seed:demo, load-test
backend/infra/s3-policy.json       your own bucket name in the ARN (Step 0)
backend/src/utils/s3.ts            + optional S3_ENDPOINT, S3_SESSION_TOKEN (Step 0)
backend/src/http/routes.ts         + GET /health (Step 0), GET /health/ready (Step 8)
backend/src/config.ts              new — env values in one place (SNAP_TTL_MS, …)
backend/src/queue/connection.ts    new — connect, retry, reconnect, confirm channel
backend/src/queue/topology.ts      new — every name + declare everything (idempotent)
backend/src/queue/publish.ts       new — publishEvent(routingKey, payload)
backend/src/queue/events.ts        new — routing keys + payload types
backend/src/websocket/controllers.ts   changed — publish events instead of emitting
backend/src/websocket/relay.ts     new — consume realtime.<id>, emit to local sockets
backend/src/services.ts            changed — one snap.created per snap; deleteExpiredSnap(id)
backend/src/repository/index.ts    + getExpiredSnapById(id)
backend/src/worker.ts              new — expiry consumer, retries, safety net, queue monitor
backend/src/index.ts               changed — connect RabbitMQ + relay; drop in-process sweep
backend/src/jobs/snap-expiry.ts    moved into the worker (hourly)
backend/scripts/dead-letters.ts    new — list | replay | purge
backend/scripts/e2e.ts             new — the end-to-end test (Step 0), two base URLs (Step 3)
backend/scripts/seed-demo.ts       new — two demo users who are already friends (Step 8)
backend/scripts/load-test.ts       new — many sockets, delivery times, failover (Step 10)
snap/.env                          EXPO_PUBLIC_API_URL → nginx (:8080) in step 6
```

Sketch of the two central pieces:

```ts
// src/queue/publish.ts — what services call. Never throws into the request.
export function publishEvent<K extends RoutingKey>(key: K, payload: EventPayload<K>): void

// src/websocket/relay.ts — one per API copy
consume(realtimeQueue, (msg) => {
  switch (msg.fields.routingKey) {
    case 'message.created': emitTo([m.sender_username, m.recipient_username], 'message_received', m); break
    case 'snap.created':    emitTo(s.recipients, 'snap_received', withoutRecipients(s)); break
    // …
  }
  ack(msg)
})
```

---

## 12. Implementation steps

Each step ends with a test. We don't start the next step until it passes.

### Step 0 — Public repo, own S3 account, end-to-end test back

- [x] Public repo `devinder-dev/snap`: backend, app and this plan. No `.env` files.
- [ ] Own AWS account: bucket, lifecycle rule, IAM user, access key (section 10). Old
      `fos25-snap` key deactivated.
- [ ] `utils/s3.ts`: also pass the optional `S3_ENDPOINT` and `S3_SESSION_TOKEN`.
- [ ] `GET /health`: 200 without touching Postgres — "is this process up". Docker and the host
      call it every few seconds, so it must stay cheap (see section 14).
- [ ] `scripts/e2e.ts` (`bun run e2e`): rewrite the end-to-end test — register, friends, text
      and photo snaps (real S3 upload, presigned read, view-once), screenshot, chat, and every
      live push. Throwaway `zzt_…` users, cleaned up afterwards. One base URL for now.

✅ **Done when:** `bun run e2e` passes against your own bucket, the photo is gone from the bucket
after cleanup, and the old key shows *Inactive* in IAM.

### Step 1 — RabbitMQ running

- [ ] Add `rabbitmq:4-management` to `docker-compose.yml`: ports 5672 + 15672, volume,
      healthcheck `rabbitmq-diagnostics -q ping`, user `snap`/`snap` via
      `RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS`.
- [ ] Mount `infra/rabbitmq/enabled_plugins`:
      `[rabbitmq_management,rabbitmq_shovel,rabbitmq_shovel_management].`
- [ ] `bun add amqplib`; add `RABBITMQ_URL` to `.env` and `.env.example`.

✅ **Done when:** `docker compose up -d rabbitmq` → http://localhost:15672 opens, login `snap`/`snap`.

### Step 2 — Queue module

- [ ] `src/config.ts`: read `RABBITMQ_URL`, `SNAP_TTL_MS`, `SNAP_RETRY_DELAY_MS`, `SNAP_MAX_ATTEMPTS`.
      `services.ts` uses `SNAP_TTL_MS` from here instead of its own constant.
- [ ] `src/queue/connection.ts`: connect with backoff (1 s → 30 s), confirm channel, emit
      `ready` on (re)connect — only after the topology is declared — close cleanly on shutdown.
- [ ] `src/queue/topology.ts`: all names as constants; `declareTopology(channel)` asserts every
      exchange, queue and binding from section 5.
- [ ] `src/queue/events.ts` + `publish.ts`: routing keys, payload types, `publishEvent`.
- [ ] `src/index.ts`: connect at startup — **the HTTP server starts even if RabbitMQ is down**.

✅ **Done when:** `bun run dev` → the web UI lists `snap.events`, `snap.unrouted`,
`snap.expire`, `snap.dlx` and the durable queues; stopping RabbitMQ doesn't crash the API, and
it reconnects when RabbitMQ is back.

### Step 3 — Live pushes across servers

- [ ] `websocket/controllers.ts`: each `send…Notification` publishes its event instead of emitting.
- [ ] `services.sendSnap`: one `snap.created` with `recipients` (not one per recipient).
- [ ] `websocket/relay.ts`: declare `realtime.<INSTANCE_ID>-<random>` (exclusive), bind
      `message.*`, `snap.*`, `friend.*`, consume, emit to local rooms, ack. Re-create on reconnect.
- [ ] Publishing waits for the relay: `publishEvent` drops (and logs) until this copy's queue is
      bound, so startup and reconnects never send real events to `snap.unrouted`.
- [ ] `scripts/e2e.ts`: accept two base URLs.

✅ **Done when:** two copies run side by side (`PORT=3000 bun run dev`, `PORT=3001 bun run dev`),
the e2e test connects Anna to :3000 and Ben to :3001, and every push (message, snap, friend
request, friend accepted, screenshot) arrives on the other server. Web UI shows two
`realtime.*` queues.

### Step 4 — Worker + snap timer

- [ ] `repository.getExpiredSnapById(id)` and `services.deleteExpiredSnap(id)`: only if
      `expires_at <= now()`; S3 object first, then the row.
- [ ] `src/worker.ts` (`bun run worker`): declare topology, `prefetch(10)`, consume
      `snap.expire.queue` → `deleteExpiredSnap` → ack.
- [ ] Move the sweep out of the API into the worker; run it hourly as the safety net.

✅ **Done when:** with `SNAP_TTL_MS=20000` (delete `snap.expiry.wait` first — see section 10), a
sent snap is removed from Postgres and S3 about 20 s later **by the timer**, with the sweep not
involved (visible in the worker log).

### Step 5 — Retries, dead letters, alternate exchange

- [ ] Worker: on failure, if `x-attempt < SNAP_MAX_ATTEMPTS` → publish to `snap.retry.wait`
      with `x-attempt + 1`, wait for confirm, ack; else `nack(requeue=false)` + `DEAD-LETTERED` log.
      Invalid messages go straight to `nack(requeue=false)`.
- [ ] Worker: every 60 s check the size of `snap.dead.queue` and `snap.unrouted.queue`, log a
      warning when it grows.
- [ ] `scripts/dead-letters.ts`: `list`, `replay` (to `snap.expire`, attempt reset), `purge`.

✅ **Done when:**
- With a wrong `S3_SECRET_ACCESS_KEY` in the worker only, a job is tried 3 times (30 s apart)
  and lands in `snap.dead.queue`; after fixing the key, `bun run dead-letters replay` deletes it.
- Publishing `mesage.created` (typo) lands in `snap.unrouted.queue` and the worker warns about it.

### Step 6 — Several servers behind nginx

- [ ] `backend/Dockerfile` (`oven/bun:1.3-slim`, `bun install --frozen-lockfile --production`,
      runs as the unprivileged `bun` user, `CMD bun run src/index.ts`). Check that `bcrypt`
      (native module) installs on Linux.
- [ ] `backend/.dockerignore`: `node_modules`, `.env`, `.env.*`. Without it the image would
      contain your S3 and JWT secrets, and the Mac build of `bcrypt` would replace the Linux one.
- [ ] Delete `backend/package-lock.json` — one lockfile, `bun.lock`.
- [ ] `infra/nginx.conf`: `upstream` → `api:3000`, WebSocket upgrade headers,
      `proxy_read_timeout 1h`, `client_max_body_size 11m` (nginx's default 1 MB would reject snaps
      with a 413).
- [ ] `docker-compose.yml`: `api` (3 replicas, no host port), `worker` (1), `nginx` on 8080.
      Secrets reach the containers at runtime: `env_file: backend/.env`, with `DATABASE_URL` and
      `RABBITMQ_URL` overridden to the service names. `depends_on` with healthchecks; the api's
      calls `GET /health` with `bun -e "fetch(…)"` (don't assume `curl` is in the image).
      Migrations stay a one-off: `bun run migrate`.
- [ ] App: `EXPO_PUBLIC_API_URL=http://<your-ip>:8080`.

✅ **Done when:**
- `docker compose up -d --scale api=3` → the e2e test passes through `:8080`.
- The web UI shows three `realtime.*` queues.
- `docker compose stop` on one API container → the app reconnects to another and keeps working.

### Step 7 — CI on every push

- [ ] `.github/workflows/ci.yml`, on every push and pull request:
  - **Typecheck** backend and app.
  - **e2e with two API copies + the worker** against service containers: Postgres 17,
    RabbitMQ 4, and a local S3 stand-in through `S3_ENDPOINT`. MinIO is archived (no images
    since October 2025) — use Adobe S3Mock or SeaweedFS; pick whichever runs as a plain
    service container. CI never holds real AWS keys.
  - **`docker build`** of the backend image — a Dockerfile only exercised on deploy day breaks
    on deploy day.
  - **No secrets committed**: fail if a `.env` file is tracked or an AWS key (`AKIA…`) appears.
- [ ] CI badge at the top of the README.

✅ **Done when:** main is green, and a deliberately broken relay makes the two-server e2e fail.

### Step 8 — Ready for the public internet

- [ ] Rate-limit `/login` and `/register` (`@fastify/rate-limit`). Kept in each copy's memory —
      so the real limit is *copies × configured limit*. Fine at this size; written down as such.
- [ ] Refresh token: 10 years → 30 days. The app refreshes on its own, so only someone idle for
      a month logs in again.
- [ ] Logs: Fastify's built-in logger (pino) with `instance` on every line, and each event's
      `messageId` logged when published and when delivered — one chat message can then be
      followed api-1 → RabbitMQ → api-2.
- [ ] `GET /health/ready`: checks Postgres and RabbitMQ — for people and deploy checks, not for
      the host's frequent probe (that stays `/health`).
- [ ] Snyk code + dependency scan; fix what it finds.
- [ ] `bun run seed:demo`: two demo users who are already friends, so a visitor can try chat in
      a minute.

✅ **Done when:** the e2e passes, the 6th wrong login in a minute gets a 429, and the logs show
one message's `messageId` on two different instances.

### Step 9 — Deploy

The host is chosen here, against what the app needs:

| Need | Why |
|---|---|
| WebSockets through its load balancer, kept open for long | Live pushes |
| At least 2 API copies + 1 worker | The point of the project |
| RabbitMQ 4 | Events and jobs |
| Postgres with backups | The data |
| HTTPS / WSS with a real certificate | Phones refuse plain HTTP outside development |
| Secrets as env vars | S3 keys — Bun can't use IAM roles (section 10) |

| Option | Shape | Cost | Trade-off |
|---|---|---|---|
| One VPS + docker compose | The same compose file as locally, plus Caddy for HTTPS | A few €/month | Cheapest, matches local exactly; but one machine |
| Fly.io | Each copy on its own machine, built-in load balancer | Pay as you go | Real separate machines; RabbitMQ runs as its own app with a volume |
| Render + CloudAMQP | Like Fakturly | Paid plans for several instances and a worker | Familiar; RabbitMQ's free tier is limited |

- [ ] Choose, write `docs/deployment.md`, deploy, point the app at the `https://` URL.

✅ **Done when:** the e2e passes against the public URL, and stopping one API copy there doesn't
break a live chat.

### Step 10 — Proof and presentation

- [ ] `scripts/load-test.ts`: many sockets spread over the copies; messages per second and
      delivery time (p50 / p95). A second run kills one copy mid-test and measures how long
      until every client is back. The README gets the real numbers, whatever they are — three
      copies on one machine aren't necessarily faster; the claim is failover and cross-server
      delivery, not raw speed.
- [ ] A way to see it without the code: a short screen recording (two phones, a container
      killed, the chat carries on), plus a way to try it (Expo Go via an EAS Update QR code, or
      an Android APK — check what SDK 54 supports at that point).
- [ ] Root `README.md`, final version: what it is, the diagrams, "follow one message across
      servers", the numbers, how to run it.
- [ ] `docs/architecture-decisions.md`: the decisions from section 1 with their trade-offs —
      why RabbitMQ and not the Redis adapter, why push-only sockets, why no sticky sessions, why
      the timer *and* the sweep.

✅ **Done when:** someone who has never seen the project understands it from the README in five
minutes.

---

## 13. Testing summary

| Test | Proves |
|---|---|
| e2e, one server | Nothing broke (rewritten in Step 0) |
| e2e, two servers | Pushes cross servers through RabbitMQ |
| Short `SNAP_TTL_MS` | Timer deletes snaps (Postgres + S3) |
| Broken S3 key in worker | Retries → dead-letter queue → replay |
| Typo'd routing key | Alternate exchange catches it |
| Stop RabbitMQ | API keeps serving; reconnects; safety net cleans up |
| Stop one API container | App fails over to another copy |
| CI: two copies + RabbitMQ + S3 stand-in | Every push still crosses servers |
| e2e against the public URL | The deployment works |
| Load test, then one copy killed | Real numbers for the README; failover time |

The e2e test creates throwaway users (`zzt_…`), uploads tiny PNGs to S3, and deletes both
afterwards.

---

## 14. Gotchas we already know about

- **RabbitMQ 4 refuses non-durable shared queues** (`transient_nonexcl_queues`). Only exclusive
  queues may be non-durable.
- **Queue arguments can't change** once declared (`PRECONDITION_FAILED`) — see section 10.
- **TTL expires only at the head of a queue.** Fine for one fixed TTL; never mix different
  per-message TTLs in the same waiting room.
- **`#` bindings disable the alternate exchange** for that exchange.
- **nginx resolves `api` once at startup.** After changing the number of replicas, restart nginx.
- **nginx body limit** defaults to 1 MB — must be raised for 10 MB snaps.
- **Socket.io polling transport would need sticky sessions.** The app uses WebSocket only; keep it
  that way (`transports: ['websocket']` in `snap/lib/realtime.ts`).
- **dbmate needs `sslmode=disable`** against the local Postgres — `bun run migrate` handles it.
- **`hostname + pid` is not unique in Docker.** The pid is always 1, and a restarted container
  keeps its hostname — so the new process can meet its own old exclusive queue, still held by a
  connection RabbitMQ hasn't noticed is dead, and fail with `RESOURCE_LOCKED`. Hence the random
  suffix on every realtime queue.
- **Publishing before the relay queue is bound** sends real events to `snap.unrouted` and makes
  them look like typos. Bind first, then publish.
- **Bun's `S3Client` reads env vars only** — no IAM roles, profiles or SSO.
- **No `.dockerignore` = secrets in the image.** `COPY . .` copies `.env` too.
- **MinIO is archived** — no images since October 2025. Use another S3 stand-in in CI.
- **A health check that queries the database**, called every few seconds, keeps a free cloud
  database awake until its monthly quota runs out (Fakturly, 2026-09-23). `/health` must not
  touch Postgres.

---

## 15. Later (not in this plan)

- Direct-to-S3 uploads with presigned PUT URLs (changes `POST /snaps`).
- Expo push notifications for users with the app closed — a new consumer of `message.created`
  and `snap.created`.
- RabbitMQ cluster with quorum queues (today RabbitMQ is a single point of failure for pushes,
  not for data).
- Routing pushes only to the server a user is on, instead of every server (matters with many copies).
- PgBouncer if the number of copies grows.
- Metrics (queue depth, publish failures) in a dashboard — Step 8 only adds logs.
- Rate limits shared across copies (in Postgres or Redis) instead of per copy.

---

## 16. Cheat sheet

```bash
docker compose up -d postgres rabbitmq       # infra
cd backend && bun run migrate                # database
bun run dev                                  # one API copy on :3000
PORT=3001 bun run dev                        # a second copy
bun run worker                               # background jobs
bun run e2e                                  # end-to-end test
bun run dead-letters list|replay|purge       # dead-letter queue
docker compose up -d --scale api=3           # step 6: everything in Docker
bun run seed:demo                            # step 8: demo users
bun run load-test                            # step 10: numbers for the README
```

- RabbitMQ web UI: http://localhost:15672 (`snap` / `snap`)
- API through nginx: http://localhost:8080
