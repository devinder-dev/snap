import { expect, test } from 'bun:test'
import fastify from 'fastify'
import healthRoutes from './health'

test('readiness follows Postgres, the broker and the local relay; liveness stays up', async () => {
    const server = fastify()
    let postgres = true
    let rabbitmq = true
    let relay = true
    let probes = 0
    await server.register(healthRoutes, {
        postgres: async () => { probes++; return postgres },
        rabbitmq: () => rabbitmq,
        relay: () => relay,
        draining: () => false,
    })
    try {
        expect((await server.inject('/health')).json()).toEqual({ status: 'ok' })
        expect(probes).toBe(0)

        for (const [db, broker, consumer] of [
            [true, true, true], [true, false, false],
            [true, true, false], [false, true, true], [true, true, true],
        ]) {
            postgres = db!
            rabbitmq = broker!
            relay = consumer!
            const ready = postgres && rabbitmq && relay
            const response = await server.inject('/health/ready')
            expect(response.statusCode).toBe(ready ? 200 : 503)
            expect(response.json()).toEqual({
                status: ready ? 'ready' : 'not ready',
                postgres: postgres ? 'up' : 'down',
                rabbitmq: rabbitmq ? 'up' : 'down',
                relay: relay ? 'up' : 'down',
            })
        }
        expect((await server.inject('/health')).statusCode).toBe(200)
        expect(probes).toBe(5)
    } finally {
        await server.close()
    }
})

test('draining removes a copy from rotation while liveness and HTTP stay up', async () => {
    const server = fastify()
    let draining = false
    const unexpectedProbe = (): never => { throw new Error('Traffic probe checked a shared service') }
    await server.register(healthRoutes, {
        postgres: unexpectedProbe,
        rabbitmq: unexpectedProbe,
        relay: unexpectedProbe,
        draining: () => draining,
    })
    server.get('/example', async () => ({ status: 'served' }))
    try {
        expect((await server.inject('/health/traffic')).statusCode).toBe(200)
        draining = true
        expect((await server.inject('/health/traffic')).statusCode).toBe(503)
        expect((await server.inject('/health')).statusCode).toBe(200)
        expect((await server.inject('/example')).statusCode).toBe(200)
    } finally {
        await server.close()
    }
})
