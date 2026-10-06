import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/design';

type EmptyStateProps = {
  icon?: IconSymbolName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ? (
        <View style={styles.iconWrap}>
          <IconSymbol name={icon} size={56} color={Colors.textTertiary} />
        </View>
      ) : null}

      <AppText variant="title2" center>
        {title}
      </AppText>

      {body ? (
        <AppText variant="body" color={Colors.textSecondary} center style={styles.body}>
          {body}
        </AppText>
      ) : null}

      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} size="md" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    maxWidth: 360,
    alignSelf: 'center',
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  body: { marginTop: Spacing.sm },
  action: { marginTop: Spacing.xl },
});
