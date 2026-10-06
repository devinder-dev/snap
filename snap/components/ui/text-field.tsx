import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string | null;
  inputRef?: React.RefObject<TextInput | null>;
};

export function TextField({
  label,
  value,
  onChangeText,
  error,
  secureTextEntry,
  inputRef,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View>
      <AppText variant="meta" color={Colors.textSecondary} style={styles.label}>
        {label}
      </AppText>

      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          Boolean(error) && styles.fieldError,
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={isPassword && !revealed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={Colors.textTertiary}
          accessibilityLabel={label}
          // The visible error is not announced on its own, so fold it into the hint.
          accessibilityHint={error ?? undefined}
          style={styles.input}
          {...rest}
        />

        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? S.password.hide : S.password.show}
            style={styles.reveal}
          >
            <IconSymbol
              name={revealed ? 'eye.slash.fill' : 'eye.fill'}
              size={18}
              color={Colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <AppText variant="meta" color={Colors.dangerText} style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/** Username inputs need the same four props everywhere; forgetting them is the
 *  classic "why did it capitalise my username" bug. */
export function UsernameField(props: TextFieldProps) {
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      autoComplete="username"
      textContentType="username"
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: Size.inputHeight,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
  },
  fieldFocused: { borderColor: Colors.ink },
  fieldError: { borderColor: Colors.danger },
  // 16px minimum, or iOS zooms the page on focus.
  input: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 0 },
  reveal: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: 6 },
});
