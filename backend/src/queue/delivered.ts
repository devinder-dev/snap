import { randomUUID } from 'node:crypto'
import type { ConfirmChannel, Message, Options } from 'amqplib'

// Publishing where losing the message is not an option: the worker's retry
// copies and the dead-letters replay. Each acks the original only after this
// resolves.
//
// A publisher confirm alone doesn't prove a queue has the message: RabbitMQ
// also confirms a message that matched no queue (the queue was deleted, the
// binding removed) and then drops it. Published with `mandatory`, such a
// message is first sent back to us — a "return" — and only then confirmed.
// So: a return before the confirm means "not delivered". The API's live
// events don't need this: snap.events sends anything unmatched to
// snap.unrouted instead.

// The ids of returned messages, per channel. One listener per channel, however
// many publishes are waiting on it at once.
const returnedIds = new WeakMap<ConfirmChannel, Set<string>>()

function returnsOf(channel: ConfirmChannel): Set<string> {
    const known = returnedIds.get(channel)
    if (known) return known

    const ids = new Set<string>()
    channel.on('return', (msg: Message) => {
        const id = msg.properties.correlationId
        if (typeof id === 'string') ids.add(id)
    })
    returnedIds.set(channel, ids)
    return ids
}

// Resolves once a queue has the message; rejects if no queue took it, if
// RabbitMQ refused it, or if the channel closed first.
export function publishDelivered(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish
): Promise<void> {
    const id = randomUUID()
    const returned = returnsOf(channel)

    return new Promise((resolve, reject) => {
        try {
            channel.publish(exchange, routingKey, content, { ...options, mandatory: true, correlationId: id }, (err) => {
                if (returned.delete(id)) {
                    reject(new Error(`no queue took it (exchange "${exchange || 'default'}", key "${routingKey}")`))
                } else if (err) {
                    reject(err)
                } else {
                    resolve()
                }
            })
        } catch (err) {
            // The channel closed between the caller's check and this publish.
            reject(err)
        }
    })
}
