import type { FastifyInstance } from 'fastify'
import * as services from '../services'

// How often expired snaps are swept. Reads already refuse expired snaps (the
// queries filter on expires_at), so this only bounds how long the data lingers
// after it stopped being readable — minutes is plenty.
const INTERVAL_MS = 5 * 60 * 1000

// Runs once at startup and then on an interval, for as long as the server is up.
//
// Every instance runs its own copy. That's safe (see services.deleteExpiredSnaps)
// but wasteful once there are many instances; that is the point to move this to
// a single scheduled worker.
async function snapExpiry(httpServer: FastifyInstance) {
    // Overlapping runs would fetch the same batch twice. Harmless, but pointless.
    let running = false

    const run = async () => {
        if (running) return
        running = true

        try {
            const deleted = await services.deleteExpiredSnaps()
            if (deleted > 0) console.log(`Deleted ${deleted} expired snap(s)`)
        } catch (error) {
            // A failed sweep must never take the server down; the next one retries.
            console.error('Snap expiry sweep failed', error)
        } finally {
            running = false
        }
    }

    const timer = setInterval(run, INTERVAL_MS)

    httpServer.addHook('onReady', async () => {
        void run()
    })

    httpServer.addHook('onClose', async () => {
        clearInterval(timer)
    })
}

export default snapExpiry
