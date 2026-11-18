import { sql } from 'bun'

const PROBE_TIMEOUT_MS = 1_000
let pending: Promise<boolean> | null = null

export function postgresReady(): Promise<boolean> {
    // Share a probe while it is in flight so a slow database cannot accumulate
    // one query for every readiness request.
    if (pending) return pending

    const query = sql`SELECT 1`
    pending = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false)
            query.cancel()
        }, PROBE_TIMEOUT_MS).unref()

        void query.then(() => resolve(true), () => resolve(false)).finally(() => {
            clearTimeout(timeout)
            pending = null
        })
    })
    return pending
}
