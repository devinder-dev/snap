import { log } from './logger'

const SHUTDOWN_LIMIT_MS = 8_000

export function createShutdown(cleanup: (reason: string, forced: boolean) => Promise<void>) {
    let pending: Promise<void> | undefined

    return (reason: string, forced = false): Promise<void> => {
        pending ??= Promise.resolve().then(async () => {
            log.info({ reason, forced }, '🛑 Shutting down')
            const guard = setTimeout(() => {
                log.error('❌ Shutdown took too long, exiting anyway')
                process.exit(1)
            }, SHUTDOWN_LIMIT_MS)

            try {
                await cleanup(reason, forced)
                log.info('✅ Shutdown cleanup finished')
                if (forced || process.exitCode === 1) process.exit(1)
            } catch (err) {
                log.error({ err }, '❌ Shutdown cleanup failed')
                process.exit(1)
            } finally {
                clearTimeout(guard)
            }
        })
        return pending
    }
}
