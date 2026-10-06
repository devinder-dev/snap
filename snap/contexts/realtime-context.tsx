/**
 * One socket for the whole signed-in session, shared by every screen.
 *
 * Screens never touch the socket. They call `useRealtime(event, handler)`; this
 * provider connects when there is a user, disconnects on sign-out, and fans each
 * event out to whoever is listening. It also shows the in-app toast for events
 * the current screen isn't already displaying.
 *
 * Lives inside the (app) group, so it only ever mounts with a signed-in user.
 */
import { router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { Toast, type ToastData } from '@/components/ui/toast';
import { S } from '@/constants/strings';
import { useAuth } from '@/contexts/auth-context';
import { connectRealtime, type RealtimeEventName, type RealtimeEvents } from '@/lib/realtime';

type Handler<E extends RealtimeEventName> = (payload: RealtimeEvents[E]) => void;
type Subscribe = <E extends RealtimeEventName>(event: E, handler: Handler<E>) => () => void;

const RealtimeContext = createContext<Subscribe | null>(null);

/**
 * Run `handler` for every `event` while the calling component is mounted.
 * The handler may be a fresh closure on every render — the latest one is used,
 * without resubscribing.
 */
export function useRealtime<E extends RealtimeEventName>(event: E, handler: Handler<E>): void {
  const subscribe = useContext(RealtimeContext);
  if (!subscribe) throw new Error('useRealtime must be used inside <RealtimeProvider>');

  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => subscribe(event, (payload) => handlerRef.current(payload)), [subscribe, event]);
}

export function RealtimeProvider({ children }: PropsWithChildren) {
  const { user, signOut } = useAuth();
  const me = user?.username ?? null;

  // Read inside the socket callback, which must not be recreated (and the
  // socket reconnected) every time the user navigates.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const listeners = useRef(new Map<RealtimeEventName, Set<(payload: never) => void>>());
  const [toast, setToast] = useState<ToastData | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const subscribe = useCallback<Subscribe>((event, handler) => {
    let handlers = listeners.current.get(event);
    if (!handlers) {
      handlers = new Set();
      listeners.current.set(event, handlers);
    }
    const entry = handler as (payload: never) => void;
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  }, []);

  useEffect(() => {
    if (!me) return;

    const connection = connectRealtime({
      onEvent: (event, payload) => {
        listeners.current.get(event)?.forEach((handler) => (handler as Handler<typeof event>)(payload));

        const next = toastFor(event, payload, me, pathnameRef.current);
        if (next) setToast(next);
      },
      onUnauthorized: () => void signOut(),
    });

    return () => connection.close();
  }, [me, signOut]);

  return (
    <RealtimeContext.Provider value={subscribe}>
      <View style={styles.root}>
        {children}
        <Toast toast={toast} onDismiss={dismissToast} />
      </View>
    </RealtimeContext.Provider>
  );
}

let toastId = 0;

function openChat(username: string) {
  router.push({ pathname: '/chat/[username]', params: { username } });
}

/** What, if anything, to pop up for an event. Null when the screen already shows it. */
function toastFor<E extends RealtimeEventName>(
  event: E,
  payload: RealtimeEvents[E],
  me: string,
  pathname: string,
): ToastData | null {
  const id = ++toastId;

  switch (event) {
    case 'message_received': {
      const message = payload as RealtimeEvents['message_received'];
      // Our own echo, or a message for the chat that is already open.
      if (message.sender_username === me) return null;
      if (safeDecode(pathname) === `/chat/${message.sender_username}`) return null;
      return {
        id,
        title: message.sender_username,
        body: message.body,
        username: message.sender_username,
        onPress: () => openChat(message.sender_username),
      };
    }
    case 'snap_received': {
      const snap = payload as RealtimeEvents['snap_received'];
      return {
        id,
        title: S.toast.snapFrom(snap.sender_username),
        username: snap.sender_username,
        onPress: () => router.navigate('/chats'),
      };
    }
    case 'friend_request': {
      const request = payload as RealtimeEvents['friend_request'];
      return {
        id,
        title: S.toast.friendRequest(request.from),
        username: request.from,
        onPress: () => router.navigate('/chats'),
      };
    }
    case 'friend_accepted': {
      const accepted = payload as RealtimeEvents['friend_accepted'];
      return {
        id,
        title: S.toast.friendAccepted(accepted.username),
        username: accepted.username,
        onPress: () => openChat(accepted.username),
      };
    }
    case 'screenshot_taken': {
      const shot = payload as RealtimeEvents['screenshot_taken'];
      return { id, title: S.toast.screenshot(shot.by), username: shot.by };
    }
    default:
      return null;
  }
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
