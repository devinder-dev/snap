import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Radius, Size, Spacing } from '@/constants/design';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: IconSymbolName;
  /** Drops the black border on yellow — correct only against a near-black surface. */
  onDark?: boolean;
  haptic?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = { lg: Size.buttonLg, md: Size.buttonMd, sm: Size.buttonSm } as const;
const PAD_H = { lg: Spacing.xl, md: Spacing.lg, sm: 14 } as const;
const RADIUS = { lg: Radius.lg, md: Radius.md, sm: 18 } as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  onDark = false,
  haptic = true,
  accessibilityHint,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const contentColor = isDisabled
    ? Colors.disabledText
    : variant === 'primary'
      ? Colors.onAccent
      : variant === 'destructive'
        ? Colors.onDark
        : onDark
          ? Colors.onDark
          : Colors.text;

  function handlePress() {
    if (haptic && (variant === 'primary' || variant === 'destructive')) {
      // iOS-only: Android's generic vibration is a worse experience than none.
      if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={size === 'sm' ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], paddingHorizontal: PAD_H[size], borderRadius: RADIUS[size] },
        variant === 'primary' && styles.primary,
        // Yellow on white is 1.10:1 — the black stroke is what makes the edge visible.
        variant === 'primary' && !onDark && styles.primaryBorder,
        variant === 'secondary' && [styles.secondary, { borderColor: onDark ? Colors.onDark : Colors.ink }],
        variant === 'destructive' && styles.destructive,
        variant === 'ghost' && styles.ghost,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {/* Kept in the tree at zero opacity so the button never changes width while loading. */}
      <View style={[styles.content, loading && styles.hidden]}>
        {icon ? <IconSymbol name={icon} size={18} color={contentColor} style={styles.icon} /> : null}
        <AppText variant="button" color={contentColor}>
          {label}
        </AppText>
      </View>
      {loading ? <ActivityIndicator color={contentColor} style={StyleSheet.absoluteFill} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hidden: { opacity: 0 },
  icon: { marginRight: 0 },
  primary: { backgroundColor: Colors.accent },
  primaryBorder: { borderWidth: 1.5, borderColor: Colors.ink },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5 },
  destructive: { backgroundColor: Colors.danger },
  ghost: { backgroundColor: 'transparent' },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { backgroundColor: Colors.disabledBg, borderColor: Colors.disabledBg },
  pressed: { transform: [{ scale: 0.98 }] },
});
