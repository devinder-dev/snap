# Snap

A Snapchat-style app: send photo and text snaps that can be viewed once and disappear after
24 hours, chat with friends, and get every update live.

**Expo (React Native) · Bun · Fastify · PostgreSQL · AWS S3 · socket.io** — and, in progress,
**RabbitMQ · Docker · Kubernetes** to run the backend as several copies at once.

> **Status:** the app works end to end on one server. Now it's being scaled out to several
> copies on Kubernetes, with RabbitMQ carrying live events and background jobs between them —
> step by step, each step tested before the next. The full plan and progress are in
> **[SCALING-PLAN.md](SCALING-PLAN.md)**.

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

## Architecture today — one server

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

## Where it's going — several copies on Kubernetes

```mermaid
flowchart TB
    app["Expo app"] -->|"HTTPS + WebSocket"| lb["Kubernetes Gateway + Service"]
    lb --> api1["api pod 1"]
    lb --> api2["api pod 2"]
    lb --> api3["api pod 3"]
    api1 <--> mq["RabbitMQ"]
    api2 <--> mq
    api3 <--> mq
    mq <-->|"expiry jobs, retries"| worker["Worker"]
    worker --> data[("PostgreSQL + S3")]
    api1 --> data
    api2 --> data
    api3 --> data
```

Every api pod is identical and keeps no state of its own. After each write it publishes an
event; RabbitMQ hands a copy to every pod, and whichever one holds the recipient's socket
pushes it. No sticky sessions needed — the app connects over WebSocket only.

Kubernetes runs the pods: it restarts any that die, replaces them one by one on a new version,
and adds pods under load (2–6). It doesn't know which pod holds whose socket — that's
RabbitMQ's job.

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

An hourly sweep in the worker deletes anything the timer missed, so a lost or dead-lettered
job never leaves a photo behind.

## Repository

```
backend/          Fastify API on Bun — routes, services, Postgres repository, S3, socket.io
  db/migrations/  SQL migrations (dbmate)
snap/             Expo app (SDK 54, expo-router) — runs in Expo Go
SCALING-PLAN.md   The scaling plan: design, RabbitMQ topology, Kubernetes, steps and progress
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
bun run e2e                           # in a second terminal: 67 end-to-end checks

cd ../snap
cp .env.example .env                  # EXPO_PUBLIC_API_URL = your computer's LAN address
bun install && bunx expo start        # scan the QR code with Expo Go
```

More detail: [backend/README.md](backend/README.md) (HTTP API, realtime events, snap expiry) and
[snap/README.md](snap/README.md) (app architecture).
