import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'bun:test'
import type { ChannelModel } from 'amqplib'

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
