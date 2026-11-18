import type { FastifyInstance } from 'fastify'

type ReadinessChecks = {
    postgres: () => Promise<boolean>
    rabbitmq: () => boolean
    relay: () => boolean
}

export default async function healthRoutes(server: FastifyInstance, checks: ReadinessChecks) {
    // Docker's liveness probe must stay independent of shared services.
    server.get('/health', async () => ({ status: 'ok' }))

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
