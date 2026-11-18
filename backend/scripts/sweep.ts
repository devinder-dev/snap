// `bun run sweep`: the safety net, once, then exit.
//
// Deletes every snap past expires_at, whatever happened to its timer: sent
// while RabbitMQ was down, dropped when snap.expiry.wait was deleted, or
// dead-lettered because S3 was failing. The S3 object goes first, then the row.
//
// On the laptop you run it by hand; on the server cron runs it hourly (Step 11).
// It used to run every 5 minutes inside the API — with three API copies that
// would be three sweeps doing the same work. One run at a time is enough.

import { sql } from 'bun'
import * as services from '../src/services'

try {
    // Step 1: Sweep.
    const { deleted, failed } = await services.deleteExpiredSnaps()

    // Step 2: Any failure exits non-zero, so cron (and you) can see it. The
    // rows that failed keep their keys, and the next run tries them again.
    if (failed > 0) {
        console.error(`❌ Sweep: ${deleted} expired snap(s) deleted, ${failed} could not be — `
            + 'their photos are still in S3; the rows stay for the next run')
        process.exitCode = 1
    } else {
        console.log(`✅ Sweep done: ${deleted} expired snap(s) deleted`)
    }
} catch (error) {
    console.error('❌ Sweep failed', error)
    process.exitCode = 1
} finally {
    // Step 3: Close the database pool, or the process would stay alive.
    await sql.close()
}
