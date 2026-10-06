/**
 * Real HTTP client. Same exports as `api.mock.ts`.
 *
 * On a 401 from a protected call this refreshes once and replays; a 401 that
 * still comes back means the refresh failed too, and `useApi` logs the user out.
 */
import { loadSession, saveSession } from '@/lib/auth-storage';
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
import { API_BASE_URL } from '@/lib/config';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token === null) refreshToken = null;
}

export function setTokens(tokens: Tokens | null): void {
  if (!tokens) {
    accessToken = null;
    refreshToken = null;
    return;
  }
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
}

/** For the realtime socket, which authenticates with the same access token. */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Trade the refresh token for a new pair. For callers outside this file — the
 * socket, whose handshake is refused once its access token has expired.
 */
export function refreshSession(): Promise<boolean> {
  return tryRefresh();
}

export async function register(username: string, password: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function getFriends(): Promise<ApiFriend[]> {
  const body = await requestJson<{ friends: ApiFriend[] }>('/friends', { method: 'GET' }, { auth: true });
  return body.friends;
}

export async function getFriendRequests(): Promise<ApiFriendRequest[]> {
  const body = await requestJson<{ requests: ApiFriendRequest[] }>(
    '/friends/requests',
    { method: 'GET' },
    { auth: true },
  );
  return body.requests;
}

export async function addFriend(friendUsername: string): Promise<AddFriendResponse> {
  return requestJson<AddFriendResponse>(
    '/friends',
    {
      method: 'POST',
      body: JSON.stringify({ friend_username: friendUsername }),
    },
    { auth: true },
  );
}

export async function deleteFriend(username: string): Promise<void> {
  await request('/friends/' + encodeURIComponent(username), { method: 'DELETE' }, { auth: true });
}

export async function sendSnap(input: SendSnapInput): Promise<void> {
  const form = new FormData();
  form.append(
    'file',
    {
      uri: input.photo.uri,
      name: input.photo.mimetype === 'image/png' ? 'snap.png' : 'snap.jpg',
      type: input.photo.mimetype,
    } as unknown as Blob,
  );
  form.append('recipients', JSON.stringify(input.recipients));
  if (input.text) form.append('text', input.text);

  await request('/snaps', { method: 'POST', body: form }, { auth: true, jsonBody: false });
}

export async function getConversations(): Promise<ApiConversation[]> {
  const body = await requestJson<{ conversations: ApiConversation[] }>(
    '/conversations',
    { method: 'GET' },
    { auth: true },
  );
  return body.conversations;
}

/** Newest first, 50 at a time. Pass the oldest id you have as `before` for the page before it. */
export async function getMessages(username: string, before?: string): Promise<ApiMessage[]> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const body = await requestJson<{ messages: ApiMessage[] }>(
    `/messages/${encodeURIComponent(username)}${query}`,
    { method: 'GET' },
    { auth: true },
  );
  return body.messages;
}

export async function sendMessage(username: string, text: string): Promise<ApiMessage> {
  return requestJson<ApiMessage>(
    `/messages/${encodeURIComponent(username)}`,
    { method: 'POST', body: JSON.stringify({ body: text }) },
    { auth: true },
  );
}

export async function getInbox(): Promise<ApiSnapSummary[]> {
  const body = await requestJson<{ snaps: ApiSnapSummary[] }>('/snaps', { method: 'GET' }, { auth: true });
  return body.snaps;
}

/** One-shot: this call is what marks the snap viewed. */
export async function getSnap(id: string): Promise<ApiSnap> {
  return requestJson<ApiSnap>(`/snaps/${encodeURIComponent(id)}`, { method: 'GET' }, { auth: true });
}

export async function reportScreenshot(id: string): Promise<void> {
  await request(`/snaps/${encodeURIComponent(id)}/screenshot`, { method: 'POST' }, { auth: true });
}

type RequestOptions = {
  auth?: boolean;
  jsonBody?: boolean;
  retry?: boolean;
};

async function requestJson<T>(path: string, init: RequestInit, options: RequestOptions = {}): Promise<T> {
  const res = await request(path, init, { jsonBody: true, ...options });
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function request(path: string, init: RequestInit, options: RequestOptions = {}): Promise<Response> {
  const { auth = false, jsonBody = true, retry = true } = options;

  const headers = new Headers(init.headers);
  if (jsonBody && init.body) headers.set('Content-Type', 'application/json');
  if (auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (res.status === 401 && auth && retry && refreshToken) {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, init, { ...options, retry: false });
  }

  if (!res.ok) await throwApiError(res);
  return res;
}

/**
 * Several calls can 401 at once when the access token expires (the chats screen
 * alone makes four in parallel, and the socket may be reconnecting too). They
 * all share one refresh instead of each starting their own.
 */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const usedToken = refreshToken;
  if (!usedToken) return false;

  try {
    const res = await fetch(`${API_BASE_URL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: usedToken }),
    });

    if (!res.ok) return false;

    const body: unknown = await res.json();
    const tokens = (body as { tokens?: Tokens }).tokens;
    if (!tokens?.access_token || !tokens.refresh_token) return false;

    // Signed out while this was in flight. Writing the new tokens now would
    // quietly sign them back in.
    if (refreshToken !== usedToken) return false;

    setTokens(tokens);

    const session = await loadSession();
    if (session) await saveSession({ ...session, tokens });

    return true;
  } catch {
    return false;
  }
}

async function throwApiError(res: Response): Promise<never> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, 'Något gick fel');
  }

  if (
    body &&
    typeof body === 'object' &&
    'code' in body &&
    'message' in body &&
    typeof (body as { code: unknown }).code === 'number' &&
    typeof (body as { message: unknown }).message === 'string'
  ) {
    throw new ApiError((body as { code: number }).code, (body as { message: string }).message);
  }

  throw new ApiError(res.status, 'Något gick fel');
}
