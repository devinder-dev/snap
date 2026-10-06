import * as Haptics from 'expo-haptics';
import { router, useSegments } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

type TabName = 'map' | 'chats' | 'index' | 'friends';

type Slot = { name: TabName; href: '/map' | '/chats' | '/' | '/friends'; icon: IconSymbolName; label: string };

/** Left-to-right, matching the pager's declaration order so the bar teaches the gesture. */
const SLOTS: Slot[] = [
  { name: 'map', href: '/map', icon: 'map.fill', label: S.nav.map },
  { name: 'chats', href: '/chats', icon: 'bubble.left.fill', label: S.nav.chats },
  { name: 'index', href: '/', icon: 'camera.fill', label: S.nav.camera },
  { name: 'friends', href: '/friends', icon: 'person.2.fill', label: S.nav.friends },
];

export function PagerBar() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();

  // The segment right after "(tabs)" is the active page. When a modal is pushed on
  // the parent Stack there is no "(tabs)" segment — the bar is covered by the modal
  // at that point, so falling back to the anchor is purely cosmetic.
  const tabsIndex = segments.indexOf('(tabs)' as never);
  const active = (tabsIndex >= 0 ? (segments[tabsIndex + 1] as TabName | undefined) : undefined) ?? 'index';

  const overCamera = active === 'index';

  function go(slot: Slot) {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // navigate, not push — pushing would stack pager pages on top of each other.
    router.navigate(slot.href);
  }

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { height: Size.pagerBar + insets.bottom, paddingBottom: insets.bottom },
        overCamera ? styles.barOverCamera : styles.barOnLight,
      ]}
    >
      {SLOTS.map((slot) => {
        const isActive = slot.name === active;
        const isCamera = slot.name === 'index';

        // Over a photo the glyphs need their own backdrop or white-on-white vanishes.
        const glyphColor = overCamera
          ? isActive
            ? Colors.onDark
            : Colors.onDarkMuted
          : isActive
            ? Colors.ink
            : Colors.textTertiary;

        return (
          <Pressable
            key={slot.name}
            onPress={() => go(slot)}
            accessibilityRole="tab"
            accessibilityLabel={slot.label}
            accessibilityState={{ selected: isActive }}
            style={styles.slot}
          >
            {isCamera ? (
              // The anchor is unmistakably home: yellow disc, black glyph (19.2:1),
              // black border so it reads on both the light bar and a pale photo.
              <View style={[styles.cameraDisc, isActive && styles.cameraDiscActive]}>
                <IconSymbol name={slot.icon} size={22} color={Colors.onAccent} />
              </View>
            ) : (
              <View style={[styles.glyph, overCamera && styles.glyphBackdrop]}>
                <IconSymbol name={slot.icon} size={24} color={glyphColor} />
              </View>
            )}

            {!isCamera ? (
              <AppText variant="caption" color={glyphColor} numberOfLines={1}>
                {slot.label}
              </AppText>
            ) : null}

            {isActive && !isCamera && !overCamera ? <View style={styles.dot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  barOverCamera: { backgroundColor: 'transparent' },
  barOnLight: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    // Android elevation only casts downward, so an upward shadow would not render.
    borderTopWidth: Size.hairline,
    borderTopColor: Colors.separator,
  },
  slot: { width: 64, height: Size.pagerBar, alignItems: 'center', justifyContent: 'center', gap: 2 },
  glyph: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  glyphBackdrop: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.controlBackdrop,
  },
  cameraDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraDiscActive: { borderWidth: 3 },
  dot: {
    position: 'absolute',
    bottom: Spacing.xs,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ink,
  },
});
