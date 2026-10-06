import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TextField, UsernameField } from '@/components/ui/text-field';
import { Colors, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api';
import { validateCredentials } from '@/lib/validation';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const passwordRef = useRef<TextInput>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const invalid = validateCredentials(username, password);
    if (invalid) {
      // Our own validation never goes through the banner — that slot is the server's.
      setFieldError(invalid);
      setServerError(null);
      return;
    }

    setFieldError(null);
    setServerError(null);
    setSubmitting(true);
    try {
      // Not useApi: a 401 here means "wrong password", not "your session died".
      await signIn(username.trim(), password);
      // No navigation — setting the user flips the guard in app/_layout.tsx.
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : S.common.somethingWentWrong);
      if (process.env.EXPO_OS === 'ios') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        // Android's adjustResize already handles this; forcing padding double-shifts.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.brand}>
            <IconSymbol name="camera.fill" size={44} color={Colors.onAccent} />
          </View>

          <AppText variant="title" center>
            {S.login.title}
          </AppText>
          <AppText variant="body" color={Colors.textSecondary} center style={styles.subtitle}>
            {S.login.subtitle}
          </AppText>

          {/* Line 1 is ours, line 2 is the backend's message, verbatim. */}
          <View style={styles.bannerSlot}>
            <ErrorBanner
              message={serverError ? S.login.failed : null}
              detail={serverError}
              onDismiss={() => setServerError(null)}
            />
          </View>

          <UsernameField
            label={S.fields.usernameLabel}
            placeholder={S.fields.usernamePlaceholder}
            value={username}
            onChangeText={setUsername}
            error={fieldError}
            editable={!submitting}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <View style={styles.gap} />

          <TextField
            inputRef={passwordRef}
            label={S.fields.passwordLabel}
            placeholder={S.fields.passwordPlaceholder}
            value={password}
            onChangeText={setPassword}
            error={fieldError}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            editable={!submitting}
            returnKeyType="go"
            onSubmitEditing={() => void handleSubmit()}
          />

          <Button
            label={S.login.submit}
            onPress={() => void handleSubmit()}
            loading={submitting}
            fullWidth
            style={styles.submit}
          />

          <View style={styles.footer}>
            <AppText variant="body" color={Colors.textSecondary}>
              {S.login.noAccount}{' '}
            </AppText>
            <Link href="/register" replace style={styles.linkHit}>
              <AppText variant="bodyStrong" style={styles.link}>
                {S.login.goToRegister}
              </AppText>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xxxl, paddingBottom: Spacing.xl },
  brand: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.xl,
  },
  subtitle: { marginTop: Spacing.sm, marginBottom: Spacing.xxl },
  bannerSlot: { marginBottom: Spacing.lg },
  gap: { height: Spacing.lg },
  submit: { marginTop: Spacing.xl },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  link: { textDecorationLine: 'underline' },
  linkHit: { paddingVertical: 8, paddingHorizontal: 4 },
});
