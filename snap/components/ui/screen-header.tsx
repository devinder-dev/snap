import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { IconButton } from '@/components/ui/icon-button';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

type ScreenHeaderProps = {
  title: string;
  onBack?: () => void;
  backIcon?: Extract<IconSymbolName, 'chevron.left' | 'xmark'>;
  backLabel?: string;
  right?: ReactNode;
};

export function ScreenHeader({
  title,
  onBack,
  backIcon = 'chevron.left',
  backLabel,
  right,
}: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.side}>
        {onBack ? (
          <IconButton
            name={backIcon}
            onPress={onBack}
            accessibilityLabel={backLabel ?? (backIcon === 'xmark' ? S.common.close : S.common.back)}
            glyphSize={24}
          />
        ) : null}
      </View>

      <AppText variant="headline" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>

      {/* Same fixed width as the left slot so the title stays optically centred. */}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: Size.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  side: { width: Size.control, alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
});
