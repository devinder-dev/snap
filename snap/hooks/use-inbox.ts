/**
 * Snaps waiting for you, kept live.
 *
 * Refetched on every focus without a throttle: it's one cheap query, and the
 * common way back to a screen using this is closing the snap viewer, where the
 * list MUST drop what was just viewed — a viewed snap is gone server-side, and
 * tapping it again would be a 404.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useRealtime } from '@/contexts/realtime-context';
import { useApi } from '@/hooks/use-api';
import { getInbox, type ApiSnapSummary } from '@/lib/api';

export function useInbox() {
  const call = useApi();
  const [snaps, setSnaps] = useState<ApiSnapSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await call(() => getInbox());
    if (res.ok) {
      setSnaps(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
  }, [call]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useRealtime('snap_received', (event) => {
    setSnaps((current) =>
      current.some((snap) => snap.id === event.snap_id)
        ? current
        : [
            {
              id: event.snap_id,
              type: event.type,
              sender_username: event.sender_username,
              created_at: event.created_at,
              expires_at: event.expires_at,
            },
            ...current,
          ],
    );
  });

  useRealtime('connected', () => void load());

  // The server stops serving a snap at expires_at; don't offer one it would refuse.
  const now = Date.now();
  const live = snaps.filter((snap) => new Date(snap.expires_at).getTime() > now);

  return { snaps: live, error, reload: load };
}

/** Inbox grouped by sender, oldest snap first within each — the order they're viewed in. */
export function groupBySender(snaps: ApiSnapSummary[]): { sender: string; ids: string[]; latest: string }[] {
  const groups = new Map<string, ApiSnapSummary[]>();
  for (const snap of snaps) {
    groups.set(snap.sender_username, [...(groups.get(snap.sender_username) ?? []), snap]);
  }

  return [...groups.entries()]
    .map(([sender, list]) => {
      const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { sender, ids: sorted.map((snap) => snap.id), latest: sorted[sorted.length - 1].created_at };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest));
}
