import { randomUUID } from 'node:crypto'
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib'
import { config } from '../config'
import { queueStopping, watchChannel } from '../queue/connection'
import { EXCHANGES } from '../queue/topology'
import { emitEvent } from './controllers'
import { getWebsocketServer } from './server'
import { log } from '../utils/logger'

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
// the alternate exchange could never catch one.
// A typo after a valid prefix ('message.cretaed') still matches here: the
// relay logs it as unknown and drops it, it doesn't reach snap.unrouted.
const PATTERNS = ['message.*', 'snap.*', 'friend.*']

// A push that's a minute late is useless (the app refetches when its socket
// reconnects), and the TTL stops a stuck copy from piling up messages.
const PUSH_TTL_MS = 60_000

// RabbitMQ sends this copy at most this many messages it hasn't acked yet.
const PREFETCH = 100
let relayChannel: Channel | null = null

export function relayReady(): boolean {
    return relayChannel !== null
}

// Runs on every (re)connect, from setup() in queue/connection.ts.
export async function startRelay(model: ChannelModel): Promise<void> {
    // Step 1: A channel of its own. Prefetch is a channel setting, and the
    // publish channel shouldn't share one with a consumer.
    const channel = await model.createChannel()
    watchChannel(model, channel, 'relay')
    let inactive = false
    const stopRelay = () => {
        inactive = true
        if (relayChannel === channel) relayChannel = null
    }
    channel.once('close', stopRelay)

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
    if (queueStopping()) throw new Error('Relay is shutting down')
    await channel.consume(queue, (msg) => {
        // null: RabbitMQ cancelled this consumer. Rare, since nobody else can
        // even delete an exclusive queue (the web UI gets a 400), but a relay
        // that stopped quietly would mean no pushes on this copy. So close the
        // connection, and recovery builds a fresh queue.
        if (!msg) {
            stopRelay()
            log.warn({ queue }, '⚠️ Relay consumer cancelled, reconnecting')
            model.close().catch(() => {})
            return
        }

        relay(msg)

        // Ack even when the push failed: a redelivery can't fix it.
        channel.ack(msg)
    })

    if (queueStopping() || inactive) throw new Error('Relay closed during setup')
    relayChannel = channel
    log.info({ queue }, '✅ Relay listening')
}

// After every relay start (index.ts calls this once RabbitMQ has accepted the
// connection): a phone connected to this copy while the relay was down missed
// every event of that time, and can't know it. That's after a RabbitMQ blip,
// and also when this copy started while RabbitMQ was still down — phones can
// connect before the first relay exists. With nobody connected (a normal
// start) it does nothing.
//
// Closes every phone's connection to this copy, the way a dropped network
// would ("transport close"), so each one reconnects by itself — maybe to
// another copy — and the app refetches its lists on every connect. Each
// connection on its own: engine.close() would also shut the WebSocket server,
// and no phone could connect again.
export function reconnectPhones(): void {
    const server = getWebsocketServer()
    if (!server) return

    const sockets = [...server.of('/').sockets.values()]
    for (const socket of sockets) socket.conn.close()

    if (sockets.length > 0) {
        log.info({ sockets: sockets.length }, '🔄 Relay rebuilt, reconnecting local phones')
    }
}

// One event → the socket.io emits for the people it concerns, if any of them
// are connected to this copy.
function relay(msg: ConsumeMessage): void {
    const event = { routingKey: msg.fields.routingKey, messageId: msg.properties.messageId, publisher: msg.properties.appId }

    try {
        const payload: unknown = JSON.parse(msg.content.toString())

        // During a rolling update an older copy can receive an event that only
        // the newer version knows.
        if (!emitEvent(event.routingKey, payload)) {
            log.warn(event, '⚠️ Relay skipped unknown event')
            return
        }
        log.info(event, 'Relayed event')
    } catch {
        // Parser errors may include fragments of the event body.
        log.error(event, '❌ Relay could not push event')
    }
}
