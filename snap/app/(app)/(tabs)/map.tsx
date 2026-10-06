import * as Location from 'expo-location';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendsMap } from '@/components/map/map-view';
import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Shadow, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { friendLocationsAround, type LatLng } from '@/lib/mock-locations';

type Status = 'loading' | 'granted' | 'denied' | 'error';

/**
 * Layout and permission only — there is no positions endpoint and none is planned,
 * so the friend markers come from `lib/mock-locations`, deliberately not from
 * `lib/api`.
 */
export default function MapScreen() {
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<Status>('loading');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const requestLocation = useCallback(async () => {
    setStatus('loading');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      setCanAskAgain(permission.canAskAgain);

      if (!permission.granted) {
        setStatus('denied');
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCenter({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setStatus('granted');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  // Keyed on the FIRST fix — recomputing on every update makes markers jitter.
  const friends = useMemo(() => (center ? friendLocationsAround(center) : []), [center]);

  // Swiping off this page is disabled (the pager would steal the map's pan
  // gesture on Android), so this button is the ONLY way out — it must render in
  // every state, including denied, or a user who refuses location is trapped.
  const closeButton = (
    <IconButton
      name="xmark"
      onPress={() => router.navigate('/')}
      accessibilityLabel={S.map.closeA11y}
      variant="overlay"
      style={[styles.close, { top: insets.top + Spacing.sm }]}
    />
  );

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        {closeButton}
        <ActivityIndicator size="large" color={Colors.ink} />
        <AppText variant="meta" color={Colors.textSecondary} style={styles.loadingLabel}>
          {S.map.loading}
        </AppText>
      </View>
    );
  }

  if (status !== 'granted' || !center) {
    const isDenied = status === 'denied';
    const askable = isDenied && canAskAgain;

    return (
      <View style={styles.permission}>
        {closeButton}
        <View style={styles.permissionIcon}>
          <IconSymbol name="map.fill" size={40} color={Colors.textTertiary} />
        </View>
        <AppText variant="title2" center>
          {isDenied ? S.map.permissionTitle : S.map.positionFailed}
        </AppText>
        <AppText variant="body" color={Colors.textSecondary} center style={styles.permissionBody}>
          {askable || !isDenied ? S.map.permissionBody : S.map.permissionDeniedBody}
        </AppText>
        <Button
          label={askable || !isDenied ? S.map.permissionAction : S.common.openSettings}
          onPress={
            askable || !isDenied
              ? () => void requestLocation()
              : // On iOS a re-request after a hard denial resolves silently with no
                // dialog, so the retry button would look broken. Send them to Settings.
                () => void Linking.openSettings()
          }
          style={styles.permissionButton}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <FriendsMap
        center={center}
        friends={friends}
        onSelectFriend={setSelected}
        selfLabel={S.map.youA11y}
        mapPadding={{
          top: insets.top + Size.header,
          left: Spacing.lg,
          right: Spacing.lg,
          bottom: Size.pagerBar + insets.bottom + Spacing.lg,
        }}
      />

      {closeButton}

      <IconButton
        name="location.fill"
        onPress={() => void requestLocation()}
        accessibilityLabel={S.map.recenterA11y}
        variant="overlay"
        style={[styles.recenter, { top: insets.top + Spacing.sm }]}
      />

      {selected ? (
        <View style={[styles.card, { bottom: Size.pagerBar + insets.bottom + Spacing.lg }]}>
          <Avatar username={selected} />
          <View style={styles.cardText}>
            <AppText variant="bodyStrong">{selected}</AppText>
            <AppText variant="meta" color={Colors.textSecondary}>
              {S.map.friendLastSeen}
            </AppText>
          </View>
          <Button label={S.map.sendSnap} size="sm" onPress={() => router.navigate('/')} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surfaceAlt },
  // Map-grey rather than white, so the transition to the loaded map is not a flash.
  loading: { flex: 1, backgroundColor: '#E8E8ED', alignItems: 'center', justifyContent: 'center' },
  loadingLabel: { marginTop: Spacing.md },
  permission: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  permissionIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...Shadow.card,
  },
  permissionBody: { marginTop: Spacing.sm },
  permissionButton: { marginTop: 28 },
  close: { position: 'absolute', left: Spacing.md, zIndex: 10 },
  recenter: { position: 'absolute', right: Spacing.md, zIndex: 10 },
  card: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    ...Shadow.float,
  },
  cardText: { flex: 1 },
});
