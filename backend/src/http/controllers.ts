import type { FastifyReply, FastifyRequest } from "fastify";
import type { AddFriendRequest, AuthRequest, FriendParams, MessageParams, MessagesQuery, RefreshRequest, SendMessageRequest, SendSnapBody, SnapParams, Tokens } from './types'
import * as services from '../services'
import type { TokenPayload } from "../auth";
import { BadRequest, NotFound, Unauthorized } from "../errors";

const generateFreshTokens = async (
    username: string,
    reply: FastifyReply,
): Promise<Tokens> => {
    const payload: TokenPayload = {
        username: username,
        type: "refresh", // Will be set below
    };

    const newAccessToken = await reply.jwtSign(
        { ...payload, type: "access" },
        { expiresIn: "15m" },
    );
    const newRefreshToken = await reply.jwtSign(
        { ...payload, type: "refresh" },
        { expiresIn: "10y" },
    );

    return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
    };
};

// Fastify hands over whatever JSON arrived, so a missing or non-string field
// would otherwise reach SQL or bcrypt as undefined and surface as a 500.
function requireString(value: unknown, message: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new BadRequest(message)
    return value
}

// bcrypt only reads the first 72 bytes of a password, so anything longer would
// be silently truncated — refuse it instead of pretending to use all of it.
const MAX_PASSWORD_BYTES = 72
const MAX_USERNAME_LENGTH = 32

function parseCredentials(body: Partial<AuthRequest> | undefined): AuthRequest {
    const message = 'Username and password are required'
    const username = requireString(body?.username, message).trim()
    const password = requireString(body?.password, message)

    if (username.length > MAX_USERNAME_LENGTH) {
        throw new BadRequest(`Username can be at most ${MAX_USERNAME_LENGTH} characters`)
    }
    if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
        throw new BadRequest(`Password can be at most ${MAX_PASSWORD_BYTES} bytes`)
    }

    return { username, password }
}

// Answers as long as the process can serve a request, and checks nothing else.
// A probe that queried the database every few seconds would keep a hosted
// database awake around the clock — and a database outage isn't something a
// restart of this process could fix anyway.
export async function health(_req: FastifyRequest, res: FastifyReply) {
    res.status(200).send({ status: 'ok' })
}

export async function register(req: FastifyRequest<{ Body: AuthRequest }>, res: FastifyReply) {
    const createdUser = await services.register(parseCredentials(req.body))

    const tokens = await generateFreshTokens(createdUser.username, res)

    const response = {
        tokens,
        user: createdUser
    }

    res.status(201).send(response)
}

export async function login(req: FastifyRequest<{ Body: AuthRequest }>, res: FastifyReply) {
    const user = await services.login(parseCredentials(req.body))

    const tokens = await generateFreshTokens(user.username, res)

    const response = {
        tokens,
        user
    }

    res.status(200).send(response)
}

// Trade a refresh token for a fresh pair. The token comes in the body, not the
// Authorization header, so this verifies it directly rather than via
// request.jwtVerify() — that one reads the header and would check the access
// token instead.
export async function refresh(req: FastifyRequest<{ Body: RefreshRequest }>, res: FastifyReply) {
    const refreshToken = req.body?.refresh_token

    if (!refreshToken) throw new Unauthorized("You are not authorized")

    let payload: TokenPayload

    try {
        payload = req.server.jwt.verify<TokenPayload>(refreshToken)
    } catch {
        // Expired, tampered with, or signed by something else.
        throw new Unauthorized("You are not authorized")
    }

    // An access token is signed with the same secret, so without this check it
    // would work here as a refresh token and never actually expire.
    if (payload.type !== "refresh") throw new Unauthorized("You are not authorized")

    const tokens = await generateFreshTokens(payload.username, res)

    res.status(200).send({ tokens })
}

export async function addFriend(req: FastifyRequest<{ Body: AddFriendRequest }>, res: FastifyReply) {
    const username = req.user.username

    const friendUsername = requireString(req.body?.friend_username, 'friend_username is required').trim()

    const response = await services.addFriend(username, friendUsername);

    res.status(200).send(response)
}

export async function deleteFriend(req: FastifyRequest<{ Params: FriendParams }>, res: FastifyReply) {
    await services.deleteFriend(req.user.username, req.params.username)

    // Idempotent, so the same 204 whether or not they were a friend.
    res.status(204).send()
}

export async function getFriends(req: FastifyRequest, res: FastifyReply) {
    const friends = await services.getFriends(req.user.username)

    res.status(200).send({ friends })
}

// People who added you and are waiting. Separate from GET /friends on purpose —
// UPPGIFT.md keeps pending incoming requests out of that response.
export async function getFriendRequests(req: FastifyRequest, res: FastifyReply) {
    const requests = await services.getFriendRequests(req.user.username)

    res.status(200).send({ requests })
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png"];

// multipart/form-data can't express an array, so `recipients` arrives in one of
// two shapes and both are accepted: a single field holding a JSON array
// (`["a","b"]`), or the field repeated once per username. A single bare
// username is unambiguous, so that works too.
function parseRecipients(field: SendSnapBody['recipients']): string[] {
    if (field === undefined) {
        throw new BadRequest('A snap needs at least one recipient')
    }

    if (Array.isArray(field)) {
        return field.map((part) => String(part.value))
    }

    const raw = String(field.value).trim()

    if (!raw.startsWith('[')) return [raw]

    let parsed: unknown

    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new BadRequest('recipients must be a JSON array of usernames')
    }

    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
        throw new BadRequest('recipients must be a JSON array of usernames')
    }

    return parsed as string[]
}

export async function sendSnap(req: FastifyRequest<{ Body: SendSnapBody }>, res: FastifyReply) {
    // @fastify/multipart is registered with attachFieldsToBody, so the parts are
    // already on req.body — the file included — rather than behind req.file().
    const file = req.body?.file

    if (!file) throw new NotFound("No file uploaded");

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) throw new BadRequest("Only JPEG and PNG images are allowed");

    const recipients = parseRecipients(req.body.recipients)

    const buffer = await file.toBuffer();

    const result = await services.sendSnap({
        senderUsername: req.user.username,
        recipients,
        type: 'photo',
        body: req.body.text?.value,
        image: buffer,
        mimetype: file.mimetype,
    });

    res.status(201).send(result)
}

// Reading a snap consumes it — see services.getSnap.
export async function getSnap(req: FastifyRequest<{ Params: SnapParams }>, res: FastifyReply) {
    const snap = await services.getSnap(req.user.username, req.params.id)

    res.status(200).send(snap)
}

// Everything unviewed and unexpired addressed to you. Metadata only, so listing
// never burns a snap.
export async function getInbox(req: FastifyRequest, res: FastifyReply) {
    const snaps = await services.getInbox(req.user.username)

    res.status(200).send({ snaps })
}

export async function reportScreenshot(req: FastifyRequest<{ Params: SnapParams }>, res: FastifyReply) {
    await services.reportScreenshot(req.user.username, req.params.id)

    res.status(204).send()
}

export async function sendMessage(
    req: FastifyRequest<{ Params: MessageParams; Body: SendMessageRequest }>,
    res: FastifyReply
) {
    const body = requireString(req.body?.body, 'A message needs a body')

    const message = await services.sendMessage(req.user.username, req.params.username, body)

    res.status(201).send(message)
}

// Newest first. Pass ?before=<oldest id you have> for the page before that.
export async function getMessages(
    req: FastifyRequest<{ Params: MessageParams; Querystring: MessagesQuery }>,
    res: FastifyReply
) {
    const messages = await services.getMessages(req.user.username, req.params.username, req.query.before)

    res.status(200).send({ messages })
}

export async function getConversations(req: FastifyRequest, res: FastifyReply) {
    const conversations = await services.getConversations(req.user.username)

    res.status(200).send({ conversations })
}
