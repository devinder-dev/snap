import { STATUS_CODES } from "node:http";
import type { FastifyInstance } from "fastify";
import { BaseError, InternalError } from "../errors";

function addGlobalErrorHandler(httpServer: FastifyInstance) {
    httpServer.setErrorHandler((error, request, reply) => {
        if (error instanceof BaseError) {
            return reply.status(error.statusCode).send(error.toPublicError());
        }

        // Preserve framework client errors without exposing parser or plugin details.
        const status = typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;
        if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500) {
            return reply.status(status).send({
                success: false,
                code: status,
                message: STATUS_CODES[status] ?? "Invalid request",
            });
        }

        const unknownError = new InternalError("Unknown error", error);
        request.log.error({ err: unknownError.full_error }, "❌ Unknown error occurred");
        return reply.status(unknownError.statusCode).send(unknownError.toPublicError());
    });
}

export default addGlobalErrorHandler;
