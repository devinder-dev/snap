import { sql } from "bun";
import fastify from "fastify";
import auth from "./auth";
import routes from "./http/routes";
import fastifyMultipart from "@fastify/multipart";
import addGlobalErrorHandler from "./utils/errorHandler";
import websocket from "./websocket";
import { closeQueue, connectQueue } from "./queue/connection";
import { startRelay } from "./websocket/relay";

const httpServer = fastify()

addGlobalErrorHandler(httpServer);

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

await httpServer.register(auth);
await httpServer.register(routes);
await httpServer.register(websocket)

// No expiry job in here any more: the worker deletes each snap when its timer
// runs out (`bun run worker`), and `bun run sweep` is the safety net.

// RabbitMQ. This returns at once, even while RabbitMQ is down: amqplib keeps
// connecting in the background, and the HTTP API works without it. On every
// (re)connect the relay starts again: this copy's queue for live pushes.
await connectQueue('snap-api', startRelay)
httpServer.addHook('onClose', closeQueue)

const port = Number(process.env.PORT ?? 3000);

// localhost on the laptop, as before. The Docker image sets HOST=0.0.0.0: in a
// container "localhost" is the container itself, so nothing outside it —
// Docker's port mapping, Traefik — could reach the API.
const host = process.env.HOST ?? "localhost";

await httpServer.listen({ port, host });

console.log(`Listening on http://${host}:${port}`);

// Graceful shutdown (SCALING-PLAN.md section 9, rule 7). `docker stop` and every
// deploy send SIGTERM, then kill the process 10 s later; Ctrl-C sends SIGINT.
// Bun ignores SIGTERM unless something listens for it, so without this every
// stop would end in that kill.
//
// close() stops taking new connections, runs preClose (disconnects the sockets,
// so the phones reconnect to another copy), waits for open requests to finish,
// then runs onClose (closes RabbitMQ, and this copy's realtime queue with it).
const SHUTDOWN_LIMIT_MS = 8_000;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
        console.log(`🛑 ${signal}: shutting down`);

        // Something hanging must not turn this into Docker's kill at 10 s.
        setTimeout(() => {
            console.error("❌ Shutdown took too long, exiting anyway");
            process.exit(1);
        }, SHUTDOWN_LIMIT_MS).unref();

        await httpServer.close();
        await sql.close();

        console.log("✅ Shut down cleanly");
        process.exit(0);
    });
}
