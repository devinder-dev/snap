// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * SF Symbol -> Material Icon mappings.
 *
 * IMPORTANT: this object is the TypeScript gate for icons across the whole app.
 * `tsc` resolves this file (not `.ios.tsx`), so `IconSymbolName` is `keyof typeof
 * MAPPING` — an icon missing from here fails the build even though iOS would have
 * rendered it fine. Add the pair here before using a new icon anywhere.
 *
 * SF Symbol names are kept to iOS 15-safe glyphs so nothing renders blank on older
 * devices (Expo SDK 54 supports iOS 15.1+).
 *
 * - Material Icons: https://icons.expo.fyi
 * - SF Symbols: the SF Symbols app
 */
const MAPPING = {
  // navigation
  'house.fill': 'home',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  xmark: 'close',
  plus: 'add',
  magnifyingglass: 'search',
  'arrow.clockwise': 'refresh',
  'gearshape.fill': 'settings',

  // pager destinations
  'camera.fill': 'photo-camera',
  'map.fill': 'map',
  'bubble.left.fill': 'chat-bubble',
  'person.2.fill': 'people',

  // people
  'person.fill': 'person',
  'person.badge.plus': 'person-add',
  trash: 'delete',

  // state
  checkmark: 'check',
  'checkmark.circle.fill': 'check-circle',
  'clock.fill': 'schedule',
  'lock.fill': 'lock',
  'eye.fill': 'visibility',
  'eye.slash.fill': 'visibility-off',
  'exclamationmark.triangle.fill': 'error',

  // camera controls
  'bolt.fill': 'flash-on',
  'bolt.slash.fill': 'flash-off',
  'bolt.circle.fill': 'flash-auto',
  'arrow.triangle.2.circlepath.camera.fill': 'flip-camera-ios',

  // messaging
  'paperplane.fill': 'send',
  'text.bubble': 'chat',
  'bubble.left.and.bubble.right.fill': 'forum',

  // map
  'location.fill': 'my-location',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
