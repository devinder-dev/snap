import fastify from 'fastify'
import { hostname } from 'node:os'

// Use Fastify's Pino configuration for HTTP and background jobs. The instance
// used to create the logger never listens; the API shares its logger.
export const log = fastify({
    logger: { base: { instance: process.env.INSTANCE_ID || hostname() } },
}).log
