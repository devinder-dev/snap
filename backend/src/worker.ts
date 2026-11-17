import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib'
import { config } from './config'
import { jobProperties, readAttempt } from './queue/attempts'
import { connectQueue, watchChannel } from './queue/connection'
import type { EventPayload } from './queue/events'
import { QUEUES } from './queue/topology'
import * as services from './services'

// `bun run worker`: the background process. No HTTP, no sockets.
//
// It deletes snaps whose 24 hours are up. Every snap.created also waits in
// snap.expiry.wait, a queue nobody reads; when its TTL runs out RabbitMQ
// dead-letters it to snap.expire, which drops it into snap.expire.queue —
// read here (SCALING-PLAN.md 7.2).
//
// A job that fails is tried again 30 s later, up to SNAP_MAX_ATTEMPTS times,
// then parked in snap.dead.queue for a human (7.3). Every 60 s the worker also
// counts the two parking lots and warns when something new arrived (section 8).
//
// Several workers can run side by side. They all read the SAME queue, and
// RabbitMQ gives each message to only one of them: they share the work. That's
// the opposite of the relay, where every API copy has its own queue so that
// every copy sees every event.

// How many jobs one worker holds at once (section 9, rule 5).
const PREFETCH = 10

// The parking lots: nothing reads them, so nobody notices them filling up
// unless something counts.
const PARKED = [QUEUES.dead, QUEUES.unrouted]
const PARKED_CHECK_MS = 60_000

// The channel the parking-lot check uses: the current connection's worker
// channel, replaced on every reconnect.
let checkChannel: Channel | null = null

// Runs on every (re)connect, from setup() in queue/connection.ts.
async function startWorker(model: ChannelModel, publish: ConfirmChannel): Promise<void> {
    // Step 1: A channel of its own, with at most PREFETCH unacked jobs.
    const channel = await model.createChannel()
    watchChannel(model, channel, 'worker')
    await channel.prefetch(PREFETCH)

    // Step 2: Read the queue. Each job runs on its own; up to PREFETCH at once.
    await channel.consume(QUEUES.expire, (msg) => {
        // null: RabbitMQ cancelled this consumer, e.g. snap.expire.queue was
        // deleted in the web UI. Close the connection, and recovery declares
        // the queue again and starts a new consumer.
        if (!msg) {
            console.warn(`⚠️ Worker: ${QUEUES.expire} was cancelled, reconnecting`)
            model.close().catch(() => {})
            return
        }

        void handle(channel, publish, msg)
    })

    // Step 3: Count the parking lots now, and every PARKED_CHECK_MS from here.
    checkChannel = channel
    void checkParkedQueues()

    console.log(`✅ Worker reading ${QUEUES.expire}`)
}

// One job: delete the snap the message names, then ack.
async function handle(channel: Channel, publish: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    // Step 1: Which snap? Without a usable snap_id the job can never succeed
    // (a poison message), so it skips the retries and is parked at once.
    const snapId = readSnapId(msg)
    if (!snapId) {
        console.error(`❌ Worker: no snap_id in message ${msg.properties.messageId}, dead-lettered`)
        settle(() => channel.nack(msg, false, false))
        return
    }

    const attempt = readAttempt(msg)

    try {
        // Step 2: Delete it. Postgres decides whether it's really due.
        const deleted = await services.deleteExpiredSnap(snapId)
        console.log(deleted
            ? `🗑️ Snap ${snapId} expired: photo and row deleted (attempt ${attempt})`
            : `Snap ${snapId}: already gone or not expired yet, nothing to do`)

        // Step 3: Done, so RabbitMQ can forget the message (rule 3: ack after the work).
        settle(() => channel.ack(msg))
    } catch (err) {
        await onFailure(channel, publish, msg, snapId, attempt, err)
    }
}

// A delete failed: try again later, or park it for a human.
async function onFailure(
    channel: Channel,
    publish: ConfirmChannel,
    msg: ConsumeMessage,
    snapId: string,
    attempt: number,
    err: unknown
): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err)

    // Step 1: Out of attempts → snap.dlx → snap.dead.queue. Nothing is lost:
    // the row is still there, so the sweep deletes the snap once the cause is gone.
    if (attempt >= config.snapMaxAttempts) {
        console.error(`❌ DEAD-LETTERED snap_id=${snapId} after ${attempt} attempts: ${reason}`)
        settle(() => channel.nack(msg, false, false))
        return
    }

    // Step 2: Attempts left → a copy waits in snap.retry.wait, whose TTL sends
    // it back to snap.expire.queue. Ack the original only once RabbitMQ has
    // confirmed the copy (rule 4); acking first could lose the job for good.
    try {
        await sendToRetry(publish, msg, attempt + 1)
        console.warn(`⚠️ Snap ${snapId}: attempt ${attempt} of ${config.snapMaxAttempts} failed (${reason}), `
            + `next try in ${config.snapRetryDelayMs / 1000} s`)
        settle(() => channel.ack(msg))
    } catch (publishErr) {
        // The copy wasn't confirmed, so the original must stay. Park it rather
        // than requeue it: a requeue would come straight back and fail again.
        console.error(`❌ Snap ${snapId}: could not schedule a retry, dead-lettered`, publishErr)
        settle(() => channel.nack(msg, false, false))
    }
}

// Resolves when RabbitMQ confirms it has the copy; rejects if it refuses it or
// the channel closes first.
function sendToRetry(publish: ConfirmChannel, msg: ConsumeMessage, attempt: number): Promise<void> {
    return new Promise((resolve, reject) => {
        publish.sendToQueue(QUEUES.retryWait, msg.content, jobProperties(msg, attempt), (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
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
                console.warn(`⚠️ ${queue} has ${messageCount} message(s) (+${messageCount - before}), `
                    + 'see SCALING-PLAN.md section 8')
            }
            lastCounts.set(queue, messageCount)
        } catch {
            // The channel closed mid-check (a reconnect); the next round uses the new one.
            return
        }
    }
}

setInterval(() => void checkParkedQueues(), PARKED_CHECK_MS)

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
// snap twice deletes nothing the second time (rule 1).
function settle(answer: () => void): void {
    try {
        answer()
    } catch {
        console.warn('⚠️ Worker: channel closed before the answer, the job will come again')
    }
}

// Like the API, this returns at once: amqplib connects in the background and
// runs startWorker on every (re)connect.
await connectQueue('snap-worker', startWorker)
