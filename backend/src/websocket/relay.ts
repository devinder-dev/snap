import { randomUUID } from 'node:crypto'
import type { ChannelModel, ConsumeMessage } from 'amqplib'
import { config } from '../config'
import { watchChannel } from '../queue/connection'
import { EXCHANGES } from '../queue/topology'
import { emitEvent } from './controllers'

// The relay: how a push reaches a phone that is connected to another API copy.
//
// Every copy has its own queue, bound to snap.events, so every copy gets its
// own copy of every event — including the ones it published itself — and
// emits it to whoever of the people involved is connected here.
//
//   api 1 ── publish ──▶ snap.events ──┬──▶ realtime.<api 1> ──▶ relay ──▶ phones on api 1
//                                      └──▶ realtime.<api 2> ──▶ relay ──▶ phones on api 2
//
// One queue PER COPY is the point. Several readers on ONE queue would split the
// events between them (that's how the worker shares jobs in Step 4), and Ben's
// copy might never see the message meant for him.

// Specific patterns, never '#': '#' would match a typo'd routing key too, and
// the alternate exchange could never catch one (SCALING-PLAN.md section 5).
const PATTERNS = ['message.*', 'snap.*', 'friend.*']

// A push that's a minute late is useless (the app refetches when its socket
// reconnects), and the TTL stops a stuck copy from piling up messages.
const PUSH_TTL_MS = 60_000

// RabbitMQ sends this copy at most this many messages it hasn't acked yet.
const PREFETCH = 100

// Runs on every (re)connect, from setup() in queue/connection.ts.
export async function startRelay(model: ChannelModel): Promise<void> {
    // Step 1: A channel of its own. Prefetch is a channel setting, and the
    // publish channel shouldn't share one with a consumer.
    const channel = await model.createChannel()
    watchChannel(model, channel, 'relay')

    // Step 2: This copy's queue. Exclusive: it belongs to this connection, and
    // RabbitMQ deletes it the moment the connection closes, so a crashed pod
    // leaves nothing behind. The random part is new on every connect: it never
    // collides with the old queue, and two copies on one laptop (same hostname)
    // still get different names.
    const name = `realtime.${config.instanceId}-${randomUUID().slice(0, 8)}`
    const { queue } = await channel.assertQueue(name, {
        exclusive: true,
        durable: false,
        messageTtl: PUSH_TTL_MS,
    })

    for (const pattern of PATTERNS) {
        await channel.bindQueue(queue, EXCHANGES.events, pattern)
    }

    // Step 3: Read it.
    await channel.prefetch(PREFETCH)
    await channel.consume(queue, (msg) => {
        // null: RabbitMQ cancelled this consumer. Rare, since nobody else can
        // even delete an exclusive queue (the web UI gets a 400), but a relay
        // that stopped quietly would mean no pushes on this copy. So close the
        // connection, and recovery builds a fresh queue.
        if (!msg) {
            console.warn(`⚠️ Relay queue ${queue} was cancelled, reconnecting`)
            model.close().catch(() => {})
            return
        }

        relay(msg)

        // Ack even when the push failed: a redelivery can't fix it.
        channel.ack(msg)
    })

    console.log(`✅ Relay listening on ${queue}`)
}

// One event → the socket.io emits for the people it concerns, if any of them
// are connected to this copy.
function relay(msg: ConsumeMessage): void {
    const key = msg.fields.routingKey

    try {
        const payload: unknown = JSON.parse(msg.content.toString())

        // During a rolling update an older copy can receive an event that only
        // the newer version knows.
        if (!emitEvent(key, payload)) {
            console.warn(`⚠️ Relay: no push defined for ${key}, skipped`)
        }
    } catch (err) {
        console.error(`❌ Relay could not push ${key}`, err)
    }
}
