import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Colors, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';
import { useApi, type ApiResult } from '@/hooks/use-api';
import { getSnap, reportScreenshot, type ApiSnap } from '@/lib/api';
import { formatAgo } from '@/lib/time';

type ViewState = { status: 'loading' } | { status: 'ready'; snap: ApiSnap } | { status: 'error'; detail: string };

/**
 * Plays one sender's waiting snaps in order. Tap to advance; past the last one
 * the viewer closes.
 *
 * Reading a snap is DESTRUCTIVE — the server marks it viewed in the same
 * request that returns it. So each id is fetched exactly once and the request is
 * cached for the life of the screen: an effect that re-runs (Fast Refresh,
 * StrictMode) reuses the promise instead of burning the snap with a second call
 * whose answer would be a 404.
 */
export default function SnapViewerScreen() {
  const insets = useSafeAreaInsets();
  const call = useApi();
  const { sender, ids } = useLocalSearchParams<{ sender: string; ids: string }>();
  const queue = useMemo(() => (ids ?? '').split(',').filter(Boolean), [ids]);

  const [index, setIndex] = useState(0);
  const [view, setView] = useState<ViewState>({ status: 'loading' });
  const [imageFailed, setImageFailed] = useState(false);
  const requests = useRef(new Map<string, Promise<ApiResult<ApiSnap>>>());

  const currentId = queue[index];

  useEffect(() => {
    if (!currentId) return;
    let current = true;
    setView({ status: 'loading' });
    setImageFailed(false);

    let request = requests.current.get(currentId);
    if (!request) {
      request = call(() => getSnap(currentId));
      requests.current.set(currentId, request);
    }

    void request.then((res) => {
      if (!current) return;
      setView(res.ok ? { status: 'ready', snap: res.data } : { status: 'error', detail: res.message });
    });

    return () => {
      current = false;
    };
  }, [call, currentId]);

  // The sender is told when their snap is screenshotted. Only while one is
  // actually on screen, and not on web, where there is no such event.
  const shownId = view.status === 'ready' ? view.snap.id : null;
  useEffect(() => {
    if (!shownId || Platform.OS === 'web') return;
    const subscription = ScreenCapture.addScreenshotListener(() => {
      void call(() => reportScreenshot(shownId));
    });
    return () => subscription.remove();
  }, [call, shownId]);

  function next() {
    if (index + 1 < queue.length) setIndex(index + 1);
    else router.back();
  }

  const snap = view.status === 'ready' ? view.snap : null;
  const showImage = snap?.type === 'photo' && snap.media_url && !imageFailed;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={next}
        accessibilityRole="button"
        accessibilityLabel={S.snap.nextA11y}
        accessibilityHint={S.snap.tapToContinue}
      >
        {showImage ? (
          <Image
            source={{ uri: snap.media_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={0}
            // One-shot content: never keep it on disk after the viewer closes.
            cachePolicy="none"
            recyclingKey={snap.id}
            onError={() => setImageFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : null}

        <View style={styles.center}>
          {view.status === 'loading' ? (
            <>
              <ActivityIndicator size="large" color={Colors.onDark} />
              <AppText variant="meta" color={Colors.onDarkMuted} style={styles.gapTop}>
                {S.snap.loading}
              </AppText>
            </>
          ) : view.status === 'error' ? (
            <Message title={S.snap.openFailed} detail={view.detail} />
          ) : snap?.type === 'text' ? (
            <AppText variant="title" color={Colors.onDark} center>
              {snap.body}
            </AppText>
          ) : !showImage ? (
            <Message title={S.snap.openFailed} detail={snap?.media_url ? S.snap.imageFailed : S.snap.noMedia} />
          ) : null}
        </View>

        {snap?.type === 'photo' && snap.body && showImage ? (
          <View style={[styles.captionBar, { bottom: insets.bottom + 96 }]}>
            <AppText variant="headline" color={Colors.onDark} center>
              {snap.body}
            </AppText>
          </View>
        ) : null}
      </Pressable>

      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]} pointerEvents="box-none">
        {queue.length > 1 ? (
          <View style={styles.progress} accessibilityLabel={S.snap.progress(index + 1, queue.length)}>
            {queue.map((id, i) => (
              <View key={id} style={[styles.segment, i <= index && styles.segmentDone]} />
            ))}
          </View>
        ) : null}

        <View style={styles.header} pointerEvents="box-none">
          <Avatar username={sender} size={36} />
          <View style={styles.headerText}>
            <AppText variant="headline" color={Colors.onDark} numberOfLines={1}>
              {sender}
            </AppText>
            {snap ? (
              <AppText variant="meta" color={Colors.onDarkMuted}>
                {formatAgo(snap.created_at)}
              </AppText>
            ) : null}
          </View>
          <IconButton
            name="xmark"
            onPress={() => router.back()}
            accessibilityLabel={S.snap.closeA11y}
            variant="overlay"
            glyphSize={22}
          />
        </View>
      </View>
    </View>
  );
}

function Message({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.message}>
      <AppText variant="headline" color={Colors.onDark} center>
        {title}
      </AppText>
      <AppText variant="meta" color={Colors.onDarkMuted} center style={styles.gapTop}>
        {detail}
      </AppText>
      <AppText variant="meta" color={Colors.onDarkMuted} center style={styles.gapTopLarge}>
        {S.snap.tapToContinue}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl },
  message: { alignItems: 'center' },
  gapTop: { marginTop: Spacing.sm },
  gapTopLarge: { marginTop: Spacing.xl },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: Colors.scrim,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: Spacing.md },
  progress: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.sm },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  segmentDone: { backgroundColor: Colors.onDark },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerText: { flex: 1 },
});
