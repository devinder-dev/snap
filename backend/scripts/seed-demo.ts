import { sql } from 'bun'
import { hashPassword, verifyPassword } from '../src/utils/password'

const usernames = ['demo_anna', 'demo_ben', 'demo_cara'] as const
const conflictMessage = 'A demo username already has a different password. No changes saved.'

async function main(): Promise<void> {
    const password = process.env.SNAP_DEMO_PASSWORD
    if (!password || password.trim().length < 12 || Buffer.byteLength(password) > 72) {
        console.error('Set SNAP_DEMO_PASSWORD to at least 12 characters and at most 72 bytes.')
        process.exitCode = 1
        return
    }

    try {
        const [annaHash, benHash, caraHash] = await Promise.all(usernames.map(() => hashPassword(password)))

        await sql.begin(async (tx) => {
            // An existing account can only be reused if the supplied password
            // already works. Never reset an account to claim a demo username.
            await tx`
                INSERT INTO users (username, password_hash)
                VALUES (${usernames[0]}, ${annaHash}), (${usernames[1]}, ${benHash}), (${usernames[2]}, ${caraHash})
                ON CONFLICT (username) DO NOTHING
            `
            const [anna, ben, cara] = await tx<{ id: string; username: string; password_hash: string }[]>`
                SELECT id, username, password_hash
                FROM users
                WHERE username IN (${usernames[0]}, ${usernames[1]}, ${usernames[2]})
                ORDER BY username
                FOR UPDATE
            `
            if (!anna || !ben || !cara) throw new Error('Demo accounts disappeared during setup.')
            const matches = await Promise.all([
                verifyPassword(password, anna.password_hash),
                verifyPassword(password, ben.password_hash),
                verifyPassword(password, cara.password_hash),
            ])
            if (matches.includes(false)) {
                throw new Error(conflictMessage)
            }

            // Snap considers friends mutual only when both directions exist.
            await tx`
                INSERT INTO friendships (user_id, friend_id)
                VALUES (${anna.id}, ${ben.id}), (${ben.id}, ${anna.id})
                ON CONFLICT (user_id, friend_id) DO NOTHING
            `
        })

        console.log('✅ Demo users ready: demo_anna and demo_ben are mutual friends; demo_cara starts without friends')
    } catch (err) {
        // SQL errors can include query details. Keep credentials out of output.
        const message = err instanceof Error && err.message === conflictMessage
            ? conflictMessage
            : 'Could not seed demo users. Check the database connection and migrations.'
        console.error(`❌ ${message}`)
        process.exitCode = 1
    } finally {
        await sql.close()
    }
}

await main()
