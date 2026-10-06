/**
 * The one place a 401 turns into a logout.
 *
 * Wrap every PROTECTED api call in `call(...)`:
 *
 *     const call = useApi();
 *     const res = await call(() => getFriends());
 *     if (!res.ok) setError(res.message);
 *     else setFriends(res.data);
 *
 * Screens then need no try/catch at all, and there is exactly one `code === 401`
 * branch in the entire app to reason about.
 *
 * IMPORTANT — do NOT use this for login/register. Those legitimately return 401
 * ("Invalid password!"), and routing them through here would sign the user out
 * mid-login. They call `signIn`/`signUp` from `useAuth` with their own try/catch.
 *
 * Why this rather than a callback registered into `lib/api.ts`: on Wednesday that
 * file is replaced wholesale, possibly by someone else's version. A hook there
 * would vanish silently. `ApiError.code === 401` is part of the binding contract
 * and cannot.
 *
 * Note the real client already refreshes once and replays on a 401, so a 401 that
 * reaches this point means the refresh failed too — logging out is correct.
 */
import { useCallback } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api';
import { S } from '@/constants/strings';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: number; message: string };

export function useApi() {
  const { signOut } = useAuth();

  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<ApiResult<T>> => {
      try {
        return { ok: true, data: await fn() };
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === 401) void signOut();
          // The backend's message is written for the user — pass it straight through.
          return { ok: false, code: e.code, message: e.message };
        }
        return { ok: false, code: 0, message: S.common.somethingWentWrong };
      }
    },
    [signOut],
  );
}
