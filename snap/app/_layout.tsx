import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { Colors } from '@/constants/design';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    // expo-router already mounts SafeAreaProvider (see ExpoRoot), but NOT this —
    // gesture-handler needs its own root or the pager's swipe misbehaves on Android.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SplashScreenController />
        <RootNavigator />
        <StatusBar style="dark" />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

/** Holds the splash until the stored session has been restored. Must live inside
 *  AuthProvider, which is why it is a child component rather than inline. */
function SplashScreenController() {
  const { isLoading } = useAuth();
  if (!isLoading) SplashScreen.hide();
  return null;
}

function RootNavigator() {
  const { user } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.surface } }}>
      {/* Guards are deliberately NOT gated on isLoading. During restore `user` is
          null, so the auth group stays mounted behind the splash and the navigator
          always has at least one route. Folding isLoading in here makes both guards
          false for a moment, which yields an empty navigator and
          "navigate before mounting the root layout" warnings. */}
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!user}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
