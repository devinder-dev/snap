/**
 * Native map. The `react-native-maps` import is confined to this file (and its
 * `.web.tsx` sibling replaces it entirely on web) so the native module never
 * enters the web dependency graph — `web.output: "static"` would otherwise try to
 * bundle it and break `expo start --web` for the whole app.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Radius, Shadow, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import type { LatLng, MockFriendLocation } from '@/lib/mock-locations';

export type FriendsMapProps = {
  center: LatLng;
  friends: MockFriendLocation[];
  onSelectFriend: (username: string) => void;
  mapPadding?: { top: number; right: number; bottom: number; left: number };
  selfLabel: string;
};

export function FriendsMap({ center, friends, onSelectFriend, mapPadding, selfLabel }: FriendsMapProps) {
  /**
   * Custom marker views re-rasterise on every frame while this is true, which
   * pegs the CPU on Android. Let the first layout settle, then freeze.
   */
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracksViewChanges(false), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...center, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
      mapPadding={mapPadding}
      showsUserLocation={false}
      showsMyLocationButton={false}
      toolbarEnabled={false}
    >
      <Marker coordinate={center} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracksViewChanges} title={selfLabel}>
        <View style={styles.selfMarker}>
          {/* Plain View + Text avatar on purpose — an async image loader inside a
              Marker is the classic blank-marker bug on Android. */}
          <Avatar username={selfLabel} size={50} />
          <View style={styles.selfDot} />
        </View>
      </Marker>

      {friends.map((friend) => (
        <Marker
          key={friend.username}
          coordinate={{ latitude: friend.latitude, longitude: friend.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracksViewChanges}
          onPress={() => onSelectFriend(friend.username)}
          accessibilityLabel={S.map.friendMarkerA11y(friend.username)}
        >
          <View style={styles.friendMarker}>
            <View style={styles.friendCircle}>
              <Avatar username={friend.username} size={42} />
            </View>
            <View style={styles.namePill}>
              <AppText variant="caption" numberOfLines={1}>
                {friend.username}
              </AppText>
            </View>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  selfMarker: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: Colors.onDark,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.float,
  },
  selfDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.received,
    borderWidth: 2,
    borderColor: Colors.onDark,
  },
  friendMarker: { alignItems: 'center' },
  friendCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: Colors.onDark,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  namePill: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    ...Shadow.card,
  },
});
