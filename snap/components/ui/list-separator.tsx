import { StyleSheet, View } from 'react-native';

import { Colors, Size, Spacing } from '@/constants/design';

/** Inset to line up with the row text, past the 48px avatar. */
export function ListSeparator() {
  return <View style={styles.line} />;
}

const styles = StyleSheet.create({
  line: {
    height: Size.hairline,
    backgroundColor: Colors.separator,
    marginLeft: Spacing.lg + Size.avatar + Spacing.md,
  },
});
