import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LoadingState } from '@/components/ui/loading-state';
import { Colors, Radius, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { useAuth } from '@/contexts/auth-context';
import { useRealtime } from '@/contexts/realtime-context';
import { useApi } from '@/hooks/use-api';
import { groupBySender, useInbox } from '@/hooks/use-inbox';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { getMessages, sendMessage, type ApiMessage } from '@/lib/api';
import { formatClock } from '@/lib/time';

/** Must match MESSAGE_PAGE_SIZE on the server: a full page means there may be more. */
const PAGE_SIZE = 50;
const MAX_LENGTH = 2000;
/** Messages from the same person closer together than this share one timestamp. */
const GROUP_GAP_MS = 5 * 60 * 1000;

/**
 * A message as the list holds it. Confirmed ones are keyed by their server id;
 * one still sending (or failed) has no id yet and is keyed locally.
 */
type ChatItem = ApiMessage & { key: string; status?: 'sending' | 'failed' };

let localKeyCounter = 0;

/** Index of the last item matching, or -1. (Array.findLastIndex, without relying on the engine having it.) */
function lastIndexWhere<T>(list: T[], match: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) return i;
  return -1;
}

/**
 * Newest first, like the API. Pending items stay on top — they are the latest
 * thing the user did — and confirmed ones are de-duplicated by id, because the
 * same message can arrive from the HTTP response, the socket echo and a
 * refetch, in any order.
 */
function mergeMessages(current: ChatItem[], incoming: ApiMessage[]): ChatItem[] {
  const pending = current.filter((item) => item.status);
  const confirmed = new Map<string, ChatItem>();
  for (const item of current) if (!item.status) confirmed.set(item.id, item);
  for (const message of incoming) confirmed.set(message.id, { ...message, key: message.id });

  const sorted = [...confirmed.values()].sort((a, b) => Number(b.id) - Number(a.id));
  return [...pending, ...sorted];
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const call = useApi();
  const { user } = useAuth();
  const me = user?.username ?? '';
  const { username } = useLocalSearchParams<{ username: string }>();
  const keyboardVisible = useKeyboardVisible();

  const { snaps } = useInbox();
  const waitingSnaps = groupBySender(snaps).find((group) => group.sender === username);

  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  // A page request that lands after a newer one must not win.
  const loadingMoreRef = useRef(false);

  const loadLatest = useCallback(async () => {
    const res = await call(() => getMessages(username));
    if (res.ok) {
      setItems((current) => mergeMessages(current ?? [], res.data));
      setLoadError(null);
      return res.data.length;
    }
    setLoadError(res.message);
    setItems((current) => current ?? []);
    return null;
  }, [call, username]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const count = await loadLatest();
      if (!cancelled && count !== null) setHasMore(count === PAGE_SIZE);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLatest]);

  // Anything sent while the socket was down was never pushed.
  useRealtime('connected', () => void loadLatest());

  useRealtime('message_received', (message) => {
    const inThisChat =
      (message.sender_username === username && message.recipient_username === me) ||
      (message.sender_username === me && message.recipient_username === username);
    if (!inThisChat) return;

    setItems((current) => {
      let list = current ?? [];
      // Our own echo can beat the HTTP response back. Swap it for the oldest
      // matching pending bubble so the message never shows twice.
      if (message.sender_username === me) {
        const pendingIndex = lastIndexWhere(list, (item) => item.status === 'sending' && item.body === message.body);
        if (pendingIndex >= 0) list = list.filter((_, i) => i !== pendingIndex);
      }
      return mergeMessages(list, [message]);
    });
  });

  async function loadOlder() {
    if (!hasMore || loadingMoreRef.current || !items) return;
    const oldestIndex = lastIndexWhere(items, (item) => !item.status);
    if (oldestIndex < 0) return;
    const oldest = items[oldestIndex];

    loadingMoreRef.current = true;
    setLoadingMore(true);
    const res = await call(() => getMessages(username, oldest.id));
    loadingMoreRef.current = false;
    setLoadingMore(false);

    if (res.ok) {
      setItems((current) => mergeMessages(current ?? [], res.data));
      setHasMore(res.data.length === PAGE_SIZE);
    }
  }

  async function send(text: string, retryKey?: string) {
    const body = text.trim();
    if (!body) return;

    const key = retryKey ?? `local-${++localKeyCounter}`;
    const pending: ChatItem = {
      key,
      id: key,
      sender_username: me,
      recipient_username: username,
      body,
      created_at: new Date().toISOString(),
      status: 'sending',
    };
    setItems((current) => [pending, ...(current ?? []).filter((item) => item.key !== key)]);
    setSendError(null);

    const res = await call(() => sendMessage(username, body));

    if (!res.ok) {
      // Kept on screen, marked failed, tappable to retry — a message the user
      // typed must never silently disappear.
      setItems((current) => (current ?? []).map((item) => (item.key === key ? { ...item, status: 'failed' } : item)));
      setSendError(res.message);
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setItems((current) =>
      mergeMessages(
        (current ?? []).filter((item) => item.key !== key),
        [res.data],
      ),
    );
  }

  function handleSend() {
    const text = draft;
    if (!text.trim()) return;
    setDraft('');
    void send(text);
  }

  const renderItem = ({ item, index }: { item: ChatItem; index: number }) => {
    const mine = item.sender_username === me;
    // The list is newest first, so the message shown BELOW this one is index - 1.
    const below = items?.[index - 1];
    const lastInGroup =
      !below ||
      below.sender_username !== item.sender_username ||
      new Date(below.created_at).getTime() - new Date(item.created_at).getTime() > GROUP_GAP_MS;

    return (
      <MessageBubble
        item={item}
        mine={mine}
        showMeta={lastInGroup || item.status !== undefined}
        onRetry={() => void send(item.body, item.key)}
      />
    );
  };

  const canSend = draft.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <IconButton
          name="chevron.left"
          onPress={() => router.back()}
          accessibilityLabel={S.common.back}
          glyphSize={24}
        />
        <Avatar username={username} size={36} />
        <View style={styles.headerText}>
          <AppText variant="headline" numberOfLines={1}>
            {username}
          </AppText>
          <AppText variant="meta" color={Colors.textSecondary}>
            {S.chat.friendsSubtitle}
          </AppText>
        </View>
        <IconButton name="camera.fill" onPress={() => router.navigate('/')} accessibilityLabel={S.chat.cameraA11y} />
      </View>

      {waitingSnaps ? (
        <Pressable
          onPress={() =>
            router.push({ pathname: '/snap-viewer', params: { sender: username, ids: waitingSnaps.ids.join(',') } })
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.snapBanner, pressed && styles.snapBannerPressed]}
        >
          <View style={styles.snapSquare} />
          <AppText variant="bodyStrong" color={Colors.sentText} style={styles.snapBannerText}>
            {S.chat.newSnaps(waitingSnaps.ids.length)}
          </AppText>
          <IconSymbol name="chevron.right" size={18} color={Colors.sentText} />
        </Pressable>
      ) : null}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loadError ? (
          <View style={styles.banner}>
            <ErrorBanner message={S.chat.loadFailed} detail={loadError} onDismiss={() => setLoadError(null)} />
          </View>
        ) : null}

        {items === null ? (
          <LoadingState label={S.chat.loading} />
        ) : items.length === 0 ? (
          // Outside the FlatList on purpose: an inverted list flips its
          // ListEmptyComponent upside down.
          <EmptyState
            icon="bubble.left.and.bubble.right.fill"
            title={S.chat.emptyTitle}
            body={S.chat.emptyBody(username)}
          />
        ) : (
          <FlatList
            inverted
            data={items}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            // Inverted, so the "footer" renders at the top — where older messages load.
            ListFooterComponent={
              loadingMore ? <ActivityIndicator style={styles.more} color={Colors.textSecondary} /> : null
            }
          />
        )}

        {sendError ? (
          <View style={styles.banner}>
            <ErrorBanner message={S.chat.sendFailed} detail={sendError} onDismiss={() => setSendError(null)} />
          </View>
        ) : null}

        <View style={[styles.composer, { paddingBottom: (keyboardVisible ? 0 : insets.bottom) + Spacing.sm }]}>
          <IconButton
            name="camera.fill"
            onPress={() => router.navigate('/')}
            accessibilityLabel={S.chat.cameraA11y}
            size={40}
          />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={S.chat.composerPlaceholder}
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel={S.chat.composerPlaceholder}
            multiline
            maxLength={MAX_LENGTH}
            style={styles.input}
          />
          <IconButton
            name="paperplane.fill"
            onPress={handleSend}
            accessibilityLabel={S.chat.sendA11y}
            size={40}
            variant={canSend ? 'accent' : 'filled'}
            disabled={!canSend}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({
  item,
  mine,
  showMeta,
  onRetry,
}: {
  item: ChatItem;
  mine: boolean;
  showMeta: boolean;
  onRetry: () => void;
}) {
  const failed = item.status === 'failed';
  const meta = item.status === 'sending' ? S.chat.sending : failed ? S.chat.failedBubble : formatClock(item.created_at);

  return (
    <Pressable
      onPress={failed ? onRetry : undefined}
      disabled={!failed}
      accessibilityRole={failed ? 'button' : 'text'}
      accessibilityHint={failed ? S.chat.retryA11y : undefined}
      style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          item.status === 'sending' && styles.bubbleSending,
          failed && styles.bubbleFailed,
        ]}
      >
        <AppText variant="body">{item.body}</AppText>
      </View>
      {showMeta ? (
        <AppText variant="caption" color={failed ? Colors.dangerText : Colors.textSecondary} style={styles.meta}>
          {meta}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  header: {
    height: Size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: Size.hairline,
    borderBottomColor: Colors.separator,
  },
  headerText: { flex: 1 },
  snapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.sentBg,
  },
  snapBannerPressed: { opacity: 0.8 },
  snapBannerText: { flex: 1 },
  snapSquare: { width: 14, height: 14, borderRadius: 3, backgroundColor: Colors.sent },
  banner: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  listContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  more: { paddingVertical: Spacing.md },
  bubbleRow: { marginVertical: 2, maxWidth: '80%' },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  // Tinted fills rather than the saturated brand reds/blues: 16px text on those
  // fails contrast. The colour still says who sent it; the text stays black.
  bubble: { paddingHorizontal: 14, paddingVertical: Spacing.sm, borderRadius: Radius.xl },
  bubbleMine: { backgroundColor: Colors.sentBg, borderBottomRightRadius: Radius.xs },
  bubbleTheirs: { backgroundColor: Colors.surfaceAlt, borderBottomLeftRadius: Radius.xs },
  bubbleSending: { opacity: 0.6 },
  bubbleFailed: { borderWidth: 1, borderColor: Colors.danger },
  meta: { marginTop: 2, marginHorizontal: Spacing.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    borderTopWidth: Size.hairline,
    borderTopColor: Colors.separator,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.separator,
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: Colors.text,
  },
});
