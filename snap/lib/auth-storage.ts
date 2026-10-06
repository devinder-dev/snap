/**
 * The persisted session. `lib/api` only holds tokens in memory — this is what
 * makes the app open already signed in after a restart.
 *
 * SecureStore is iOS/Android. Web falls back to localStorage so `expo start --web`
 * still boots; that path is not how we test the app.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ApiUser, Tokens } from '@/lib/api.types';

const SESSION_KEY = 'snap.session';

export type StoredSession = {
  tokens: Tokens;
  user: ApiUser;
};

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await readRaw();
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredSession(parsed)) return null;
    return parsed;
  } catch {
    // Corrupt JSON — treat as signed out rather than crashing on boot.
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await writeRaw(JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(SESSION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
  }
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(SESSION_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(SESSION_KEY, value);
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as StoredSession;
  return (
    typeof session.user?.username === 'string' &&
    typeof session.user?.created_at === 'string' &&
    typeof session.tokens?.access_token === 'string' &&
    typeof session.tokens?.refresh_token === 'string'
  );
}
