# Snap

A Snapchat-style app: send photo and text snaps that can be viewed once and disappear after
24 hours, chat with friends, and get every update live.

**Expo (React Native) · Bun · Fastify · PostgreSQL · AWS S3 · socket.io · RabbitMQ** — and, in
progress, **Docker · Traefik** to run the backend as three copies behind one address.

> **Status:** the app works end to end, and the backend can already run as several copies side
> by side: live pushes cross between them through RabbitMQ, and a worker deletes each snap when
> its 24-hour timer runs out. Next come retries and dead letters, then Docker, three copies
> behind Traefik, CI and a deploy to one server — step by step, each step tested before the
> next. The full plan and progress are in **[SCALING-PLAN.md](SCALING-PLAN.md)**.

## What it does

- **Accounts** — register, log in; short-lived JWT access tokens refreshed automatically.
- **Friends** — add someone, they add you back, you're friends. Snaps only go to friends.
- **Snaps** — a photo, with an optional caption, to one or many friends. It is opened through
  a 5-minute presigned S3 link, and **only once**: the read that authorizes it also marks it viewed.
  The sender is told if you screenshot it. After 24 hours the photo and the row are deleted.
- **Chat** — one-to-one messages with paged history and a conversation list.
- **Live pushes** — new snaps, messages, friend requests and screenshots arrive over a
  WebSocket. The socket only *announces*; all data comes over HTTP, so a missed push is never
  lost data — the app refetches whenever it reconnects.

## Where it started — one server

```mermaid
flowchart LR
    app["Expo app"] -->|"HTTP: auth, friends, snaps, chat"| api["Fastify API on Bun"]
    api -->|"socket.io: live pushes"| app
    api --> pg[("PostgreSQL")]
    api -->|"upload / delete photos"| s3[("AWS S3")]
    app -.->|"5-minute presigned link"| s3
```

This can't simply be copied onto more servers: each user's socket lives in **one** server's
memory, so a message saved by server 1 can't be pushed to someone connected to server 2.

## Where it's going — three copies behind Traefik

```mermaid
flowchart TB
    app["Expo app"] -->|"HTTPS + WebSocket"| lb["Traefik"]
    lb --> api1["api copy 1"]
    lb --> api2["api copy 2"]
    lb --> api3["api copy 3"]
    api1 <--> mq["RabbitMQ"]
    api2 <--> mq
    api3 <--> mq
    mq <-->|"expiry jobs, retries"| worker["Worker"]
    worker --> data[("PostgreSQL + S3")]
    api1 --> data
    api2 --> data
    api3 --> data
```

Every api copy is identical and keeps no state of its own. After each write it publishes an
event; RabbitMQ hands a copy to every api copy, and whichever one holds the recipient's socket
pushes it. No sticky sessions needed — the app connects over WebSocket only.

docker compose runs everything on one server: it restarts a copy that crashes, and Traefik only
sends traffic to the copies that are healthy. Neither knows which copy holds whose socket —
that's RabbitMQ's job. (Why docker compose and not Kubernetes: section 0 of the plan.)

### Following one message across servers

```mermaid
sequenceDiagram
    participant Anna as Anna's phone
    participant A1 as API copy 1
    participant PG as PostgreSQL
    participant MQ as RabbitMQ
    participant A2 as API copy 2
    participant Ben as Ben's phone
    Anna->>A1: POST /messages/ben
    A1->>PG: INSERT the message (the source of truth)
    A1-->>Anna: 201 Created
    A1->>MQ: publish message.created
    MQ->>A1: copy for server 1
    MQ->>A2: copy for server 2
    A2->>Ben: message_received
    Note over A1: Server 1 pushes to Anna's other devices
```

### A snap's 24-hour timer

```mermaid
sequenceDiagram
    participant API as API copy
    participant Wait as snap.expiry.wait
    participant Q as snap.expire.queue
    participant W as Worker
    participant Retry as snap.retry.wait
    participant Dead as snap.dead.queue
    API->>Wait: snap.created - waits 24 h, nobody reads this queue
    Wait->>Q: time is up - RabbitMQ dead-letters it
    Q->>W: delete snap 42
    alt S3 and Postgres answer
        W->>W: delete the photo, then the row, ack
    else it failed, attempts left
        W->>Retry: same job, attempt + 1
        Retry->>Q: back in line after 30 s
    else it failed 3 times
        W->>Dead: kept 7 days for a human to inspect
    end
```

An hourly sweep (`bun run sweep`, run by cron on the server) deletes anything the timer missed,
so a lost or dead-lettered job never leaves a photo behind.

## Repository

```
backend/          Fastify API on Bun — routes, services, Postgres repository, S3, socket.io
  db/migrations/  SQL migrations (dbmate)
snap/             Expo app (SDK 54, expo-router) — runs in Expo Go
SCALING-PLAN.md   The scaling plan: design, RabbitMQ topology, docker compose, steps and progress
```

## Run it locally

You need Bun, Docker, and an S3 bucket with an IAM user that can put, get and delete objects
in it (policy in [`backend/infra/s3-policy.json`](backend/infra/s3-policy.json)).

```bash
docker compose up -d                  # PostgreSQL :5432, RabbitMQ :5672 (web UI :15672)
cd backend
cp .env.example .env                  # DATABASE_URL, RABBITMQ_URL, JWT_SECRET_KEY, S3_*
bun install && bun run migrate
bun run dev                           # http://localhost:3000
bun run worker                        # in a second terminal: deletes snaps when their 24 h are up
bun run e2e                           # in a third terminal: 67 end-to-end checks

cd ../snap
cp .env.example .env                  # EXPO_PUBLIC_API_URL = your computer's LAN address
bun install && bunx expo start        # scan the QR code with Expo Go
```

### The whole stack in containers — three copies behind Traefik

The same `backend/.env`, but everything runs in Docker: Traefik in front, three api copies,
the worker, and the migrations before them.

```bash
export COMPOSE_FILE=docker-compose.yml:compose.stack.yml
docker compose up -d --build          # API through Traefik: http://localhost:8080
docker compose ps                     # 3 api copies, healthy; the worker; migrate exited 0
docker compose run --rm e2e           # the e2e, Anna on copy 1 and Ben on copy 2
docker kill snap-api-2                # fail a copy: its phones reconnect to another one
docker compose up -d                  # bring it back
```

Point the app at it with `EXPO_PUBLIC_API_URL=http://<your LAN address>:8080`. Traefik's
dashboard, showing which copies are live, is at http://localhost:8081.

More detail: [backend/README.md](backend/README.md) (HTTP API, realtime events, snap expiry) and
[snap/README.md](snap/README.md) (app architecture).
