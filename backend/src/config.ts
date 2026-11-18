import { hostname } from 'node:os'

// Settings read from the environment, once, at startup. A missing or malformed
// value throws here, so a typo in .env stops the server at boot instead of
// showing up as odd behaviour hours later.
//
// For now this holds what the queue code needs. JWT and S3 still read their own
// variables in auth.ts and utils/s3.ts.

function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name}!`)
    return value
}

// Optional whole number of milliseconds or attempts. Empty counts as unset.
function positiveInt(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) return fallback

    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a whole number above 0, got "${raw}"`)
    }
    return value
}

export const config = {
    rabbitmqUrl: required('RABBITMQ_URL'),

    // Names this process in RabbitMQ: the connection name in the web UI and the
    // appId on every event it publishes. In Kubernetes the hostname is the pod
    // name, which is exactly what you want to see there.
    instanceId: process.env.INSTANCE_ID || hostname(),

    // How long a snap lives. The API stamps expires_at with it and the topology
    // uses it as the timer queue's TTL: one value, so the two can't drift apart.
    snapTtlMs: positiveInt('SNAP_TTL_MS', 24 * 60 * 60 * 1000),

    // Worker retries: wait this long between attempts, give up after this many.
    snapRetryDelayMs: positiveInt('SNAP_RETRY_DELAY_MS', 30_000),
    snapMaxAttempts: positiveInt('SNAP_MAX_ATTEMPTS', 3),
}
