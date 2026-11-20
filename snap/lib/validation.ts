import { S } from '@/constants/strings';

/** Login/register: both fields must be present. Returns a message, or null if ok. */
export function validateCredentials(username: string, password: string): string | null {
  if (username.trim() === '' || password === '') return S.validation.bothFields;
  return null;
}

export function validateRegistration(username: string, password: string): string | null {
  const missing = validateCredentials(username, password);
  if (missing) return missing;

  const name = username.trim();
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(name) || name === '.' || name === '..') {
    return S.validation.registrationUsername;
  }
  return null;
}

/** Add-friend: a username is required. Returns a message, or null if ok. */
export function validateUsername(username: string): string | null {
  if (username.trim() === '') return S.validation.usernameRequired;
  return null;
}
