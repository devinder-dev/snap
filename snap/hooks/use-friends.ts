/**
 * Shared loading of the friend list + incoming requests.
 *
 * Both /chats and /friends need exactly this, and duplicating the focus-refetch
 * logic in two screens is how the two lists end up disagreeing with each other.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useRealtime } from '@/contexts/realtime-context';
import { useApi } from '@/hooks/use-api';
import { getFriendRequests, getFriends, type ApiFriend, type ApiFriendRequest } from '@/lib/api';

/** With a pager, focus fires on every drag-settle — without this the list refetches
 *  every time the user swipes past. */
const REFETCH_THROTTLE_MS = 5000;

export function useFriends() {
  const call = useApi();

  const [friends, setFriends] = useState<ApiFriend[] | null>(null);
  const [requests, setRequests] = useState<ApiFriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastFetchedAt = useRef(0);

  const load = useCallback(
    async (options?: { force?: boolean; refreshing?: boolean }) => {
      if (!options?.force && Date.now() - lastFetchedAt.current < REFETCH_THROTTLE_MS) return;
      lastFetchedAt.current = Date.now();

      if (options?.refreshing) setRefreshing(true);

      const [friendsRes, requestsRes] = await Promise.all([
        call(() => getFriends()),
        call(() => getFriendRequests()),
      ]);

      if (friendsRes.ok) {
        setFriends(friendsRes.data);
        setError(null);
      } else {
        setError(friendsRes.message);
      }

      // A failing requests call must not blank out a friend list that loaded fine.
      if (requestsRes.ok) setRequests(requestsRes.data);

      setLoading(false);
      setRefreshing(false);
    },
    [call],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        await load();
        // Guards against a slow response landing after the screen is gone, and
        // against an older response overwriting a newer one on a fast
        // chats -> add-friend -> chats round trip.
        if (cancelled) return;
      })();

      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  // Someone added you, or accepted — either way both lists change. Forced,
  // because the throttle is for swipe-focus spam, not for real news.
  useRealtime('friend_request', () => void load({ force: true }));
  useRealtime('friend_accepted', () => void load({ force: true }));
  useRealtime('connected', () => void load({ force: true }));

  return {
    friends,
    requests,
    setFriends,
    setRequests,
    loading,
    refreshing,
    error,
    setError,
    reload: useCallback(() => load({ force: true }), [load]),
    refresh: useCallback(() => load({ force: true, refreshing: true }), [load]),
  };
}
