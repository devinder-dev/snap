import { expect, mock, test } from 'bun:test'
import { createShutdown } from './shutdown'

test('both signals share one cleanup promise', async () => {
    const drain = Promise.withResolvers<void>()
    const cleanup = mock(() => drain.promise)
    const shutdown = createShutdown(cleanup)

    const first = shutdown('SIGTERM')
    expect(shutdown('SIGINT')).toBe(first)
    drain.resolve()
    await first
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith('SIGTERM', false)
})
