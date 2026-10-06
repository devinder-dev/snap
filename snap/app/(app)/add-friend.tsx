import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/ui/screen-header';
import { UsernameField } from '@/components/ui/text-field';
import { Colors, Radius, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { useApi } from '@/hooks/use-api';
import { addFriend, type AddFriendResponse } from '@/lib/api';
import { validateUsername } from '@/lib/validation';

export default function AddFriendScreen() {
  const call = useApi();

  const [username, setUsername] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<{ lead: string; detail: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ status: AddFriendResponse['status']; username: string } | null>(null);

  async function handleSubmit() {
    const invalid = validateUsername(username);
    if (invalid) {
      setFieldError(invalid);
      return;
    }

    const target = username.trim();
    setFieldError(null);
    setServerError(null);
    setSubmitting(true);

    const res = await call(() => addFriend(target));
    setSubmitting(false);

    if (!res.ok) {
      setServerError({
        // 400 here is "that's you"; 404 is "no such person" — different lead-ins.
        lead: res.code === 400 ? S.addFriend.selfLead : S.addFriend.notFoundLead,
        detail: res.message,
      });
      return;
    }

    // Rendered straight from the response — the contract explicitly says not to
    // refetch the list here. /chats picks up the change when it regains focus.
    setResult({ status: res.data.status, username: target });

    if (process.env.EXPO_OS === 'ios') {
      // The two outcomes differ in feel as well as in sight.
      if (res.data.status === 'friends') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  }

  function reset() {
    setResult(null);
    setUsername('');
    setServerError(null);
    setFieldError(null);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title={S.addFriend.title} onBack={() => router.back()} backIcon="xmark" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {result ? <ResultCard status={result.status} username={result.username} onAddMore={reset} /> : (
            <>
              <AppText variant="body" color={Colors.textSecondary} style={styles.body}>
                {S.addFriend.body}
              </AppText>

              <View style={styles.bannerSlot}>
                <ErrorBanner
                  message={serverError?.lead ?? null}
                  detail={serverError?.detail}
                  onDismiss={() => setServerError(null)}
                />
              </View>

              <UsernameField
                label={S.addFriend.usernameLabel}
                placeholder={S.addFriend.usernamePlaceholder}
                value={username}
                onChangeText={setUsername}
                error={fieldError}
                editable={!submitting}
                autoFocus
                returnKeyType="send"
                onSubmitEditing={() => void handleSubmit()}
              />

              <Button
                label={S.addFriend.submit}
                onPress={() => void handleSubmit()}
                loading={submitting}
                fullWidth
                style={styles.submit}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The two outcomes are graded, so they differ on seven independent axes: card
 * colour, ring style (solid vs dashed), badge glyph, headline, body copy, primary
 * action and haptic. Two of those are non-colour, so the distinction survives
 * greyscale.
 */
function ResultCard({
  status,
  username,
  onAddMore,
}: {
  status: AddFriendResponse['status'];
  username: string;
  onAddMore: () => void;
}) {
  const isFriends = status === 'friends';

  return (
    <View style={[styles.card, { backgroundColor: isFriends ? Colors.receivedBg : Colors.pendingBg }]}>
      <View style={styles.avatarWrap}>
        <Avatar username={username} size={72} ring={isFriends ? 'received' : 'pendingDashed'} />
        <View style={styles.badge}>
          <IconSymbol
            name={isFriends ? 'checkmark.circle.fill' : 'clock.fill'}
            size={28}
            color={isFriends ? Colors.received : Colors.pending}
          />
        </View>
      </View>

      <AppText variant="title2" center style={styles.cardTitle}>
        {isFriends ? S.addFriend.friendsTitle : S.addFriend.pendingTitle}
      </AppText>

      <AppText variant="body" color={Colors.textSecondary} center style={styles.cardBody}>
        {isFriends ? S.addFriend.friendsBody(username) : S.addFriend.pendingBody(username)}
      </AppText>

      <Button
        label={isFriends ? S.addFriend.friendsPrimary : S.addFriend.pendingPrimary}
        fullWidth
        onPress={() =>
          isFriends
            ? router.replace({ pathname: '/chat/[username]', params: { username } })
            : router.back()
        }
        style={styles.cardPrimary}
      />
      <Button label={S.addFriend.addMore} variant="ghost" fullWidth onPress={onAddMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  body: { marginBottom: 20 },
  bannerSlot: { marginBottom: Spacing.lg },
  submit: { marginTop: 20 },
  card: { alignItems: 'center', borderRadius: Radius.lg, paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.xl },
  avatarWrap: { marginBottom: Spacing.lg },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { marginBottom: Spacing.sm },
  cardBody: { marginBottom: Spacing.xl },
  cardPrimary: { marginBottom: Spacing.sm },
});
