import { AlreadyExists, BadRequest, NotFound, Unauthorized } from './errors'
import type { AddFriendResponse, ApiConversation, ApiFriend, ApiFriendRequest, ApiMessage, ApiSnap, ApiSnapSummary, ApiUser, AuthRequest, SendSnapResponse } from './http/types'
import type { MessageWithUsers } from './repository/types'
import * as repository from './repository'
import { hashPassword, verifyPassword } from './utils/password';
import * as s3 from './utils/s3'
import * as websocket from './websocket/controllers'

// Idempotent
export async function register(authRequest: AuthRequest): Promise<ApiUser> {
    // Om användaren finns
    const exists = await repository.userExists(authRequest.username)

    if (exists) throw new AlreadyExists("User already exists");

    // Hasha lösenord
    const passwordHash = await hashPassword(authRequest.password)

    // Skapa användaren
    const user = await repository.insertUser(authRequest.username, passwordHash)

    // Utfärda tokens

    return {
        username: user.username,
        created_at: user.created_at.toISOString()
    }
    // Hasha lösenordet
}

export async function login(authRequest: AuthRequest): Promise<ApiUser> {
    // Kontrollera användarnamn och lösenord
    const user = await repository.getUserByUsername(authRequest.username)

    if (!user) throw new NotFound("User not found");

    const validPassword = await verifyPassword(authRequest.password, user.password_hash);

    if (!validPassword) throw new Unauthorized("Invalid password!")

    return {
        username: user.username,
        created_at: user.created_at.toISOString()
    }
}

export async function addFriend(
    username: string,
    friendUsername: string
): Promise<AddFriendResponse> {
    // Usernames are unique, so this is an exact self-add check — and it saves
    // the DB throwing check (user_id <> friend_id) as an unhandled 500.
    if (username === friendUsername) {
        throw new BadRequest("You can't add yourself as a friend")
    }

    const { friend_exists, created, mutual } = await repository.addFriend(username, friendUsername)

    if (!friend_exists) throw new NotFound('User not found')

    // Only on a genuinely new edge. A client re-sending the same add is a no-op
    // in the database, and it shouldn't re-notify the other person either.
    if (created) {
        if (mutual) {
            // This add was the second of the two directed edges, so it's an
            // acceptance: both sides just became friends.
            websocket.sendFriendAcceptedNotification(username, friendUsername)
        } else {
            websocket.sendFriendRequestNotification(friendUsername, username)
        }
    }

    return { status: mutual ? 'friends' : 'pending' }
}

// Everyone who has added this user without being added back. Deliberately a
// separate call from getFriends — UPPGIFT.md keeps these out of GET /friends.
export async function getFriendRequests(username: string): Promise<ApiFriendRequest[]> {
    const requests = await repository.getIncomingFriendRequests(username)

    return requests.map((request) => ({
        username: request.username,
        created_at: request.created_at.toISOString(),
    }))
}

// Idempotent — removing someone who isn't a friend is a no-op, not an error.
// Only your own edge goes; if they still have you added, you become a pending
// incoming request to them.
export async function deleteFriend(username: string, friendUsername: string): Promise<void> {
    await repository.deleteFriend(username, friendUsername)
}

export async function getFriends(username: string): Promise<ApiFriend[]> {
    const friends = await repository.getFriends(username)

    return friends.map((friend) => ({
        username: friend.username,
        created_at: friend.created_at.toISOString(),
        mutual: friend.mutual,
    }))
}

type TextContent = {
    text: string
}/*  */

type ImageContent = {
    src: string
}

type Snap = {
    type: 'photo' | 'text',
    content: ImageContent | TextContent
    sender_id: string
    created_at: string
}


const SNAP_TTL_MS = 24 * 60 * 60 * 1000 // 24 timmar

// The arguments to sendSnap, mirroring CreateSnapInput in repository/types.ts.
// The union is the point: "a photo carries an image, a text snap carries a body"
// becomes a compile-time fact instead of a runtime BadRequest.
export type SendSnapInput = {
    senderUsername: string
    recipients: string[]
} & (
        | { type: 'text'; body: string }
        | { type: 'photo'; body?: string | null; image: Buffer; mimetype: string }
    )

// Anropas av HTTP-controllern. Websocketen skickar bara notiser, den skriver inte.
export async function sendSnap(input: SendSnapInput): Promise<SendSnapResponse> {
    const { senderUsername, recipients } = input

    if (recipients.length === 0) throw new BadRequest('A snap needs at least one recipient')

    // Du kan bara snappa dina vänner — annars kan vem som helst snappa vem som helst.
    for (const recipient of new Set(recipients)) {
        const friends = await repository.areFriends(senderUsername, recipient)
        if (!friends) throw new BadRequest(`You are not friends with ${recipient}`)
    }

    // Först spara i databasen
    const expiresAt = new Date(Date.now() + SNAP_TTL_MS)

    const base = {
        senderUsername,
        recipientUsernames: recipients,
        expiresAt,
    }

    // Spara initiala snapen i db (utan filen)
    const createdSnap = input.type === 'text'
        ? await repository.createSnap({ ...base, type: 'text', body: input.body })
        : await repository.createSnap({ ...base, type: 'photo', body: input.body ?? null })

    // Ladda upp filen på S3 och uppdatera snapen i db.
    if (input.type === 'photo') {
        // Random, never the snap id: the key travels inside every presigned URL,
        // and a sequential id there would leak how many snaps exist.
        const key = crypto.randomUUID()

        await s3.uploadFile(key, input.image, input.mimetype)

        await repository.setSnapMedia(createdSnap.id, key, input.mimetype)
    }

    // Notify last, once the snap is durable. A recipient who is offline finds it
    // through GET /snaps instead, so a missed emit costs nothing.
    for (const recipient of new Set(recipients)) {
        websocket.sendSnapNotification(recipient, createdSnap, senderUsername)
    }

    return {
        snap_id: createdSnap.id,
        expires_at: createdSnap.expires_at.toISOString(),
    }
}

// Snap ids are bigserial. A non-numeric id would make Postgres throw on the
// cast — a 500 — instead of simply matching no rows, so it's rejected up front
// as the same 404 every other miss produces.
function assertSnapId(snapId: string): void {
    if (!/^\d+$/.test(snapId)) throw new NotFound('Snap not found')
}

// Read a snap once. The read is destructive: claimSnapForRecipient stamps
// viewed_at in the same statement that authorizes the read, so a second call
// gets nothing and two concurrent calls can't both win.
export async function getSnap(username: string, snapId: string): Promise<ApiSnap> {
    assertSnapId(snapId)

    const snap = await repository.claimSnapForRecipient(snapId, username)

    // One 404 for every reason it could fail — no such snap, not addressed to
    // you, already viewed, expired. Telling them apart would let anyone probe
    // which sequential ids exist.
    if (!snap) throw new NotFound('Snap not found')

    const base = {
        id: snap.id,
        sender_username: snap.sender_username,
        body: snap.body ?? undefined,
        created_at: snap.created_at.toISOString(),
        expires_at: snap.expires_at.toISOString(),
    }

    if (snap.type === 'text') {
        return { ...base, type: 'text' }
    }

    return {
        ...base,
        type: 'photo',
        // Null when the S3 upload never landed. The snap row still exists, so
        // hand back what there is rather than failing the whole read.
        media_url: snap.media_key ? s3.getPresignedUrl(snap.media_key) : undefined,
    }
}

// What's waiting for this user. Metadata only — reading a snap's content is
// getSnap's job, and it burns the snap.
export async function getInbox(username: string): Promise<ApiSnapSummary[]> {
    const snaps = await repository.getInboxForUser(username)

    return snaps.map((snap) => ({
        id: snap.id,
        type: snap.type,
        sender_username: snap.sender_username,
        created_at: snap.created_at.toISOString(),
        expires_at: snap.expires_at.toISOString(),
    }))
}

// The recipient screenshotted a snap; tell whoever sent it.
export async function reportScreenshot(username: string, snapId: string): Promise<void> {
    assertSnapId(snapId)

    const snap = await repository.setScreenshot(snapId, username)

    if (!snap) throw new NotFound('Snap not found')

    websocket.sendScreenshotNotification(snap.sender_username, snapId, username)
}


// Snaps are deleted a batch at a time so one run can't hold a huge list in
// memory or hammer S3 with thousands of parallel deletes.
const EXPIRY_BATCH_SIZE = 100

// Delete every snap past expires_at: its S3 object first, then its row.
//
// That order is the point. The row is the only record of the key, so deleting
// it first would strand the object — the photo would outlive the snap. A snap
// whose S3 delete fails keeps its row, and the next run tries it again.
//
// Safe to run on several instances at once: S3 deletes are idempotent and the
// row delete re-checks expires_at, so a race just deletes nothing twice.
export async function deleteExpiredSnaps(): Promise<number> {
    let total = 0

    while (true) {
        const expired = await repository.getExpiredSnaps(EXPIRY_BATCH_SIZE)
        if (expired.length === 0) break

        const results = await Promise.allSettled(
            expired.map(async (snap) => {
                if (snap.media_key) await s3.deleteFile(snap.media_key)
                return snap.id
            })
        )

        const deletable = results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : []
        )

        for (const result of results) {
            if (result.status === 'rejected') {
                console.error('Could not delete expired snap media', result.reason)
            }
        }

        total += await repository.deleteSnaps(deletable)

        // Every S3 delete in this batch failed. Stop, or the loop would fetch
        // the same batch forever; the next scheduled run retries.
        if (deletable.length === 0) break

        // A short batch means that was the last of them.
        if (expired.length < EXPIRY_BATCH_SIZE) break
    }

    return total
}

const MAX_MESSAGE_LENGTH = 2000
const MESSAGE_PAGE_SIZE = 50

function toApiMessage(message: MessageWithUsers): ApiMessage {
    return {
        id: message.id,
        sender_username: message.sender_username,
        recipient_username: message.recipient_username,
        body: message.body,
        created_at: message.created_at.toISOString(),
    }
}

// Send a chat message. Same rule as snaps: only to someone who has added you
// back. The row is written first and the push goes out after, so a recipient
// who is offline finds it in GET /messages/:username instead.
export async function sendMessage(
    senderUsername: string,
    recipientUsername: string,
    body: string
): Promise<ApiMessage> {
    const text = body.trim()

    if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
        throw new BadRequest(`A message must be between 1 and ${MAX_MESSAGE_LENGTH} characters`)
    }

    if (senderUsername === recipientUsername) {
        throw new BadRequest("You can't message yourself")
    }

    if (!(await repository.userExists(recipientUsername))) throw new NotFound('User not found')

    const friends = await repository.areFriends(senderUsername, recipientUsername)
    if (!friends) throw new BadRequest(`You are not friends with ${recipientUsername}`)

    const row = await repository.insertMessage(senderUsername, recipientUsername, text)

    // Both users were just resolved, so this only happens if one was deleted
    // in between.
    if (!row) throw new NotFound('User not found')

    const message = toApiMessage(row)

    websocket.sendMessageNotification(message)

    return message
}

// One page of history with one person, newest first. Not gated on being
// friends: it's your own conversation, and it shouldn't vanish if they remove
// you. It can only ever contain messages you sent or received.
export async function getMessages(
    username: string,
    otherUsername: string,
    before?: string
): Promise<ApiMessage[]> {
    // Same reasoning as assertSnapId: a non-numeric cursor would be a 500 from
    // the bigint cast rather than a 400.
    if (before !== undefined && !/^\d+$/.test(before)) {
        throw new BadRequest('before must be a message id')
    }

    const rows = await repository.getConversation(username, otherUsername, before ?? null, MESSAGE_PAGE_SIZE)

    return rows.map(toApiMessage)
}

// The newest message with each person you've talked to.
export async function getConversations(username: string): Promise<ApiConversation[]> {
    const rows = await repository.getConversations(username)

    return rows.map((row) => ({
        username: row.partner_username,
        last_message: toApiMessage(row),
    }))
}
