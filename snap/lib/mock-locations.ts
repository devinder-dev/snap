/**
 * Friend markers for MapsPage. There is no positions endpoint — these stay
 * local on purpose and must not live in `lib/api.ts`.
 *
 * Offsets are keyed on the first GPS fix so the pins don't jitter when the
 * user recenters.
 */

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type MockFriendLocation = LatLng & {
  username: string;
};

const OFFSETS: { username: string; dLat: number; dLng: number }[] = [
  { username: 'moises', dLat: 0.0032, dLng: 0.0021 },
  { username: 'sara', dLat: -0.0024, dLng: 0.0045 },
  { username: 'kalle', dLat: 0.0015, dLng: -0.0038 },
  { username: 'dave', dLat: -0.0041, dLng: -0.0016 },
];

export function friendLocationsAround(center: LatLng): MockFriendLocation[] {
  return OFFSETS.map((offset) => ({
    username: offset.username,
    latitude: center.latitude + offset.dLat,
    longitude: center.longitude + offset.dLng,
  }));
}
