// A timed-out operation may still be running in Bun's SQL or S3 client.
// Abort prevents late settlement; the worker recycles to discard stuck I/O.
export async function runJobWithDeadline(
    work: (signal: AbortSignal) => Promise<void>,
    expired: () => void,
    timeoutMs: number,
): Promise<void> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
            controller.abort()
            expired()
            resolve()
        }, timeoutMs)
    })

    try {
        await Promise.race([work(controller.signal), deadline])
    } finally {
        clearTimeout(timer)
    }
}
