import multipart from "@fastify/multipart";
import { expect, spyOn, test } from "bun:test";
import fastify from "fastify";
import { InternalError } from "../errors";
import addGlobalErrorHandler from "./errorHandler";

test("keeps parser and upload failures in the public 4xx response format", async () => {
    const app = fastify();
    addGlobalErrorHandler(app);
    await app.register(multipart, {
        attachFieldsToBody: true,
        limits: { fileSize: 10_000_000, files: 1 },
    });
    app.post("/body", async () => ({ success: true }));

    try {
        const noContentType = await app.inject({
            method: "POST", url: "/body", payload: "{}",
        });
        const malformed = await app.inject({
            method: "POST", url: "/body", payload: "{",
            headers: { "content-type": "application/json" },
        });
        const oversized = await app.inject({
            method: "POST", url: "/body",
            headers: { "content-type": "multipart/form-data; boundary=snap-test" },
            payload: '--snap-test\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\n'
                + 'Content-Type: image/png\r\n\r\n' + "x".repeat(11_000_000) + "\r\n--snap-test--\r\n",
        });

        for (const [response, status] of [[noContentType, 415], [malformed, 400], [oversized, 413]] as const) {
            expect(response.statusCode).toBe(status);
            expect(response.json()).toEqual({ success: false, code: status, message: expect.any(String) });
        }
    } finally {
        await app.close();
    }
});

test("logs the original error and keeps the public 500 generic", async () => {
    const app = fastify();
    const cause = new Error("private test cause");
    const log = spyOn(console, "log").mockImplementation(() => {});
    addGlobalErrorHandler(app);
    app.get("/failure", async () => { throw cause; });

    try {
        const response = await app.inject({ method: "GET", url: "/failure" });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ success: false, code: 500, message: "Unknown error" });
        const logged = log.mock.calls.find(([message]) => message === "Unknown error occurred")?.[1];
        expect(logged).toBeInstanceOf(InternalError);
        expect((logged as InternalError).full_error).toBe(cause);
    } finally {
        log.mockRestore();
        await app.close();
    }
});
