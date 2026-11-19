import { randomUUID } from 'node:crypto'
import { config } from '../config'
import type { ConfirmChannel } from 'amqplib'
import { getPublishChannel, publishBlocked } from './connection'
import type { EventPayload, RoutingKey } from './events'
import { EXCHANGES } from './topology'
import { log } from '../utils/logger'

const MAX_PENDING_CONFIRMS = 256
const pendingByChannel = new WeakMap<ConfirmChannel, { count: number; draining: boolean }>()
const lastDropAt = new Map<string, number>()

function logDrop(routingKey: RoutingKey, reason: string): void {
    // Log the first drop and at most one per second per reason during a flood.
    const now = Date.now()
    if (now - (lastDropAt.get(reason) ?? -Infinity) < 1_000) return
    lastDropAt.set(reason, now)
    log.warn({ routingKey, reason }, '⚠️ Dropped live event')
}

// What services call after a write is committed to Postgres (Step 3 wires them up).
//
// Fire-and-forget, like the socket emits it will replace: it returns nothing,
// never throws, and never makes a request wait for RabbitMQ. While RabbitMQ is
// down the event is logged and dropped: the app refetches
// when its socket reconnects, and the hourly sweep catches snaps that missed
// their timer.
export function publishEvent<K extends RoutingKey>(key: K, payload: EventPayload<K>): void {
    const channel = getPublishChannel()
    if (!channel) return logDrop(key, 'unavailable')
    if (publishBlocked()) return logDrop(key, 'broker blocked')

    let pending = pendingByChannel.get(channel)
    if (!pending) {
        pending = { count: 0, draining: false }
        pendingByChannel.set(channel, pending)
    }
    if (pending.count >= MAX_PENDING_CONFIRMS) return logDrop(key, 'confirm limit')
    if (pending.draining) return logDrop(key, 'write buffer full')

    const event = { routingKey: key, messageId: randomUUID() }
    const state = pending
    state.count++
    try {
        const body = Buffer.from(JSON.stringify(payload))
        const writable = channel.publish(
            EXCHANGES.events,
            key,
            body,
            {
                messageId: event.messageId,
                // AMQP timestamps are whole seconds, not milliseconds.
                timestamp: Math.floor(Date.now() / 1000),
                type: key,
                appId: config.instanceId,
                contentType: 'application/json',
                // Written to disk, so it survives a RabbitMQ restart.
                persistent: true,
            },
            // Confirm mode: RabbitMQ answers every publish. An error here means
            // it refused the message, or the channel closed before it answered.
            (err) => {
                state.count--
                if (err) log.error(event, '❌ RabbitMQ did not confirm event')
                else log.info(event, 'Published event')
            },
        )
        if (!writable) {
            state.draining = true
            channel.once('drain', () => { state.draining = false })
        }
    } catch {
        state.count--
        log.error(event, '❌ Failed to publish event')
    }
}
