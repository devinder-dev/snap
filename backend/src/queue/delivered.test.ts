import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { ConfirmChannel, Options } from 'amqplib'
import { publishDelivered } from './delivered'

test('a mandatory return rejects even when the broker confirms the publish', async () => {
    const emitter = new EventEmitter()
    const channel = Object.assign(emitter, {
        publish(_exchange: string, key: string, _body: Buffer, options: Options.Publish, confirm: (error: null) => void) {
            expect(options.mandatory).toBe(true)
            expect(typeof options.correlationId).toBe('string')
            if (key === 'missing') emitter.emit('return', { properties: { correlationId: options.correlationId } })
            confirm(null)
            return true
        },
    }) as unknown as ConfirmChannel

    const missing = publishDelivered(channel, '', 'missing', Buffer.from('{}'), {})
    const present = publishDelivered(channel, '', 'present', Buffer.from('{}'), {})
    await expect(missing).rejects.toThrow('no queue took it')
    await expect(present).resolves.toBeUndefined()
    expect(emitter.listenerCount('return')).toBe(1)
})
