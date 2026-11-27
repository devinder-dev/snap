import type { FastifyInstance } from 'fastify'

type ReadinessChecks = {
    postgres: () => Promise<boolean>
    rabbitmq: () => boolean
    relay: () => boolean
    draining: () => boolean
}

export default async function healthRoutes(server: FastifyInstance, checks: ReadinessChecks) {
    // Both process and traffic probes work without Postgres or RabbitMQ.
    server.get('/health', async () => ({ status: 'ok' }))
    server.get('/health/traffic', async (_request, reply) => {
        const draining = checks.draining()
        return reply.code(draining ? 503 : 200).send({ status: draining ? 'draining' : 'ok' })
    })

    server.get('/health/ready', async (_request, reply) => {
        const postgres = await checks.postgres()
        const rabbitmq = checks.rabbitmq()
        const relay = rabbitmq && checks.relay()
        const ready = postgres && rabbitmq && relay

        return reply.code(ready ? 200 : 503).send({
            status: ready ? 'ready' : 'not ready',
            postgres: postgres ? 'up' : 'down',
            rabbitmq: rabbitmq ? 'up' : 'down',
            relay: relay ? 'up' : 'down',
        })
    })
}
