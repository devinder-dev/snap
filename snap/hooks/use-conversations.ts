/**
 * The newest message with each person, for list previews. Kept live from the
 * socket, so the chats list reorders as messages arrive.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useRealtime } from '@/contexts/realtime-context';
import { useApi } from '@/hooks/use-api';
import { getConversations, type ApiMessage } from '@/lib/api';

export function useConversations() {
  const call = useApi();
  const { user } = useAuth();
  /** Other person's username -> newest message with them. */
  const [latest, setLatest] = useState<Record<string, ApiMessage>>({});

  const load = useCallback(async () => {
    const res = await call(() => getConversations());
    // A failed preview fetch is not worth a banner — the list is still usable
    // without previews, and the friends error banner covers a dead connection.
    if (!res.ok) return;
    setLatest(Object.fromEntries(res.data.map((c) => [c.username, c.last_message])));
  }, [call]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useRealtime('message_received', (message) => {
    const other = message.sender_username === user?.username ? message.recipient_username : message.sender_username;
    setLatest((current) => {
      const existing = current[other];
      if (existing && Number(existing.id) >= Number(message.id)) return current;
      return { ...current, [other]: message };
    });
  });

  useRealtime('connected', () => void load());

  return { latest, reload: load };
}
