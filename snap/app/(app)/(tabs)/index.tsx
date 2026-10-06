import { useIsFocused } from '@react-navigation/native';
import {
  CameraView,
  useCameraPermissions,
  type CameraCapturedPicture,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShutterButton } from '@/components/camera/shutter-button';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Radius, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

/** Once per app launch is enough; this is a hint, not a setting. */
let coachMarkSeen = false;

const FLASH_ORDER: FlashMode[] = ['off', 'auto', 'on'];
const FLASH_ICON: Record<FlashMode, IconSymbolName> = {
  off: 'bolt.slash.fill',
  auto: 'bolt.circle.fill',
  on: 'bolt.fill',
};
const FLASH_LABEL: Record<FlashMode, string> = {
  off: S.camera.flashOffA11y,
  auto: S.camera.flashAutoA11y,
  on: S.camera.flashOnA11y,
};

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView>(null);
  const lastTapRef = useRef(0);

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(true);
  const [showCoachMark, setShowCoachMark] = useState(!coachMarkSeen);

  /**
   * Pager pages stay mounted forever — react-native-tab-view has no unmountOnBlur —
   * so without this the capture session runs while the user reads their chat list,
   * burning battery and keeping the iOS camera indicator lit.
   *
   * The 400 ms grace means flicking to Chats and straight back is instant, while
   * actually settling on another page releases the hardware.
   */
  useEffect(() => {
    if (isFocused) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(timer);
  }, [isFocused]);

  // A remount re-fires onCameraReady, so the flag must go back down with it —
  // otherwise the shutter stays enabled against a ref that no longer exists.
  useEffect(() => {
    if (!mounted) setCameraReady(false);
  }, [mounted]);

  // `active` is iOS-only (verified in expo-camera's own types), so Android needs
  // the imperative pause. Both are belt-and-braces on top of the unmount above.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const camera = cameraRef.current;
    if (!camera) return;
    if (isFocused) camera.resumePreview();
    else camera.pausePreview();
  }, [isFocused]);

  useEffect(() => {
    if (!showCoachMark) return;
    coachMarkSeen = true;
    const timer = setTimeout(() => setShowCoachMark(false), 4000);
    return () => clearTimeout(timer);
  }, [showCoachMark]);

  const toggleFacing = useCallback(() => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }, []);

  const cycleFlash = useCallback(() => {
    setFlash((current) => FLASH_ORDER[(FLASH_ORDER.indexOf(current) + 1) % FLASH_ORDER.length]);
  }, []);

  /** Double-tap to flip, kept as an accelerator. The flip button is the
   *  discoverable affordance — a gesture inside a horizontal pager is contested. */
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) toggleFacing();
    lastTapRef.current = now;
  }, [toggleFacing]);

  const takePhoto = useCallback(async () => {
    if (!cameraReady || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      // quality 0.6 keeps us comfortably under the backend's 10 MB cap.
      const photo: CameraCapturedPicture | undefined = await cameraRef.current?.takePictureAsync({
        quality: 0.6,
      });
      if (!photo?.uri) throw new Error('no photo');

      router.push({
        pathname: '/preview',
        params: { uri: photo.uri, format: photo.format ?? 'jpg' },
      });
    } catch {
      setError(S.camera.captureFailed);
    } finally {
      setCapturing(false);
    }
  }, [cameraReady, capturing]);

  // --- render ---------------------------------------------------------------

  if (!permission) {
    return <View style={styles.blackFill} />;
  }

  if (!permission.granted) {
    const canRetry = permission.canAskAgain;
    return (
      <View style={[styles.blackFill, styles.permission]}>
        <StatusBar style="light" />
        <View style={styles.permissionIcon}>
          <IconSymbol name="lock.fill" size={40} color={Colors.accent} />
        </View>
        <AppText variant="title2" color={Colors.onDark} center>
          {S.camera.permissionTitle}
        </AppText>
        <AppText variant="body" color={Colors.onDarkMuted} center style={styles.permissionBody}>
          {canRetry ? S.camera.permissionBody : S.camera.permissionDeniedBody}
        </AppText>
        <Button
          label={canRetry ? S.camera.permissionAction : S.common.openSettings}
          onPress={canRetry ? () => void requestPermission() : () => void Linking.openSettings()}
          // The black border is dropped here on purpose: yellow on black is 19.2:1.
          onDark
          style={styles.permissionButton}
        />
      </View>
    );
  }

  return (
    <View style={styles.blackFill}>
      <StatusBar style="light" />

      {mounted ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} accessibilityLabel={S.camera.previewA11y}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash}
            active={isFocused}
            animateShutter={false}
            enableTorch={false}
            onCameraReady={() => setCameraReady(true)}
          />
        </Pressable>
      ) : null}

      {/* Edge hints that a swipe is available. Decorative — hidden from a11y. */}
      <View
        style={[styles.peek, styles.peekLeft]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <IconSymbol name="chevron.left" size={18} color="rgba(255,255,255,0.55)" />
      </View>
      <View
        style={[styles.peek, styles.peekRight]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <IconSymbol name="chevron.right" size={18} color="rgba(255,255,255,0.55)" />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <IconButton
          name={FLASH_ICON[flash]}
          onPress={cycleFlash}
          accessibilityLabel={FLASH_LABEL[flash]}
          // Active flash goes yellow-on-black rather than white-on-dim.
          variant={flash === 'off' ? 'overlay' : 'accent'}
        />
        <IconButton
          name="arrow.triangle.2.circlepath.camera.fill"
          onPress={toggleFacing}
          accessibilityLabel={S.camera.flipA11y}
          variant="overlay"
        />
      </View>

      {error ? (
        <View style={[styles.errorSlot, { top: insets.top + 60 }]}>
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </View>
      ) : null}

      {showCoachMark ? (
        <View style={[styles.coachMark, { bottom: Size.pagerBar + insets.bottom + 110 }]}>
          <AppText variant="meta" color={Colors.onDark} center>
            {S.camera.coachMark}
          </AppText>
        </View>
      ) : null}

      <View style={[styles.shutterRow, { bottom: Size.pagerBar + insets.bottom + Spacing.lg }]}>
        <ShutterButton onPress={() => void takePhoto()} disabled={!cameraReady || capturing} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blackFill: { flex: 1, backgroundColor: Colors.ink },
  permission: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl },
  permissionIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  permissionBody: { marginTop: Spacing.sm },
  permissionButton: { marginTop: 28 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  errorSlot: { position: 'absolute', left: Spacing.lg, right: Spacing.lg },
  peek: {
    position: 'absolute',
    top: '50%',
    // Numeric offset rather than a percentage transform — half the 48px height.
    marginTop: -24,
    width: 24,
    height: 48,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekLeft: { left: 0, borderTopRightRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  peekRight: { right: 0, borderTopLeftRadius: Radius.xl, borderBottomLeftRadius: Radius.xl },
  coachMark: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '80%',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  shutterRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
