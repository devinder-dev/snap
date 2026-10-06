/**
 * Web has no react-native-maps. Metro resolves this file instead on web, so the
 * native module is never even referenced in that bundle.
 */
import { EmptyState } from '@/components/ui/empty-state';
import { S } from '@/constants/strings';

import type { FriendsMapProps } from './map-view';

export function FriendsMap(_props: FriendsMapProps) {
  return <EmptyState icon="map.fill" title={S.map.webUnavailableTitle} body={S.map.webUnavailableBody} />;
}
