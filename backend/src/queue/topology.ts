import type { Channel } from 'amqplib'
import { config } from '../config'
import type { RoutingKey } from './events'

// Every exchange and queue Snap uses, and the one function that creates them:
//
//   snap.events (topic) ── message.* · snap.* · friend.* ──▶ realtime.<copy>   (each api copy's relay)
//        │  └──────────── snap.created ──▶ snap.expiry.wait ── TTL 24 h ──▶ snap.expire ──▶ snap.expire.queue (worker)
//        │                                                                       ▲
//        │                       snap.retry.wait ── TTL 30 s ────────────────────┘   (a failed job, tried again)
//        └─ no binding matches ──▶ snap.unrouted ──▶ snap.unrouted.queue              (parked: a typo'd key)
//   a job that failed every attempt ──▶ snap.dlx ──▶ snap.dead.queue                (parked for a human)
//
// Declaring is idempotent: asserting something that already exists with the
// same settings does nothing. So every process runs declareTopology() on every
// (re)connect, and nobody ever sets RabbitMQ up by hand.
//
// Asserting it with DIFFERENT settings fails with PRECONDITION_FAILED (406).
// That's why SNAP_TTL_MS and SNAP_RETRY_DELAY_MS can't simply be changed once
// the queues exist: stop the apps, delete snap.expiry.wait / snap.retry.wait in
// the web UI, and start again. Timers that were waiting are lost; the sweep
// deletes those snaps instead.

export const EXCHANGES = {
    // Every event the API publishes lands here first.
    events: 'snap.events',
    // Where snap.events sends what no binding matched: a typo'd routing key.
    unrouted: 'snap.unrouted',
    // A snap's time is up: the timer dead-letters it here, the worker reads it.
    expire: 'snap.expire',
    // Jobs that failed every attempt.
    deadLetter: 'snap.dlx',
} as const

export const QUEUES = {
    // The 24-hour timer. Nobody reads it; RabbitMQ dead-letters each message to
    // snap.expire when its TTL runs out.
    expiryWait: 'snap.expiry.wait',
    expire: 'snap.expire.queue',
    // Same trick, 30 seconds: a failed job waits here before its next attempt.
    retryWait: 'snap.retry.wait',
    // Parking lots, emptied by a human (web UI or `bun run dead-letters`).
    dead: 'snap.dead.queue',
    unrouted: 'snap.unrouted.queue',
} as const

// Parked messages are kept for a week, at most 10 000; past that the oldest go.
const PARKING = {
    durable: true,
    messageTtl: 7 * 24 * 60 * 60 * 1000,
    maxLength: 10_000,
}

const SNAP_CREATED: RoutingKey = 'snap.created'

export async function declareTopology(channel: Channel): Promise<void> {
    // Exchanges first, queues next, bindings last: a binding needs both ends.
    // snap.unrouted before snap.events, which names it as its alternate.
    await channel.assertExchange(EXCHANGES.unrouted, 'fanout', { durable: true })
    await channel.assertExchange(EXCHANGES.events, 'topic', {
        durable: true,
        alternateExchange: EXCHANGES.unrouted,
    })
    await channel.assertExchange(EXCHANGES.expire, 'fanout', { durable: true })
    await channel.assertExchange(EXCHANGES.deadLetter, 'fanout', { durable: true })

    await channel.assertQueue(QUEUES.expiryWait, {
        durable: true,
        messageTtl: config.snapTtlMs,
        deadLetterExchange: EXCHANGES.expire,
    })
    // When the worker gives up on a job it rejects it, and it's dead-lettered.
    await channel.assertQueue(QUEUES.expire, {
        durable: true,
        deadLetterExchange: EXCHANGES.deadLetter,
    })
    await channel.assertQueue(QUEUES.retryWait, {
        durable: true,
        messageTtl: config.snapRetryDelayMs,
        deadLetterExchange: EXCHANGES.expire,
    })
    await channel.assertQueue(QUEUES.dead, PARKING)
    await channel.assertQueue(QUEUES.unrouted, PARKING)

    // Only snap.created starts a timer. The live-push bindings (message.*,
    // snap.*, friend.*) belong to each API copy's own queue, which arrives with
    // the relay in Step 3. Fanout exchanges ignore the routing key, hence ''.
    // snap.retry.wait has no binding: the worker sends to it by name.
    await channel.bindQueue(QUEUES.expiryWait, EXCHANGES.events, SNAP_CREATED)
    await channel.bindQueue(QUEUES.expire, EXCHANGES.expire, '')
    await channel.bindQueue(QUEUES.dead, EXCHANGES.deadLetter, '')
    await channel.bindQueue(QUEUES.unrouted, EXCHANGES.unrouted, '')
}
