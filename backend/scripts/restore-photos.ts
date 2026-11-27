import { SQL } from 'bun'
import { getPresignedUrl } from '../src/utils/s3'

const database = new URL(process.env.DATABASE_URL!)
database.pathname = process.env.RESTORE_TEST_DB!
const sql = new SQL(database.toString())
try {
    const photos = await sql<{ media_key: string }[]>`
        SELECT media_key FROM snaps WHERE media_key IS NOT NULL AND expires_at > now()
    `
    if (!photos.length) {
        console.log('Restore OK; photo links not checked: no living photo snap in this backup')
        process.exitCode = 2
    }
    let passed = 0
    for (const { media_key } of photos) {
        const response = await fetch(getPresignedUrl(media_key, 60), {
            signal: AbortSignal.timeout(15_000),
            redirect: 'error',
        }).catch(() => null)
        await response?.body?.cancel()
        if (response?.status !== 200) {
            throw new Error(`A restored photo GET returned ${response?.status ?? 'a network error'}`)
        }
        passed++
    }
    if (photos.length) console.log(`Restored photo GETs: ${passed}/${photos.length} HTTP 200`)
} catch (error) {
    // Network errors can contain signed URLs. Only emit errors created above.
    const message = error instanceof Error ? error.message : ''
    console.error(/^A restored photo GET returned (\d{3}|a network error)$/.test(message)
        ? message : 'Could not check photos in the restored database')
    process.exitCode = 1
} finally {
    await sql.close()
}
