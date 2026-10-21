# Snap — scaling plan: several servers, RabbitMQ and Kubernetes

Status: **Step 0 done** (2026-10-17). The app is finished and runs on one server, on its own
S3 bucket, with a committed end-to-end test; Steps 1–12 are not started. On 2026-10-07 the plan
changed to run on **Kubernetes** — section 0 says what was planned before, what changes, and why.
Verified beforehand: `amqplib` 2.2 works under Bun 1.3.14, and every RabbitMQ feature used
below (topic routing, alternate exchange, TTL → dead-letter timer, nack → dead-letter queue)
was tested against RabbitMQ 4.

---

## 0. Plan changes

| Version | Date | The plan |
|---|---|---|
| 1 | 2026-09-30 | Several copies of the backend with RabbitMQ between them, behind nginx, run with docker compose |
| 2 | 2026-10-06 | + the portfolio goal: own S3 account, e2e test, CI, hardening, deploy, load test, docs |
| 3 | 2026-10-07 | + **Kubernetes**: the copies run in a Kubernetes cluster instead of docker compose + nginx |
| 3.1 | 2026-10-17 | Security scans: GitHub's CodeQL + Dependabot in CI instead of Snyk |

### Version 3.1 — security scans (2026-10-17)

| Topic | Before | After | Why |
|---|---|---|---|
| Code and package scans | Snyk, run by hand in Step 10 | GitHub **CodeQL** + **Dependabot**, on every push from Step 9 | Free for public repos, no extra account, and they run on every push instead of once |

Step 0 ran no scan: its changes (env vars in `s3.ts`, `/health`, the e2e script) give a scanner
little to find. The older code (login, tokens, uploads) gets its first scan from CodeQL in Step 9.

### Version 3 — Kubernetes (2026-10-07)

**Why:** to learn Kubernetes. It's what most companies run their services on, and "I deployed a
scaled app on Kubernetes" is a stronger interview story than "I ran docker compose".
Honest trade-off: for an app this size docker compose would be enough — Kubernetes adds
moving parts and costs more to host. We take that on to learn it.

**What Kubernetes does, and what it doesn't.** Kubernetes decides *where* the copies run,
restarts them when they die, sends traffic to them, and adds or removes copies. It does **not**
know that Ben's socket is on copy 2 — so the RabbitMQ relay (Steps 1–5) is still needed.
*Kubernetes runs the copies; RabbitMQ lets them talk to each other.*

| Topic | Before (version 2) | After (version 3) | Why |
|---|---|---|---|
| Running 3 copies | docker compose `--scale api=3` | Kubernetes **Deployment**, `replicas: 3` | Kubernetes keeps 3 running: if one dies it starts a new one by itself |
| Load balancer | An nginx container with our own config | A **Service** inside the cluster + **Gateway API** for traffic from outside (Traefik) | Load balancing is built in. ingress-nginx, the usual choice, was retired in March 2026; Gateway API replaces it |
| A copy hangs | Nobody notices | **Liveness probe** (`/health`) restarts it; **readiness probe** keeps traffic away until it's ready | Self-healing |
| How many copies | Always 3 | **HorizontalPodAutoscaler**: 2–6, by CPU | Real scaling under load — the load test shows it happen |
| New version | Stop the containers, start new ones | **Rolling update**: new copies start before old ones stop | No downtime on deploy |
| Hourly safety-net sweep | A timer inside the worker | A Kubernetes **CronJob** running `bun run sweep` | Runs once an hour however many workers there are |
| Database migrations | `bun run migrate` by hand | A Kubernetes **Job** before the new version starts | Part of the deploy, not something to remember |
| Secrets | `env_file: backend/.env` | A Kubernetes **Secret** made from `.env` (never committed) + a **ConfigMap** for the rest | The cluster's own way to hand settings to containers |
| Postgres, RabbitMQ | Compose services with volumes | **StatefulSets** with persistent volumes | Stable names, and data that survives restarts |
| Several copies on the laptop | docker compose | **kind** — a Kubernetes cluster inside Docker, with 3 nodes | The same tool runs in CI |
| CI | e2e against two API processes | + a kind cluster in GitHub Actions: deploy everything, run the e2e inside it | Every push proves the Kubernetes setup works, not just the code |
| Image | Built on the laptop | Pushed to **GitHub Container Registry** (ghcr.io), tagged with the commit | A cluster pulls images from a registry |
| Hosting | One VPS, Fly.io or Render | A real **Kubernetes cluster**; provider chosen at Step 11 | The deploy target is now "a cluster", wherever it runs |
| HTTPS | Caddy | **cert-manager** + Let's Encrypt | The Kubernetes way to get certificates |

**What stays the same:** Steps 0–5 — all the app code (RabbitMQ relay, worker, timer, retries,
dead letters), the HTTP API and the app. docker compose also stays, for everyday development:
Postgres and RabbitMQ on the laptop and `bun run dev` for quick changes. Kubernetes is for
running it the way production does.

| Steps before (version 2) | Steps after (version 3) |
|---|---|
| 0–5 | 0–5, unchanged |
| 6 Several servers behind nginx | 6 Docker image — nginx dropped |
| – | 7 Kubernetes on the laptop — **new** |
| – | 8 Kubernetes like production: rolling updates, autoscaling, limits — **new** |
| 7 CI on every push | 9 CI/CD — now also deploys to a kind cluster in CI |
| 8 Ready for the public internet | 10, unchanged |
| 9 Deploy (VPS, Fly.io or Render) | 11 Deploy to a real Kubernetes cluster |
| 10 Proof and presentation | 12, + autoscaling in the load test |

### Version 2 — portfolio (2026-10-06)

**Why:** use the project in job interviews and on GitHub, the way Fakturly is used.
**Before:** the plan ended when several copies worked on the laptop.
**Added:** Step 0 (own S3 account, `/health`, a committed e2e test), CI, hardening for the
public internet, deploy, a load test and docs — plus fixes from a review: a unique name for
each realtime queue, binding before publishing, and keeping `.env` out of the Docker image.

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
| Containers and Kubernetes | Dockerfile; Deployments, Services, Gateway API, probes, StatefulSets, Jobs, CronJobs, Secrets (Steps 6–7) |
| Operating on Kubernetes | Rolling updates without downtime, autoscaling, resource limits, copies spread over nodes (Step 8) |
| Failure testing | Delete a pod, kill RabbitMQ, break the S3 key — and watch it recover (section 13) |
| CI/CD with real dependencies | Every push: a Kubernetes cluster in GitHub Actions, three API copies, RabbitMQ, the e2e inside it (Step 9) |
| Running it for real | HTTPS, secrets, logs, real numbers from a load test (Steps 10–12) |

### Roadmap

| Step | What | Status |
|---|---|---|
| – | App on one server: auth, friends, snaps, chat, live pushes | ✅ 2026-09-30 |
| 0 | Public repo, own S3 account, end-to-end test back | ✅ 2026-10-17 |
| 1 | RabbitMQ running | ⬜ |
| 2 | Queue module | ⬜ |
| 3 | Live pushes across servers | ⬜ |
| 4 | Worker + snap timer | ⬜ |
| 5 | Retries, dead letters, alternate exchange | ⬜ |
| 6 | Docker image | ⬜ |
| 7 | Kubernetes on the laptop (kind) | ⬜ |
| 8 | Kubernetes like production: rolling updates, autoscaling, limits | ⬜ |
| 9 | CI/CD on every push | ⬜ |
| 10 | Ready for the public internet | ⬜ |
| 11 | Deploy to a real Kubernetes cluster | ⬜ |
| 12 | Proof and presentation | ⬜ |

After every step: run its end-to-end test, review it together, then commit and push.

### Decisions

| Question | Decision | Why |
|---|---|---|
| Message broker | **RabbitMQ 4** | Course topic; supports every pattern we need |
| Client library | **`amqplib`** (v2, ships its own types) | Most used, most examples; verified on Bun |
| Background jobs | **Separate worker process** | Scales and restarts independently of the API |
| Photo uploads | **Unchanged** (`POST /snaps` multipart through the API) | The API contract must not change |
| Cross-server pushes | **Own relay over RabbitMQ**, not the socket.io Redis adapter | Only one file emits today, so it's a small change — and it's RabbitMQ we're learning |
| Snap expiry | **RabbitMQ timer** (TTL → dead-letter) + **hourly safety-net sweep** (a Kubernetes CronJob) | Exact timing from the timer, guaranteed cleanup from the sweep. Honest trade-off: the indexed sweep alone would do the job — the timer is here to learn TTL and dead-lettering |
| App changes | **None**, except pointing `EXPO_PUBLIC_API_URL` at the Gateway | Socket events stay exactly the same |
| Code on GitHub | **Public repo `devinder-dev/snap`**, committed step by step | The history shows how it was built |
| S3 account | **Own AWS account**, IAM user with object-only access | The course bucket's key has to be replaced anyway (section 10) |
| S3 in CI | **Local S3 stand-in** through `S3_ENDPOINT` | CI never holds real AWS keys |
| Running the copies | **Kubernetes** (section 0) | To learn it; it restarts, load-balances, rolls out and scales the copies |
| Kubernetes on the laptop | **kind** CLI with `infra/kind-cluster.yaml` (3 nodes: 1 control plane, 2 workers) — not Docker Desktop's built-in cluster | Runs in Docker, which we already have; the same file creates the same cluster in GitHub Actions. Tested 2026-10-07: Docker Desktop's cluster (kind inside, too) can't see images built on the laptop (`ErrImageNeverPull`), so every build would have to go through a registry — the kind CLI loads them directly |
| Traffic into the cluster | **Gateway API** with **Traefik** | ingress-nginx is retired; Traefik is light, handles WebSockets with no extra setup, and is what k3s ships with |
| Kubernetes files | **Plain YAML + Kustomize** (built into `kubectl`), no Helm at first | Learn the objects themselves before hiding them behind a chart |
| Postgres + RabbitMQ in the cluster | **Own StatefulSets** with the official images | Learning; whether production keeps Postgres in the cluster is decided at Step 11 |
| Image registry | **GitHub Container Registry** (ghcr.io), tagged with the commit SHA | Free for public repos, next to the code; never `latest` |
| Hosting | **A Kubernetes cluster, provider chosen at Step 11** | Nothing before Step 11 depends on it, and the requirements are known by then |

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

**End-to-end test:** the September one (45 checks) lived in a temporary folder and is gone.
Step 0 rewrote it as a committed script, `bun run e2e` — 67 checks.

### Integrations

| Integration | Used for | Today | Needed for scaling |
|---|---|---|---|
| Postgres 17 (Docker) | All data | ✅ | Shared by every copy. Bun pools ~10 connections per process; Postgres allows 100 by default — fine for up to 6 api pods + worker + sweep (~80) |
| AWS S3 | Snap photos | ✅ course bucket `fos25-snap` → own account in Step 0 | Nothing. Every copy uses the same bucket |
| JWT | Auth | ✅ | Same `JWT_SECRET_KEY` on every copy. Stateless — nothing else |
| socket.io | Live pushes | ✅ one copy only | ❌ rooms live in one process's memory → **RabbitMQ relay** |
| RabbitMQ | Events + jobs | ❌ | **New** |
| Kubernetes | Running, healing and scaling N copies | ❌ | **New** — kind on the laptop (Step 7), a real cluster later (Step 11) |
| Gateway (Traefik) | Load balancer, traffic from outside | ❌ | **New** (must pass WebSockets, keep them open, allow 10 MB bodies) |
| Backend Docker image | What every pod runs | ❌ | **New** `Dockerfile` + `.dockerignore`, pushed to ghcr.io |
| Health route | Kubernetes probes checking a copy is alive | ✅ `GET /health` (Step 0) | Used by the liveness and readiness probes |
| CI/CD | Testing every push in a real cluster | ❌ | **New** GitHub Actions + kind (Step 9) |

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
                                 │  HTTPS + WebSocket
┌────────────────────────────────┼──────── Kubernetes cluster, namespace "snap" ──────┐
│                                ▼                                                    │
│                     ┌─────────────────────┐                                         │
│                     │ Gateway  (Traefik)  │  traffic from outside                   │
│                     └──────────┬──────────┘                                         │
│                                ▼                                                    │
│                     ┌─────────────────────┐                                         │
│                     │  Service  "api"     │  spreads requests over the pods         │
│                     └───┬───────┬──────┬──┘                                         │
│                         ▼       ▼      ▼                                            │
│   Deployment "api"   ┌─────┐ ┌─────┐ ┌─────┐   2–6 pods (autoscaler), identical,    │
│   + autoscaler       │ pod │ │ pod │ │ pod │   no state of their own                │
│                      └──┬──┘ └──┬──┘ └──┬──┘                                        │
│      publish events ────┤       │       ├──── each reads its own realtime queue     │
│                         ▼       ▼       ▼                                           │
│                    ┌──────────────────────┐        ┌───────────────────┐            │
│   StatefulSet      │ RabbitMQ  (+ volume) │◀──────▶│ Deployment worker │ timer jobs,│
│                    └──────────────────────┘        └───────────────────┘ retries    │
│                                                                                     │
│   StatefulSet      ┌──────────────────────┐   CronJob "sweep"   hourly safety net   │
│                    │ Postgres  (+ volume) │   Job "migrate"     before each deploy  │
│                    └──────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
          api pods + worker + sweep ──▶ AWS S3 (outside the cluster)
```

- **Gateway + Service** take the place of nginx: traffic comes in through the Gateway, and the
  Service spreads it over whichever api pods are ready.
- **API pods** handle HTTP and sockets, and *publish* an event after every write.
- **RabbitMQ** copies each event to whoever needs it.
- **Worker** does slow or scheduled work nobody should wait for.
- **Postgres and S3** stay the source of truth. RabbitMQ never holds data we can't rebuild.
- **Kubernetes** keeps the right number of each running, restarts what dies, and replaces
  pods one by one when a new version is deployed.

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

## 4b. Kubernetes in five minutes

**The one idea:** you write down what you *want* in YAML files ("3 copies of the api, a
database with a 1 GB disk, …"), hand it over with `kubectl apply`, and Kubernetes keeps working
until reality matches — and keeps checking forever. A pod dies → reality no longer matches →
Kubernetes starts a new one. Everything below follows from that.

| Kubernetes | In plain words | In Snap |
|---|---|---|
| **Cluster** | The machines Kubernetes manages | On the laptop: kind — 3 Docker containers acting as 3 machines |
| **Node** | One machine in the cluster | `snap-worker`, `snap-worker2` |
| **Pod** | One running copy of a container — the smallest thing Kubernetes runs | One API copy |
| **Deployment** | "Keep N identical pods running; on a new version, replace them one by one" | `api` (3), `worker` (1) |
| **StatefulSet** | Like a Deployment, but each pod keeps its name and its own disk | `postgres-0`, `rabbitmq-0` |
| **Service** | One stable name in front of a group of pods; spreads traffic over the ready ones | `api`, `postgres`, `rabbitmq` |
| **Gateway + HTTPRoute** | The front door: which traffic from outside goes to which Service | `:8080` → Service `api` |
| **ConfigMap / Secret** | Settings / passwords handed to pods as environment variables | `snap-config` / `snap-secrets` |
| **PersistentVolumeClaim** | "I need a disk of this size that outlives the pod" | Postgres data, RabbitMQ data |
| **Job / CronJob** | Run something to the end once / on a schedule | `migrate` / the hourly `sweep` |
| **Probe** | Kubernetes asking a pod "are you alive?" (liveness) and "can you take traffic?" (readiness) | `GET /health` |
| **HorizontalPodAutoscaler** | Changes a Deployment's number of pods based on load | api: 2–6, by CPU |
| **Namespace** | A folder for everything that belongs to one app | `snap` |

How a request finds Ben's phone, in Kubernetes words: phone → **Gateway** → **Service** `api` →
one of the **pods** → Postgres → event to RabbitMQ → every api **pod**'s realtime queue → the pod
that holds Ben's socket pushes it.

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
api pod 2 crashes
  → its phones' sockets drop → socket.io reconnects through the Gateway to pod 1 or pod 3
  → the app gets `connected` → refetches lists (nothing lost)
  → realtime.<pod-2>-<random> was exclusive → RabbitMQ deletes it automatically
  → Kubernetes notices one pod is missing and starts a replacement
  → it gets a NEW random suffix, so it never collides with the old queue
```

The same thing happens, on purpose, during every **rolling update**: Kubernetes stops old pods
one at a time, their sockets reconnect to the others, and the app refetches.

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
   connection. Kubernetes sends `SIGTERM` to every old pod on every deploy, then waits
   `terminationGracePeriodSeconds` (30 s by default) before killing it.
8. **Readiness never depends on a shared service.** If the readiness probe checked Postgres or
   RabbitMQ, one blip would mark *every* pod unready at once and the Service would have nowhere
   to send traffic — a full outage instead of a few errors. Both probes call `/health`, which
   only asks "is this process up". (That's also why the API keeps serving when RabbitMQ is down,
   section 7.6.)

---

## 10. Configuration

New variables in `backend/.env` (and `.env.example`):

| Variable | Example | Used by |
|---|---|---|
| `RABBITMQ_URL` | `amqp://snap:snap@localhost:5672` | api, worker |
| `INSTANCE_ID` | *(optional, defaults to hostname = the pod name in Kubernetes)* | api — names its realtime queue, plus a random suffix per start (see section 14) |
| `SNAP_TTL_MS` | `86400000` (24 h) | api (`expires_at`) **and** topology (timer TTL) — one value, so they can't drift |
| `SNAP_RETRY_DELAY_MS` | `30000` | worker, topology |
| `SNAP_MAX_ATTEMPTS` | `3` | worker |

⚠️ **Changing `SNAP_TTL_MS` or `SNAP_RETRY_DELAY_MS` after the queues exist:** RabbitMQ refuses to
redeclare a queue with different arguments (`PRECONDITION_FAILED`). Stop the apps, delete
`snap.expiry.wait` / `snap.retry.wait` in the web UI, restart. Timers that were waiting are lost;
the safety net covers them.

**In Kubernetes** the same variables arrive from two places:

| Where | Holds | Committed? |
|---|---|---|
| ConfigMap `snap-config` | `SNAP_TTL_MS`, `SNAP_RETRY_DELAY_MS`, `SNAP_MAX_ATTEMPTS`, `S3_BUCKET`, `S3_REGION` | Yes — nothing secret |
| Secret `snap-secrets` | `DATABASE_URL`, `RABBITMQ_URL`, `JWT_SECRET_KEY`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **Never** — created with `kubectl create secret` from a gitignored file |

Inside the cluster `DATABASE_URL` and `RABBITMQ_URL` point at the Service names (`postgres`,
`rabbitmq`) instead of `localhost` — Kubernetes' own DNS resolves them.

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

Where the keys may live: `backend/.env` locally, the Kubernetes Secret in a cluster.
Never in the app — every `EXPO_PUBLIC_*` value is bundled into the app and readable by anyone
who has it.

---

## 11. Files

```
README.md                          new — what it is, diagrams, how to run (final version: Step 12)
.github/workflows/ci.yml           new — Step 9
docs/architecture-decisions.md     new — Step 12
docs/deployment.md                 new — Step 11
docker-compose.yml                 + rabbitmq — everyday development only (Postgres + RabbitMQ)
infra/rabbitmq/enabled_plugins     new — management + shovel (for "Move messages")
infra/kind-cluster.yaml            new — kind: 1 control plane + 2 workers, port 8080 → Gateway (Step 7)
k8s/base/                          new — the app in Kubernetes, shared by every cluster (Step 7)
  kustomization.yaml                 lists everything below
  namespace.yaml                     namespace "snap"
  config.yaml                        ConfigMap snap-config (nothing secret)
  postgres.yaml                      StatefulSet + Service + volume
  rabbitmq.yaml                      StatefulSet + Service + volume + enabled_plugins
  migrate-job.yaml                   Job: run the migrations
  api.yaml                           Deployment + Service + liveness/readiness probes
  worker.yaml                        Deployment
  sweep-cronjob.yaml                 CronJob: hourly safety-net sweep
  gateway.yaml                       Gateway + HTTPRoute (Traefik)
  hpa.yaml                           HorizontalPodAutoscaler for api (Step 8)
  pdb.yaml                           PodDisruptionBudget for api (Step 8)
k8s/overlays/local/                new — kind: local image, small limits (Step 7)
k8s/overlays/cloud/                new — real cluster: ghcr.io image, TLS, bigger limits (Step 11)
k8s/overlays/ci/                   new — CI's kind cluster: S3 stand-in, e2e as a Job (Step 9)
backend/Dockerfile                 new — two targets: `app` and `migrate` (needs dbmate)
backend/.dockerignore              new — keeps .env and the Mac's node_modules out of the image
backend/package-lock.json          deleted — leftover from npm; Bun uses bun.lock
backend/.env.example               + RABBITMQ_URL, SNAP_TTL_MS, S3_ENDPOINT, …
backend/package.json               + amqplib; scripts: worker, sweep, e2e, dead-letters, seed:demo, load-test
backend/infra/s3-policy.json       your own bucket name in the ARN (Step 0)
backend/src/utils/s3.ts            + optional S3_ENDPOINT, S3_SESSION_TOKEN (Step 0)
backend/src/http/routes.ts         + GET /health (Step 0), GET /health/ready (Step 10)
backend/src/config.ts              new — env values in one place (SNAP_TTL_MS, …)
backend/src/queue/connection.ts    new — connect, retry, reconnect, confirm channel
backend/src/queue/topology.ts      new — every name + declare everything (idempotent)
backend/src/queue/publish.ts       new — publishEvent(routingKey, payload)
backend/src/queue/events.ts        new — routing keys + payload types
backend/src/websocket/controllers.ts   changed — publish events instead of emitting
backend/src/websocket/relay.ts     new — consume realtime.<id>, emit to local sockets
backend/src/services.ts            changed — one snap.created per snap; deleteExpiredSnap(id)
backend/src/repository/index.ts    + getExpiredSnapById(id)
backend/src/worker.ts              new — expiry consumer, retries, queue monitor
backend/src/index.ts               changed — connect RabbitMQ + relay; drop in-process sweep; SIGTERM
backend/src/jobs/snap-expiry.ts    becomes scripts/sweep.ts — one run, then exit (a CronJob in Kubernetes)
backend/scripts/sweep.ts           new — `bun run sweep`: the safety net, once
backend/scripts/dead-letters.ts    new — list | replay | purge
backend/scripts/e2e.ts             new — the end-to-end test (Step 0), two base URLs (Step 3)
backend/scripts/seed-demo.ts       new — two demo users who are already friends (Step 10)
backend/scripts/load-test.ts       new — load for the autoscaler (Step 8); delivery times, failover (Step 12)
snap/.env                          EXPO_PUBLIC_API_URL → the Gateway (:8080 on kind) in Step 7
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
- [x] Own AWS account: bucket `snapchatv2` (eu-north-1), lifecycle rule, IAM user `snap-api`
      with one inline policy (`backend/infra/s3-policy.json`), access key (section 10).
      Old `fos25-snap` key deactivated.
- [x] `utils/s3.ts`: also pass the optional `S3_ENDPOINT` and `S3_SESSION_TOKEN`.
- [x] `GET /health`: 200 without touching Postgres — "is this process up". Docker and the host
      call it every few seconds, so it must stay cheap (see section 14).
- [x] `scripts/e2e.ts` (`bun run e2e`): 67 checks — accounts and tokens, friends, photo snaps
      (real S3 upload, presigned download, view-once), screenshot, expiry (row and photo),
      chat with paging, removing a friend, every live push, and a stranger who must receive
      nothing. Throwaway `zzt_…` users, cleaned up afterwards. One base URL for now.
      Passes against `snapchatv2`: 67 of 67.

✅ **Done when:** `bun run e2e` passes against your own bucket, the photo is gone from the bucket
after cleanup, and the old key shows *Inactive* in IAM.

**Result (2026-10-17):** all three hold — and the old key is refused by AWS, not just marked
inactive. The app key is also proven to be least privilege: listing the bucket, listing all
buckets, reading the bucket's settings and reading IAM all get *AccessDenied*.

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
- [ ] Move the sweep out of the API into `scripts/sweep.ts` (`bun run sweep`): one run, then
      exit. On the laptop it's run by hand; in Kubernetes a CronJob runs it hourly (Step 7).
      *Changed in version 3 — before, the worker ran it on an hourly timer.*

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

### Step 6 — Docker image

*Changed in version 3 — before, this step was "several servers behind nginx" with docker compose.
nginx and the compose replicas are dropped: Kubernetes does both in Step 7.*

- [ ] `backend/Dockerfile` (`oven/bun:1.3-slim`, `bun install --frozen-lockfile --production`,
      runs as the unprivileged `bun` user). Two targets:
      - `app` — `CMD bun run src/index.ts`. The worker and the sweep use the same image with a
        different command, so there is one image to build, scan and ship.
      - `migrate` — includes dbmate (a dev dependency) and runs the migrations.

      Check that `bcrypt` (native module) installs on Linux.
- [ ] `backend/.dockerignore`: `node_modules`, `.env`, `.env.*`. Without it the image would
      contain your S3 and JWT secrets, and the Mac build of `bcrypt` would replace the Linux one.
- [ ] Delete `backend/package-lock.json` — one lockfile, `bun.lock`.
- [ ] API shuts down gracefully on `SIGTERM`: stop taking requests, close the sockets (the
      phones reconnect to another pod), stop the relay, close RabbitMQ. Kubernetes sends
      `SIGTERM` on every deploy (section 9, rule 7).

✅ **Done when:** the image builds; a container from it (pointed at the laptop's Postgres and
RabbitMQ) passes the e2e; `docker stop` shows a clean shutdown in the log within a few seconds,
not a kill after the timeout.

### Step 7 — Kubernetes on the laptop (kind)

*New in version 3. Read section 4b first.*

- [ ] Install `kind` and `kubectl` (Homebrew). `infra/kind-cluster.yaml`: 1 control plane +
      2 workers, laptop port 8080 → the Gateway.
- [ ] Gateway: install the Gateway API definitions and Traefik with its Gateway provider on.
      `gateway.yaml` sends everything to Service `api`. Check two settings: the WebSocket idle
      timeout (sockets stay open for hours) and the request-body limit (10 MB snaps).
- [ ] `postgres.yaml`, `rabbitmq.yaml`: StatefulSets with a volume each, plus a Service each.
      Readiness: `pg_isready` / `rabbitmq-diagnostics -q ping`.
- [ ] `config.yaml` (ConfigMap) and the Secret, made from a gitignored file:
      `kubectl create secret generic snap-secrets --from-env-file=k8s/overlays/local/secrets.env`
      — `DATABASE_URL` and `RABBITMQ_URL` there use the Service names (section 10).
- [ ] `migrate-job.yaml`: the `migrate` image. The api is applied after it has completed
      (`kubectl wait --for=condition=complete job/migrate`).
- [ ] `api.yaml`: Deployment, 3 replicas, settings from the ConfigMap + Secret, liveness and
      readiness probes on `/health`, Service port 80 → 3000.
- [ ] `worker.yaml` (1 replica) and `sweep-cronjob.yaml` (`0 * * * *`, `concurrencyPolicy:
      Forbid` — never two sweeps at once).
- [ ] Images into kind without a registry: `docker build` + `kind load docker-image`, with a
      fixed tag (section 14).
- [ ] App: `EXPO_PUBLIC_API_URL=http://<your-ip>:8080`.

✅ **Done when:**
- From an empty cluster, `kubectl apply -k k8s/overlays/local` → every pod Running, `migrate`
  Completed.
- The e2e passes through the Gateway: `E2E_BASE_URL=http://localhost:8080`, with
  `DATABASE_URL` pointing at `kubectl port-forward svc/postgres 5435:5432` — the test's setup
  and cleanup must talk to the cluster's database, not the laptop's.
- The RabbitMQ web UI (`kubectl port-forward svc/rabbitmq 15672`) shows three `realtime.*`
  queues — one per api pod.
- `kubectl delete pod <an api pod>` in the middle of a chat → the app reconnects, Kubernetes
  starts a replacement, its new realtime queue appears and the old one disappears.
- `kubectl create job --from=cronjob/sweep sweep-now` runs the sweep once, successfully.

### Step 8 — Kubernetes like production

*New in version 3.*

- [ ] Resource requests and limits on every container. The autoscaler measures CPU as a
      percentage of the request, so without one it can't work.
- [ ] metrics-server (in kind it needs `--kubelet-insecure-tls`) and `hpa.yaml`: api between
      2 and 6 pods, aiming at 70 % CPU.
- [ ] Rolling updates: `maxUnavailable: 0`, `maxSurge: 1`, and a short `preStop` pause so the
      Service stops sending a pod traffic *before* it shuts down.
- [ ] `pdb.yaml`: PodDisruptionBudget, at least 1 api pod running during maintenance.
- [ ] `topologySpreadConstraints`: api pods spread over both worker nodes — copies on different
      "machines", even on the laptop.
- [ ] `scripts/load-test.ts`, first version: many sockets sending messages, enough to load the
      CPU. Step 12 adds the measurements.
- [ ] Image tags are the commit SHA, never `latest`.

✅ **Done when:**
- The e2e runs in a loop while `kubectl rollout restart deployment/api` replaces every pod →
  zero failed checks.
- The load test pushes the autoscaler from 2 pods up, and it scales back down to 2 afterwards
  (`kubectl get hpa -w`).
- `kubectl drain` on one worker node → its api pods move to the other node, never fewer than 1
  running, and the e2e still passes.

### Step 9 — CI/CD on every push

*Changed in version 3 — before, this was Step 7 and tested two API processes; now it deploys
the Kubernetes files to a throwaway cluster and tests that.*

- [ ] `.github/workflows/ci.yml`, on every push and pull request:
  - **Typecheck** backend and app.
  - **Build** both image targets.
  - **A kind cluster** in GitHub Actions: load the images, `kubectl apply -k k8s/overlays/ci`,
    wait for every rollout, then run the **e2e as a Job inside the cluster** with 3 api pods.
  - **S3 stand-in** inside the cluster through `S3_ENDPOINT`, so CI never holds real AWS keys.
    MinIO is archived (no images since October 2025) — use Adobe S3Mock or SeaweedFS.
    Presigned links carry the stand-in's hostname, which only resolves inside the cluster —
    that's why the e2e runs there too.
  - **No secrets committed**: fail if a `.env` file is tracked or an AWS key (`AKIA…`) appears.
- [ ] Security scans on every push, free for public repos: **CodeQL** reads the code for
      dangerous patterns; **Dependabot** warns about known holes in the npm packages and opens
      update pull requests.
- [ ] On `main` only: push the `app` and `migrate` images to ghcr.io, tagged with the commit SHA.
- [ ] CI badge at the top of the README.

✅ **Done when:** main is green; a deliberately broken relay makes the in-cluster e2e fail; the
images appear under the repo's *Packages* on GitHub.

### Step 10 — Ready for the public internet

*Unchanged in version 3 apart from its number (was Step 8).*

- [ ] Rate-limit `/login` and `/register` (`@fastify/rate-limit`). Kept in each pod's memory —
      so the real limit is *pods × configured limit*, and the autoscaler changes the number of
      pods. Fine at this size; written down as such.
- [ ] Refresh token: 10 years → 30 days. The app refreshes on its own, so only someone idle for
      a month logs in again.
- [ ] Logs: Fastify's built-in logger (pino) with `instance` (the pod name) on every line, and
      each event's `messageId` logged when published and when delivered — one chat message can
      then be followed pod 1 → RabbitMQ → pod 2 with `kubectl logs`.
- [ ] `GET /health/ready`: checks Postgres and RabbitMQ — for people and deploy checks, **not**
      for the probes (section 9, rule 8).
- [ ] Go through what CodeQL and Dependabot (Step 9) report, and scan the image; fix what they
      find.
- [ ] `bun run seed:demo`: two demo users who are already friends, so a visitor can try chat in
      a minute.

✅ **Done when:** the e2e passes, the 6th wrong login in a minute gets a 429, and the logs show
one message's `messageId` on two different pods.

### Step 11 — Deploy to a real Kubernetes cluster

*Changed in version 3 — before, this was Step 9 and chose between a VPS with docker compose,
Fly.io and Render. Now the target is a Kubernetes cluster; only the provider is still open.*

What the cluster needs:

| Need | Why |
|---|---|
| At least 2 worker nodes | Copies on different machines |
| A public IP or load balancer for the Gateway | Traffic in |
| Persistent volumes | Postgres and RabbitMQ data |
| A domain or subdomain + cert-manager (Let's Encrypt) | Phones refuse plain HTTP outside development |
| Postgres backups | A CronJob: `pg_dump` → S3 (its own prefix or bucket) |

| Option | Shape | Cost | Trade-off |
|---|---|---|---|
| k3s on 2–3 small VPSs | You install Kubernetes yourself; k3s ships with Traefik | Lowest | Most learning — you also run the control plane and its upgrades |
| Managed, free control plane (e.g. DigitalOcean, Akamai/Linode, Civo) | The provider runs the control plane; you pay for the nodes | Low to medium | Real managed Kubernetes without big-cloud prices |
| Big cloud (GKE, EKS, AKS) | Managed; the names on most job ads | Highest — EKS also charges for the control plane | Best on a CV; easiest to overspend — set a budget alert first |

Prices change; compare them when we get here.

- [ ] Choose the provider, and whether Postgres stays in the cluster (with the backup CronJob)
      or moves to a managed database.
- [ ] `k8s/overlays/cloud`: images from ghcr.io, TLS, real resource sizes.
- [ ] CD: on `main`, after CI passes, GitHub Actions applies the cloud overlay with the new
      image tag — using a service account that can only touch the `snap` namespace.
- [ ] `docs/deployment.md`. Point the app at the `https://` URL.

✅ **Done when:** the e2e passes against the public URL; deleting an api pod there doesn't
break a live chat; a deploy from CI causes no failed requests.

### Step 12 — Proof and presentation

*Was Step 10; version 3 adds the autoscaler and Kubernetes to what gets shown.*

- [ ] `scripts/load-test.ts`, final version: many sockets spread over the pods; messages per
      second and delivery time (p50 / p95); **pods over time** as the autoscaler reacts; a pod
      deleted mid-test and how long until every client is back. The README gets the real
      numbers, whatever they are.
- [ ] A way to see it without the code: a short screen recording (two phones, `kubectl delete
      pod`, the chat carries on, the autoscaler adding pods), plus a way to try it (Expo Go via
      an EAS Update QR code, or an Android APK — check what SDK 54 supports at that point).
- [ ] Root `README.md`, final version: what it is, the diagrams, "follow one message across
      pods", the numbers, how to run it.
- [ ] `docs/architecture-decisions.md`: the decisions from section 1 with their trade-offs —
      why RabbitMQ and not the Redis adapter, why push-only sockets, why no sticky sessions, why
      the timer *and* the sweep, why Kubernetes for an app this size, why Gateway API.

✅ **Done when:** someone who has never seen the project understands it from the README in five
minutes.

---

## 13. Testing summary

| Test | Proves | Step |
|---|---|---|
| e2e, one server | Nothing broke (67 checks) | 0 |
| e2e, two servers | Pushes cross servers through RabbitMQ | 3 |
| Short `SNAP_TTL_MS` | Timer deletes snaps (Postgres + S3) | 4 |
| Broken S3 key in worker | Retries → dead-letter queue → replay | 5 |
| Typo'd routing key | Alternate exchange catches it | 5 |
| Stop RabbitMQ | API keeps serving; reconnects; safety net cleans up | 5 |
| e2e through the Gateway on kind | The app works in Kubernetes | 7 |
| Delete an api pod | The app reconnects to another; Kubernetes replaces the pod | 7 |
| e2e in a loop during a rolling update | Deploys cause no downtime | 8 |
| Load test | The autoscaler adds pods, then removes them | 8 |
| Drain a node | Pods move; at least one stays up | 8 |
| CI: kind cluster, 3 api pods, e2e inside it | Every push still crosses pods | 9 |
| e2e against the public URL | The deployment works | 11 |
| Load test with a pod deleted mid-way | Real numbers for the README; failover time | 12 |

The e2e test creates throwaway users (`zzt_…`), uploads tiny PNGs to S3, and deletes both
afterwards.

---

## 14. Gotchas we already know about

**RabbitMQ**
- **RabbitMQ 4 refuses non-durable shared queues** (`transient_nonexcl_queues`). Only exclusive
  queues may be non-durable.
- **Queue arguments can't change** once declared (`PRECONDITION_FAILED`) — see section 10.
- **TTL expires only at the head of a queue.** Fine for one fixed TTL; never mix different
  per-message TTLs in the same waiting room.
- **`#` bindings disable the alternate exchange** for that exchange.
- **The hostname alone is not unique enough.** A pod that restarts (or a Docker container) keeps
  its hostname, so the new process can meet its own old exclusive queue, still held by a
  connection RabbitMQ hasn't noticed is dead, and fail with `RESOURCE_LOCKED`. Hence the random
  suffix on every realtime queue.
- **Publishing before the relay queue is bound** sends real events to `snap.unrouted` and makes
  them look like typos. Bind first, then publish.
- **RabbitMQ needs a StatefulSet, not a Deployment.** It stores its data under its own hostname;
  a Deployment gives the pod a new name on every restart, and RabbitMQ wouldn't find its data.

**Kubernetes**
- **ingress-nginx is retired** (March 2026) — no more security fixes. Use Gateway API.
- **The Gateway must keep WebSockets open and accept 10 MB bodies** — check the controller's
  idle timeout and body limit (nginx's 1 MB default was the old version of this problem).
- **kind can't pull an image that only exists on the laptop.** `kind load docker-image`, and a
  fixed tag: with `:latest` Kubernetes always tries to pull → `ErrImagePull`. Docker Desktop's
  own Kubernetes has no such command — its nodes don't see the laptop's images at all.
- **The control-plane node takes no app pods** (it has a taint). "2 nodes" in kind or Docker
  Desktop means 1 control plane + 1 worker — so every pod lands on the same machine. Spreading
  and draining (Step 8) need 2 workers: 3 nodes.
- **The Mac is arm64; GitHub's runners and most cloud nodes are amd64.** An image built on the
  laptop won't run on an amd64 cluster. CI builds its own; images for ghcr.io are built for
  both (`docker buildx --platform linux/amd64,linux/arm64`).
- **Deleting a StatefulSet keeps its volumes.** On purpose — the data survives. To start from
  scratch, delete the PersistentVolumeClaims too.
- **The autoscaler needs CPU requests and metrics-server.** Without them `kubectl get hpa` shows
  `<unknown>`. In kind, metrics-server needs `--kubelet-insecure-tls`.
- **A Secret is base64, not encryption.** Anyone who can read the YAML can read the password —
  never commit one.
- **Readiness must not check Postgres or RabbitMQ** — see section 9, rule 8.
- **Presigned links carry the S3 endpoint's hostname.** With an in-cluster S3 stand-in, whoever
  downloads the photo must be inside the cluster — hence the e2e as a Job in CI.

**Everything else**
- **Socket.io polling transport would need sticky sessions.** The app uses WebSocket only; keep it
  that way (`transports: ['websocket']` in `snap/lib/realtime.ts`).
- **dbmate needs `sslmode=disable`** against the local Postgres — `bun run migrate` handles it.
- **Bun's `S3Client` reads env vars only** — no IAM roles, profiles or SSO.
- **IAM changes take a few seconds to spread.** A key that was just created or switched back on
  can fail with `InvalidAccessKeyId` for a few seconds (seen 2026-10-17) — retry before debugging.
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
- RabbitMQ with three nodes and quorum queues, run by the RabbitMQ Cluster Operator (today
  RabbitMQ is a single point of failure for pushes, not for data).
- Routing pushes only to the pod a user is on, instead of every pod (matters with many pods).
- GitOps with Argo CD: the cluster pulls its desired state from the repo instead of CI pushing it.
- Prometheus + Grafana: queue depth, publish failures, pods over time — Step 10 only adds logs.
- Secrets from a vault (External Secrets or Sealed Secrets) instead of `kubectl create secret`.
- A Helm chart for the whole app, once the plain YAML is understood.
- PgBouncer if the number of pods grows.
- Rate limits shared across pods (in Postgres or Redis) instead of per pod.

---

## 16. Cheat sheet

```bash
# Everyday development (docker compose)
docker compose up -d postgres rabbitmq       # infra on the laptop
cd backend && bun run migrate                # database
bun run dev                                  # one API copy on :3000
PORT=3001 bun run dev                        # a second copy
bun run worker                               # background jobs
bun run sweep                                # the safety net, once
bun run e2e                                  # end-to-end test
bun run dead-letters list|replay|purge       # dead-letter queue

# Kubernetes on the laptop (from Step 7)
kind create cluster --name snap --config infra/kind-cluster.yaml
kind load docker-image snap-api:<tag> --name snap
kubectl apply -k k8s/overlays/local          # everything
kubectl -n snap get pods -o wide             # what runs where
kubectl -n snap logs deploy/api -f           # logs from one api pod
kubectl -n snap delete pod <api pod>         # fail one copy on purpose
kubectl -n snap rollout restart deployment/api
kubectl -n snap get hpa -w                   # watch the autoscaler (Step 8)
kubectl -n snap port-forward svc/rabbitmq 15672   # RabbitMQ web UI
kind delete cluster --name snap              # throw it all away

bun run seed:demo                            # demo users (Step 10)
bun run load-test                            # load (Step 8), numbers (Step 12)
```

- RabbitMQ web UI: http://localhost:15672 (`snap` / `snap`)
- API through the Gateway on kind: http://localhost:8080
