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
    const deleted = await services.deleteExpiredSnaps()
    console.log(`✅ Sweep done: ${deleted} expired snap(s) deleted`)
} catch (error) {
    // Step 2: A failed sweep exits non-zero, so cron (and you) can see it.
    console.error('❌ Sweep failed', error)
    process.exitCode = 1
} finally {
    // Step 3: Close the database pool, or the process would stay alive.
    await sql.close()
}
