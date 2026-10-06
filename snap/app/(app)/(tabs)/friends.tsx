import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmRemoveFriend } from '@/components/friend-actions';
import { FriendRow } from '@/components/friend-row';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LargeTitle } from '@/components/ui/large-title';
import { ListSeparator } from '@/components/ui/list-separator';
import { LoadingState } from '@/components/ui/loading-state';
import { SectionHeader } from '@/components/ui/section-header';
import { Colors, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { useApi } from '@/hooks/use-api';
import { useFriends } from '@/hooks/use-friends';
import { deleteFriend, type ApiFriend } from '@/lib/api';

/** Roster management, as opposed to /chats which is conversations. */
export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const call = useApi();
  const { friends, setFriends, loading, refreshing, error, setError, reload, refresh } = useFriends();

  const [actionError, setActionError] = useState<string | null>(null);

  const removeFriend = useCallback(
    (friend: ApiFriend) => {
      confirmRemoveFriend(friend.username, friend.mutual, () => {
        void (async () => {
          const previous = friends ?? [];
          setFriends(previous.filter((f) => f.username !== friend.username));

          const res = await call(() => deleteFriend(friend.username));
          if (!res.ok) {
            setFriends(previous);
            setActionError(res.message);
            return;
          }
          void reload();
        })();
      });
    },
    [call, friends, reload, setFriends],
  );

  const mutualFriends = friends?.filter((f) => f.mutual) ?? [];
  const pendingFriends = friends?.filter((f) => !f.mutual) ?? [];

  const sections = [
    { key: 'pending', title: S.friends.sentRequestsSection, data: pendingFriends },
    { key: 'mutual', title: S.friends.myFriendsSection, data: mutualFriends },
  ].filter((section) => section.data.length > 0);

  const isEmpty = friends !== null && friends.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LargeTitle title={S.friends.title} />

      {loading && friends === null ? (
        <LoadingState label={S.chats.loading} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.username}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={ListSeparator}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Size.pagerBar + insets.bottom + Spacing.xl },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.ink} colors={[Colors.ink]} />
          }
          ListHeaderComponent={
            <View>
              {error ? (
                <View style={styles.banner}>
                  <ErrorBanner message={S.chats.loadFailed} detail={error} onDismiss={() => setError(null)} />
                </View>
              ) : null}
              {actionError ? (
                <View style={styles.banner}>
                  <ErrorBanner
                    message={S.friend.deleteFailed}
                    detail={actionError}
                    onDismiss={() => setActionError(null)}
                  />
                </View>
              ) : null}

              <Pressable
                onPress={() => router.push('/add-friend')}
                accessibilityRole="button"
                accessibilityLabel={S.friends.addRow}
                style={({ pressed }) => [styles.addRow, pressed && styles.addRowPressed]}
              >
                <View style={styles.addIcon}>
                  <IconSymbol name="plus" size={24} color={Colors.onAccent} />
                </View>
                <AppText variant="bodyStrong" style={styles.addLabel}>
                  {S.friends.addRow}
                </AppText>
                <IconSymbol name="chevron.right" size={20} color={Colors.textTertiary} />
              </Pressable>
            </View>
          }
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item }) => (
            <FriendRow
              username={item.username}
              mutual={item.mutual}
              onPress={() => router.push({ pathname: '/chat/[username]', params: { username: item.username } })}
              onLongPress={() => removeFriend(item)}
            />
          )}
          ListEmptyComponent={
            isEmpty ? (
              <View style={styles.empty}>
                <EmptyState icon="person.2.fill" title={S.friends.emptyTitle} body={S.friends.emptyBody} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { flexGrow: 1 },
  banner: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  addRow: {
    height: Size.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  addRowPressed: { backgroundColor: Colors.surfacePressed },
  addIcon: {
    width: Size.avatar,
    height: Size.avatar,
    borderRadius: Size.avatar / 2,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { flex: 1 },
  empty: { paddingTop: Spacing.xxxl, minHeight: 320 },
});
