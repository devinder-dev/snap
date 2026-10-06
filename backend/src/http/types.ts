import type { MultipartFile, MultipartValue } from '@fastify/multipart'
import type { SnapType } from './../repository/types';

export type AuthRequest = {
    username: string
    password: string
}

export type ApiUser = {
    username: string
    created_at: string
}

export type Tokens = {
    access_token: string
    refresh_token: string
}

export type RefreshRequest = {
    refresh_token: string
}

export type AddFriendRequest = {
    friend_username: string
}

// POST /snaps is multipart, and @fastify/multipart is registered with
// attachFieldsToBody, so each field arrives as a wrapper rather than a bare
// value: the file exposes toBuffer()/mimetype, other fields expose .value.
//
// Everything is optional here because a client can omit anything; the controller
// is what rejects a request that's missing a part.
export type SendSnapBody = {
    file?: MultipartFile
    // Multipart has no array type, so this arrives one of two ways: a single
    // field holding a JSON array, or the same field repeated once per username
    // (which @fastify/multipart collects into an array of parts). The controller
    // accepts both.
    recipients?: MultipartValue<string> | MultipartValue<string>[]
    // Optional caption.
    text?: MultipartValue<string>
}

// What POST /snaps answers with. UPPGIFT.md fixes the status at 201 but not the
// body, so this is the smallest thing a client needs to follow up on the snap.
export type SendSnapResponse = {
    snap_id: string
    expires_at: string
}

// One snap, read in full. Reading is one-shot — see services.getSnap.
export type ApiSnap = {
    id: string
    type: SnapType
    sender_username: string
    // Text content for a text snap, optional caption for a photo.
    body?: string
    // Presigned GET, photo only, short-lived (300s — see utils/s3.ts).
    media_url?: string
    expires_at: string
    created_at: string
}

// An inbox row. Metadata only: listing what's waiting must not hand back
// content, or GET /snaps would burn every snap it lists.
export type ApiSnapSummary = {
    id: string
    type: SnapType
    sender_username: string
    created_at: string
    expires_at: string
}

export type ApiFriend = {
    username: string
    created_at: string
    mutual: boolean
}

// An incoming friend request. `created_at` is when the request was made, not
// when the account was created — see IncomingFriendRequest in repository/types.
export type ApiFriendRequest = {
    username: string
    created_at: string
}

// 'pending' — you've added them, waiting for them to add you back
// 'friends' — both directions exist
export type AddFriendResponse = {
    status: 'pending' | 'friends'
}

export type FriendParams = {
    username: string
}

export type SnapParams = {
    id: string
}

// One chat message. Usernames at both ends, never ids.
export type ApiMessage = {
    id: string
    sender_username: string
    recipient_username: string
    body: string
    created_at: string
}

// A row in the conversation list: who it's with, and the newest message.
export type ApiConversation = {
    username: string
    last_message: ApiMessage
}

export type SendMessageRequest = {
    body: string
}

export type MessageParams = {
    username: string
}

export type MessagesQuery = {
    // The oldest message id the client already has; the page ends before it.
    before?: string
}
