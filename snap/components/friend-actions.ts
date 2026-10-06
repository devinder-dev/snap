/**
 * The confirm-then-delete flow, shared by /chats and /friends.
 *
 * Deletion is long-press + Alert rather than swipe-to-delete: a horizontal row
 * gesture inside a horizontal pager is precisely the Android conflict we already
 * had to disable swiping on the map for.
 */
import { Alert } from 'react-native';

import { S } from '@/constants/strings';

export function confirmRemoveFriend(username: string, mutual: boolean, onConfirm: () => void) {
  const title = mutual ? S.friend.deleteTitle : S.friend.cancelRequestTitle;
  const message = mutual
    ? // The backend keeps their edge, so a removed mutual friend comes back as an
      // incoming request. Saying so up front stops it looking like a bug.
      `${S.friend.deleteMessage(username)} ${S.friend.deleteMutualNote}`
    : S.friend.cancelRequestMessage(username);

  Alert.alert(title, message, [
    { text: S.common.cancel, style: 'cancel' },
    {
      text: mutual ? S.friend.deleteConfirm : S.friend.cancelRequestConfirm,
      style: 'destructive',
      onPress: onConfirm,
    },
  ]);
}
