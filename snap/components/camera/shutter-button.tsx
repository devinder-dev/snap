import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Size } from '@/constants/design';
import { S } from '@/constants/strings';

export function ShutterButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const [pressed, setPressed] = useState(false);

  function handlePress() {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={S.camera.shutterA11y}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.ring, pressed && styles.ringPressed, disabled && styles.ringDisabled]}
    >
      <View style={[styles.inner, pressed && styles.innerPressed]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: Size.shutter,
    height: Size.shutter,
    // Numeric, never '50%' — percentage radii crash on Android API 35 in RN 0.81.
    borderRadius: Size.shutter / 2,
    borderWidth: 5,
    borderColor: Colors.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPressed: { borderColor: Colors.accent },
  ringDisabled: { borderColor: 'rgba(255,255,255,0.4)' },
  inner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  innerPressed: { transform: [{ scale: 0.86 }] },
});
