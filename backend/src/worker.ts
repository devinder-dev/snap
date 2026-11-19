import { sql } from 'bun'
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib'
import { config } from './config'
import { jobProperties, readAttempt } from './queue/attempts'
import { closeQueue, connectQueue, queueStopping, stopQueueRecovery, watchChannel } from './queue/connection'
import { publishDelivered } from './queue/delivered'
import { runJobWithDeadline } from './queue/job-deadline'
import type { EventPayload } from './queue/events'
import { QUEUES } from './queue/topology'
import * as services from './services'
import { getOverdueSnapAgeSeconds } from './repository'
import { log } from './utils/logger'
import { createShutdown } from './utils/shutdown'

// `bun run worker`: the background process. No HTTP, no sockets.
//
// It deletes snaps whose 24 hours are up. Every snap.created also waits in
// snap.expiry.wait, a queue nobody reads; when its TTL runs out RabbitMQ
// dead-letters it to snap.expire, which drops it into snap.expire.queue —
// read here.
//
// A job that fails is tried again 30 s later, up to SNAP_MAX_ATTEMPTS times,
// then parked in snap.dead.queue for a human. Every 60 s the worker also
// counts the two parking lots and warns when something new arrived.
//
// Several workers can run side by side. They all read the SAME queue, and
// RabbitMQ gives each message to only one of them: they share the work. That's
// the opposite of the relay, where every API copy has its own queue so that
// every copy sees every event.

// How many jobs one worker holds at once: RabbitMQ never sends it more
// unacked messages than this.
const PREFETCH = 10
const JOB_DEADLINE_MS = 30_000
let deadlineHit = false

// The parking lots: nothing reads them, so nobody notices them filling up
// unless something counts.
const PARKED = [QUEUES.dead, QUEUES.unrouted]
const PARKED_CHECK_MS = 60_000

// The channel the parking-lot check uses: the current connection's worker
// channel, replaced on every reconnect.
let checkChannel: Channel | null = null

// For the shutdown: the current consumer, so it can be cancelled, and every
// job still running, so they can finish first.
let consumer: { channel: Channel; tag: string } | null = null
const running = new Set<Promise<void>>()

// Runs on every (re)connect, from setup() in queue/connection.ts.
async function startWorker(model: ChannelModel, publish: ConfirmChannel): Promise<void> {
    // Step 1: A channel of its own, with at most PREFETCH unacked jobs.
    const channel = await model.createChannel()
    watchChannel(model, channel, 'worker')
    await channel.prefetch(PREFETCH)

    // Step 2: Read the queue. Each job runs on its own; up to PREFETCH at once.
    if (queueStopping()) throw new Error('Worker is shutting down')
    const { consumerTag } = await channel.consume(QUEUES.expire, (msg) => {
        // null: RabbitMQ cancelled this consumer, e.g. snap.expire.queue was
        // deleted in the web UI. Close the connection, and recovery declares
        // the queue again and starts a new consumer.
        if (queueStopping()) return
        if (!msg) {
            log.warn({ queue: QUEUES.expire }, '⚠️ Worker consumer cancelled, reconnecting')
            model.close().catch(() => {})
            return
        }

        const job = runJobWithDeadline(
            (signal) => handle(channel, publish, msg, signal),
            () => {
                if (deadlineHit) return
                deadlineHit = true
                stopQueueRecovery()
                log.error({ messageId: msg.properties.messageId, deadlineMs: JOB_DEADLINE_MS },
                    '❌ Worker deadline exceeded; recycling with delivery unacknowledged')
                process.exitCode = 1
                void closeQueue()
                void shutdown('job deadline', true)
            },
            JOB_DEADLINE_MS,
        )
        running.add(job)
        void job.then(
            () => running.delete(job),
            (err) => {
                running.delete(job)
                log.error({ err, messageId: msg.properties.messageId }, '❌ Unexpected worker job failure')
                void shutdown('job failure', true)
            },
        )
    })
    if (queueStopping()) throw new Error('Worker is shutting down')
    consumer = { channel, tag: consumerTag }

    // Step 3: Count the parking lots now, and every PARKED_CHECK_MS from here.
    checkChannel = channel
    void checkParkedQueues()

    log.info({ queue: QUEUES.expire }, '✅ Worker listening')
}

// One job: delete the snap the message names, then ack.
async function handle(
    channel: Channel, publish: ConfirmChannel, msg: ConsumeMessage, signal: AbortSignal,
): Promise<void> {
    // Step 1: Which snap? Without a usable snap_id the job can never succeed
    // (a poison message), so it skips the retries and is parked at once.
    const snapId = readSnapId(msg)
    if (!snapId) {
        log.error({ messageId: msg.properties.messageId }, '❌ Worker: no snap ID, dead-lettering job')
        settle(() => channel.nack(msg, false, false))
        return
    }

    const attempt = readAttempt(msg)

    try {
        // Step 2: Delete it. Postgres decides whether it's really due.
        const deleted = await services.deleteExpiredSnap(snapId, signal)
        if (signal.aborted || deadlineHit) return
        log.info({ snapId, attempt, messageId: msg.properties.messageId }, deleted
            ? '🗑️ Expired snap deleted'
            : 'Snap already gone or not expired yet')

        // Step 3: Done, so RabbitMQ can forget the message — only now, after the work.
        settle(() => channel.ack(msg))
    } catch (err) {
        if (!signal.aborted && !deadlineHit) await onFailure(channel, publish, msg, snapId, attempt, err, signal)
    }
}

// A delete failed: try again later, or park it for a human.
async function onFailure(
    channel: Channel,
    publish: ConfirmChannel,
    msg: ConsumeMessage,
    snapId: string,
    attempt: number,
    err: unknown,
    signal: AbortSignal,
): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err)

    // Step 1: Out of attempts → snap.dlx → snap.dead.queue. Nothing is lost:
    // the row is still there, so the sweep deletes the snap once the cause is gone.
    if (attempt >= config.snapMaxAttempts) {
        log.error({ snapId, attempt, reason, messageId: msg.properties.messageId }, '❌ DEAD-LETTERED')
        settle(() => channel.nack(msg, false, false))
        return
    }

    // Step 2: Attempts left → a copy waits in snap.retry.wait, whose TTL sends
    // it back to snap.expire.queue. Ack the original only once the copy is
    // really in that queue — sent through the default exchange, which
    // routes by queue name — or acking could lose the job for good.
    try {
        await publishDelivered(publish, '', QUEUES.retryWait, msg.content, jobProperties(msg, attempt + 1))
        if (signal.aborted || deadlineHit) return
        log.warn({ snapId, attempt, reason, messageId: msg.properties.messageId, retryDelayMs: config.snapRetryDelayMs },
            '⚠️ Snap deletion failed, retry scheduled')
        settle(() => channel.ack(msg))
    } catch (publishErr) {
        if (signal.aborted || deadlineHit) return
        // The copy didn't make it — refused, or no snap.retry.wait to take it —
        // so the original must stay. Park it rather than requeue it: a requeue
        // would come straight back and fail again.
        const why = publishErr instanceof Error ? publishErr.message : String(publishErr)
        log.error({ snapId, reason: why, messageId: msg.properties.messageId }, '❌ Could not schedule retry, dead-lettering job')
        settle(() => channel.nack(msg, false, false))
    }
}

// Warns when a parking lot holds more than at the last count. The first count
// after starting warns about anything already there.
const lastCounts = new Map<string, number>()

async function checkParkedQueues(): Promise<void> {
    const channel = checkChannel
    if (!channel) return

    for (const queue of PARKED) {
        try {
            // A passive check: asks for the count, never creates the queue.
            const { messageCount } = await channel.checkQueue(queue)
            const before = lastCounts.get(queue) ?? 0

            if (messageCount > before) {
                log.warn({ queue, messageCount, increase: messageCount - before }, '⚠️ Parking queue grew')
            }
            lastCounts.set(queue, messageCount)
        } catch {
            // The channel closed mid-check (a reconnect); the next round uses the new one.
            return
        }
    }
}

let checkingExpiry = false

async function checkExpiryLag(): Promise<void> {
    if (checkingExpiry) return
    checkingExpiry = true
    try {
        const ageSeconds = await getOverdueSnapAgeSeconds()
        if (ageSeconds !== null) {
            log.warn({ ageSeconds }, '⚠️ Oldest expired snap is over an hour overdue')
        }
    } catch (err) {
        log.warn({ err }, '⚠️ Could not check expired snap age')
    } finally {
        checkingExpiry = false
    }
}

const monitor = setInterval(() => {
    void checkParkedQueues()
    void checkExpiryLag()
}, PARKED_CHECK_MS)

// The message is the snap.created event, unchanged by its trip through the timer.
function readSnapId(msg: ConsumeMessage): string | null {
    try {
        const event = JSON.parse(msg.content.toString()) as Partial<EventPayload<'snap.created'>>
        const id = event.snap_id
        // Snap ids are bigserial: digits only, or Postgres throws on the cast.
        return typeof id === 'string' && /^\d+$/.test(id) ? id : null
    } catch {
        return null
    }
}

// ack and nack throw if the channel closed while the job ran (RabbitMQ
// restarted, say). Nothing to do then: RabbitMQ puts the unacked message back
// and delivers it again after the reconnect, which is safe because deleting a
// snap twice deletes nothing the second time.
function settle(answer: () => void): void {
    try {
        answer()
    } catch {
        log.warn('⚠️ Worker channel closed before settlement')
    }
}

// Stop recovery before cancelling the consumer. A deadline closes the broker
// connection immediately so unacked deliveries can be redelivered.
const shutdown = createShutdown(async (_reason, forced) => {
    stopQueueRecovery()
    clearInterval(monitor)
    if (!forced) {
        await consumer?.channel.cancel(consumer.tag).catch(() => {})
        await Promise.allSettled(running)
    }
    await closeQueue()
    if (!forced && !deadlineHit) await sql.close()
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal))
}

// Like the API, this returns at once: amqplib connects in the background and
// runs startWorker on every (re)connect.
await connectQueue('snap-worker', startWorker)
