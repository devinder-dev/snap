import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthRequest } from './types'
import { BaseError } from '../errors'

export const REGISTRATION_CODE_HEADER = 'x-snap-registration-code'

class RegistrationClosed extends BaseError {
    statusCode = 403
}

function digest(code: string): Buffer {
    return createHash('sha256').update(code).digest()
}

function registrationGuard(code: string | undefined) {
    const expected = code ? digest(code) : undefined

    return async (request: FastifyRequest): Promise<void> => {
        if (!expected) return
        const supplied = request.headers[REGISTRATION_CODE_HEADER]
        // Compare fixed-size digests so different input lengths take the same comparison path.
        if (typeof supplied !== 'string' || !timingSafeEqual(expected, digest(supplied))) {
            throw new RegistrationClosed('Registration is closed on the demo server. A registration code is required.')
        }
    }
}

export function registerRegistrationRoute(
    server: FastifyInstance,
    code: string | undefined,
    register: (request: FastifyRequest<{ Body: AuthRequest }>, reply: FastifyReply) => Promise<unknown>,
): void {
    const requireCode = registrationGuard(code)
    server.post<{ Body: AuthRequest }>('/register', {
        // Twenty per minute leaves room for a few typos and the e2e's seven requests.
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        // Fastify's rate-limit preHandler also counts rejected code guesses.
        await requireCode(request)
        return register(request, reply)
    })
}
