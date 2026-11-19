import { sql } from "bun";
import fastify from "fastify";
import auth from "./auth";
import routes from "./http/routes";
import fastifyMultipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import addGlobalErrorHandler from "./utils/errorHandler";
import websocket from "./websocket";
import healthRoutes from "./http/health";
import { postgresReady } from "./repository/readiness";
import { log } from "./utils/logger";
import { createShutdown } from "./utils/shutdown";
import { config } from "./config";
import { TooManyRequests } from "./errors";
import { closeQueue, connectQueue, queueStopping, rabbitmqReady, stopQueueRecovery } from "./queue/connection";
import { reconnectPhones, relayReady, startRelay } from "./websocket/relay";

// request.ip is the client's real address only behind a proxy we trust
// (config.ts); the rate limit counts by it. Fastify 5.12 ignores a plain hop
// count here on purpose — it can't check who the nearest hop is, so it trusts
// nobody — which would make every client look like Traefik and share one
// counter. So the same rule is given as a function, and the check is ours: in
// the compose stack the api has no published port, so its nearest hop is
// always Traefik. Without TRUST_PROXY_HOPS (the laptop), nothing is trusted.
const httpServer = fastify({
    loggerInstance: log,
    disableRequestLogging: true,
    trustProxy: config.trustProxyHops > 0
        ? (_address: string, hop: number) => hop < config.trustProxyHops
        : false,
})

addGlobalErrorHandler(httpServer);

// Rate limits, only on routes that ask for one (routes.ts: /login, /register).
// It runs after the body is parsed, so a route can count per username too. The
// counters live in this copy's memory: behind Traefik's three copies the real
// limit is three times the number set. A blocked request gets our own 429.
await httpServer.register(rateLimit, {
    global: false,
    hook: "preHandler",
    errorResponseBuilder: (_request, context) =>
        new TooManyRequests(`Too many attempts, try again in ${context.after}.`),
});

// attachFieldsToBody puts every part on request.body — the file included, still
// carrying .mimetype — instead of leaving them behind request.file(). Only
// multipart requests are touched: the plugin's preValidation hook returns early
// on anything else, so the JSON routes are unaffected.
await httpServer.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
        // UPPGIFT.md: max 10 MB per snap.
        fileSize: 10_000_000,
        files: 1,
    },
});

await httpServer.register(healthRoutes, { postgres: postgresReady, rabbitmq: rabbitmqReady, relay: relayReady });
await httpServer.register(auth);
await httpServer.register(routes);
await httpServer.register(websocket)

// No expiry job in here any more: the worker deletes each snap when its timer
// runs out (`bun run worker`), and `bun run sweep` is the safety net.

// Stop broker recovery before Fastify drains requests. The onClose hook
// then closes the live broker connection after those requests finish.
const shutdown = createShutdown(async () => {
    stopQueueRecovery();
    await httpServer.close();
    await sql.close();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void shutdown(signal));
}

// RabbitMQ. This returns at once, even while RabbitMQ is down: amqplib keeps
// connecting in the background, and the HTTP API works without it. On every
// (re)connect the relay starts again: this copy's queue for live pushes. Once
// RabbitMQ has accepted that connection, the phones connected here are made to
// reconnect and refetch what they missed (relay.ts).
httpServer.addHook('onClose', closeQueue)
await connectQueue('snap-api', startRelay, reconnectPhones)

const port = Number(process.env.PORT ?? 3000);

// localhost on the laptop, as before. The Docker image sets HOST=0.0.0.0: in a
// container "localhost" is the container itself, so nothing outside it —
// Docker's port mapping, Traefik — could reach the API.
const host = process.env.HOST ?? "localhost";

if (!queueStopping()) await httpServer.listen({ port, host });
