import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Colors, Radius, Shadow, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

export type ToastData = {
  /** Changes for every toast, so a second one from the same person still re-animates. */
  id: number;
  title: string;
  body?: string;
  /** Shows their avatar. */
  username?: string;
  onPress?: () => void;
};

const VISIBLE_MS = 3500;

/** One at a time, top of the screen. A newer toast simply replaces the current one. */
export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return;
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility([toast.title, toast.body].filter(Boolean).join('. '));
    }
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    // The host stays mounted even with no toast: if it unmounted together with
    // the card, the card's exit animation would never get to run.
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + Spacing.sm }]}>
      {toast ? (
        <Animated.View key={toast.id} entering={FadeInUp} exiting={FadeOutUp} style={styles.card}>
          <Pressable
            onPress={() => {
              onDismiss();
              toast.onPress?.();
            }}
            disabled={!toast.onPress}
            accessibilityRole={toast.onPress ? 'button' : 'text'}
            accessibilityLiveRegion="polite"
            style={styles.pressable}
          >
            {toast.username ? <Avatar username={toast.username} size={36} /> : null}
            <View style={styles.text}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {toast.title}
              </AppText>
              {toast.body ? (
                <AppText variant="meta" color={Colors.textSecondary} numberOfLines={2}>
                  {toast.body}
                </AppText>
              ) : null}
            </View>
          </Pressable>
          <IconButton
            name="xmark"
            onPress={onDismiss}
            accessibilityLabel={S.toast.dismissA11y}
            size={32}
            glyphSize={16}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: Spacing.md, right: Spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.separator,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    ...Shadow.float,
  },
  pressable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  text: { flex: 1 },
});
