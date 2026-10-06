/**
 * expo-camera reports `format` as 'jpg' / 'png'. The backend only accepts
 * `image/jpeg` and `image/png`, so this is the mapping `sendSnap` needs.
 */
export function mimeTypeFor(format?: string, uri?: string): string {
  const hint = `${format ?? ''} ${uri ?? ''}`.toLowerCase();
  if (hint.includes('png')) return 'image/png';
  return 'image/jpeg';
}
