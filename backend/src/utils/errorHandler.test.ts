import multipart from "@fastify/multipart";
import { expect, test } from "bun:test";
import fastify from "fastify";
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
    const lines: string[] = [];
    const app = fastify({
        logger: { stream: { write: (line: string) => lines.push(line) } },
    });
    const cause = new Error("private test cause");
    addGlobalErrorHandler(app);
    app.get("/failure", async () => { throw cause; });

    try {
        const response = await app.inject({ method: "GET", url: "/failure" });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ success: false, code: 500, message: "Unknown error" });
        const logged = lines.map((line) => JSON.parse(line)).find((entry) => entry.msg === "❌ Unknown error occurred");
        expect(logged?.err?.message).toBe(cause.message);
        expect(logged?.err?.stack).toBe(cause.stack);
    } finally {
        await app.close();
    }
});
