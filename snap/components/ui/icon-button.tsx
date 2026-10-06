import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Size } from '@/constants/design';

type IconButtonProps = {
  name: IconSymbolName;
  onPress: () => void;
  /** Required — an icon-only control is invisible to a screen reader without it. */
  accessibilityLabel: string;
  size?: number;
  glyphSize?: number;
  variant?: 'plain' | 'overlay' | 'filled' | 'accent';
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = Size.control,
  glyphSize = 22,
  variant = 'plain',
  color,
  disabled,
  style,
}: IconButtonProps) {
  const glyphColor =
    color ??
    (variant === 'overlay' ? Colors.onDark : variant === 'accent' ? Colors.onAccent : Colors.text);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={size < Size.touch ? (Size.touch - size) / 2 : 0}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: size / 2 },
        variant === 'overlay' && styles.overlay,
        variant === 'filled' && styles.filled,
        variant === 'accent' && styles.accent,
        pressed && variant === 'overlay' && styles.overlayPressed,
        pressed && (variant === 'filled' || variant === 'accent') && styles.filledPressed,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <IconSymbol name={name} size={glyphSize} color={glyphColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  overlay: { backgroundColor: Colors.control },
  overlayPressed: { backgroundColor: Colors.controlPressed },
  filled: { backgroundColor: Colors.surfaceAlt },
  accent: { backgroundColor: Colors.accent, borderWidth: 1.5, borderColor: Colors.ink },
  filledPressed: { backgroundColor: Colors.surfacePressed },
  pressed: { transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.4 },
});
