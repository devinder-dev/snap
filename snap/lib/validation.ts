import { S } from '@/constants/strings';

/** Login/register: both fields must be present. Returns a message, or null if ok. */
export function validateCredentials(username: string, password: string): string | null {
  if (username.trim() === '' || password === '') return S.validation.bothFields;
  return null;
}

/** Add-friend: a username is required. Returns a message, or null if ok. */
export function validateUsername(username: string): string | null {
  if (username.trim() === '') return S.validation.usernameRequired;
  return null;
}
