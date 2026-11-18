# Snap — scaling plan: several servers and RabbitMQ

*A local working document: not in the repository since 2026-11-18 (version 4.2). Code and
committed docs never point to it.*

Status: **Step 9b done** (2026-11-18), **plan version 4.1** (2026-11-18). The whole backend runs
as it will on the server: `docker compose` starts Traefik in front of three api copies, the
worker, and the migrations before them. Every live push goes through RabbitMQ, so a message
reaches the phone whichever copy holds its socket; a copy that dies drops out of Traefik, and
its phones reconnect to another one by themselves. A worker deletes each snap when its 24-hour
timer runs out, retries a failed delete, then parks it in `snap.dead.queue`. **GitHub Actions**
now runs that same stack and the e2e on every push, and on `main` publishes the images to
ghcr.io (amd64 + arm64, tagged with the commit SHA); CodeQL and Dependabot watch the code and
the dependencies. Step 9b fixed what an independent code review found (version 4.1). Steps 10–12 (public-internet hardening, deploy to one VPS, proof) are not
started (Step 8 was dropped). Version 4 runs the copies with **docker
compose behind Traefik** instead of Kubernetes — section 0 says what changed and why.
Verified beforehand: `amqplib` 2.2 works under Bun 1.3.14, and every RabbitMQ feature used
below (topic routing, alternate exchange, TTL → dead-letter timer, nack → dead-letter queue)
was tested against RabbitMQ 4.

**Continuing from here:** the roadmap (section 1) shows the next open step; its checklist and
"Done when" are in section 12. After every step: run its test, review it, then update the status
line, the roadmap row and the step's checkboxes plus a short **Result** note, then commit and
push.

---

## 0. Plan changes

| Version | Date | The plan |
|---|---|---|
| 1 | 2026-09-30 | Several copies of the backend with RabbitMQ between them, behind nginx, run with docker compose |
| 2 | 2026-10-06 | + the portfolio goal: own S3 account, e2e test, CI, hardening, deploy, load test, docs |
| 3 | 2026-10-07 | + **Kubernetes**: the copies run in a Kubernetes cluster instead of docker compose + nginx |
| 3.1 | 2026-10-17 | Security scans: GitHub's CodeQL + Dependabot in CI instead of Snyk |
| 3.2 | 2026-10-21 | Local Docker setup: Snap's own Postgres, ports for this laptop only |
| 4 | 2026-11-17 | **docker compose + Traefik** instead of Kubernetes for Steps 6–12; Step 8 dropped |
| 4.1 | 2026-11-18 | **Step 9b** added: fixes from an independent code review; more checks for Steps 10–11 |
| 4.2 | 2026-11-18 | This plan leaves GitHub: kept on the laptop only; comments in the repo stand on their own. A comment pass at the end (Step 12) |

### Version 4.2 — the plan stays on the laptop (2026-11-18)

**Why:** Devinder's choice — the plan is a working document (status, process, test notes), not
part of the public project. The repo's README and code comments explain the system on their
own; the public write-up of the decisions comes in Step 12.

| Topic | Before | After | Why |
|---|---|---|---|
| `SCALING-PLAN.md` | Committed, linked from the README | Untracked, hidden in `.git/info/exclude`, kept up to date locally | Not public |
| References in the repo | ~35 comments like "see SCALING-PLAN.md section 9, rule 7" | Comments that explain themselves; the topology picture moved into `queue/topology.ts` | A public reader can't follow a link into a file they don't have |
| Git history | The plan is in 13 older commits | Left as it is (no rewrite) | A rewrite would change every commit hash and break the ghcr image tags; nothing in the plan is secret |
| Comments at the end | – | Step 12: GitHub keeps only short, important comments; the fully commented version stays local | Devinder's choice (see Step 12) |

### Version 4.1 — Step 9b, fixes from a code review (2026-11-18)

**Why:** after Step 9, an independent reviewer read Steps 0–7 with no access to the running
system. Every claim was checked against the code before acting; five were reproduced on the old
code first (Step 9b's result). Fixing them before Step 10 keeps the hardening step about the
public internet, not about bugs that were already there.

| Topic | Before | After | Why |
|---|---|---|---|
| Retry copies and replay | Acked the original after a publisher confirm | Acked only once a queue has the copy (`mandatory` + no return) | RabbitMQ also confirms a message that reached no queue — and drops it |
| A relay rebuilt after a RabbitMQ blip | Nothing told the phones that stayed connected | Their socket connections are closed, so they reconnect and refetch | An open chat silently missed what was sent during the gap |
| Sweep with failing S3 deletes | Exit 0; stopped at a batch where every delete failed | Exit 1 with counts; pages past the failed rows | cron must see a failure, and one bad batch mustn't block the rest |
| A photo snap during its upload | Already in the inbox and openable — the one view used up, no photo | Shown and openable only once the photo is attached | A user-visible bug |
| Rule 1 "at least once" | One promise for everything | A guarantee per hop (section 9) | RabbitMQ's own dead-letter moves are at most once |
| Steps 10 and 11 | – | More checks from the review (marked there) | Backpressure, readiness, shutdown, production compose, rollout and restore tests |

**Part 2 (same day):** the reviewer read the fixes too. Four more points held up and were
fixed the same way (part 2 in Step 9b): phones that connect *before* a copy's first relay start
missed the resync; an `error` event during `setup()` had no listener and would crash the
process; a photo could be attached to an already expired snap; and paging the sweep by
timestamp could repeat the same page forever (millisecond vs microsecond). Replay now targets
the work queue by name. One claim didn't hold: a close slipping in between `setup()` returning
and amqplib's own listener — nothing waits in between, so no event can arrive there.

### Version 4 — docker compose instead of Kubernetes (2026-11-17)

**Why:** Kubernetes is already shown in another project of mine, Relay (k3s on a VPS, CI/CD,
probes, zero-downtime and rollback tests, autoscaling). Doing it a second time here would mostly
repeat the same lessons. What only Snap shows is the realtime part: live sockets across several
copies, RabbitMQ fan-out per copy, retries and dead letters, and a copy dying mid-chat. So
Steps 3–5 stay exactly as planned, and the copies run with docker compose behind Traefik —
enough to prove the scaling, with much less to build and host. Each project now proves
something different.

**What we give up:** copies spread over several machines, autoscaling, PodDisruptionBudgets,
Gateway API, and a Kubernetes cluster in CI. Everything runs on one machine, so "a copy dies"
means a process dies, not a server. The Docker image and graceful shutdown from Step 6 make
moving to Kubernetes later a move, not a rewrite (section 15).

| Topic | Before (version 3) | After (version 4) | Why |
|---|---|---|---|
| Running 3 copies | Kubernetes Deployment, `replicas: 3` | docker compose, `deploy.replicas: 3` | Enough to prove pushes cross copies |
| Load balancer | Service + Gateway API (Traefik) | A **Traefik** container with its Docker provider | Docker tells it at once when a copy starts, becomes healthy or stops, and it only routes to healthy copies (free nginx can re-resolve names since 1.27.3, but only notices a dead copy when a request fails; Caddy polls DNS and runs its own checks); passes WebSockets as they are; gets Let's Encrypt certificates itself (Step 11); already known from Relay. *Corrected 2026-11-17: this said nginx resolves names only at startup, which is out of date.* |
| A copy hangs | Liveness probe restarts it | Compose `healthcheck` on `/health`; Traefik stops sending traffic to an unhealthy copy | Docker restarts a copy that crashes, not one that only hangs (section 14) |
| How many copies | Autoscaler, 2–6 | Always 3 | Autoscaling is shown in Relay |
| New version | Rolling update | Own deploy script in Step 11: start new copies, wait until healthy, stop the old ones | Compose has no rolling update; doing it by hand shows what one is |
| Hourly sweep | Kubernetes CronJob | `docker compose run --rm sweep`, run hourly by cron on the server | Still runs once an hour however many workers there are |
| Migrations | Kubernetes Job | A `migrate` service; the api waits for it (`service_completed_successfully`) | Same order, compose's own way |
| Secrets | Kubernetes Secret + ConfigMap | `backend/.env` on the laptop, a `.env` file on the server (mode 600) | Never committed, as before |
| Postgres, RabbitMQ | StatefulSets with volumes | Compose services with volumes (as today) | Already works |
| Several copies on the laptop | kind, 3 nodes | The same compose files as the server, plus override files | One tool from laptop to server |
| CI | kind cluster in GitHub Actions, e2e as a Job | The whole stack in compose in GitHub Actions, e2e as a container on its network | Still proves every push crosses copies, without a cluster |
| Image targets | `app` + `migrate` | `app` + `tools` (dev dependencies: dbmate for migrations, socket.io-client for the e2e) | The e2e must run inside the compose network in CI, so it needs an image too |
| Hosting | A Kubernetes cluster | **One VPS** with docker compose; provider chosen at Step 11 | Cheapest; nothing before Step 11 depends on it |
| HTTPS | cert-manager | Traefik's built-in Let's Encrypt | One moving part fewer |

| Steps before (version 3) | Steps after (version 4) |
|---|---|
| 0–5 | 0–5, unchanged (0–3 already done) |
| 6 Docker image | 6, with a `tools` target instead of `migrate` |
| 7 Kubernetes on the laptop (kind) | 7 Several copies on the laptop: docker compose + Traefik |
| 8 Kubernetes like production | **Dropped** — what's useful without Kubernetes moved to Steps 9, 11 and 12 |
| 9 CI/CD with a kind cluster | 9 CI/CD with the whole stack in compose |
| 10 Ready for the public internet | 10, unchanged apart from wording |
| 11 Deploy to a real Kubernetes cluster | 11 Deploy to one VPS with docker compose |
| 12 Proof, with the autoscaler | 12 Proof: 1 copy vs 3, failover time |

### Version 3.2 — local Docker setup (2026-10-21)

| Topic | Before | After | Why |
|---|---|---|---|
| Postgres on the laptop | Borrowed from an older copy of the project (Snap-v0): same `container_name: snap-postgres`, same port | Its own container and volume; compose project `name: snap`, no `container_name` | Two projects can't share a fixed container name, and Snap-v2 never had a database of its own. The old one held 0 users, so nothing was lost |
| Container names | Fixed with `container_name` | Compose's own: `snap-postgres-1`, `snap-rabbitmq-1` | Unique per project, and `docker compose up --scale` works |
| Project folder in Postgres | Mounted at `/volume` | Not mounted | Postgres could read `backend/.env`; it only needs its data volume |
| Published ports | `0.0.0.0` — reachable from the whole Wi-Fi | `127.0.0.1` — this laptop only | `postgres`/`postgres` and `snap`/`snap` are fine passwords on a laptop, not on a café network. The phone only talks to the API (:3000), so it's unaffected |

### Version 3.1 — security scans (2026-10-17)

| Topic | Before | After | Why |
|---|---|---|---|
| Code and package scans | Snyk, run by hand in Step 10 | GitHub **CodeQL** + **Dependabot**, on every push from Step 9 | Free for public repos, no extra account, and they run on every push instead of once |

Step 0 ran no scan: its changes (env vars in `s3.ts`, `/health`, the e2e script) give a scanner
little to find. The older code (login, tokens, uploads) gets its first scan from CodeQL in Step 9.

### Version 3 — Kubernetes (2026-10-07)

*Replaced by version 4 for Steps 6–12. Kept as history.*

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
| Containers | One image for api, worker and sweep; graceful shutdown; health checks; 3 copies behind Traefik (Steps 6–7) |
| Failure testing | Kill a copy mid-chat, stop RabbitMQ, break the S3 key — and watch it recover (section 13) |
| CI/CD with real dependencies | Every push: the whole stack in GitHub Actions, three API copies, RabbitMQ, the e2e across copies (Step 9) |
| Running it for real | HTTPS, secrets, logs, backups, a deploy without downtime done by hand, real numbers from a load test (Steps 10–12) |

Kubernetes is shown in another project (Relay). Here the point is the realtime scaling itself.

### Roadmap

| Step | What | Status |
|---|---|---|
| – | App on one server: auth, friends, snaps, chat, live pushes | ✅ 2026-09-30 |
| 0 | Public repo, own S3 account, end-to-end test back | ✅ 2026-10-17 |
| 1 | RabbitMQ running | ✅ 2026-10-21 |
| 2 | Queue module | ✅ 2026-11-17 |
| 3 | Live pushes across servers | ✅ 2026-11-17 |
| 4 | Worker + snap timer | ✅ 2026-11-17 |
| 5 | Retries, dead letters, alternate exchange | ✅ 2026-11-17 |
| 6 | Docker image | ✅ 2026-11-17 |
| 7 | Several copies on the laptop: docker compose + Traefik | ✅ 2026-11-17 |
| 8 | ~~Kubernetes like production~~ | Dropped in version 4 |
| 9 | CI/CD on every push | ✅ 2026-11-18 |
| 9b | Fixes from a code review *(added in version 4.1)* | ✅ 2026-11-18 |
| 10 | Ready for the public internet | ⬜ |
| 11 | Deploy to one VPS with docker compose | ⬜ |
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
| Snap expiry | **RabbitMQ timer** (TTL → dead-letter) + **hourly safety-net sweep** (run by cron on the server) | Exact timing from the timer, guaranteed cleanup from the sweep. Honest trade-off: the indexed sweep alone would do the job — the timer is here to learn TTL and dead-lettering |
| App changes | **None**, except pointing `EXPO_PUBLIC_API_URL` at Traefik | Socket events stay exactly the same |
| Code on GitHub | **Public repo `devinder-dev/snap`**, committed step by step | The history shows how it was built |
| S3 account | **Own AWS account**, IAM user with object-only access | The course bucket's key has to be replaced anyway (section 10) |
| S3 in CI | **Local S3 stand-in** through `S3_ENDPOINT` | CI never holds real AWS keys |
| Running the copies | **docker compose**: 3 api copies + 1 worker (section 0, version 4) | Enough to prove the scaling; Kubernetes is shown in Relay |
| Load balancer | **Traefik** with its Docker provider | Picks up copies as they start and stop and follows Docker's health status, passes WebSockets, gets certificates itself; no sticky sessions needed (section 2). Compared with Caddy and nginx on 2026-11-17 and kept: the deploy in Step 11 needs instant, health-aware discovery. Cost: Traefik reads the Docker socket |
| Compose files | **One base file + an override file per place** (laptop stack, CI, server), merged with `-f` | Each place changes only what differs — the same idea as Kustomize overlays |
| Postgres + RabbitMQ | **Containers with volumes**, as today | Whether production keeps Postgres on the VPS (with backups) or uses a managed database is decided at Step 11 |
| Image registry | **GitHub Container Registry** (ghcr.io), tagged with the commit SHA | Free for public repos, next to the code; never `latest` |
| Hosting | **One VPS, provider chosen at Step 11** | Nothing before Step 11 depends on it |

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
| Postgres 17 (Docker) | All data | ✅ | Shared by every copy. Bun pools ~10 connections per process; Postgres allows 100 by default — fine for 3 api copies + worker + sweep (~50) |
| AWS S3 | Snap photos | ✅ course bucket `fos25-snap` → own account in Step 0 | Nothing. Every copy uses the same bucket |
| JWT | Auth | ✅ | Same `JWT_SECRET_KEY` on every copy. Stateless — nothing else |
| socket.io | Live pushes | ✅ one copy only | ❌ rooms live in one process's memory → **RabbitMQ relay** |
| RabbitMQ | Events + jobs | ❌ | **New** |
| docker compose (whole stack) | Running, restarting and load-balancing N copies | ✅ Postgres + RabbitMQ only | **New** — 3 api copies + worker + Traefik (Step 7), the same on the server (Step 11) |
| Traefik | Load balancer, traffic from outside | ❌ | **New** (must pass WebSockets, keep them open, allow 10 MB bodies) |
| Backend Docker image | What every container runs | ❌ | **New** `Dockerfile` + `.dockerignore`, pushed to ghcr.io |
| Health route | Checking a copy is alive | ✅ `GET /health` (Step 0) | The compose healthcheck; Traefik only sends traffic to healthy copies |
| CI/CD | Testing every push with the whole stack | ❌ | **New** GitHub Actions + docker compose (Step 9) |

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
┌────────────────────────────────┼──────── one server, docker compose project "snap" ─┐
│                                ▼                                                    │
│                     ┌───────────────────────────┐                                   │
│                     │          Traefik          │  HTTPS; spreads requests over     │
│                     └───┬─────────┬─────────┬───┘  the healthy api copies           │
│                         ▼         ▼         ▼                                       │
│   service "api"     ┌───────┐ ┌───────┐ ┌───────┐   3 identical copies,             │
│   3 replicas        │ api-1 │ │ api-2 │ │ api-3 │   no state of their own           │
│                     └───┬───┘ └───┬───┘ └───┬───┘                                   │
│      publish events ────┤         │         ├──── each reads its own realtime queue │
│                         ▼         ▼         ▼                                       │
│                    ┌──────────────────────┐        ┌───────────────────┐            │
│                    │ RabbitMQ  (+ volume) │◀──────▶│ worker            │ timer jobs,│
│                    └──────────────────────┘        └───────────────────┘ retries    │
│                                                                                     │
│                    ┌──────────────────────┐   sweep     hourly safety net (cron)    │
│                    │ Postgres  (+ volume) │   migrate   runs before the api starts  │
│                    └──────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
          api copies + worker + sweep ──▶ AWS S3 (outside the server)
```

- **Traefik** takes the place of nginx (version 1) and of the Gateway + Service (version 3):
  traffic comes in through it, and it spreads requests over whichever api copies are healthy.
- **API copies** handle HTTP and sockets, and *publish* an event after every write.
- **RabbitMQ** copies each event to whoever needs it.
- **Worker** does slow or scheduled work nobody should wait for.
- **Postgres and S3** stay the source of truth. RabbitMQ never holds data we can't rebuild.
- **docker compose** starts the right number of each and restarts a copy that crashes. Unlike
  Kubernetes it doesn't move copies to another machine or replace them one by one on a
  deploy — Step 11 does that last part with a small script (section 4b).

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

## 4b. Several copies with docker compose

*The Kubernetes version of this section (plan version 3) is in the git history.*

**The one idea:** the compose files say what should run ("3 copies of the api, 1 worker,
Traefik in front"), `docker compose up -d` starts it, and Docker keeps the containers running.
It's the same "write down what you want" idea as Kubernetes, on one machine and with fewer
guarantees.

| docker compose | In plain words | In Snap |
|---|---|---|
| **Service** | One kind of container and its settings | `api`, `worker`, `traefik`, `postgres`, `rabbitmq` |
| **Replicas** (`deploy.replicas`) | How many identical containers of a service run | api: 3 |
| **Container name** | `<project>-<service>-<n>`; other containers on the network can use it as a hostname | `snap-api-1`, `snap-api-2`, `snap-api-3` |
| **Service name** | One hostname for a service, inside the compose network | `postgres`, `rabbitmq` in `DATABASE_URL` / `RABBITMQ_URL` |
| **Healthcheck** | A command Docker runs every few seconds: healthy or not | `GET /health` |
| **Restart policy** | Start the container again when its process exits | `unless-stopped` |
| **`depends_on` + condition** | Start this after that one is healthy, or has finished | api waits for `migrate` to finish |
| **Profile** | Services that only start when asked for by name | `sweep`, `e2e` |
| **Override file** (`-f a.yml -f b.yml`) | A second file that changes only what differs | `compose.stack.yml`, `compose.ci.yml`, `compose.prod.yml` |
| **Labels** | Notes on a container that other tools read | Traefik reads which port to send traffic to |

How a request finds Ben's phone: phone → **Traefik** → one of the **api copies** → Postgres →
event to RabbitMQ → every api copy's realtime queue → the copy that holds Ben's socket pushes it.

**What Kubernetes did that compose doesn't**, and how this plan handles it:

| Kubernetes | docker compose | In this plan |
|---|---|---|
| Spreads copies over several machines | One machine | Accepted: a copy dying is a process dying, not a server |
| Restarts a copy that hangs (liveness probe) | Restarts only a copy whose process exits | Traefik stops sending traffic to an unhealthy copy; restarting it is manual |
| Rolling update: new copies healthy before old ones stop | Recreates the containers | Step 11's deploy script does it by hand |
| Autoscaling | A fixed number | 3 copies; the load test compares 1 with 3 (Step 12) |

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
typos, so the alternate exchange would never catch anything. The limit of `*`: a typo *after* a
valid prefix (`message.cretaed`) still matches, so it never reaches `snap.unrouted` — the relay
logs it as an unknown event and drops it. Exact bindings per event would catch that too, at the
cost of a binding change for every new event.

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
api copy 2 crashes
  → its phones' sockets drop → socket.io reconnects through Traefik to copy 1 or copy 3
  → the app gets `connected` → refetches lists (nothing lost)
  → realtime.<copy-2>-<random> was exclusive → RabbitMQ deletes it automatically
  → Docker's restart policy starts the copy again (after a crash; not after `docker stop`)
  → it gets a NEW random suffix, so it never collides with the old queue
```

The same thing happens, on purpose, during every deploy (Step 11): old copies stop one at a
time after the new ones are healthy, their sockets reconnect to the others, and the app
refetches.

### 7.6 RabbitMQ is down

| What | Effect | Recovery |
|---|---|---|
| HTTP API | Works normally — all data goes to Postgres | – |
| Live pushes | Paused (publishes are logged and dropped) | Every time a copy's relay starts — after a blip, and also the first time, if phones connected while RabbitMQ was still down — it closes its phones' socket connections, so they reconnect and the app refetches *(Step 9b)* |
| Snap timers | Not started for snaps sent during the outage | Hourly safety net deletes them |
| API / worker | Keep retrying the connection (1 s → 30 s backoff) | Re-declare topology and consumers on reconnect |

*Before Step 9b* this table said "app refetches on reconnect" — but the phone's socket goes to
the api copy, not to RabbitMQ, so a RabbitMQ blip never made it reconnect, and an open chat
silently missed what was sent during the gap. **Still not covered:** if only *one* copy loses
RabbitMQ, the events it publishes in that time are dropped for the phones on the *other* copies,
which don't reconnect. They see those items on their next refetch (reopening a screen or
reconnecting). Closing that gap would need an outbox (section 15).

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

1. **At least once, not exactly once — and only where we can prove it.** A message can arrive
   twice, so every consumer must be safe to run twice (*idempotent*). Deleting a snap twice
   deletes nothing the second time; pushing a message twice is filtered by id in the app.
   The guarantee per hop *(made precise in Step 9b)*:

   | Hop | Guarantee |
   |---|---|
   | Worker → `snap.retry.wait`, dead-letters replay → `snap.expire` | **At least once.** `mandatory` + publisher confirm: the original is acked only once a queue has the copy (`queue/delivered.ts`) |
   | Queue → consumer (relay, worker) | **At least once.** Ack after the work; an unacked message is redelivered |
   | RabbitMQ's own dead-letter moves (TTL → `snap.expire`, reject → `snap.dlx`) | **At most once.** RabbitMQ doesn't confirm them for classic queues: if the target queue is missing at that moment, the message is gone |
   | API → `snap.events` (live pushes) | **Best effort.** Dropped and logged while RabbitMQ is down (7.6) |

   So the promise "every expired snap is deleted" rests on **Postgres and the sweep**, not on
   RabbitMQ: the timer makes deletion *timely*, the sweep makes it *certain*. "Within about an
   hour" is a goal, not a guarantee: it holds while the hourly sweep runs and succeeds, so Step 10
   adds a warning on the oldest expired row. Photos whose upload was interrupted fall to the
   bucket's 2-day lifecycle rule instead.
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
   connection. `docker stop`, and so every deploy, sends `SIGTERM`, then waits the grace period
   (`stop_grace_period`, 10 s by default) before killing the process.
8. **The health check never depends on a shared service.** If it checked Postgres or RabbitMQ,
   one blip would mark *every* copy unhealthy at once and Traefik would have nowhere to send
   traffic — a full outage instead of a few errors. The healthcheck calls `/health`, which only
   asks "is this process up". (That's also why the API keeps serving when RabbitMQ is down,
   section 7.6.)

---

## 10. Configuration

New variables in `backend/.env` (and `.env.example`):

| Variable | Example | Used by |
|---|---|---|
| `RABBITMQ_URL` | `amqp://snap:snap@localhost:5672` | api, worker |
| `INSTANCE_ID` | *(optional, defaults to the hostname = the container ID in Docker)* | api — names its realtime queue, plus a random suffix per start (see section 14) |
| `SNAP_TTL_MS` | `86400000` (24 h) | api (`expires_at`) **and** topology (timer TTL) — one value, so they can't drift |
| `SNAP_RETRY_DELAY_MS` | `30000` | worker, topology |
| `SNAP_MAX_ATTEMPTS` | `3` | worker |
| `HOST` | *(set to `0.0.0.0` by the Docker image; the laptop's default is `localhost`)* | api — which network interface it listens on |

⚠️ **Changing `SNAP_TTL_MS` or `SNAP_RETRY_DELAY_MS` after the queues exist:** RabbitMQ refuses to
redeclare a queue with different arguments (`PRECONDITION_FAILED`). Stop the apps, delete
`snap.expiry.wait` / `snap.retry.wait` in the web UI, restart. Timers that were waiting are lost;
the safety net covers them.

**In containers** the same variables arrive like this:

| Where | How | Committed? |
|---|---|---|
| Laptop (Step 7) | `env_file: backend/.env`; `compose.stack.yml` sets `DATABASE_URL` and `RABBITMQ_URL` to the service names (`postgres`, `rabbitmq`) instead of `localhost` | `.env`: **never** |
| CI (Step 9) | Throwaway values in `compose.ci.yml` and an S3 stand-in — no real keys | Yes — nothing real in them |
| Server (Step 11) | A `.env` file on the VPS, mode 600 | **Never** |

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

Where the keys may live: `backend/.env` locally, the `.env` file on the server.
Never in the app — every `EXPO_PUBLIC_*` value is bundled into the app and readable by anyone
who has it.

---

## 11. Files

```
README.md                          new — what it is, diagrams, how to run (final version: Step 12)
.github/workflows/ci.yml           new — Step 9
docs/architecture-decisions.md     new — Step 12
docs/deployment.md                 new — Step 11
docker-compose.yml                 + rabbitmq — everyday development (Postgres + RabbitMQ); the base file
compose.stack.yml                  new — the app in containers: traefik, migrate, api ×3, worker, sweep, e2e (Step 7)
compose.ci.yml                     new — CI: S3 stand-in, throwaway passwords (Step 9)
compose.prod.yml                   new — the server: ghcr.io images, HTTPS, no open database ports, limits (Step 11)
infra/rabbitmq/enabled_plugins     new — management + shovel (for "Move messages")
infra/traefik/                     new — Traefik settings: entry points, timeouts (Step 7), Let's Encrypt (Step 11)
infra/server/                      new — deploy script, cron lines for the sweep and backups (Step 11)
backend/Dockerfile                 new — two targets: `app` and `tools` (dev dependencies: dbmate, socket.io-client)
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
backend/src/queue/attempts.ts      new — the x-attempt header: read it, copy a job as attempt n (Step 5)
backend/src/websocket/controllers.ts   changed — publish events instead of emitting
backend/src/websocket/relay.ts     new — consume realtime.<id>, emit to local sockets
backend/src/services.ts            changed — one snap.created per snap; deleteExpiredSnap(id)
backend/src/repository/index.ts    + getExpiredSnapById(id)
backend/src/worker.ts              new — expiry consumer, retries, queue monitor
backend/src/index.ts               changed — connect RabbitMQ + relay; drop in-process sweep; SIGTERM
backend/src/jobs/snap-expiry.ts    becomes scripts/sweep.ts — one run, then exit (cron runs it on the server)
backend/scripts/sweep.ts           new — `bun run sweep`: the safety net, once
backend/scripts/dead-letters.ts    new — list | replay | purge
backend/scripts/e2e.ts             new — the end-to-end test (Step 0), two base URLs (Step 3)
backend/scripts/seed-demo.ts       new — two demo users who are already friends (Step 10)
backend/scripts/load-test.ts       new — messages/s, delivery time, 1 copy vs 3, failover (Step 12)
snap/.env                          EXPO_PUBLIC_API_URL → Traefik (:8080 on the laptop) in Step 7
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

- [x] Add `rabbitmq:4-management` to `docker-compose.yml`: ports 5672 + 15672, volume,
      healthcheck `rabbitmq-diagnostics -q ping`, user `snap`/`snap` via
      `RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS`, fixed `hostname: rabbitmq`.
- [x] Mount `infra/rabbitmq/enabled_plugins`:
      `[rabbitmq_management,rabbitmq_shovel,rabbitmq_shovel_management].`
- [x] `bun add amqplib`; add `RABBITMQ_URL` to `.env` and `.env.example`.
- [x] Snap's own Postgres (version 3.2 in section 0): no `container_name`, no `.:/volume`,
      ports on `127.0.0.1`; `bun run migrate` on the fresh database.

✅ **Done when:** `docker compose up -d rabbitmq` → http://localhost:15672 opens, login `snap`/`snap`.

**Result (2026-10-21):** RabbitMQ 4.4.0, node `rabbit@rabbitmq`, all three plugins on; `snap`/`snap`
logs in, `guest` doesn't exist. A throwaway `amqplib` script under Bun connected, published on a
confirm channel, got the confirm, read the message back and closed cleanly. `bun run e2e`:
67 of 67 against the new Postgres.

### Step 2 — Queue module

- [x] `src/config.ts`: read `RABBITMQ_URL`, `SNAP_TTL_MS`, `SNAP_RETRY_DELAY_MS`, `SNAP_MAX_ATTEMPTS`.
      `services.ts` uses `SNAP_TTL_MS` from here instead of its own constant.
- [x] `src/queue/connection.ts`: connect with backoff (1 s → 30 s), confirm channel, emit
      `ready` on (re)connect — only after the topology is declared — close cleanly on shutdown.
      Decide first: `amqplib` has had built-in reconnects since v1.1
      (`connect(url, { recovery })`: backoff, jitter, max delay, a `setup` hook per connection) —
      use those, or write our own?
- [x] `src/queue/topology.ts`: all names as constants; `declareTopology(channel)` asserts every
      exchange, queue and binding from section 5.
- [x] `src/queue/events.ts` + `publish.ts`: routing keys, payload types, `publishEvent`.
- [x] `src/index.ts`: connect at startup — **the HTTP server starts even if RabbitMQ is down**.

✅ **Done when:** `bun run dev` → the web UI lists `snap.events`, `snap.unrouted`,
`snap.expire`, `snap.dlx` and the durable queues; stopping RabbitMQ doesn't crash the API, and
it reconnects when RabbitMQ is back.

**Result (2026-11-17):** amqplib's built-in recovery, not our own loop: 1 s → 30 s with jitter,
and its `setup` hook opens a confirm channel and declares the topology on every (re)connect.
Instead of a separate `ready` event, the publish channel is only handed out after the topology
is declared; until then `publishEvent` logs and drops. `onConnectFailed` retries network errors
and exits on setup mistakes (wrong password, 406), the way a missing `S3_*` variable stops the
server. Tested against RabbitMQ 4: the web UI shows 4 exchanges, 5 queues, 4 bindings and the
connection `snap-api@<hostname>`. RabbitMQ stopped → `/health` stays 200, retries after 1.2 s,
2.2 s, 4.1 s and 8.5 s, then reconnects and declares everything again. Wrong password → exit 1
at boot. `SNAP_TTL_MS=20000` against the existing 24 h queue → 406, exit 1. `bun run e2e`: 67 of 67.

### Step 3 — Live pushes across servers

- [x] `websocket/controllers.ts`: each `send…Notification` publishes its event instead of emitting.
- [x] `services.sendSnap`: one `snap.created` with `recipients` (not one per recipient).
- [x] `websocket/relay.ts`: declare `realtime.<INSTANCE_ID>-<random>` (exclusive), bind
      `message.*`, `snap.*`, `friend.*`, consume, emit to local rooms, ack. Re-create on reconnect.
- [x] Publishing waits for the relay: `publishEvent` drops (and logs) until this copy's queue is
      bound, so startup and reconnects never send real events to `snap.unrouted`.
- [x] `scripts/e2e.ts`: accept two base URLs.

✅ **Done when:** two copies run side by side (`PORT=3000 bun run dev`, `PORT=3001 bun run dev`),
the e2e test connects Anna to :3000 and Ben to :3001, and every push (message, snap, friend
request, friend accepted, screenshot) arrives on the other server. Web UI shows two
`realtime.*` queues.

**Result (2026-11-17):** `controllers.ts` now has two halves: `send…Notification` publishes
(called by services), `emitEvent` emits (called by the relay), typed against the `Events` map so
a new event without an emitter doesn't compile. Every push goes through RabbitMQ, even between
two people on the same copy. The relay starts from `connectQueue`'s new `onConnect` hook, which
runs after the topology and before the publish channel opens; that ordering is how publishing
waits for the relay. The second URL is `E2E_OTHER_URL`: Ben and Dave use it, Anna and Cara
`E2E_BASE_URL`. Tested: one server → e2e 67 of 67; two servers → two `realtime.*` queues, e2e
67 of 67 with every push crossing, `snap.unrouted.queue` still 0, `snap.expiry.wait` +2 (the
timers, read from Step 4). RabbitMQ restarted, or the connection force-closed in the web UI →
the relay comes back on a new queue within about 2 s, and e2e passes 67 of 67 again. Stopped
copies leave no `realtime.*` queue behind. Found on the way: nobody but the owner can delete
an exclusive queue, not even the web UI (400 "cannot obtain exclusive access").

### Step 4 — Worker + snap timer

- [x] `repository.getExpiredSnapById(id)` and `services.deleteExpiredSnap(id)`: only if
      `expires_at <= now()`; S3 object first, then the row.
- [x] `src/worker.ts` (`bun run worker`): declare topology, `prefetch(10)`, consume
      `snap.expire.queue` → `deleteExpiredSnap` → ack.
- [x] Move the sweep out of the API into `scripts/sweep.ts` (`bun run sweep`): one run, then
      exit. On the laptop it's run by hand; on the server cron runs it hourly (Step 11).
      *Changed in version 3 — before, the worker ran it on an hourly timer. Version 4: cron on
      the server instead of a Kubernetes CronJob.*

✅ **Done when:** with `SNAP_TTL_MS=20000` (delete `snap.expiry.wait` first — see section 10), a
sent snap is removed from Postgres and S3 about 20 s later **by the timer**, with the sweep not
involved (visible in the worker log). **Afterwards** stop the API and worker and delete
`snap.expiry.wait` again, so the next normal start creates the 24 h queue; otherwise that start
hits the 406 and exits (Step 2).

**Result (2026-11-17):** the worker reuses Step 3's `onConnect` hook
(`connectQueue('snap-worker', startWorker)`): its own channel, `prefetch(10)`, and each job
re-checks `expires_at` in Postgres, deletes the S3 object then the row, and acks. A failed job
is nacked without requeue, so it lands in `snap.dead.queue` (Step 5 adds the retries first); a
message without a usable `snap_id` goes there at once. `jobs/snap-expiry.ts` is gone from the
API; `scripts/sweep.ts` runs the same sweep once and exits non-zero on failure. Tested with
`SNAP_TTL_MS=20000`: a photo snap was deleted from Postgres and S3 **20.2 s** after sending,
by the worker. A timer for a snap that no longer exists → acked, "nothing to do". A message
without `snap_id` → `snap.dead.queue` (`x-death` reason `rejected`). A worker with a wrong S3
secret → `SignatureDoesNotMatch`, dead-lettered, row kept; `bun run sweep` then deleted it
(exit 0). Restored to 24 h, then `bun run e2e` 67 of 67 with no sweep in the API log;
`snap.dead.queue` and `snap.unrouted.queue` back to 0. A deleted photo answers **403**, not
404: the IAM user has no `s3:ListBucket`, so S3 won't say whether a key exists.

### Step 5 — Retries, dead letters, alternate exchange

- [x] Worker: on failure, if `x-attempt < SNAP_MAX_ATTEMPTS` → publish to `snap.retry.wait`
      with `x-attempt + 1`, wait for confirm, ack; else `nack(requeue=false)` + `DEAD-LETTERED` log.
      Invalid messages go straight to `nack(requeue=false)`.
- [x] Worker: every 60 s check the size of `snap.dead.queue` and `snap.unrouted.queue`, log a
      warning when it grows.
- [x] `scripts/dead-letters.ts`: `list`, `replay` (to `snap.expire`, attempt reset), `purge`.

✅ **Done when:**
- With a wrong `S3_SECRET_ACCESS_KEY` in the worker only, a job is tried 3 times (30 s apart)
  and lands in `snap.dead.queue`; after fixing the key, `bun run dead-letters replay` deletes it.
- Publishing `mesage.created` (typo) lands in `snap.unrouted.queue` and the worker warns about it.

**Result (2026-11-17):** `queue/attempts.ts` holds the `x-attempt` header (checked first against
RabbitMQ 4: our own header survives the TTL → dead-letter trip, next to RabbitMQ's `x-death`).
`connectQueue`'s `onConnect` now also gets the publish channel, which the worker uses for the
retry copies; a copy RabbitMQ doesn't confirm parks the original instead of acking it. The
60 s check uses AMQP's passive `checkQueue` on the worker's own connection, not the web API.
Tested with `SNAP_TTL_MS=20000`: wrong S3 secret, attempt 1 failed, key fixed → attempt 2
deleted the snap 30 s later with no human involved. Key left wrong → attempts at
14:36:23, 14:36:54, 14:37:24, then `DEAD-LETTERED snap_id=16 after 3 attempts: …signature…`
and, within the minute, `⚠️ snap.dead.queue has 1 message(s) (+1)`; `dead-letters list`
showed it (attempts 3, rejected, from `snap.expire.queue`); key fixed → `replay` → deleted at
once. `mesage.created` → `snap.unrouted.queue`, warned within 60 s. `purge` emptied the queue.
Restored to 24 h, e2e 67 of 67, all four queues at 0. **Bug found and fixed:** the first
`replay` left the parked copy in place as well — the script closed the connection right after
the last ack, and the close overtook it. Closing the channel first (it waits for RabbitMQ's
answer) fixed it; retested with 1 and with 3 parked jobs (section 14).

### Step 6 — Docker image

*Version 3 dropped the compose replicas and nginx for Kubernetes; version 4 brings the
replicas back in Step 7, with Traefik in front. The `migrate` target became `tools`.*

- [x] `backend/Dockerfile` (`oven/bun:1.3-slim`, runs as the unprivileged `bun` user). Two
      targets:
      - `app` — `bun install --frozen-lockfile --production`, `CMD bun run src/index.ts`. The
        worker and the sweep use the same image with a different command, so there is one image
        to build, scan and ship.
      - `tools` — adds the dev dependencies: dbmate for the migrations, socket.io-client for the
        e2e. Runs `bun run migrate` by default.

      Check that `bcrypt` (native module) installs on Linux.
- [x] `backend/.dockerignore`: `node_modules`, `.env`, `.env.*`. Without it the image would
      contain your S3 and JWT secrets, and the Mac build of `bcrypt` would replace the Linux one.
- [x] Delete `backend/package-lock.json` — one lockfile, `bun.lock`.
- [x] API shuts down gracefully on `SIGTERM`: stop taking requests, close the sockets (the
      phones reconnect to another copy), stop the relay, close RabbitMQ. `docker stop` and every
      deploy send `SIGTERM` (section 9, rule 7).
- [x] *Added when building:* the worker shuts down gracefully too (rule 7 already asked for it):
      cancel the consumer, let running jobs finish and ack, close RabbitMQ and Postgres.

✅ **Done when:** the image builds; a container from it (pointed at the laptop's Postgres and
RabbitMQ) passes the e2e; `docker stop` shows a clean shutdown in the log within a few seconds,
not a kill after the timeout.

**Result (2026-11-17):** built as planned with three changes. The base is `oven/bun:1.4.4-slim`
(the Bun the code is developed with; arm64 and amd64 both exist), and `CMD` is the exec form
`["bun", "--sql-preconnect", "src/index.ts"]`, so Bun is the first process and gets the
signal. `.dockerignore` is an **allowlist** (`*`, then `package.json`, `bun.lock`,
`tsconfig.json`, `src`, `scripts`, `db`): nothing new reaches the image unless added on purpose.
The image sets `HOST=0.0.0.0` (Fastify's default `localhost` is unreachable from outside a
container; the laptop keeps `localhost`). Sizes: `app` 366 MB, `tools` 420 MB. Tested on the
`snap_default` network: the `app` image runs as `bun` (uid 1000), holds no `.env` or local
files and no dev packages, and `bcrypt` works on Linux; an api container passed **e2e 67 of 67**
from the laptop and again from a `tools` container inside the network; `docker stop` on the api
took 0.2 s, exit 0; on the worker 0.1 s, exit 0; `tools` ran the migrations ("Applied: 4,
Pending: 0"); Ctrl-C on the laptop exits cleanly for both. **Bug found and fixed:** the
existing `preClose` hook used `disconnectSockets(true)`, which tells each phone "you are
disconnected" (`io server disconnect`) — and socket.io-client never reconnects after that by
itself, so after every stop or deploy phones would have had no live pushes until reopened. Now
it calls `engine.close()`: the phone sees `transport close`, and in the test it reconnected on
its own to a new api container 2.5 s later (section 14).

### Step 7 — Several copies on the laptop: docker compose + Traefik

*New in version 4, in place of "Kubernetes on the laptop". Read section 4b first.*

- [x] `compose.stack.yml`, used together with `docker-compose.yml`
      (`export COMPOSE_FILE=docker-compose.yml:compose.stack.yml`, then plain `docker compose`):
  - `traefik`: Docker provider with `exposedByDefault=false` (only containers labelled
    `traefik.enable=true` get traffic), laptop port 8080 → the api copies. Check two settings:
    the WebSocket idle timeout (sockets stay open for hours) and the request-body limit (10 MB
    snaps).
  - `migrate`: the `tools` image, runs once; everything that needs the database starts after it
    has finished (`depends_on: { migrate: { condition: service_completed_successfully } }`).
  - `api`: the `app` image, `deploy.replicas: 3`, `env_file: backend/.env` with `DATABASE_URL`
    and `RABBITMQ_URL` set to the service names (section 10), `restart: unless-stopped`, a
    healthcheck on `/health` (the slim image may have no `curl` — check, or call `/health` with
    `bun` itself), Traefik labels. No published port: only Traefik is reachable from outside.
  - `worker`: the `app` image running `bun run worker`, 1 copy.
  - `sweep` and `e2e` (profile `tools`): run on demand with `docker compose run --rm …`. The e2e
    runs as a container so it can reach each copy by name: Anna and Cara on `snap-api-1`
    (`E2E_BASE_URL`), Ben and Dave on `snap-api-2` (`E2E_OTHER_URL`).
- [x] `infra/traefik/`: the static settings (entry point, timeouts), mounted read-only.
- [ ] App: `EXPO_PUBLIC_API_URL=http://<your-ip>:8080`. *Devinder's phone check — the stack
      side was tested with a phone-like socket client (below).*

✅ **Done when:**
- From nothing, `docker compose up -d` → `docker compose ps` shows `migrate` exited 0, 3 api
  copies healthy, the worker running.
- The e2e passes through Traefik (`E2E_BASE_URL=http://localhost:8080`), and again as a
  container with Anna on `snap-api-1` and Ben on `snap-api-2`, so every push must cross.
- The RabbitMQ web UI shows three `realtime.*` queues — one per api copy.
- `docker kill snap-api-2` in the middle of a chat on the phone → the app reconnects through
  Traefik to another copy, and that copy's realtime queue disappears; `docker compose up -d`
  brings the third copy back with a new queue.
- `docker compose run --rm sweep` runs the sweep once, successfully.

**Result (2026-11-17):** `compose.stack.yml` with `traefik:v3.7.15` (newest v3 at the time),
`migrate`, `api` ×3, `worker`, and `sweep`/`e2e` on the `tools` profile; the backend services
share `backend/.env` through a YAML anchor, with `DATABASE_URL`/`RABBITMQ_URL` pointed at the
service names. The api health check is `bun -e "fetch('/health')"` — the image has no `curl`.
`infra/traefik/traefik.yml`: entry point `:80` with **`readTimeout: 300s`** (Traefik's default
of 60 s covers the whole request body and would cut off a 10 MB snap on a slow phone
connection), Docker provider with `exposedByDefault: false`, the dashboard on
`127.0.0.1:8081`, an access log. Traefik has no request-size limit by default; Fastify's
10 MB limit stays the only one. Tested: from no stack containers, `up -d --build` → `migrate`
exited 0, 3 api copies healthy, the worker running, Traefik routing to 3 servers (UP UP UP).
e2e through Traefik **67 of 67**, the requests spread 19 / 20 / 19 over the copies; e2e as a
container with Anna on `snap-api-1` and Ben on `snap-api-2` **67 of 67**. RabbitMQ: three
`realtime.*` queues, connections from 3 `snap-api` and 1 `snap-worker`. A phone-like client
connected through Traefik landed on `snap-api-3`; `docker kill snap-api-3` → `transport close`,
reconnected by itself to `snap-api-1` 1.1 s later; Traefik down to 2 servers, 2 realtime
queues. `docker kill` doesn't trigger the restart policy (it counts as a manual stop);
`docker compose up -d` brought the copy back with a new queue (3 again — Traefik adds it a
moment after Docker reports it healthy). A socket held open through Traefik for **240 s**:
0 disconnects (past both the 60 s read and 180 s idle timeouts). A 9 MB upload throttled to
100 KB/s took **88 s** and got 201 — the 60 s default would have cut it. `run --rm sweep`
succeeded. The first attempt hit Docker Hub's anonymous limit (100 requests an hour, used up
by checking image tags); logged in to Docker Hub, it pulled fine (section 14). Traefik logs two
start-up warnings — to review in Step 11: `aliasHeadersStrategy` (headers like `X_Auth_User`
that some backends read as `X-Auth-User`; it matters for PHP or CGI, not for Fastify) and
encoded characters in paths (whether Traefik and the backend read an encoded path the same
way). *Corrected 2026-11-18: this note first treated both as the same header issue.* Left for
Devinder: the real phone check.

### Step 8 — ~~Kubernetes like production~~ (dropped in version 4)

Autoscaling, PodDisruptionBudgets and spreading copies over nodes need Kubernetes; Relay shows
them. What is still useful without Kubernetes moved:

| Was in Step 8 | Now |
|---|---|
| Image tags are the commit SHA, never `latest` | Step 9 |
| Resource limits on every container | Step 11 (`compose.prod.yml`), so one copy can't starve the server |
| No failed requests during a deploy | Step 11 (deploy script) |
| Load test, first version | Step 12 |

### Step 9 — CI/CD on every push

*Changed in version 4 — the stack runs in docker compose in GitHub Actions instead of a kind
cluster.*

- [x] `.github/workflows/ci.yml`, on every push and pull request:
  - **Typecheck** backend and app.
  - **Build** both image targets, tagged with the commit SHA.
  - **The whole stack** in compose: `docker-compose.yml` + `compose.stack.yml` +
    `compose.ci.yml` → Postgres, RabbitMQ, an S3 stand-in, `migrate`, 3 api copies, the worker,
    Traefik. Then the **e2e as a container on the compose network**, Anna on `snap-api-1` and
    Ben on `snap-api-2`.
  - **S3 stand-in** through `S3_ENDPOINT`, so CI never holds real AWS keys. MinIO is archived
    (no images since October 2025) — use Adobe S3Mock or SeaweedFS. Presigned links carry the
    stand-in's hostname, which only resolves on the compose network — that's why the e2e runs
    there too.
  - **No secrets committed**: fail if a `.env` file is tracked or an AWS key (`AKIA…`) appears.
- [x] Security scans on every push, free for public repos: **CodeQL** reads the code for
      dangerous patterns; **Dependabot** warns about known holes in the npm packages and opens
      update pull requests.
- [x] On `main` only: push the `app` and `tools` images to ghcr.io, tagged with the commit SHA,
      built for amd64 and arm64 (section 14).
- [x] CI badge at the top of the README.

✅ **Done when:** main is green; a deliberately broken relay makes the e2e in CI fail; the
images appear under the repo's *Packages* on GitHub.

**Result (2026-11-18):** `ci.yml` runs on every push: **checks** (no `.env` file or AWS key ID in
git; both type checks), **stack** (both images built with the GitHub Actions layer cache; the
whole stack started with `compose.ci.yml` — Adobe S3Mock 5.2.3 instead of S3, throwaway settings,
no published ports; the e2e run twice, across `snap-api-1`/`snap-api-2` and through Traefik), and
on `main` only **publish** (amd64 + arm64 through QEMU, tagged with the full commit SHA).
`codeql.yml` scans the TypeScript and the workflows; `dependabot.yml` covers the backend (minor
and patch grouped), the Dockerfile, the compose images (never a major Postgres) and the actions;
the app gets security fixes only, since Expo SDK 54 pins its versions together. Every action is
pinned to a commit SHA. `compose.stack.yml` now has an optional `env_file` and names that follow
the compose project, so CI was rehearsed on the laptop first as project `snapci` on a copy without
`.env` (both e2e runs 67 of 67) without touching the `snap` containers. actionlint: 0 problems;
the secrets check was tested against a committed `.env` and AWS's example key ID (both fail).
On GitHub: branch `ci/step-9` green (stack job 1 min 36 s); **a deliberately broken relay**
(`relay(msg)` removed) turned the stack job red with **59 passed, 8 failed** — exactly the eight
live-push checks — while the type check stayed green; `main` green, then
`ghcr.io/devinder-dev/snap-app` and `snap-tools` tagged `eeac92e…` with `linux/amd64` and
`linux/arm64`, **public** (pulled without a login) because they're linked to the public repo.
Docker Hub login in CI uses a read-only token (`DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`).
Dependabot alerts and security fixes switched on with `gh api`; secret scanning and push
protection were already on. First findings, for Step 10: CodeQL `js/missing-rate-limiting` on
`/register` and `/login` (Step 10 adds the rate limit) and `js/clear-text-logging` in the e2e's
`check()`, which prints a failing response — tokens included — to the (public) CI log.
Dependabot's first pull requests: Traefik v3.7.15 → v3.7.19, and 8 backend updates (amqplib
2.2.0 → 2.3.1 among them), both green in CI.

### Step 9b — Fixes from a code review

*Added in version 4.1 (section 0).* Each fix starts with a test that shows the problem on the
old code.

- [x] `queue/delivered.ts`: `publishDelivered()` — publish with `mandatory`, and treat a
      returned message as a failure even when it's confirmed. The worker's retry copies and
      `dead-letters replay` use it.
- [x] `websocket/relay.ts`: when the relay is rebuilt (not on its first start), close the local
      phones' socket connections one by one, so they reconnect and the app refetches.
- [x] `queue/connection.ts`: `setup()` watches for a close itself and fails the attempt if the
      connection closed before it finished (amqplib only starts watching after `setup()`).
- [x] Sweep: page by `(expires_at, id)` past failed rows; return deleted and failed counts;
      `scripts/sweep.ts` exits 1 when anything failed.
- [x] Photo snaps appear in the inbox and can be opened only once their photo is attached; a
      failed attach removes the uploaded object.
- [x] `.dockerignore`: no `.env` file even inside `src/`, `scripts/`, `db/`.
- [x] Docs: rule 1 per hop, 7.6, the `*` binding limit, the README's push description.

✅ **Done when:** the same test shows each problem on the old code and its fix on the new;
the e2e passes; CI is green.

**Result (2026-11-18):** one test script ran twice against the same RabbitMQ — on the old code
(a clone of `main`) and on the fixed code:

| Finding | Old code | Fixed code |
|---|---|---|
| Retry into a deleted `snap.retry.wait` | attempt 1 failed, the job was gone (dead queue 0) | "could not schedule a retry (no queue took it)", parked — dead queue 1 |
| Replay with the `snap.expire.queue` binding removed | "✅ Replayed 1 job(s)", the job was gone | exit 1, "Replay stopped… the rest stay parked", dead queue 1 |
| RabbitMQ connection force-closed, phone stays connected | the phone never reconnected (40 s) | `transport close`, reconnected 1.5 s later — the app refetches |
| Sweep with a failing S3 key, one text + one photo snap expired | exit 0, "✅ Sweep done: 1 deleted" | exit 1, "1 deleted, 1 could not be" |
| Photo snap whose upload hasn't finished | in the inbox; opening it used the one view with no photo | not in the inbox, 404; after the attach: listed, opens with its photo |

The `setup()` close guard has no test of its own: the gap is too narrow to trigger on demand
(amqplib 2.4.0 still starts watching only after `setup()`), so it was checked only for not
breaking a normal reconnect. Before the fixes, Dependabot's backend group and amqplib **2.4.0**
(two security fixes beyond the group's 2.3.1) passed every RabbitMQ failure path by hand: the
wrong-password and 406 exits, a RabbitMQ restart with the relay and worker rebuilt, SIGTERM,
retries → dead letter → replay. After the fixes: e2e 67 of 67, tsc and actionlint clean.

**Part 2 — the fixes, reviewed (2026-11-18)**

- [x] The phones are reset after **every** relay start, including the first, from amqplib's
      `connect` event (`connectQueue(…, onReady)`), so never for an attempt that fails later.
- [x] `setup()` also listens for `error` while it runs; it moved into `createSetup()` so a unit
      test can drive it with a fake connection — the repo's first `bun test`, now in CI.
- [x] `setSnapMedia()` refuses an expired snap; a database error while attaching keeps the
      object (the update may have been saved) and logs it.
- [x] The sweep pages by `id` with one cutoff per run from the database's clock.
- [x] `dead-letters replay` publishes straight into `snap.expire.queue` by name.
- [x] Docs: "within about an hour" is a goal (Step 10 warns on the oldest expired row); 7.6;
      two gotchas.

**Result:** the same script ran on `main` before part 2 (68a8606) and on the fixed code; the
unit test went red first, then green.

| Point | Before | After |
|---|---|---|
| `error` during setup (unit test, fake connection) | `emit('error')` throws — in a real process, a crash | caught; the attempt fails and amqplib retries |
| Phone connects while RabbitMQ is down, then RabbitMQ comes up | the first relay start reset nobody: no reconnect in 75 s | `transport close`, reconnected 3.9 s after connecting |
| Replay with a diagnostic queue on `snap.expire` and the work queue deleted | "✅ Replayed 1 job(s)" — into the diagnostic queue | exit 1, "no queue took it", the job stays parked |
| Attach a photo to an expired snap | attached | refused |
| Sweep, 120 expired rows within one millisecond, S3 unreachable | still running after 8 s: **192 800** failed deletes logged for 120 rows (the same page, again and again) | one pass, exit 1, "0 deleted, 120 could not be" |

The S3 calls in the sweep test went to a closed local port (`S3_ENDPOINT`), not to AWS. After
the fixes: e2e 67 of 67, `bun test` 3 of 3, tsc and actionlint clean.

### Step 10 — Ready for the public internet

*Unchanged in version 3 apart from its number (was Step 8); version 4 only changes "pod" to
"copy".*

- [ ] Rate-limit `/login` and `/register` (`@fastify/rate-limit`). Kept in each copy's memory —
      so the real limit is *copies × configured limit* (3 × the limit). Fine at this size;
      written down as such.
- [ ] Refresh token: 10 years → 30 days. The app refreshes on its own, so only someone idle for
      a month logs in again.
- [ ] Logs: Fastify's built-in logger (pino) with `instance` (the copy's `INSTANCE_ID`) on every
      line, and each event's `messageId` logged when published and when delivered — one chat
      message can then be followed copy 1 → RabbitMQ → copy 2 with `docker compose logs`.
- [ ] `GET /health/ready`: checks Postgres and RabbitMQ — for people and deploy checks, **not**
      for the healthcheck (section 9, rule 8).
- [ ] Go through what CodeQL and Dependabot (Step 9) report, and scan the image; fix what they
      find.
- [ ] `bun run seed:demo`: two demo users who are already friends, so a visitor can try chat in
      a minute.
- [ ] *From the review (version 4.1):* watch RabbitMQ's `blocked`/`unblocked` signal and cap
      unconfirmed publishes, so a broker alarm can't grow the api's memory; a deadline on worker
      jobs; one shutdown promise per process that stops recovery first; `/health/ready` also
      reports whether this copy's relay is running, and logs a warning when RabbitMQ stays
      unreachable (a wrong vhost or TLS setting retries forever today); cap a photo link's
      lifetime at the snap's remaining life; a warning when the oldest expired row is more than
      an hour old, and when a sweep run fails; e2e checks with a definite "object gone"
      (`HEAD` through the S3 client, not "not 200"); a CI test for a missing retry route;
      Fastify trusts client-IP headers only from Traefik (for the rate limit).

✅ **Done when:** the e2e passes, the 6th wrong login in a minute against one copy gets a 429,
and the logs show one message's `messageId` on two different copies.

### Step 11 — Deploy to one VPS with docker compose

*Changed in version 4 — before, a real Kubernetes cluster. Now one VPS running the same compose
files as the laptop, plus `compose.prod.yml`.*

What the server needs:

| Need | Why |
|---|---|
| One small Linux VPS with Docker | Runs everything; size it from the memory use seen in Step 7 |
| A domain or subdomain pointing at it | Let's Encrypt needs a name; phones refuse plain HTTP outside development |
| Firewall: only 22, 80 and 443 open | Postgres and RabbitMQ are never reachable from outside (the RabbitMQ web UI goes through an SSH tunnel) |
| Volumes for Postgres and RabbitMQ | The data survives a container restart |
| Postgres backups | Daily `pg_dump` → S3 (its own prefix or bucket), run by cron |

| Where | Trade-off |
|---|---|
| A new small VPS (any provider) | Clean: Snap can't disturb Relay, and Traefik gets ports 80 and 443 to itself |
| The VPS that runs Relay | No extra cost, but Relay's k3s already holds ports 80 and 443 there, so Snap would have to go into k3s — Kubernetes again |

Prices change; compare them when we get here.

- [ ] Choose the VPS, and whether Postgres stays on it (with backups) or moves to a managed
      database.
- [ ] `compose.prod.yml`: images from ghcr.io by commit SHA, Traefik with Let's Encrypt and
      80 → 443, no published database ports, resource limits per container,
      `restart: unless-stopped`, settings from the `.env` file on the server (section 10).
- [ ] Deploy without downtime, `infra/server/deploy.sh` (or a ready-made tool such as the
      docker-rollout plugin — decide here): pull the new image, run `migrate`, start new api
      copies next to the old ones, wait until they're healthy, then stop the old ones with
      `SIGTERM` (Step 6). Migrations must work with the old code too (section 14).
- [ ] CD: on `main`, after CI passes, GitHub Actions connects over SSH as a deploy user whose
      key can only run the deploy, and passes the new image tag.
- [ ] cron on the server: the sweep hourly (`docker compose run --rm sweep`), the backup daily.
- [ ] `docs/deployment.md`. Point the app at the `https://` URL.
- [ ] *From the review (version 4.1):* `compose.prod.yml` must *remove* what the laptop stack
      adds — compose **appends** port lists, so use `!reset` (or don't layer `compose.stack.yml`);
      no Traefik dashboard; no laptop passwords in `environment`. Docker socket only through a
      socket proxy (`:ro` doesn't limit the API). Decide Traefik's `aliasHeadersStrategy` and
      encoded-path settings. A tested rollout and rollback with old and new copies serving
      together; a restore test that also checks the photos.

✅ **Done when:** the e2e passes against the public URL; killing an api copy there doesn't break
a live chat; the e2e in a loop during a deploy from CI has zero failed checks; last night's
backup restores into an empty database.

### Step 12 — Proof and presentation

*Was Step 10; version 4 compares 1 copy with 3 instead of showing an autoscaler.*

- [ ] `scripts/load-test.ts`: many sockets spread over the copies; messages per second and
      delivery time (p50 / p95) with 1 copy and with 3; a copy killed mid-test and how long until
      every client is back. Bun runs the JavaScript on one core per process, so on a server with
      several cores 3 copies should handle more — the test shows whether they do. The README gets
      the real numbers, whatever they are.
- [ ] A way to see it without the code: a short screen recording (two phones, `docker kill` on a
      copy, the chat carries on), plus a way to try it (Expo Go via an EAS Update QR code, or an
      Android APK — check what SDK 54 supports at that point).
- [ ] Root `README.md`, final version: what it is, the diagrams, "follow one message across
      copies", the numbers, how to run it.
- [ ] *Added in version 4.2:* **comment pass for GitHub.** When everything else is done, the
      repository keeps only short, to-the-point comments that say something the code doesn't
      (why, not what); obvious ones go. The fully commented version stays on the laptop — how
      (a local-only branch or tag, never pushed, or a copy) is decided then.
- [ ] `docs/architecture-decisions.md`: the decisions from section 1 with their trade-offs — why
      RabbitMQ and not the Redis adapter, why push-only sockets, why no sticky sessions, why the
      timer *and* the sweep, why docker compose and not Kubernetes for this project (version 4),
      why Traefik.

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
| Stack in compose: e2e through Traefik, and across named copies | The app works as 3 containers behind a load balancer | 7 |
| Kill an api copy mid-chat | The app reconnects to another; that copy's queue goes away | 7 |
| CI: whole stack in compose, 3 api copies, e2e on its network | Every push still crosses copies | 9 |
| e2e against the public URL | The deployment works | 11 |
| e2e in a loop during a deploy | Deploys cause no failed requests | 11 |
| Restore last night's backup | Backups actually work | 11 |
| Load test: 1 copy vs 3, a copy killed mid-way | Real numbers for the README; failover time | 12 |

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
- **The hostname alone is not unique enough.** A container that restarts keeps
  its hostname, so the new process can meet its own old exclusive queue, still held by a
  connection RabbitMQ hasn't noticed is dead, and fail with `RESOURCE_LOCKED`. Hence the random
  suffix on every realtime queue.
- **Publishing before the relay queue is bound** sends real events to `snap.unrouted` and makes
  them look like typos. Bind first, then publish.
- **RabbitMQ needs a fixed hostname.** It stores its data under its own hostname; without
  `hostname:` in compose every recreated container gets a random one, and RabbitMQ wouldn't find
  its data. (In Kubernetes the same problem is why RabbitMQ runs as a StatefulSet.)
- **`guest` only logs in from inside the container**, and doesn't exist at all once
  `RABBITMQ_DEFAULT_USER` is set — hence our own `snap` user.

**docker compose and Traefik**
- **Traefik must keep WebSockets open and accept 10 MB bodies** — check its idle timeout and
  body limit (nginx's 1 MB default was the old version of this problem).
- **Without a healthcheck Traefik routes to a copy as soon as it starts**, before it's ready.
  With one, it waits until the copy is healthy, and stops when it isn't.
- **Docker restarts a container whose process exits, never one that's only unhealthy.** A hung
  copy just stops getting traffic. Kubernetes' liveness probe would restart it; here it's manual.
- **Compose has no rolling update.** `docker compose up -d` with a new image recreates the
  copies without waiting for new ones to be healthy — hence the deploy script in Step 11.
- **Migrations run while old copies still serve** (Step 11), so each migration must work with the
  old code too: add a column first, remove the old one a release later.
- **Copies of one service can't publish the same host port.** Only Traefik publishes a port; the
  copies are reached through it, or by container name from inside the compose network.
- **Container names resolve inside the compose network, not on the laptop** — so a test that has
  to pick a specific copy runs as a container.
- **Traefik reads the Docker socket** to find the copies. `:ro` on the mount doesn't make that
  safe — the Docker API can still do anything — so keep Traefik's dashboard off on the server
  and pin its image version.
- **`docker compose down -v` deletes the volumes** — the database and RabbitMQ's data. Never
  `-v` on the server.
- **The Mac is arm64; GitHub's runners and most VPSs are amd64.** An image built on the laptop
  won't run on an amd64 server. CI builds its own; images for ghcr.io are built for both
  (`docker buildx --platform linux/amd64,linux/arm64`).
- **The health check must not check Postgres or RabbitMQ** — see section 9, rule 8.
- **Presigned links carry the S3 endpoint's hostname.** With the S3 stand-in in CI, whoever
  downloads the photo must be on the compose network — hence the e2e as a container in CI.

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
- **A script that acks and then closes the connection can lose its last ack** (amqplib 2.2,
  Step 5). The connection's close can overtake the ack, and RabbitMQ puts the message back.
  Close the channel first — `await channel.close()` waits for RabbitMQ's answer, and a
  channel's frames are handled in order — then the connection.
- **An exclusive queue can only be deleted by its own connection** — the web UI gets a 400
  (Step 3). To reset a copy's realtime queue, force-close its connection instead.
- **A deleted S3 object answers 403, not 404**, because the IAM user has no `s3:ListBucket`
  (Step 4). Tests check "not 200".
- **Bun as a container's first process ignores SIGTERM** unless the code listens for it, so
  `docker stop` waits 10 s and kills. Both the api and the worker handle SIGTERM and SIGINT, and
  the image's `CMD` is the exec form so the signal reaches Bun, not a shell (Step 6).
- **Fastify listens on `localhost` by default**, which inside a container is the container
  itself. The image sets `HOST=0.0.0.0` (Step 6).
- **Don't end a socket.io session from the server on shutdown.** `disconnectSockets()` gives
  the phone `io server disconnect`, and socket.io-client then never reconnects by itself.
  Closing the connections (`engine.close()`) gives `transport close`, and it does (Step 6).
- **Traefik's `readTimeout` defaults to 60 s for the whole request, body included** — a 10 MB
  upload on a slow phone connection would be cut off. Set to 300 s (Step 7).
- **Docker Hub limits anonymous requests to 100 an hour**, and every `docker manifest inspect`
  or pull counts. Checking many image tags used it up mid-test (Step 7). Log in to Docker Hub
  (`docker login`, or sign in to Docker Desktop); in CI, log in to ghcr.io / Docker Hub too.
- **`docker kill` doesn't trigger `restart: unless-stopped`** — Docker treats it as a manual
  stop. A copy whose process crashes on its own is restarted; one you kill stays down until
  `docker compose up -d` (Step 7).
- **A script that checks image tags must tell "not found" from "rate limited"** (Step 9). In
  Step 7 a tag check printed "not found" for a Docker Hub 429, so Traefik v3.7.15 was taken for
  the newest version; Dependabot then offered v3.7.19. Check versions in the docs or with
  Dependabot, not by probing many tags.
- **RabbitMQ confirms a message that reached no queue** (Step 9b). A publisher confirm means
  "RabbitMQ handled it", not "a queue has it": a publish to a deleted queue, or to an exchange
  with no binding, is confirmed and dropped. Publish with `mandatory` and treat a returned
  message as a failure (`queue/delivered.ts`).
- **An `error` event with no listener crashes the process** — in Node and in Bun. amqplib's
  connection object passes socket errors on as `error` events, and during `setup()` amqplib
  hasn't attached its own listener yet. Listen for `error` during setup (Step 9b,
  `connection.test.ts`).
- **A JavaScript `Date` has milliseconds, a Postgres `timestamptz` has microseconds.** Paging
  by a timestamp that goes through JavaScript can return the same page forever. Page by `id`
  (Step 9b, the sweep).
- **CI green doesn't cover reconnects, retries or dead letters.** The e2e tests the happy path
  across copies; the RabbitMQ failure paths (Steps 2–5) were tested by hand. A Dependabot bump
  of `amqplib` or `socket.io` needs those manual checks too, or a test for them (Step 9).

---

## 15. Later (not in this plan)

- **Kubernetes for Snap** (plan version 3 in the git history: kind, Gateway API, autoscaling,
  PodDisruptionBudgets, a kind cluster in CI, then GitOps with Argo CD and a Helm chart). The
  Docker image, health check and graceful shutdown from Steps 6–7 make it a move, not a
  rewrite. Kubernetes is already shown in Relay.
- Direct-to-S3 uploads with presigned PUT URLs (changes `POST /snaps`).
- Expo push notifications for users with the app closed — a new consumer of `message.created`
  and `snap.created`.
- RabbitMQ with three nodes and quorum queues (today RabbitMQ is a single point of failure for
  pushes, not for data).
- Routing pushes only to the copy a user is on, instead of every copy (matters with many copies).
- Prometheus + Grafana: queue depth, publish failures, copies over time — Step 10 only adds logs.
- An outbox table for events (written in the same transaction as the data, published by a
  separate loop), so a copy that loses RabbitMQ doesn't drop the pushes for the other copies
  (7.6). Not needed while a missed push only means a refetch.
- Secrets from a vault instead of a `.env` file on the server.
- PgBouncer if the number of copies grows.
- Rate limits shared across copies (in Postgres or Redis) instead of per copy.

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

# The whole stack in containers (from Step 7)
export COMPOSE_FILE=docker-compose.yml:compose.stack.yml
docker compose up -d --build                 # Traefik, migrate, 3 api copies, worker
docker compose ps                            # what runs, healthy or not
docker compose logs -f api                   # logs from every api copy
docker kill snap-api-2                       # fail one copy on purpose
docker compose up -d                         # bring it back
docker compose run --rm sweep                # the safety net, once
docker compose run --rm e2e                  # e2e across named copies
docker compose down                          # stop it all (keeps the data; never -v)

bun run seed:demo                            # demo users (Step 10)
bun run load-test                            # numbers (Step 12)
```

- RabbitMQ web UI: http://localhost:15672 (`snap` / `snap`)
- API through Traefik: http://localhost:8080
