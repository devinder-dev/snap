import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Shadow, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

type PhotoPreviewProps = {
  photoUri: string;
  onDiscard: () => void;
  onSend: (caption: string) => void;
};

const MAX_CAPTION = 120;

export function PhotoPreview({ photoUri, onDiscard, onSend }: PhotoPreviewProps) {
  const insets = useSafeAreaInsets();

  const [caption, setCaption] = useState('');
  const [captionVisible, setCaptionVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  /**
   * Deliberately not KeyboardAvoidingView: `padding` shrinks the photo and
   * `position` translates it. Only the caption bar should move.
   */
  useEffect(() => {
    // The `Will` events do not fire on Android.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      // Under edge-to-edge on Android this height includes the nav-bar inset,
      // which is already accounted for below — subtract it or the bar floats high.
      const raw = e.endCoordinates.height;
      setKeyboardHeight(Platform.OS === 'android' ? Math.max(0, raw - insets.bottom) : raw);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom]);

  const captionBottom = keyboardHeight > 0 ? keyboardHeight + Spacing.md : insets.bottom + 96;

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: photoUri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        // No cross-fade: a just-taken photo should already be there.
        transition={0}
        cachePolicy="memory"
        // Without this a second capture briefly shows the first photo.
        recyclingKey={photoUri}
        accessibilityIgnoresInvertColors
      />

      {keyboardHeight > 0 ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessibilityElementsHidden />
      ) : null}

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <IconButton
          name="xmark"
          onPress={onDiscard}
          accessibilityLabel={S.preview.discardA11y}
          variant="overlay"
          glyphSize={24}
        />
        <IconButton
          name="text.bubble"
          onPress={() => setCaptionVisible((v) => !v)}
          accessibilityLabel={S.preview.captionToggleA11y}
          variant={captionVisible ? 'accent' : 'overlay'}
        />
      </View>

      {captionVisible || caption.length > 0 ? (
        <View style={[styles.captionBar, { bottom: captionBottom }]}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder={S.preview.captionPlaceholder}
            placeholderTextColor="rgba(255,255,255,0.6)"
            selectionColor={Colors.accent}
            // The one place a dark keyboard is correct, despite the light app.
            keyboardAppearance="dark"
            multiline
            maxLength={MAX_CAPTION}
            autoFocus={captionVisible}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
            style={styles.captionInput}
          />
          {caption.length > 100 ? (
            <AppText variant="caption" color="rgba(255,255,255,0.6)" style={styles.counter}>
              {caption.length}/{MAX_CAPTION}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.sendRow, { bottom: insets.bottom + Spacing.lg }]}>
        <Pressable
          onPress={() => onSend(caption.trim())}
          accessibilityRole="button"
          accessibilityLabel={S.preview.send}
          accessibilityHint={S.preview.sendA11y}
          style={({ pressed }) => [styles.sendPill, pressed && styles.sendPillPressed]}
        >
          <AppText variant="button" color={Colors.onAccent}>
            {S.preview.send}
          </AppText>
          <IconSymbol name="paperplane.fill" size={18} color={Colors.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.ink },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: Colors.scrim,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  captionInput: {
    color: Colors.onDark,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
  },
  counter: { position: 'absolute', right: Spacing.md, bottom: 4 },
  sendRow: { position: 'absolute', left: 0, right: 0, paddingHorizontal: Spacing.lg, alignItems: 'flex-end' },
  sendPill: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: 26,
    backgroundColor: Colors.accent,
    // A photo can be pale yellow — the dark stroke keeps the pill's edge readable.
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.85)',
    ...Shadow.float,
  },
  sendPillPressed: { transform: [{ scale: 0.98 }], backgroundColor: Colors.accentPressed },
});

export default PhotoPreview;
