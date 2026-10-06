import { Stack } from 'expo-router';

import { Colors } from '@/constants/design';
import { RealtimeProvider } from '@/contexts/realtime-context';

/** The pager is the anchor; everything else here renders OVER it. */
export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
  return (
    // Inside the (app) group, so the socket only exists while someone is signed in.
    <RealtimeProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.surface } }}>
        <Stack.Screen name="(tabs)" />

        {/* preview and send-snap sit on THIS stack, above the pager. That is what keeps
            the camera mounted underneath: discarding a photo is router.back() onto a
            screen that never held photo state, so "take a new picture after discarding"
            cannot regress. */}
        <Stack.Screen name="preview" options={{ animation: 'fade' }} />
        <Stack.Screen name="send-snap" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-friend" options={{ presentation: 'modal' }} />
        <Stack.Screen name="chat/[username]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="snap-viewer" options={{ animation: 'fade', presentation: 'fullScreenModal' }} />
      </Stack>
    </RealtimeProvider>
  );
}
