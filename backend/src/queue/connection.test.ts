import { EventEmitter } from 'node:events'
import { describe, expect, spyOn, test } from 'bun:test'
import type { ChannelModel, ConsumeMessage, MessageProperties } from 'amqplib'
import { log } from '../utils/logger'

// Unit tests for the setup that runs on every fresh RabbitMQ connection
// (`bun test`). A fake connection makes the rare moments happen on demand:
// an error or a close in the middle of setup, which a real RabbitMQ only
// does by bad luck.

// config.ts insists on RABBITMQ_URL. Nothing connects in these tests.
process.env.RABBITMQ_URL ??= 'amqp://unused-in-unit-tests'
const { createSetup, getPublishChannel } = await import('./connection')

// A channel whose declarations all succeed at once.
function fakeChannel() {
    const channel = new EventEmitter() as EventEmitter & Record<string, unknown>
    channel.assertExchange = async () => ({})
    channel.assertQueue = async (queue: string) => ({ queue, messageCount: 0, consumerCount: 0 })
    channel.bindQueue = async () => ({})
    return channel
}

// A connection whose createConfirmChannel() answers when the test says so.
function fakeConnection() {
    let answer!: { resolve: (c: unknown) => void; reject: (e: Error) => void }
    const model = new EventEmitter() as EventEmitter & Record<string, unknown>
    model.createConfirmChannel = () => new Promise((resolve, reject) => { answer = { resolve, reject } })
    model.close = async () => {}
    return { model: model as unknown as ChannelModel & EventEmitter, answer: () => answer }
}

describe('setup on a fresh connection', () => {
    test('an error during setup does not crash the process, and the attempt fails', async () => {
        const { model, answer } = fakeConnection()
        const running = createSetup()(model)

        // What amqplib's ChannelModel does when the socket breaks: it passes the
        // connection's 'error' on. With no listener, emit() throws — in a real
        // process that's an uncaught exception, and the api or worker dies.
        expect(() => model.emit('error', new Error('read ECONNRESET'))).not.toThrow()

        // Then the connection closes, and the pending step fails.
        model.emit('close')
        answer().reject(new Error('Connection closed'))

        await expect(running).rejects.toThrow()
        expect(model.listenerCount('error')).toBe(0)
        expect(model.listenerCount('close')).toBe(0)
    })

    test('a close during setup fails the attempt even if every step succeeded', async () => {
        const { model, answer } = fakeConnection()
        const running = createSetup(async () => {
            model.emit('close')
        })(model)

        answer().resolve(fakeChannel())

        await expect(running).rejects.toThrow('closed during setup')
        expect(getPublishChannel()).toBeNull()
    })

    test('a healthy setup opens publishing and leaves no listeners behind', async () => {
        const { model, answer } = fakeConnection()
        const channel = fakeChannel()
        const running = createSetup()(model)

        answer().resolve(channel)
        await running

        expect(getPublishChannel()).toBe(channel as never)
        expect(model.listenerCount('error')).toBe(0)
        expect(model.listenerCount('close')).toBe(0)
    })
})

test('publisher and relay log the same event ID and cancellation clears relay readiness', async () => {
    const { publishEvent } = await import('./publish')
    const { relayReady, startRelay } = await import('../websocket/relay')
    const { model, answer } = fakeConnection()
    const channel = fakeChannel()
    const relayChannel = fakeChannel()
    let deliver!: (message: ConsumeMessage | null) => void
    let sent!: ConsumeMessage
    const close = spyOn(model, 'close')
    const info = spyOn(log, 'info').mockImplementation(() => {})

    relayChannel.prefetch = async () => {}
    relayChannel.ack = () => {}
    relayChannel.consume = async (_queue: string, callback: typeof deliver) => { deliver = callback }
    Object.assign(model, { createChannel: async () => relayChannel })
    channel.publish = (
        _exchange: string, routingKey: string, content: Buffer,
        properties: MessageProperties, confirm: (err: null) => void,
    ) => {
        sent = { fields: { routingKey }, properties, content } as ConsumeMessage
        confirm(null)
        return true
    }

    try {
        const setup = createSetup(startRelay)(model)
        answer().resolve(channel)
        await setup
        expect(relayReady()).toBe(true)

        publishEvent('friend.requested', { from: 'private-sender', to: 'private-recipient', created_at: 'now' })
        deliver(sent)
        const published = info.mock.calls.find(([, message]) => message === 'Published event')?.[0]
        const relayed = info.mock.calls.find(([, message]) => message === 'Relayed event')?.[0]
        expect(published).toEqual({ routingKey: 'friend.requested', messageId: sent.properties.messageId })
        expect(relayed).toEqual({
            routingKey: 'friend.requested', messageId: sent.properties.messageId, publisher: sent.properties.appId,
        })
        expect(JSON.stringify(info.mock.calls)).not.toContain('private-sender')

        deliver(null)
        expect(relayReady()).toBe(false)
        expect(close).toHaveBeenCalledTimes(1)
    } finally {
        relayChannel.emit('close')
        channel.emit('close')
        close.mockRestore()
        info.mockRestore()
    }
})

test('pending live publishes stay bounded and resume after a confirm', async () => {
    const { publishEvent } = await import('./publish')
    const { model, answer } = fakeConnection()
    const channel = fakeChannel()
    const confirms: ((error: null) => void)[] = []
    let writable = true
    channel.publish = (...args: unknown[]) => {
        confirms.push(args[4] as (error: null) => void)
        return writable
    }

    const info = spyOn(log, 'info').mockImplementation(() => {})
    const warn = spyOn(log, 'warn').mockImplementation(() => {})
    const payload = { from: 'anna', to: 'ben', created_at: 'now' }
    try {
        const setup = createSetup()(model)
        answer().resolve(channel)
        await setup
        for (let i = 0; i < 300; i++) publishEvent('friend.requested', payload)
        expect(confirms).toHaveLength(256)
        expect(warn.mock.calls.some(([fields]) =>
            (fields as { reason?: string }).reason === 'confirm limit')).toBe(true)
        confirms[0]!(null)
        publishEvent('friend.requested', payload)
        expect(confirms).toHaveLength(257)

        confirms[1]!(null)
        model.emit('blocked', 'memory alarm')
        publishEvent('friend.requested', payload)
        expect(confirms).toHaveLength(257)
        expect(warn.mock.calls.some(([fields]) =>
            (fields as { reason?: string }).reason === 'broker blocked')).toBe(true)
        model.emit('unblocked')
        writable = false
        publishEvent('friend.requested', payload)
        expect(confirms).toHaveLength(258)

        confirms[2]!(null)
        publishEvent('friend.requested', payload)
        expect(confirms).toHaveLength(258)
        writable = true
        channel.emit('drain')
        publishEvent('friend.requested', payload)
        expect(confirms).toHaveLength(259)
    } finally {
        channel.emit('close')
        info.mockRestore()
        warn.mockRestore()
    }
})
