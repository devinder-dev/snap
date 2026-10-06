import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

type ErrorBannerProps = {
  /** Our Swedish lead-in. Null hides the banner entirely. */
  message: string | null;
  /**
   * The backend's own `ApiError.message`, rendered verbatim on its own line.
   * Never interpolate this into `message` — the assignment requires the server's
   * wording to survive untouched.
   */
  detail?: string | null;
  tone?: 'error' | 'success' | 'info';
  onDismiss?: () => void;
};

const TONE = {
  error: { bg: Colors.dangerBg, border: '#F5C2BE', text: Colors.dangerText, icon: 'exclamationmark.triangle.fill' },
  success: { bg: Colors.successBg, border: '#B7E4CA', text: Colors.successText, icon: 'checkmark.circle.fill' },
  info: { bg: Colors.receivedBg, border: '#B8E6F7', text: Colors.receivedText, icon: 'clock.fill' },
} as const;

export function ErrorBanner({ message, detail, tone = 'error', onDismiss }: ErrorBannerProps) {
  useEffect(() => {
    // Android honours accessibilityLiveRegion; iOS has no equivalent, so announce.
    if (message && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility([message, detail].filter(Boolean).join('. '));
    }
  }, [message, detail]);

  if (!message) return null;

  const t = TONE[tone];

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.container, { backgroundColor: t.bg, borderColor: t.border }]}
    >
      <IconSymbol name={t.icon} size={20} color={t.text} />

      <View style={styles.text}>
        <AppText variant="bodyStrong" color={t.text}>
          {message}
        </AppText>
        {detail ? (
          <AppText variant="meta" color={t.text} style={styles.detail}>
            {detail}
          </AppText>
        ) : null}
      </View>

      {onDismiss ? (
        <IconButton
          name="xmark"
          onPress={onDismiss}
          accessibilityLabel={S.a11y.dismissBanner}
          size={28}
          glyphSize={16}
          color={t.text}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  text: { flex: 1 },
  detail: { marginTop: 2 },
});
