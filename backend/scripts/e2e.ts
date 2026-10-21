// `bun run e2e` — the whole backend, end to end, against a running server.
//
// It uses the API the way the app does: HTTP for every write, socket.io for
// the pushes. Four throwaway users (zzt_<run>_…) — anna, ben and cara become
// friends, dave stays a stranger and must never receive a push. A tiny PNG goes
// to the real bucket and comes back through a presigned link.
//
// Setup and cleanup reach into Postgres and S3 directly, so it needs the same
// .env as the server. Cleanup runs even when a check fails: the S3 objects
// first, then the rows — the same order the expiry sweep uses, so a photo is
// never left without the row that knows its key.
//
//   bun run dev                 # in one terminal
//   bun run e2e                 # in another
//   E2E_BASE_URL=http://localhost:3001 bun run e2e

import { sql } from 'bun'
import { io, type Socket } from 'socket.io-client'
import * as services from '../src/services'
import * as s3 from '../src/utils/s3'

const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

const run = crypto.randomUUID().slice(0, 6)
const users = {
    anna: `zzt_${run}_anna`,
    ben: `zzt_${run}_ben`,
    cara: `zzt_${run}_cara`,
    dave: `zzt_${run}_dave`,
}
const PASSWORD = 'correct horse battery staple'

// A 1×1 PNG. The server checks the declared type, not the pixels.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
)

const DAY_MS = 24 * 60 * 60 * 1000

// ── Reporting ─────────────────────────────────────────────

let passed = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail?: unknown): void {
    if (ok) {
        passed++
        console.log(`  ✓ ${name}`)
    } else {
        failures.push(name)
        console.log(`  ✗ ${name}`, detail === undefined ? '' : detail)
    }
}

function section(title: string): void {
    console.log(`\n${title}`)
}

// ── HTTP ──────────────────────────────────────────────────

type ApiResponse = { status: number; body: any }

async function api(
    method: string,
    path: string,
    options: { token?: string; json?: unknown; form?: FormData } = {}
): Promise<ApiResponse> {
    const headers: Record<string, string> = {}
    if (options.token) headers.authorization = `Bearer ${options.token}`

    let body: string | FormData | undefined
    if (options.json !== undefined) {
        // Only with a body: Fastify rejects an empty body that claims to be JSON.
        headers['content-type'] = 'application/json'
        body = JSON.stringify(options.json)
    } else if (options.form) {
        // fetch writes the multipart boundary into the header itself.
        body = options.form
    }

    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body })
    const text = await response.text()

    let parsed: unknown = undefined
    if (text) {
        try {
            parsed = JSON.parse(text)
        } catch {
            parsed = text
        }
    }

    return { status: response.status, body: parsed }
}

function snapForm(recipients: string[], options: { caption?: string; type?: string; file?: boolean } = {}): FormData {
    const form = new FormData()
    if (options.file !== false) {
        form.append('file', new Blob([PNG], { type: options.type ?? 'image/png' }), 'snap.png')
    }
    // The app sends recipients as one field holding a JSON array.
    form.append('recipients', JSON.stringify(recipients))
    if (options.caption) form.append('text', options.caption)
    return form
}

// ── Sockets ───────────────────────────────────────────────

function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
        // WebSocket only, like the app — and no automatic reconnect, so a refused
        // handshake fails here instead of retrying forever.
        const socket = io(BASE_URL, { transports: ['websocket'], auth: { token }, reconnection: false })
        socket.once('connect', () => resolve(socket))
        socket.once('connect_error', (error) => {
            socket.close()
            reject(error)
        })
    })
}

// Call this BEFORE the request that triggers the push, and await it after. A
// push that arrived before anyone listened would otherwise be missed.
// Resolves to null on timeout, so a missing push is a failed check, not a crash.
function nextEvent(
    socket: Socket,
    event: string,
    match: (payload: any) => boolean = () => true,
    timeoutMs = 3000
): Promise<any | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            socket.off(event, handler)
            resolve(null)
        }, timeoutMs)

        function handler(payload: any) {
            if (!match(payload)) return
            clearTimeout(timer)
            socket.off(event, handler)
            resolve(payload)
        }

        socket.on(event, handler)
    })
}

// ── The run ───────────────────────────────────────────────

const tokens: Record<string, { access: string; refresh: string }> = {}
const sockets: Record<string, Socket> = {}
const daveReceived: string[] = []
let firstSnapUrl: string | undefined

console.log(`e2e against ${BASE_URL} — run ${run}`)

try {
    section('Health')
    {
        const res = await api('GET', '/health')
        check('GET /health answers 200 ok', res.status === 200 && res.body?.status === 'ok', res)
    }

    section('Accounts')
    {
        for (const [name, username] of Object.entries(users)) {
            const res = await api('POST', '/register', { json: { username, password: PASSWORD } })
            const ok = res.status === 201 && res.body?.user?.username === username
                && typeof res.body?.tokens?.access_token === 'string'
                && typeof res.body?.tokens?.refresh_token === 'string'
            check(`${name} registers (201, both tokens)`, ok, res)
            if (ok) tokens[name] = { access: res.body.tokens.access_token, refresh: res.body.tokens.refresh_token }
        }
        if (Object.keys(tokens).length < 4) throw new Error('Registration failed — nothing else can run')

        const again = await api('POST', '/register', { json: { username: users.anna, password: PASSWORD } })
        check('registering a taken username is 409', again.status === 409, again)

        const noPassword = await api('POST', '/register', { json: { username: `zzt_${run}_x` } })
        check('registering without a password is 400', noPassword.status === 400, noPassword)

        const tooLong = await api('POST', '/register', { json: { username: 'z'.repeat(33), password: PASSWORD } })
        check('a 33-character username is 400', tooLong.status === 400, tooLong)

        const wrong = await api('POST', '/login', { json: { username: users.anna, password: 'wrong password' } })
        check('login with the wrong password is 401', wrong.status === 401, wrong)

        const login = await api('POST', '/login', { json: { username: users.anna, password: PASSWORD } })
        check('login with the right password is 200', login.status === 200 && login.body?.user?.username === users.anna, login)

        const refreshed = await api('POST', '/refresh', { json: { refresh_token: tokens.anna!.refresh } })
        const newAccess: string | undefined = refreshed.body?.tokens?.access_token
        const usable = newAccess ? await api('GET', '/friends', { token: newAccess }) : undefined
        check('refresh gives an access token that works', refreshed.status === 200 && usable?.status === 200, refreshed)

        const accessAsRefresh = await api('POST', '/refresh', { json: { refresh_token: tokens.anna!.access } })
        check('an access token is refused as a refresh token (401)', accessAsRefresh.status === 401, accessAsRefresh)

        const noToken = await api('GET', '/friends')
        check('a protected route without a token is 401', noToken.status === 401, noToken)

        const refreshAsAccess = await api('GET', '/friends', { token: tokens.anna!.refresh })
        check('a refresh token is refused as an access token (401)', refreshAsAccess.status === 401, refreshAsAccess)
    }

    section('Sockets')
    {
        let refused = false
        try {
            const socket = await connect('not-a-token')
            socket.close()
        } catch {
            refused = true
        }
        check('a socket with a bad token is refused', refused)

        for (const name of Object.keys(users)) {
            sockets[name] = await connect(tokens[name]!.access)
        }
        check('all four connect with their access tokens', Object.values(sockets).every((socket) => socket.connected))

        // Dave is nobody's friend. Anything that reaches him is a leak.
        sockets.dave!.onAny((event) => daveReceived.push(event))
    }

    section('Friends')
    {
        const self = await api('POST', '/friends', { token: tokens.anna!.access, json: { friend_username: users.anna } })
        check('adding yourself is 400', self.status === 400, self)

        const ghost = await api('POST', '/friends', { token: tokens.anna!.access, json: { friend_username: `zzt_${run}_nobody` } })
        check('adding a user who does not exist is 404', ghost.status === 404, ghost)

        const requestPush = nextEvent(sockets.ben!, 'friend_request', (p) => p.from === users.anna)
        const add = await api('POST', '/friends', { token: tokens.anna!.access, json: { friend_username: users.ben } })
        check('anna adds ben → pending', add.status === 200 && add.body?.status === 'pending', add)
        check('ben is pushed friend_request from anna', (await requestPush) !== null)

        const requests = await api('GET', '/friends/requests', { token: tokens.ben!.access })
        check("anna is in ben's incoming requests", requests.body?.requests?.some((r: any) => r.username === users.anna), requests)

        const annaFriends = await api('GET', '/friends', { token: tokens.anna!.access })
        const pending = annaFriends.body?.friends?.find((f: any) => f.username === users.ben)
        check("ben is in anna's list, not yet mutual", pending?.mutual === false, annaFriends)

        const annaAccepted = nextEvent(sockets.anna!, 'friend_accepted', (p) => p.username === users.ben)
        const benAccepted = nextEvent(sockets.ben!, 'friend_accepted', (p) => p.username === users.anna)
        const back = await api('POST', '/friends', { token: tokens.ben!.access, json: { friend_username: users.anna } })
        check('ben adds anna back → friends', back.status === 200 && back.body?.status === 'friends', back)
        check('anna is pushed friend_accepted naming ben', (await annaAccepted) !== null)
        check('ben is pushed friend_accepted naming anna', (await benAccepted) !== null)

        const mutual = await api('GET', '/friends', { token: tokens.anna!.access })
        check('ben is now mutual in anna\'s list', mutual.body?.friends?.find((f: any) => f.username === users.ben)?.mutual === true, mutual)

        const after = await api('GET', '/friends/requests', { token: tokens.ben!.access })
        check("anna has left ben's incoming requests", !after.body?.requests?.some((r: any) => r.username === users.anna), after)

        await api('POST', '/friends', { token: tokens.anna!.access, json: { friend_username: users.cara } })
        const cara = await api('POST', '/friends', { token: tokens.cara!.access, json: { friend_username: users.anna } })
        check('anna and cara become friends', cara.body?.status === 'friends', cara)
    }

    section('Snaps')
    {
        const stranger = await api('POST', '/snaps', { token: tokens.anna!.access, form: snapForm([users.dave]) })
        check('a snap to a non-friend is 400', stranger.status === 400, stranger)

        const noFile = await api('POST', '/snaps', { token: tokens.anna!.access, form: snapForm([users.ben], { file: false }) })
        check('a snap without a file is refused', noFile.status >= 400 && noFile.status < 500, noFile)

        const gif = await api('POST', '/snaps', { token: tokens.anna!.access, form: snapForm([users.ben], { type: 'image/gif' }) })
        check('a GIF is 400 (JPEG and PNG only)', gif.status === 400, gif)

        const received = nextEvent(sockets.ben!, 'snap_received', (p) => p.sender_username === users.anna)
        const sent = await api('POST', '/snaps', { token: tokens.anna!.access, form: snapForm([users.ben], { caption: 'hej ben' }) })
        const snapId: string | undefined = sent.body?.snap_id
        const expiresIn = new Date(sent.body?.expires_at).getTime() - Date.now()
        check('anna sends ben a photo (201)', sent.status === 201 && typeof snapId === 'string', sent)
        check('it expires in 24 hours', Math.abs(expiresIn - DAY_MS) < 60_000, sent.body)

        const push = await received
        check('ben is pushed snap_received for it', push?.snap_id === snapId && push?.type === 'photo', push)

        const inbox = await api('GET', '/snaps', { token: tokens.ben!.access })
        const row = inbox.body?.snaps?.find((s: any) => s.id === snapId)
        check("it is in ben's inbox", row !== undefined, inbox)
        check('the inbox holds metadata only — no link, no caption', row && !('media_url' in row) && !('body' in row), row)

        const notYours = await api('GET', `/snaps/${snapId}`, { token: tokens.cara!.access })
        check('cara cannot open a snap sent to ben (404)', notYours.status === 404, notYours)

        const opened = await api('GET', `/snaps/${snapId}`, { token: tokens.ben!.access })
        firstSnapUrl = opened.body?.media_url
        check('ben opens it: caption and a photo link', opened.status === 200 && opened.body?.body === 'hej ben' && typeof firstSnapUrl === 'string', opened)

        if (firstSnapUrl) {
            const photo = await fetch(firstSnapUrl)
            const bytes = Buffer.from(await photo.arrayBuffer())
            check('the presigned link downloads the exact PNG from S3', photo.status === 200 && bytes.equals(PNG), photo.status)
            check('S3 serves it as image/png', photo.headers.get('content-type') === 'image/png', photo.headers.get('content-type'))
        }

        const twice = await api('GET', `/snaps/${snapId}`, { token: tokens.ben!.access })
        check('opening it a second time is 404 (view once)', twice.status === 404, twice)

        const inboxAfter = await api('GET', '/snaps', { token: tokens.ben!.access })
        check("it has left ben's inbox", !inboxAfter.body?.snaps?.some((s: any) => s.id === snapId), inboxAfter)

        const badId = await api('GET', '/snaps/abc', { token: tokens.ben!.access })
        check('a non-numeric snap id is 404, not 500', badId.status === 404, badId)

        const screenshotPush = nextEvent(sockets.anna!, 'screenshot_taken', (p) => p.snap_id === snapId)
        const screenshot = await api('POST', `/snaps/${snapId}/screenshot`, { token: tokens.ben!.access })
        const shot = await screenshotPush
        check('ben reports a screenshot (204)', screenshot.status === 204, screenshot)
        check('anna is pushed screenshot_taken by ben', shot?.by === users.ben, shot)

        const benPush = nextEvent(sockets.ben!, 'snap_received', (p) => p.sender_username === users.anna)
        const caraPush = nextEvent(sockets.cara!, 'snap_received', (p) => p.sender_username === users.anna)
        const group = await api('POST', '/snaps', { token: tokens.anna!.access, form: snapForm([users.ben, users.cara]) })
        const [toBen, toCara] = await Promise.all([benPush, caraPush])
        check('one snap to ben and cara (201)', group.status === 201, group)
        check('both are pushed the same snap', toBen?.snap_id === group.body?.snap_id && toCara?.snap_id === group.body?.snap_id, { toBen, toCara })

        section('Expiry (the function the 5-minute sweep runs)')

        const groupId: string = group.body?.snap_id
        const [media] = await sql`SELECT media_key FROM snaps WHERE id = ${groupId}`
        const key: string | undefined = media?.media_key
        check('the group snap has a photo in S3', key !== undefined && (await fetch(s3.getPresignedUrl(key))).status === 200)

        await sql`UPDATE snaps SET expires_at = now() - interval '1 second' WHERE id = ${groupId}`

        const expiredInbox = await api('GET', '/snaps', { token: tokens.cara!.access })
        const expiredOpen = await api('GET', `/snaps/${groupId}`, { token: tokens.cara!.access })
        check('an expired snap leaves the inbox at once', !expiredInbox.body?.snaps?.some((s: any) => s.id === groupId), expiredInbox)
        check('and can no longer be opened (404)', expiredOpen.status === 404, expiredOpen)

        await services.deleteExpiredSnaps()
        const [stillThere] = await sql`SELECT id FROM snaps WHERE id = ${groupId}`
        check('the sweep deletes its row', stillThere === undefined)
        if (key) {
            const gone = await fetch(s3.getPresignedUrl(key))
            check('and its photo in S3', gone.status !== 200, gone.status)
        }
    }

    section('Chat')
    {
        const stranger = await api('POST', `/messages/${users.dave}`, { token: tokens.anna!.access, json: { body: 'hej' } })
        check('a message to a non-friend is 400', stranger.status === 400, stranger)

        const empty = await api('POST', `/messages/${users.ben}`, { token: tokens.anna!.access, json: { body: '   ' } })
        check('an empty message is 400', empty.status === 400, empty)

        const long = await api('POST', `/messages/${users.ben}`, { token: tokens.anna!.access, json: { body: 'x'.repeat(2001) } })
        check('a 2001-character message is 400', long.status === 400, long)

        const benPush = nextEvent(sockets.ben!, 'message_received', (p) => p.sender_username === users.anna)
        const annaEcho = nextEvent(sockets.anna!, 'message_received', (p) => p.sender_username === users.anna)
        const first = await api('POST', `/messages/${users.ben}`, { token: tokens.anna!.access, json: { body: 'first' } })
        const [pushed, echoed] = await Promise.all([benPush, annaEcho])
        check('anna messages ben (201)', first.status === 201 && first.body?.body === 'first', first)
        check('ben is pushed message_received with the same id', pushed?.id === first.body?.id, pushed)
        check("anna's own socket gets the echo, for her other devices", echoed?.id === first.body?.id, echoed)

        const second = await api('POST', `/messages/${users.ben}`, { token: tokens.anna!.access, json: { body: 'second' } })
        const third = await api('POST', `/messages/${users.ben}`, { token: tokens.anna!.access, json: { body: 'third' } })

        const history = await api('GET', `/messages/${users.anna}`, { token: tokens.ben!.access })
        const ids = history.body?.messages?.map((m: any) => m.id)
        check('history is newest first', JSON.stringify(ids) === JSON.stringify([third.body?.id, second.body?.id, first.body?.id]), ids)

        const page = await api('GET', `/messages/${users.anna}?before=${third.body?.id}`, { token: tokens.ben!.access })
        const pageIds = page.body?.messages?.map((m: any) => m.id)
        check('?before= returns only the older ones', JSON.stringify(pageIds) === JSON.stringify([second.body?.id, first.body?.id]), pageIds)

        const badCursor = await api('GET', `/messages/${users.anna}?before=abc`, { token: tokens.ben!.access })
        check('a non-numeric cursor is 400', badCursor.status === 400, badCursor)

        const conversations = await api('GET', '/conversations', { token: tokens.ben!.access })
        const withAnna = conversations.body?.conversations?.find((c: any) => c.username === users.anna)
        check("ben's conversation with anna shows the newest message", withAnna?.last_message?.id === third.body?.id, conversations)
    }

    section('Removing a friend')
    {
        const removed = await api('DELETE', `/friends/${users.ben}`, { token: tokens.anna!.access })
        const again = await api('DELETE', `/friends/${users.ben}`, { token: tokens.anna!.access })
        check('anna removes ben (204), and again is still 204', removed.status === 204 && again.status === 204, { removed, again })

        const message = await api('POST', `/messages/${users.ben}`, { token: tokens.anna!.access, json: { body: 'still there?' } })
        check('anna can no longer message ben (400)', message.status === 400, message)

        const requests = await api('GET', '/friends/requests', { token: tokens.anna!.access })
        check('ben, who still has anna added, is an incoming request to her', requests.body?.requests?.some((r: any) => r.username === users.ben), requests)
    }

    section('Privacy')
    {
        check('dave, a stranger, received no pushes at all', daveReceived.length === 0, daveReceived)
    }
} catch (error) {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`)
    console.error('\n  ✗ the run crashed:', error)
} finally {
    for (const socket of Object.values(sockets)) socket.close()

    section('Cleanup')
    try {
        const usernames = Object.values(users)
        const keys = await sql`
            SELECT s.media_key
            FROM snaps s
            JOIN users u ON u.id = s.sender_id
            WHERE u.username IN ${sql(usernames)} AND s.media_key IS NOT NULL
        `
        for (const { media_key } of keys) await s3.deleteFile(media_key)

        // snap_recipients goes with its snap; friendships and messages with their users.
        await sql`DELETE FROM snaps WHERE sender_id IN (SELECT id FROM users WHERE username IN ${sql(usernames)})`
        const deleted = await sql`DELETE FROM users WHERE username IN ${sql(usernames)} RETURNING id`
        console.log(`  removed ${keys.length} photo(s) from S3 and ${deleted.length} test user(s)`)

        if (firstSnapUrl) {
            const gone = await fetch(firstSnapUrl)
            check("ben's photo is gone from S3", gone.status !== 200, gone.status)
        }
    } catch (error) {
        failures.push('cleanup')
        console.error(`  ✗ cleanup failed — remove users named zzt_${run}_* by hand`, error)
    }
    await sql.close()
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
    for (const name of failures) console.log(`  ✗ ${name}`)
    process.exit(1)
}
