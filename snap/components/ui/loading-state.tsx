import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Colors, Spacing } from '@/constants/design';

export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.ink} />
      {label ? (
        <AppText variant="meta" color={Colors.textSecondary} style={styles.label}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: Spacing.md },
});
