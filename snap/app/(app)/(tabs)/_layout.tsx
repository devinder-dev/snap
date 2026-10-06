import {
  createMaterialTopTabNavigator,
  type MaterialTopTabNavigationEventMap,
  type MaterialTopTabNavigationOptions,
} from '@react-navigation/material-top-tabs';
import type { ParamListBase, TabNavigationState } from '@react-navigation/native';
import { withLayoutContext } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { PagerBar } from '@/components/pager-bar';
import { Colors } from '@/constants/design';

const { Navigator } = createMaterialTopTabNavigator();

/** Binds React Navigation's swipeable top-tab navigator to expo-router's file
 *  routing, so each pager page stays a real route with real focus events. */
const MaterialTopTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(Navigator);

/** The camera is home. expo-router reads `anchor` (falling back to initialRouteName). */
export const unstable_settings = { anchor: 'index' };

export default function TabsPagerLayout() {
  const { width } = useWindowDimensions();

  return (
    <View style={styles.root}>
      <MaterialTopTabs
        initialRouteName="index"
        backBehavior="initialRoute"
        // The Material tab bar is replaced wholesale by our own PagerBar below.
        tabBar={() => null}
        // Without this the pager lays out at zero width for one frame.
        initialLayout={{ width }}
        screenOptions={{
          swipeEnabled: true,
          lazy: true,
          sceneStyle: { backgroundColor: Colors.surface },
        }}
      >
        {/* Declaration order IS the left-to-right pager order. */}
        <MaterialTopTabs.Screen
          name="map"
          // On Android the pager is a native ViewPager2 and steals horizontal drags
          // before the MapView ever sees them, which makes the map impossible to pan.
          // Swiping off the map is replaced by the always-visible close button there.
          options={{ swipeEnabled: false }}
        />
        <MaterialTopTabs.Screen name="chats" />
        <MaterialTopTabs.Screen name="index" options={{ lazy: false }} />
        <MaterialTopTabs.Screen name="friends" />
      </MaterialTopTabs>

      <PagerBar />
    </View>
  );
}

const styles = StyleSheet.create({
  // Black, because the gutter between pages is visible mid-drag and a white flash
  // there looks like a rendering bug.
  root: { flex: 1, backgroundColor: Colors.ink },
});
