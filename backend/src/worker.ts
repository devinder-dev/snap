import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib'
import { connectQueue, watchChannel } from './queue/connection'
import type { EventPayload } from './queue/events'
import { QUEUES } from './queue/topology'
import * as services from './services'

// `bun run worker`: the background process. No HTTP, no sockets.
//
// It deletes snaps whose 24 hours are up. Every snap.created also waits in
// snap.expiry.wait, a queue nobody reads; when its TTL runs out RabbitMQ
// dead-letters it to snap.expire, which drops it into snap.expire.queue —
// read here (SCALING-PLAN.md 7.2). Step 5 adds retries and dead-letter checks.
//
// Several workers can run side by side. They all read the SAME queue, and
// RabbitMQ gives each message to only one of them: they share the work. That's
// the opposite of the relay, where every API copy has its own queue so that
// every copy sees every event.

// How many jobs one worker holds at once (section 9, rule 5).
const PREFETCH = 10

// Runs on every (re)connect, from setup() in queue/connection.ts.
async function startWorker(model: ChannelModel): Promise<void> {
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

        void handle(channel, msg)
    })

    console.log(`✅ Worker reading ${QUEUES.expire}`)
}

// One job: delete the snap the message names, then ack.
async function handle(channel: Channel, msg: ConsumeMessage): Promise<void> {
    // Step 1: Which snap? Without a usable snap_id the job can never succeed,
    // so it goes straight to snap.dead.queue for a human to look at.
    const snapId = readSnapId(msg)
    if (!snapId) {
        console.error(`❌ Worker: no snap_id in message ${msg.properties.messageId}, dead-lettered`)
        settle(() => channel.nack(msg, false, false))
        return
    }

    try {
        // Step 2: Delete it. Postgres decides whether it's really due.
        const deleted = await services.deleteExpiredSnap(snapId)
        console.log(deleted
            ? `🗑️ Snap ${snapId} expired: photo and row deleted`
            : `Snap ${snapId}: already gone or not expired yet, nothing to do`)

        // Step 3: Done, so RabbitMQ can forget the message (rule 3: ack after the work).
        settle(() => channel.ack(msg))
    } catch (err) {
        // No retries yet (Step 5). nack without requeue → snap.dlx →
        // snap.dead.queue. Putting it back in the queue instead would retry it
        // thousands of times a second while S3 is down. The row is still
        // there, so the sweep deletes the snap once the cause is gone.
        console.error(`❌ Worker: deleting snap ${snapId} failed, dead-lettered`, err)
        settle(() => channel.nack(msg, false, false))
    }
}

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
