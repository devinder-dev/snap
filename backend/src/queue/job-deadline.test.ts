import { expect, mock, test } from 'bun:test'
import { runJobWithDeadline } from './job-deadline'

test('a timed-out job leaves the original unsettled even when work finishes later', async () => {
    const acknowledge = mock(() => {})
    const recycle = mock(() => {})
    const operation = Promise.withResolvers<void>()
    const finished = Promise.withResolvers<void>()

    await runJobWithDeadline(async (signal) => {
        await operation.promise
        if (!signal.aborted) acknowledge()
        finished.resolve()
    }, recycle, 5)

    expect(recycle).toHaveBeenCalledTimes(1)
    expect(acknowledge).not.toHaveBeenCalled()
    operation.resolve()
    await finished.promise
    expect(acknowledge).not.toHaveBeenCalled()
})

test('work that completes before the deadline does not recycle the worker', async () => {
    const recycle = mock(() => {})
    await runJobWithDeadline(async (signal) => {
        expect(signal.aborted).toBe(false)
    }, recycle, 100)
    expect(recycle).not.toHaveBeenCalled()
})
