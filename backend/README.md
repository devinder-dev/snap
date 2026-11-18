# Snap — backend

Fastify on Bun, Postgres, S3 for photos, socket.io for realtime pushes.

## Run it

```bash
docker compose up -d        # from the repo root: Postgres :5432, RabbitMQ :5672
cp .env.example .env        # fill in DATABASE_URL, RABBITMQ_URL, JWT_SECRET_KEY, S3_*
bun install
bun run migrate             # applies db/migrations (dbmate)
bun run dev                 # http://localhost:3000
bun run e2e                 # in a second terminal: the whole API end to end
bun test                    # unit tests (src/**/*.test.ts), no services needed
```

`bun run e2e` drives the running server the way the app does — HTTP for writes,
socket.io for pushes — with four throwaway `zzt_…` users and a real S3 upload,
then deletes all of it. Point it elsewhere with `E2E_BASE_URL`.

Two servers, to check live pushes cross RabbitMQ: start a second copy with
`PORT=3001 bun run dev`, then `E2E_OTHER_URL=http://localhost:3001 bun run e2e`.
Ben and Dave use the second server, Anna and Cara the first.

`bun run migrate status` / `bun run migrate rollback` pass straight through to dbmate.
The script adds `sslmode=disable` for dbmate only; the app's `DATABASE_URL` stays as is.

## HTTP API

Protected routes need `Authorization: Bearer <access_token>`. Every error has the
same shape: `{ "success": false, "code": 400, "message": "…" }`, and `message` is
written for the user.

Tokens: the access token lasts 15 minutes, the refresh token 30 days. `/login` allows
5 tries a minute per account and client IP, `/register` 20 a minute per IP; past
that the answer is `429`. The counters live in each api copy's memory, so behind
Traefik's three copies the real limit is three times as high.

| Method | URL                        | Body / query              | Response                                   |
| ------ | -------------------------- | ------------------------- | ------------------------------------------ |
| POST   | `/register`                | `{ username, password }`  | `201 { tokens, user }`                     |
| POST   | `/login`                   | `{ username, password }`  | `200 { tokens, user }`                     |
| POST   | `/refresh`                 | `{ refresh_token }`       | `200 { tokens }`                           |
| GET    | `/friends`                 | –                         | `200 { friends: ApiFriend[] }`             |
| GET    | `/friends/requests`        | –                         | `200 { requests }` — people who added you  |
| POST   | `/friends`                 | `{ friend_username }`     | `200 { status: 'pending' \| 'friends' }`   |
| DELETE | `/friends/:username`       | –                         | `204`                                      |
| POST   | `/snaps`                   | multipart: `file`, `recipients`, `text?` | `201 { snap_id, expires_at }` |
| GET    | `/snaps`                   | –                         | `200 { snaps }` — inbox, metadata only     |
| GET    | `/snaps/:id`               | –                         | `200 ApiSnap` — **one-shot**, burns it     |
| POST   | `/snaps/:id/screenshot`    | –                         | `204`, pushes `screenshot_taken` to sender |
| GET    | `/conversations`           | –                         | `200 { conversations }` — newest message per person |
| GET    | `/messages/:username`      | `?before=<message id>`    | `200 { messages }` — 50, newest first      |
| POST   | `/messages/:username`      | `{ body }` (1–2000 chars) | `201 ApiMessage`                           |

Snaps and messages can only be sent to mutual friends (`400 You are not friends with X`).

## Health and logs

Docker probes `GET /health` to check that the process can answer. Use
`GET /health/ready` for deploy checks. It returns 200 when Postgres answers
and this copy has a RabbitMQ connection and a running relay. Otherwise it
returns 503 with the status of each check.

The API, worker, and sweep write JSON logs with an `instance` field. Filter
API logs by `messageId` to match a confirmed publish to the relay deliveries
on other copies. These trace entries record event metadata and omit the event body.
A broker outage logs a warning after two minutes. The worker checks once a
minute for expired snaps more than an hour overdue.

## Realtime

socket.io on the same port. Authenticate in the handshake with
`io(url, { auth: { token: accessToken } })`; a bad or expired token is refused
with `You are not authorized`.

The socket is **push-only**: every write goes over HTTP, and the server then
emits to each affected user's room (`user:<username>`). A client that was offline
misses nothing — the same data is in the HTTP API — so clients refetch on reconnect.

| Event              | To                        | Payload                                          |
| ------------------ | ------------------------- | ------------------------------------------------ |
| `message_received` | recipient **and** sender  | `ApiMessage`                                     |
| `snap_received`    | each recipient            | `{ snap_id, sender_username, type, created_at, expires_at }` |
| `friend_request`   | the person added          | `{ from, created_at }`                           |
| `friend_accepted`  | both people               | `{ username, created_at }`                       |
| `screenshot_taken` | the snap's sender         | `{ snap_id, by, created_at }`                    |

All emits live in `src/websocket/controllers.ts` — nothing else touches the socket
server.

## Snap expiry

Snaps live 24 hours. Reads already refuse expired snaps; two things delete them for
good — the S3 object first, then the row, so a failed S3 delete leaves the row to
retry rather than orphaning the photo:

- **The timer.** Every `snap.created` also waits 24 hours in `snap.expiry.wait`;
  RabbitMQ then hands it to the worker (`bun run worker`, `src/worker.ts`), which
  re-checks `expires_at` in Postgres and deletes that one snap.
- **The sweep** (`bun run sweep`, `scripts/sweep.ts`): one pass over everything past
  `expires_at`, then exit. The safety net for timers that never ran (RabbitMQ was
  down) or failed; on the server cron runs it hourly.

```bash
bun run worker              # a third terminal, next to dev
bun run sweep               # now and then, by hand
```

A delete that fails (S3 down, say) is tried again 30 seconds later, up to
`SNAP_MAX_ATTEMPTS` (3) times. After that the job is parked in `snap.dead.queue`
with a `DEAD-LETTERED` log line, and the worker warns every minute that the queue
grew — the same for `snap.unrouted.queue`, where an event with a typo'd routing
key ends up. Parked jobs wait for a human:

```bash
bun run dead-letters list   # what's parked and why; it stays parked
bun run dead-letters replay # once the cause is fixed: back to the worker, attempt 1
bun run dead-letters purge  # delete them for good
```

## Docker

One `Dockerfile`, two targets. `app` runs the api by default, and the worker and the
sweep with a different command; `tools` adds the dev packages and runs the migrations
(and the e2e). Only what `.dockerignore` lets in reaches the image — never `.env`.

```bash
docker build --target app   -t snap-app   .
docker build --target tools -t snap-tools .

# On the compose network, where the database and RabbitMQ are called postgres
# and rabbitmq (DATABASE_URL and RABBITMQ_URL must use those names):
docker run --rm --network snap_default --env-file .env -p 127.0.0.1:3001:3000 snap-app
docker run --rm --network snap_default --env-file .env snap-app bun --sql-preconnect src/worker.ts
docker run --rm --network snap_default --env-file .env snap-tools          # migrations
```

`docker stop` sends SIGTERM, and both shut down cleanly in well under a second: the
api closes its sockets (phones reconnect to another copy), finishes open requests and
closes RabbitMQ; the worker stops taking jobs and finishes the running ones.

Usually you don't run these by hand: `compose.stack.yml` in the repo root starts the
whole stack — Traefik, the migrations, three api copies and the worker — with the
right names and settings (see the root README).

## Layout

```
src/index.ts          server setup, plugin registration
src/worker.ts         `bun run worker`: deletes each snap when its timer runs out
src/config.ts         settings read once at startup (RabbitMQ, snap timing)
src/auth.ts           JWT plugin + `authenticate` preHandler
src/http/             routes, controllers (parse + validate), API types
src/services.ts       business rules
src/repository/       SQL (Bun.sql) and row types
src/queue/            RabbitMQ: connection, topology, events, publish
src/websocket/        socket.io server, handshake auth, publish + emit, relay
scripts/              migrate, e2e, sweep, dead-letters
db/migrations/        dbmate migrations
Dockerfile            the image: `app` and `tools` targets
```
