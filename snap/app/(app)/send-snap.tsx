import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendRow } from '@/components/friend-row';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListSeparator } from '@/components/ui/list-separator';
import { LoadingState } from '@/components/ui/loading-state';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Colors, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { useApi } from '@/hooks/use-api';
import { getFriends, sendSnap, type ApiFriend } from '@/lib/api';
import { mimeTypeFor } from '@/lib/mime';

export default function SendSnapScreen() {
  const insets = useSafeAreaInsets();
  const call = useApi();
  const { uri, format, text } = useLocalSearchParams<{ uri: string; format?: string; text?: string }>();

  const [friends, setFriends] = useState<ApiFriend[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Load once on mount — this is a modal, it does not need focus refetching.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await call(() => getFriends());
      if (cancelled) return;
      if (res.ok) setFriends(res.data);
      else setLoadError(res.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [call]);

  const toggle = useCallback((username: string) => {
    setSelected((current) =>
      current.includes(username) ? current.filter((u) => u !== username) : [...current, username],
    );
  }, []);

  const sections = useMemo(() => {
    const all = friends ?? [];
    const q = query.trim().toLowerCase();
    const matching = q ? all.filter((f) => f.username.toLowerCase().includes(q)) : all;

    return [
      { key: 'selectable', title: S.sendTo.selectableSection, data: matching.filter((f) => f.mutual) },
      // Shown but locked. Hiding them makes people think a friend disappeared.
      { key: 'pending', title: S.sendTo.pendingSection, data: matching.filter((f) => !f.mutual) },
    ].filter((section) => section.data.length > 0);
  }, [friends, query]);

  async function handleSend() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    setSendError(null);

    const res = await call(() =>
      sendSnap({
        recipients: selected,
        photo: { uri, mimetype: mimeTypeFor(format, uri) },
        text: text?.trim() ? text.trim() : undefined,
      }),
    );

    // Always clears, so a failure can never strand the button in a spinner.
    setSending(false);

    if (!res.ok) {
      // Stay on the screen with the selection intact — the user should be able to
      // deselect whoever was rejected and try again.
      setSendError(res.message);
      if (process.env.EXPO_OS === 'ios') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    if (process.env.EXPO_OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    // Pops both send-snap and preview, landing back on the live camera.
    router.dismissAll();
  }

  const sendLabel =
    selected.length === 0
      ? S.sendTo.chooseRecipients
      : selected.length === 1
        ? S.sendTo.sendOne
        : S.sendTo.sendMany(selected.length);

  const isEmpty = friends !== null && friends.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader
        title={S.sendTo.title}
        onBack={() => router.back()}
        backIcon="xmark"
        right={
          selected.length > 0 ? (
            <Button label={S.sendTo.clear} variant="ghost" size="sm" haptic={false} onPress={() => setSelected([])} />
          ) : null
        }
      />

      {friends === null && !loadError ? (
        <LoadingState label={S.chats.loading} />
      ) : isEmpty ? (
        <EmptyState icon="person.2.fill" title={S.sendTo.emptyTitle} body={S.sendTo.emptyBody} />
      ) : (
        <>
          <View style={styles.search}>
            <IconSymbol name="magnifyingglass" size={18} color={Colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={S.sendTo.searchPlaceholder}
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={S.sendTo.searchPlaceholder}
              style={styles.searchInput}
            />
          </View>

          {selected.length > 0 ? (
            // Wraps rather than scrolls: a horizontal scroller here would fight the
            // pager gesture, and selections are typically only a handful.
            <View style={styles.chips}>
              {selected.map((username) => (
                <Chip
                  key={username}
                  label={username}
                  avatarUsername={username}
                  onRemove={() => toggle(username)}
                  removeLabel={S.sendTo.removeChipA11y(username)}
                />
              ))}
            </View>
          ) : null}

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.username}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={ListSeparator}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              loadError ? (
                <View style={styles.banner}>
                  <ErrorBanner message={S.chats.loadFailed} detail={loadError} />
                </View>
              ) : null
            }
            renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
            renderItem={({ item }) => (
              <FriendRow
                username={item.username}
                mutual={item.mutual}
                subtitle={item.mutual ? undefined : S.sendTo.pendingRowSubtitle}
                selectable
                selected={selected.includes(item.username)}
                onPress={() => toggle(item.username)}
              />
            )}
          />

          <View style={[styles.sendBar, { paddingBottom: insets.bottom + Spacing.md }]}>
            {sendError ? (
              <View style={styles.banner}>
                <ErrorBanner message={S.sendTo.sendFailed} detail={sendError} onDismiss={() => setSendError(null)} />
              </View>
            ) : null}
            <Button
              label={sendLabel}
              onPress={() => void handleSend()}
              loading={sending}
              disabled={selected.length === 0}
              fullWidth
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 0 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    maxHeight: 88,
    overflow: 'hidden',
  },
  listContent: { paddingBottom: Spacing.lg },
  banner: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  sendBar: {
    borderTopWidth: Size.hairline,
    borderTopColor: Colors.separator,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
