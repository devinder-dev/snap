import { randomUUID } from 'node:crypto'
import { config } from '../config'
import { getPublishChannel } from './connection'
import type { EventPayload, RoutingKey } from './events'
import { EXCHANGES } from './topology'

// What services call after a write is committed to Postgres (Step 3 wires them up).
//
// Fire-and-forget, like the socket emits it will replace: it returns nothing,
// never throws, and never makes a request wait for RabbitMQ. While RabbitMQ is
// down the event is logged and dropped (SCALING-PLAN.md 7.6): the app refetches
// when its socket reconnects, and the hourly sweep catches snaps that missed
// their timer.
export function publishEvent<K extends RoutingKey>(key: K, payload: EventPayload<K>): void {
    const channel = getPublishChannel()
    if (!channel) {
        console.warn(`RabbitMQ unavailable, dropped ${key}`)
        return
    }

    const body = Buffer.from(JSON.stringify(payload))

    try {
        channel.publish(
            EXCHANGES.events,
            key,
            body,
            {
                messageId: randomUUID(),
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
                if (err) console.error(`RabbitMQ did not confirm ${key}`, err)
            },
        )
    } catch (err) {
        // The channel closed between the check above and this publish.
        console.error(`Failed to publish ${key}`, err)
    }
}
