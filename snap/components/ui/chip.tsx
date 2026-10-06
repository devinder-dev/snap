import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Size, Spacing } from '@/constants/design';

type ChipProps = {
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
  avatarUsername?: string;
};

export function Chip({ label, onRemove, removeLabel, avatarUsername }: ChipProps) {
  return (
    <View
      style={[
        styles.chip,
        { paddingLeft: avatarUsername ? 4 : Spacing.md, paddingRight: onRemove ? Spacing.sm : Spacing.md },
      ]}
    >
      {avatarUsername ? <Avatar username={avatarUsername} size={Size.avatarSm} /> : null}

      <AppText variant="metaStrong" color={Colors.text} numberOfLines={1}>
        {label}
      </AppText>

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? label}
          style={styles.remove}
        >
          <IconSymbol name="xmark" size={14} color={Colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    borderRadius: 18,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.separator,
  },
  remove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
