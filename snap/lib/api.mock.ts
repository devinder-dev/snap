/**
 * In-memory stand-in for the backend. Same signatures, same error messages,
 * 300–800 ms of delay so loading states are visible.
 *
 * State lives at module scope, so it resets on reload and on Fast Refresh of
 * this file. See snap/README.md for the error-path table.
 */
import {
  ApiError,
  type AddFriendResponse,
  type ApiConversation,
  type ApiFriend,
  type ApiFriendRequest,
  type ApiMessage,
  type ApiSnap,
  type ApiSnapSummary,
  type AuthResponse,
  type SendSnapInput,
  type Tokens,
} from '@/lib/api.types';

const ACCESS_PREFIX = 'mock-access:';
const REFRESH_PREFIX = 'mock-refresh:';
const SEED_CREATED_AT = '2026-01-15T12:00:00.000Z';

let accessToken: string | null = null;

let friends: ApiFriend[] = [
  { username: 'moises', created_at: SEED_CREATED_AT, mutual: true },
  { username: 'sara', created_at: SEED_CREATED_AT, mutual: true },
  { username: 'kalle', created_at: SEED_CREATED_AT, mutual: false },
];

let requests: ApiFriendRequest[] = [
  { username: 'dave', created_at: SEED_CREATED_AT },
  { username: 'nour', created_at: SEED_CREATED_AT },
];

/** All messages, in send order. Filtered per conversation on read. */
let messages: ApiMessage[] = [
  {
    id: '1',
    sender_username: 'moises',
    recipient_username: '__me__',
    body: 'Hej! Såg du min snap?',
    created_at: SEED_CREATED_AT,
  },
];
let nextMessageId = 2;

const SNAP_TTL_MS = 24 * 60 * 60 * 1000;

/** Waiting snaps, with the content getSnap hands back once. */
let inbox: ApiSnap[] = [
  {
    id: '101',
    type: 'photo',
    sender_username: 'sara',
    created_at: SEED_CREATED_AT,
    expires_at: new Date(Date.now() + SNAP_TTL_MS).toISOString(),
    body: 'Fika?',
    media_url: 'https://picsum.photos/seed/snap-101/1080/1920',
  },
];

const PAGE_SIZE = 50;

function sleep(): Promise<void> {
  const ms = 300 + Math.random() * 500;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokensFor(username: string): Tokens {
  return {
    access_token: `${ACCESS_PREFIX}${username}`,
    refresh_token: `${REFRESH_PREFIX}${username}`,
  };
}

function currentUsername(): string | null {
  if (!accessToken?.startsWith(ACCESS_PREFIX)) return null;
  const username = accessToken.slice(ACCESS_PREFIX.length);
  return username || null;
}

function requireUser(): string {
  const username = currentUsername();
  if (!username) throw new ApiError(401, 'You are not authorized');
  return username;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cloneFriends(): ApiFriend[] {
  const me = currentUsername();
  return friends.filter((friend) => friend.username !== me).map((friend) => ({ ...friend }));
}

function cloneRequests(): ApiFriendRequest[] {
  const me = currentUsername();
  return requests.filter((request) => request.username !== me).map((request) => ({ ...request }));
}

/** Assignment: called after login/register, on boot, and with null on logout. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** What auth-context actually calls — both tokens, or null to sign out. */
export function setTokens(tokens: Tokens | null): void {
  accessToken = tokens?.access_token ?? null;
}

export async function register(username: string, _password: string): Promise<AuthResponse> {
  await sleep();

  if (username === 'boom') throw new ApiError(500, 'Unknown error');
  if (username === 'taken') throw new ApiError(409, 'User already exists');

  return {
    tokens: tokensFor(username),
    user: { username, created_at: nowIso() },
  };
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  await sleep();

  if (username === 'nobody') throw new ApiError(404, 'User not found');
  if (password === 'wrong') throw new ApiError(401, 'Invalid password!');

  return {
    tokens: tokensFor(username),
    user: { username, created_at: SEED_CREATED_AT },
  };
}

export async function getFriends(): Promise<ApiFriend[]> {
  await sleep();
  requireUser();
  return cloneFriends();
}

export async function getFriendRequests(): Promise<ApiFriendRequest[]> {
  await sleep();
  requireUser();
  return cloneRequests();
}

export async function addFriend(friendUsername: string): Promise<AddFriendResponse> {
  await sleep();
  const me = requireUser();

  if (friendUsername === me) {
    throw new ApiError(400, "You can't add yourself as a friend");
  }
  if (friendUsername === 'nobody') {
    throw new ApiError(404, 'User not found');
  }

  const existing = friends.find((friend) => friend.username === friendUsername);
  const incoming = requests.find((request) => request.username === friendUsername);
  // `anna` is the assignment's special case; anyone already in incoming requests
  // is the real backend's "they added you first" path (dave, nour, …).
  const becomesFriends = friendUsername === 'anna' || Boolean(incoming) || existing?.mutual === true;

  if (incoming) {
    requests = requests.filter((request) => request.username !== friendUsername);
  }

  if (existing) {
    existing.mutual = becomesFriends;
  } else {
    friends = [
      ...friends,
      { username: friendUsername, created_at: nowIso(), mutual: becomesFriends },
    ];
  }

  return { status: becomesFriends ? 'friends' : 'pending' };
}

export async function deleteFriend(username: string): Promise<void> {
  await sleep();
  requireUser();

  const removed = friends.find((friend) => friend.username === username);
  friends = friends.filter((friend) => friend.username !== username);

  // Their edge remains, so a mutual friend comes back as an incoming request.
  if (removed?.mutual && !requests.some((request) => request.username === username)) {
    requests = [...requests, { username, created_at: nowIso() }];
  }
}

export async function sendSnap(input: SendSnapInput): Promise<void> {
  await sleep();
  requireUser();

  if (input.recipients.length === 0) {
    throw new ApiError(400, 'A snap needs at least one recipient');
  }

  for (const recipient of input.recipients) {
    const friend = friends.find((entry) => entry.username === recipient);
    if (!friend?.mutual) {
      throw new ApiError(400, `You are not friends with ${recipient}`);
    }
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Mock tokens never expire, so there is never anything to refresh. */
export async function refreshSession(): Promise<boolean> {
  return false;
}

/** The seed message is addressed to "whoever is signed in". */
function resolveMe(message: ApiMessage, me: string): ApiMessage {
  return {
    ...message,
    sender_username: message.sender_username === '__me__' ? me : message.sender_username,
    recipient_username: message.recipient_username === '__me__' ? me : message.recipient_username,
  };
}

function conversationWith(me: string, other: string): ApiMessage[] {
  return messages
    .map((message) => resolveMe(message, me))
    .filter(
      (m) =>
        (m.sender_username === me && m.recipient_username === other) ||
        (m.sender_username === other && m.recipient_username === me),
    )
    .reverse(); // newest first, like the server
}

export async function getConversations(): Promise<ApiConversation[]> {
  await sleep();
  const me = requireUser();

  const partners = new Set(
    messages
      .map((message) => resolveMe(message, me))
      .filter((m) => m.sender_username === me || m.recipient_username === me)
      .map((m) => (m.sender_username === me ? m.recipient_username : m.sender_username)),
  );

  return [...partners]
    .map((username) => ({ username, last_message: conversationWith(me, username)[0] }))
    .sort((a, b) => Number(b.last_message.id) - Number(a.last_message.id));
}

export async function getMessages(username: string, before?: string): Promise<ApiMessage[]> {
  await sleep();
  const me = requireUser();

  const all = conversationWith(me, username);
  const older = before ? all.filter((m) => Number(m.id) < Number(before)) : all;
  return older.slice(0, PAGE_SIZE);
}

export async function sendMessage(username: string, text: string): Promise<ApiMessage> {
  await sleep();
  const me = requireUser();

  const body = text.trim();
  if (body.length === 0 || body.length > 2000) {
    throw new ApiError(400, 'A message must be between 1 and 2000 characters');
  }
  if (username === 'nobody') throw new ApiError(404, 'User not found');

  const friend = friends.find((entry) => entry.username === username);
  if (!friend?.mutual) throw new ApiError(400, `You are not friends with ${username}`);

  const message: ApiMessage = {
    id: String(nextMessageId++),
    sender_username: me,
    recipient_username: username,
    body,
    created_at: nowIso(),
  };
  messages = [...messages, message];
  return message;
}

export async function getInbox(): Promise<ApiSnapSummary[]> {
  await sleep();
  requireUser();
  return inbox.map(({ body: _body, media_url: _mediaUrl, ...summary }) => summary);
}

export async function getSnap(id: string): Promise<ApiSnap> {
  await sleep();
  requireUser();

  const snap = inbox.find((entry) => entry.id === id);
  if (!snap) throw new ApiError(404, 'Snap not found');

  // One-shot, like the server: reading it removes it.
  inbox = inbox.filter((entry) => entry.id !== id);
  return snap;
}

export async function reportScreenshot(_id: string): Promise<void> {
  await sleep();
  requireUser();
}
