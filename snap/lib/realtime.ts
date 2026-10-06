/**
 * The realtime socket. Like `api.ts`, the only place in the app that talks to
 * the server over it.
 *
 * The socket is PUSH-ONLY: the server says "something happened", and every
 * write still goes over HTTP. So nothing here sends; it connects, listens and
 * hands each event to one callback. Missing an event is never data loss — the
 * same data is always in the HTTP API — which is why screens refetch on
 * `connected` instead of trying to replay what they missed.
 */
import { io } from 'socket.io-client';

import { getAccessToken, refreshSession, type ApiMessage, type ApiSnapType } from '@/lib/api';
import { API_BASE_URL, USE_MOCK } from '@/lib/config';

export type SnapReceivedEvent = {
  snap_id: string;
  sender_username: string;
  type: ApiSnapType;
  created_at: string;
  expires_at: string;
};

/** Someone added you. Accepting is `addFriend` back at them. */
export type FriendRequestEvent = { from: string; created_at: string };

/** You and `username` just became mutual friends, whichever side accepted. */
export type FriendAcceptedEvent = { username: string; created_at: string };

/** `by` screenshotted a snap you sent. */
export type ScreenshotTakenEvent = { snap_id: string; by: string; created_at: string };

/** Event name -> payload. Mirrors ServerToClientEvents in backend/src/websocket/types.ts. */
export type RealtimeEvents = {
  snap_received: SnapReceivedEvent;
  friend_request: FriendRequestEvent;
  friend_accepted: FriendAcceptedEvent;
  screenshot_taken: ScreenshotTakenEvent;
  /** Also echoed to the sender, so your other devices stay in sync. */
  message_received: ApiMessage;
  /**
   * Ours, not the server's: fired on every successful (re)connect. Anything
   * that happened while disconnected was not pushed, so this is the cue to refetch.
   */
  connected: undefined;
};

export type RealtimeEventName = keyof RealtimeEvents;

const SERVER_EVENTS: Exclude<RealtimeEventName, 'connected'>[] = [
  'snap_received',
  'friend_request',
  'friend_accepted',
  'screenshot_taken',
  'message_received',
];

export type RealtimeConnection = { close: () => void };

type ConnectOptions = {
  onEvent: <E extends RealtimeEventName>(event: E, payload: RealtimeEvents[E]) => void;
  /** The server refused the token and refreshing it did not help. */
  onUnauthorized: () => void;
};

/**
 * A refresh that "succeeds" but still gets refused would otherwise loop
 * forever: refuse -> refresh -> reconnect -> refuse.
 */
const MAX_AUTH_RETRIES = 2;

export function connectRealtime({ onEvent, onUnauthorized }: ConnectOptions): RealtimeConnection {
  // The mock has no server to connect to. Everything still works; it just
  // never pushes, so screens update on focus and pull-to-refresh instead.
  if (USE_MOCK) return { close: () => {} };

  const socket = io(API_BASE_URL, {
    // Straight to WebSocket. The default starts with HTTP long-polling and
    // upgrades, which is extra round trips for nothing on a phone.
    transports: ['websocket'],
    // A function, not a value: it is re-read on every (re)connect, so a token
    // that was refreshed over HTTP since the last handshake gets used.
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });

  let closed = false;
  let authRetries = 0;

  socket.on('connect', () => {
    authRetries = 0;
    onEvent('connected', undefined);
  });

  for (const event of SERVER_EVENTS) {
    socket.on(event, (payload: RealtimeEvents[typeof event]) => onEvent(event, payload));
  }

  socket.on('connect_error', async () => {
    // Still `active` means a network-level failure, and socket.io keeps
    // retrying on its own. Inactive means the server's auth middleware refused
    // the handshake — usually an access token that expired while the app was
    // in the background — and socket.io will NOT retry that by itself.
    if (socket.active || closed) return;

    if (authRetries >= MAX_AUTH_RETRIES) {
      onUnauthorized();
      return;
    }
    authRetries++;

    const refreshed = await refreshSession();
    if (closed) return;

    if (refreshed) socket.connect();
    else onUnauthorized();
  });

  return {
    close: () => {
      closed = true;
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
