/**
 * Session state for the whole app.
 *
 * Two rules worth keeping in mind when reading this file:
 *
 * 1. Tokens are pushed into `lib/api` BEFORE the user is set, so no protected
 *    screen can ever render with a live navigation guard and a dead token.
 * 2. Nothing here navigates. Signing in and out only changes `user`; the
 *    `Stack.Protected` guards in `app/_layout.tsx` do the routing. Calling
 *    `router.replace` as well would navigate twice and flash.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { login as apiLogin, register as apiRegister, setTokens, type ApiUser } from '@/lib/api';
import { clearSession, loadSession, saveSession } from '@/lib/auth-storage';

type AuthContextValue = {
  user: ApiUser | null;
  /** True while the stored session is being restored on boot. */
  isLoading: boolean;
  /** Throws ApiError on failure — the calling screen shows `e.message` verbatim. */
  signIn: (username: string, password: string) => Promise<void>;
  /** Throws ApiError on failure. */
  signUp: (username: string, password: string) => Promise<void>;
  /** Never throws. */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore the stored session once, at startup.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await loadSession();
        if (cancelled || !session) return;
        setTokens(session.tokens); // token first...
        setUser(session.user); //     ...then the user
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    setTokens(res.tokens);
    await saveSession({ tokens: res.tokens, user: res.user });
    setUser(res.user);
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    const res = await apiRegister(username, password);
    setTokens(res.tokens);
    await saveSession({ tokens: res.tokens, user: res.user });
    setUser(res.user);
  }, []);

  // Stable identity matters: `useApi` depends on it, and `useFocusEffect` callbacks
  // depend on `useApi`. An unstable signOut would re-run those effects every render.
  const signOut = useCallback(async () => {
    setTokens(null);
    setUser(null);
    await clearSession();
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, signIn, signUp, signOut }),
    [user, isLoading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
