# Snap — backend

Fastify on Bun, Postgres, S3 for photos, socket.io for realtime pushes.

## Run it

```bash
docker compose up -d        # from the repo root: Postgres on :5432
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET_KEY, S3_*
bun install
bun run migrate             # applies db/migrations (dbmate)
bun run dev                 # http://localhost:3000
```

`bun run migrate status` / `bun run migrate rollback` pass straight through to dbmate.
The script adds `sslmode=disable` for dbmate only; the app's `DATABASE_URL` stays as is.

## HTTP API

Protected routes need `Authorization: Bearer <access_token>`. Every error has the
same shape: `{ "success": false, "code": 400, "message": "…" }`, and `message` is
written for the user.

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

Snaps live 24 hours. Reads already refuse expired snaps; `src/jobs/snap-expiry.ts`
sweeps every 5 minutes and deletes them for good — the S3 object first, then the
row, so a failed S3 delete leaves the row to retry rather than orphaning the photo.

Every instance runs the sweep. That's safe (deletes are idempotent) but redundant
once there are several instances.

## Layout

```
src/index.ts          server setup, plugin registration
src/auth.ts           JWT plugin + `authenticate` preHandler
src/http/             routes, controllers (parse + validate), API types
src/services.ts       business rules
src/repository/       SQL (Bun.sql) and row types
src/websocket/        socket.io server, handshake auth, emitters
src/jobs/             background work (snap expiry)
db/migrations/        dbmate migrations
```
