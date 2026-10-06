import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Colors, Radius, Spacing } from '@/constants/design';

export function SectionHeader({ title, badge }: { title: string; badge?: number }) {
  return (
    <View style={styles.container}>
      <AppText variant="overline" color={Colors.textSecondary}>
        {title}
      </AppText>
      {badge ? (
        <View style={styles.badge}>
          <AppText variant="caption" color={Colors.onDark}>
            {badge}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
