import { Stack } from 'expo-router';

import { Colors } from '@/constants/design';

/** Without an index route in this group, the landing screen would otherwise depend
 *  on file ordering. Signed-out users must always land on login. */
export const unstable_settings = { anchor: 'login' };

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.surface } }}
    />
  );
}
