import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { PhotoPreview } from '@/components/photo-preview';

/**
 * A route rather than a conditional render inside the camera screen. That is what
 * keeps CameraView mounted underneath: discarding is router.back() onto a screen
 * that never held photo state, so taking a new picture afterwards always works.
 */
export default function PreviewScreen() {
  const { uri, format } = useLocalSearchParams<{ uri: string; format?: string }>();

  return (
    <>
      <StatusBar style="light" />
      <PhotoPreview
        photoUri={uri}
        onDiscard={() => router.back()}
        onSend={(caption) =>
          router.push({
            pathname: '/send-snap',
            params: { uri, format: format ?? 'jpg', text: caption },
          })
        }
      />
    </>
  );
}
