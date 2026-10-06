import { StyleSheet, Text, type TextProps } from 'react-native';

import { Colors, Type, type TypeVariant } from '@/constants/design';

type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
};

/**
 * Dynamic Type is capped rather than disabled: `allowFontScaling={false}` breaks
 * accessibility, but an unbounded multiplier breaks the fixed-height pills and
 * buttons. Capping here means no call site can forget.
 */
const TIGHT_VARIANTS: TypeVariant[] = ['button', 'caption', 'overline'];

export function AppText({ variant = 'body', color, center, style, ...rest }: AppTextProps) {
  return (
    <Text
      maxFontSizeMultiplier={TIGHT_VARIANTS.includes(variant) ? 1.2 : 1.4}
      style={[
        styles.base,
        Type[variant],
        color ? { color } : null,
        center ? styles.center : null,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: Colors.text },
  center: { textAlign: 'center' },
});
