import { sql } from 'bun'
import type { AddFriendResult, ConversationEntry, CreateSnapInput, ExpiredSnap, FriendListEntry, InboxEntry, IncomingFriendRequest, MessageWithUsers, PublicUser, SnapRow, SnapWithSender, UserRow } from './types'

// Check if user exists
export async function userExists(username: string): Promise<boolean> {
    const rows = await sql`
        SELECT 1 FROM users WHERE username = ${username}
    `
    return rows.length > 0
}

// Insert user
export async function insertUser(username: string, passwordHash: string): Promise<UserRow> {
    const [user] = await sql`
        INSERT INTO users (username, password_hash)
        VALUES (${username}, ${passwordHash})
        RETURNING *
    `
    return user as UserRow
}

// Fetch user by id
export async function getUserById(id: string): Promise<UserRow | null> {
    const [user] = await sql`
        SELECT * FROM users WHERE id = ${id}
    `
    return (user as UserRow | undefined) ?? null
}

// Fetch user by username
export async function getUserByUsername(username: string): Promise<UserRow | null> {
    const [user] = await sql`
        SELECT * FROM users WHERE username = ${username}
    `
    return (user as UserRow | undefined) ?? null
}

// Add a friend, by username at both ends — the JWT carries a username, not an id.
//
// `me` and `them` resolve the usernames to ids and hold 0 or 1 rows each. The
// insert is INSERT..SELECT over their cross join, so an unknown username makes
// it a no-op instead of a foreign-key error — that's what friend_exists reports.
// `ins` then holds 0 or 1 rows (0 when ON CONFLICT swallowed a repeat add) and
// EXISTS turns that into `created`. The outer SELECT has no FROM, so the
// statement always returns exactly one row.
export async function addFriend(username: string, friendUsername: string): Promise<AddFriendResult> {
    const [row] = await sql`
        WITH me AS (
            SELECT id FROM users WHERE username = ${username}
        ),
        them AS (
            SELECT id FROM users WHERE username = ${friendUsername}
        ),
        ins AS (
            INSERT INTO friendships (user_id, friend_id)
            SELECT me.id, them.id FROM me, them
            ON CONFLICT DO NOTHING
            RETURNING 1
        )
        SELECT
            EXISTS (SELECT 1 FROM them) AS friend_exists,
            EXISTS (SELECT 1 FROM ins)  AS created,
            EXISTS (
                SELECT 1 FROM friendships f, me, them
                WHERE f.user_id = them.id AND f.friend_id = me.id
            ) AS mutual
    `
    return row as AddFriendResult
}

// Are these two actually friends? Requires the edge in both directions.
// An unknown username leaves its CTE empty, so both EXISTS are false.
export async function areFriends(username: string, otherUsername: string): Promise<boolean> {
    const [row] = await sql`
        WITH me AS (
            SELECT id FROM users WHERE username = ${username}
        ),
        them AS (
            SELECT id FROM users WHERE username = ${otherUsername}
        )
        SELECT (
            EXISTS (
                SELECT 1 FROM friendships f, me, them
                WHERE f.user_id = me.id AND f.friend_id = them.id
            )
            AND EXISTS (
                SELECT 1 FROM friendships f, me, them
                WHERE f.user_id = them.id AND f.friend_id = me.id
            )
        ) AS friends
    `
    return (row as { friends: boolean }).friends
}

// Remove a friend for a user. Idempotent — an unknown username or an edge
// that isn't there deletes zero rows without erroring.
export async function deleteFriend(username: string, friendUsername: string): Promise<void> {
    await sql`
        DELETE FROM friendships
        WHERE user_id   = (SELECT id FROM users WHERE username = ${username})
          AND friend_id = (SELECT id FROM users WHERE username = ${friendUsername})
    `
}

// Everyone this user has added, each flagged with whether it's mutual.
// The reverse edge is a LEFT JOIN rather than an inner one, so rows survive
// when the other person hasn't added back — that's the pending case.
// Confirmed friends sort first.
export async function getFriends(username: string): Promise<FriendListEntry[]> {
    const rows = await sql`
        WITH me AS (
            SELECT id FROM users WHERE username = ${username}
        )
        SELECT
            u.username,
            u.created_at,
            (r.user_id IS NOT NULL) AS mutual
        FROM friendships f
        JOIN me ON me.id = f.user_id
        JOIN users u ON u.id = f.friend_id
        LEFT JOIN friendships r
               ON r.user_id = f.friend_id AND r.friend_id = f.user_id
        ORDER BY mutual DESC, u.username
    `
    return rows as FriendListEntry[]
}

// Create a snap and fan it out to its recipients in one transaction.
//
// Phase 1 of 2. A photo snap is written without media_key/media_mime — the
// object is uploaded afterwards and attached with setSnapMedia. Writing the row
// first means a failed upload leaves a snap without media (findable, cleanable)
// rather than an S3 object nothing references. A photo may carry an optional
// caption in body.
//
// Either the snap and every recipient row land together, or nothing does, so a
// snap can't exist with nobody able to see it.
//
// Recipients are inserted one at a time so a bad username names itself in the
// error. Lists are short; if they ever aren't, this becomes one INSERT..SELECT
// over `= ANY(sql.array(recipients))`.
export async function createSnap(input: CreateSnapInput): Promise<SnapRow> {
    const { senderUsername, type, expiresAt } = input

    // The (snap_id, recipient_id) primary key would reject a repeated username.
    const recipients = [...new Set(input.recipientUsernames)]

    if (recipients.length === 0) {
        throw new Error('A snap needs at least one recipient')
    }

    // Required for text, an optional caption for photo.
    const body = input.body ?? null

    return await sql.begin(async (tx) => {
        const [row] = await tx`
            INSERT INTO snaps (sender_id, type, body, expires_at)
            SELECT id, ${type}, ${body}, ${expiresAt}
            FROM users WHERE username = ${senderUsername}
            RETURNING *
        `

        // INSERT..SELECT inserts nothing rather than erroring on an unknown
        // username, so an empty RETURNING is how that surfaces.
        if (!row) throw new Error(`Unknown sender: ${senderUsername}`)

        for (const username of recipients) {
            const [recipient] = await tx`
                INSERT INTO snap_recipients (snap_id, recipient_id)
                SELECT ${row.id}, id FROM users WHERE username = ${username}
                RETURNING recipient_id
            `
            if (!recipient) throw new Error(`Unknown recipient: ${username}`)
        }

        return row as SnapRow
    }) as SnapRow
}

// Phase 2 of 2. Attach uploaded media to a photo snap that doesn't have any yet.
//
// The WHERE clause is the guard: it matches only a photo snap whose media_key is
// still null, so a retried or duplicated upload can't overwrite media already
// attached. Returns null when nothing matched — snap missing, wrong type, or
// media already set.
//
// The key should be random (crypto.randomUUID()), not the snap id: it travels
// inside every presigned URL, and a sequential id there would leak the snap count.
export async function setSnapMedia(
    snapId: string,
    mediaKey: string,
    mediaMime: string
): Promise<SnapRow | null> {
    const [row] = await sql`
        UPDATE snaps
        SET media_key = ${mediaKey}, media_mime = ${mediaMime}
        WHERE id = ${snapId}
          AND type = 'photo'
          AND media_key IS NULL
        RETURNING *
    `
    return (row as SnapRow | undefined) ?? null
}


// Read a snap once, and burn it in the same breath.
//
// Authorization and the one-shot stamp are a single statement on purpose. Split
// across a SELECT then an UPDATE, two concurrent requests both pass the check
// and both get the content. Here the second one blocks on the row lock, then
// re-evaluates `viewed_at IS NULL` against the row the first one just wrote and
// matches nothing — so exactly one caller ever sees a given snap.
//
// Zero rows (and so null) covers every failure the caller must not be able to
// tell apart: no such snap, not a recipient of it, already viewed, or expired.
// The service turns all of them into the same 404.
//
// `id` must already be known to be digits — a non-numeric value would make
// Postgres throw on the bigint cast instead of returning empty.
export async function claimSnapForRecipient(
    snapId: string,
    username: string
): Promise<SnapWithSender | null> {
    const [row] = await sql`
        UPDATE snap_recipients sr
        SET viewed_at = now()
        FROM snaps s, users sender, users me
        WHERE sr.snap_id      = s.id
          AND sender.id       = s.sender_id
          AND me.username     = ${username}
          AND sr.recipient_id = me.id
          AND sr.snap_id      = ${snapId}
          AND sr.viewed_at IS NULL
          AND s.expires_at > now()
        RETURNING s.*, sender.username AS sender_username
    `
    return (row as SnapWithSender | undefined) ?? null
}

// Everything waiting for this user: not yet viewed, not yet expired.
//
// Metadata only — no body, no media_key. Listing the inbox must never be able to
// burn a snap, and the content is claimSnapForRecipient's job.
export async function getInboxForUser(username: string): Promise<InboxEntry[]> {
    const rows = await sql`
        WITH me AS (
            SELECT id FROM users WHERE username = ${username}
        )
        SELECT
            s.id,
            sender.username AS sender_username,
            s.type,
            s.created_at,
            s.expires_at
        FROM snap_recipients sr
        JOIN me ON me.id = sr.recipient_id
        JOIN snaps s ON s.id = sr.snap_id
        JOIN users sender ON sender.id = s.sender_id
        WHERE sr.viewed_at IS NULL
          AND s.expires_at > now()
        ORDER BY s.created_at DESC
    `
    return rows as InboxEntry[]
}

// Flag that a recipient screenshotted a snap, and report who sent it so the
// sender can be told. Returns null when the caller isn't a recipient of it,
// which is also what an unknown snap id looks like.
//
// Deliberately not gated on viewed_at: the screenshot arrives right after the
// view, and refusing it on a burnt snap would drop every real one.
export async function setScreenshot(
    snapId: string,
    username: string
): Promise<{ sender_username: string } | null> {
    const [row] = await sql`
        UPDATE snap_recipients sr
        SET screenshot = TRUE
        FROM snaps s, users sender, users me
        WHERE sr.snap_id      = s.id
          AND sender.id       = s.sender_id
          AND me.username     = ${username}
          AND sr.recipient_id = me.id
          AND sr.snap_id      = ${snapId}
        RETURNING sender.username AS sender_username
    `
    return (row as { sender_username: string } | undefined) ?? null
}

// People who added this user and haven't been added back — the pending incoming
// requests. UPPGIFT.md keeps these out of getFriends on purpose, so this is the
// mirror image of it: join on f.friend_id instead of f.user_id, and the same
// LEFT JOIN against the reverse edge, kept only where that edge is missing.
//
// Supported by `create index on friendships (friend_id)` in the initial migration.
export async function getIncomingFriendRequests(username: string): Promise<IncomingFriendRequest[]> {
    const rows = await sql`
        WITH me AS (
            SELECT id FROM users WHERE username = ${username}
        )
        SELECT
            u.username,
            f.created_at
        FROM friendships f
        JOIN me ON me.id = f.friend_id
        JOIN users u ON u.id = f.user_id
        LEFT JOIN friendships r
               ON r.user_id = f.friend_id AND r.friend_id = f.user_id
        WHERE r.user_id IS NULL
        ORDER BY f.created_at DESC
    `
    return rows as IncomingFriendRequest[]
}

// Snaps past expires_at, oldest first, a batch at a time. The expiry job
// deletes the S3 object before the row, so it needs the key while the row
// still exists — hence a SELECT here rather than DELETE..RETURNING.
export async function getExpiredSnaps(limit: number): Promise<ExpiredSnap[]> {
    const rows = await sql`
        SELECT id, media_key
        FROM snaps
        WHERE expires_at <= now()
        ORDER BY expires_at
        LIMIT ${limit}
    `
    return rows as ExpiredSnap[]
}

// Delete snaps by id. snap_recipients rows go with them (ON DELETE CASCADE).
// Re-checks expires_at so a batch that raced something can only ever delete
// what is actually expired. Returns how many rows went.
export async function deleteSnaps(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0

    const rows = await sql`
        DELETE FROM snaps
        WHERE id = ANY(${sql.array(ids, "BIGINT")})
          AND expires_at <= now()
        RETURNING id
    `
    return rows.length
}

// Store a message. INSERT..SELECT resolves both usernames in the same statement,
// so an unknown one inserts nothing and comes back null instead of a
// foreign-key error. The service has already checked the two are friends.
export async function insertMessage(
    senderUsername: string,
    recipientUsername: string,
    body: string
): Promise<MessageWithUsers | null> {
    const [row] = await sql`
        WITH sender AS (
            SELECT id, username FROM users WHERE username = ${senderUsername}
        ),
        recipient AS (
            SELECT id, username FROM users WHERE username = ${recipientUsername}
        ),
        ins AS (
            INSERT INTO messages (sender_id, recipient_id, body)
            SELECT sender.id, recipient.id, ${body} FROM sender, recipient
            RETURNING id, body, created_at
        )
        SELECT
            ins.id,
            sender.username    AS sender_username,
            recipient.username AS recipient_username,
            ins.body,
            ins.created_at
        FROM ins, sender, recipient
    `
    return (row as MessageWithUsers | undefined) ?? null
}

// One page of a conversation, newest first. `before` is the oldest id the
// client already has (exclusive); null means start from the newest.
//
// Written as two limited halves glued with UNION ALL rather than one
// `WHERE (a->b) OR (b->a)`: each half is then a straight walk down one of the
// two (sender_id, recipient_id, id desc) indexes, stopping after `limit` rows.
export async function getConversation(
    username: string,
    otherUsername: string,
    before: string | null,
    limit: number
): Promise<MessageWithUsers[]> {
    const rows = await sql`
        WITH me AS (
            SELECT id, username FROM users WHERE username = ${username}
        ),
        them AS (
            SELECT id, username FROM users WHERE username = ${otherUsername}
        ),
        page AS (
            (
                SELECT m.id, m.sender_id, m.body, m.created_at
                FROM messages m, me, them
                WHERE m.sender_id = me.id AND m.recipient_id = them.id
                  AND (${before}::bigint IS NULL OR m.id < ${before}::bigint)
                ORDER BY m.id DESC
                LIMIT ${limit}
            )
            UNION ALL
            (
                SELECT m.id, m.sender_id, m.body, m.created_at
                FROM messages m, me, them
                WHERE m.sender_id = them.id AND m.recipient_id = me.id
                  AND (${before}::bigint IS NULL OR m.id < ${before}::bigint)
                ORDER BY m.id DESC
                LIMIT ${limit}
            )
        )
        SELECT
            page.id,
            CASE WHEN page.sender_id = me.id THEN me.username ELSE them.username END AS sender_username,
            CASE WHEN page.sender_id = me.id THEN them.username ELSE me.username END AS recipient_username,
            page.body,
            page.created_at
        FROM page, me, them
        ORDER BY page.id DESC
        LIMIT ${limit}
    `
    return rows as MessageWithUsers[]
}

// The newest message in every conversation this user has, newest conversation
// first. DISTINCT ON keeps the first row per partner under ORDER BY
// partner, id DESC — i.e. the latest message with each person.
export async function getConversations(username: string): Promise<ConversationEntry[]> {
    const rows = await sql`
        WITH me AS (
            SELECT id FROM users WHERE username = ${username}
        ),
        latest AS (
            SELECT DISTINCT ON (partner_id)
                m.id,
                m.sender_id,
                m.recipient_id,
                m.body,
                m.created_at,
                CASE WHEN m.sender_id = me.id THEN m.recipient_id ELSE m.sender_id END AS partner_id
            FROM messages m, me
            WHERE m.sender_id = me.id OR m.recipient_id = me.id
            ORDER BY partner_id, m.id DESC
        )
        SELECT
            latest.id,
            partner.username   AS partner_username,
            sender.username    AS sender_username,
            recipient.username AS recipient_username,
            latest.body,
            latest.created_at
        FROM latest
        JOIN users partner   ON partner.id   = latest.partner_id
        JOIN users sender    ON sender.id    = latest.sender_id
        JOIN users recipient ON recipient.id = latest.recipient_id
        ORDER BY latest.id DESC
    `
    return rows as ConversationEntry[]
}
