import { publishEvent } from '../queue/publish'
import type { EventPayload, RoutingKey } from '../queue/events'
import type { SnapRow } from '../repository/types'
import { getWebsocketServer, userRoom, type SnapSocketServer } from './server'
import type { MessageReceivedPayload } from './types'

// Every push in the app goes through this file, in two halves:
//
//   services ──▶ send…Notification ──▶ publishEvent ──▶ RabbitMQ (snap.events)
//   RabbitMQ ──▶ relay.ts ──▶ emitEvent ──▶ socket.io ──▶ the phones connected HERE
//
// Services never emit directly: socket.io only reaches sockets connected to
// this process, and the person may be connected to another API copy. So the
// event goes to RabbitMQ, every copy gets it, and each copy emits it to its own
// sockets. Even two people on the same copy go this way: one path for all.
//
// These are notifications, not delivery. The snap or friendship is already
// committed to Postgres by the time one is sent; a recipient who is offline
// finds it through GET /snaps or GET /friends/requests instead. So publishing is
// fire-and-forget: never awaited, and it never throws into the request path.
//
// Nothing else touches the socket server, so replacing socket.io with
// @fastify/websocket (UPPGIFT.md item 15) means rewriting the emit half of this
// file and index.ts — and nothing in services.ts.

// ── Step 1: Publish (called by services) ─────────────────

// One event for the whole snap, not one per recipient: the same event starts
// the snap's one 24-hour timer (queue/topology.ts).
export function sendSnapNotification(
    snap: SnapRow,
    senderUsername: string,
    recipients: string[]
): void {
    publishEvent('snap.created', {
        snap_id: snap.id,
        sender_username: senderUsername,
        recipients,
        type: snap.type,
        created_at: snap.created_at.toISOString(),
        expires_at: snap.expires_at.toISOString(),
    })
}

// Someone added you and you haven't added them back.
export function sendFriendRequestNotification(
    recipientUsername: string,
    fromUsername: string
): void {
    publishEvent('friend.requested', {
        from: fromUsername,
        to: recipientUsername,
        created_at: new Date().toISOString(),
    })
}

// The second of the two directed edges just landed, so both sides go from
// pending to friends at the same moment and both need telling.
export function sendFriendAcceptedNotification(
    accepterUsername: string,
    otherUsername: string
): void {
    publishEvent('friend.accepted', {
        users: [accepterUsername, otherUsername],
        created_at: new Date().toISOString(),
    })
}

// Goes to the sender of the snap, not to the person who took the screenshot.
export function sendScreenshotNotification(
    senderUsername: string,
    snapId: string,
    byUsername: string
): void {
    publishEvent('snap.screenshot', {
        snap_id: snapId,
        sender_username: senderUsername,
        by: byUsername,
        created_at: new Date().toISOString(),
    })
}

export function sendMessageNotification(message: MessageReceivedPayload): void {
    publishEvent('message.created', message)
}

// ── Step 2: Emit (called by the relay) ───────────────────

// How each event becomes socket.io emits. Typed against the Events map, so
// adding an event to queue/events.ts without saying how it's pushed is a
// compile error here.
//
// An emit to a room with nobody in it on this copy does nothing, so every copy
// can run every emitter: only the copy the person is connected to reaches them.
//
// Payloads are plain objects — socket.io serializes them itself, so
// JSON.stringify here would make the client parse a string out of a string.
const emitters: { [K in RoutingKey]: (server: SnapSocketServer, event: EventPayload<K>) => void } = {
    // Both people: the recipient to see it, the sender so their other devices
    // stay in sync. The device that sent it already has it from the HTTP
    // response and drops the echo by id.
    'message.created': (server, message) => {
        server
            .to([userRoom(message.recipient_username), userRoom(message.sender_username)])
            .emit('message_received', message)
    },

    // Every recipient, with the same payload and without the recipient list:
    // people in a group snap don't learn who else got it.
    'snap.created': (server, snap) => {
        server.to(snap.recipients.map(userRoom)).emit('snap_received', {
            snap_id: snap.snap_id,
            sender_username: snap.sender_username,
            type: snap.type,
            created_at: snap.created_at,
            expires_at: snap.expires_at,
        })
    },

    'snap.screenshot': (server, shot) => {
        server.to(userRoom(shot.sender_username)).emit('screenshot_taken', {
            snap_id: shot.snap_id,
            by: shot.by,
            created_at: shot.created_at,
        })
    },

    'friend.requested': (server, request) => {
        server.to(userRoom(request.to)).emit('friend_request', {
            from: request.from,
            created_at: request.created_at,
        })
    },

    // Each of the two gets the other's name.
    'friend.accepted': (server, { users: [first, second], created_at }) => {
        server.to(userRoom(first)).emit('friend_accepted', { username: second, created_at })
        server.to(userRoom(second)).emit('friend_accepted', { username: first, created_at })
    },
}

// The relay calls this for every event in this copy's queue, whichever copy
// published it. Returns false for a routing key this version doesn't know.
export function emitEvent(key: string, payload: unknown): boolean {
    if (!Object.hasOwn(emitters, key)) return false

    // The payload was typed when publishEvent sent it; RabbitMQ hands back
    // bytes, so the routing key is what tells us its type again.
    const emit = emitters[key as RoutingKey] as (server: SnapSocketServer, event: unknown) => void

    const server = getWebsocketServer()
    if (server) emit(server, payload)
    return true
}
