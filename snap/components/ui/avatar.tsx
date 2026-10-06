import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { AvatarPalette, Colors, Size } from '@/constants/design';
import { S } from '@/constants/strings';

type AvatarProps = {
  username: string;
  size?: number;
  ring?: 'none' | 'accent' | 'received' | 'pendingDashed';
};

/** Stable across renders and devices, so a person keeps the same colour. */
function hashUsername(username: string): number {
  let hash = 7;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initialsFor(username: string): string {
  const parts = username.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (username[0] ?? '?').toUpperCase();
}

/**
 * Plain View + Text on purpose. There is no avatar endpoint, and an async image
 * loader inside a map Marker is the classic blank-marker bug on Android.
 */
export function Avatar({ username, size = Size.avatar, ring = 'none' }: AvatarProps) {
  const background = AvatarPalette[hashUsername(username) % AvatarPalette.length];

  const circle = (
    <View
      style={[
        styles.circle,
        // Numeric, never '50%': percentage radii crash on Android API 35 in RN 0.81.
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
      ]}
    >
      <AppText variant="bodyStrong" color="#1A1A1A" style={{ fontSize: size * 0.4, lineHeight: size * 0.5 }}>
        {initialsFor(username)}
      </AppText>
    </View>
  );

  if (ring === 'none') {
    return (
      <View accessible accessibilityLabel={S.a11y.avatar(username)}>
        {circle}
      </View>
    );
  }

  const ringSize = size + 6;
  return (
    <View
      accessible
      accessibilityLabel={S.a11y.avatar(username)}
      style={[
        styles.ring,
        { width: ringSize, height: ringSize, borderRadius: ringSize / 2 },
        ring === 'accent' && { borderColor: Colors.accent },
        ring === 'received' && { borderColor: Colors.received },
        // Dashed is a non-colour cue, so "pending" survives greyscale.
        ring === 'pendingDashed' && { borderColor: Colors.pending, borderStyle: 'dashed' },
      ]}
    >
      {circle}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
});
