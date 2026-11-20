import { expect, test } from 'bun:test'
import fastify from 'fastify'
import addGlobalErrorHandler from '../utils/errorHandler'
import rateLimit from '@fastify/rate-limit'
import { registerRegistrationRoute, REGISTRATION_CODE_HEADER } from './registration-guard'

test.each([
    { name: 'missing code', configured: 'zzt-demo-code', supplied: undefined, status: 403 },
    { name: 'wrong code', configured: 'zzt-demo-code', supplied: 'zzt-wrong', status: 403 },
    { name: 'right code', configured: 'zzt-demo-code', supplied: 'zzt-demo-code', status: 201 },
    { name: 'unset gate', configured: undefined, supplied: undefined, status: 201 },
])('registration: $name', async ({ configured, supplied, status }) => {
    const server = fastify()
    addGlobalErrorHandler(server)
    registerRegistrationRoute(server, configured, async (_request, reply) =>
        reply.code(201).send({ created: true }))

    try {
        const response = await server.inject({
            method: 'POST',
            url: '/register',
            headers: supplied === undefined ? {} : { [REGISTRATION_CODE_HEADER]: supplied },
        })
        expect(response.statusCode).toBe(status)
        if (status === 403) {
            expect(response.json()).toEqual({
                success: false,
                code: 403,
                message: 'Registration is closed on the demo server. A registration code is required.',
            })
        } else {
            expect(response.json()).toEqual({ created: true })
        }
    } finally {
        await server.close()
    }
})


test('wrong registration codes still count toward the route rate limit', async () => {
    const server = fastify()
    addGlobalErrorHandler(server)
    await server.register(rateLimit, { global: false, hook: 'preHandler' })
    registerRegistrationRoute(server, 'zzt-demo-code', async (_request, reply) =>
        reply.code(201).send({ created: true }))
    try {
        for (let i = 0; i < 20; i++) {
            const response = await server.inject({ method: 'POST', url: '/register' })
            expect(response.statusCode).toBe(403)
        }
        expect((await server.inject({ method: 'POST', url: '/register' })).statusCode).toBe(429)
    } finally {
        await server.close()
    }
})
