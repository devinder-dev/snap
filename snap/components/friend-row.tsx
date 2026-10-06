import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Size, Spacing } from '@/constants/design';
import { S } from '@/constants/strings';

type FriendRowProps = {
  username: string;
  /** false = you added them and they have not added you back. */
  mutual: boolean;
  subtitle?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Renders a checkbox instead of the chevron/pending pill. */
  selectable?: boolean;
  selected?: boolean;
};

/**
 * The mutual/pending split is graded, so it carries FIVE redundant cues — and two
 * of them (the dashed avatar ring and the literal word "Väntar") are non-colour,
 * which means the distinction survives greyscale and colour-blindness.
 *
 * Note what is deliberately NOT used: `opacity`. Dimming a pending row reads as
 * "broken" rather than "waiting", and it wrecks the contrast of the text inside.
 */
export function FriendRow({
  username,
  mutual,
  subtitle,
  onPress,
  onLongPress,
  selectable = false,
  selected = false,
}: FriendRowProps) {
  const disabled = !mutual && !onLongPress;

  return (
    <Pressable
      onPress={mutual ? onPress : undefined}
      onLongPress={onLongPress}
      delayLongPress={500}
      disabled={disabled}
      accessibilityRole={selectable ? 'checkbox' : 'button'}
      accessibilityLabel={username}
      accessibilityHint={mutual ? undefined : S.friend.pendingA11yHint}
      accessibilityState={selectable ? { checked: selected } : { disabled: !mutual }}
      // Long-press is invisible to a screen reader without this.
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: S.friend.deleteA11yAction }] : undefined}
      onAccessibilityAction={onLongPress}
      style={({ pressed }) => [
        styles.row,
        !mutual && styles.rowPending,
        pressed && mutual && styles.rowPressed,
      ]}
    >
      <Avatar username={username} size={Size.avatar} ring={mutual ? 'none' : 'pendingDashed'} />

      <View style={styles.text}>
        <AppText variant="bodyStrong" color={mutual ? Colors.text : Colors.textSecondary} numberOfLines={1}>
          {username}
        </AppText>
        <AppText
          variant="meta"
          color={mutual ? Colors.textSecondary : Colors.pendingText}
          numberOfLines={1}
        >
          {subtitle ?? (mutual ? S.friend.mutualSubtitle : S.friend.pendingSubtitle)}
        </AppText>
      </View>

      {selectable ? (
        <SelectionControl mutual={mutual} selected={selected} />
      ) : mutual ? (
        <View style={styles.trailing}>
          <IconSymbol name="checkmark.circle.fill" size={18} color={Colors.received} />
          <IconSymbol name="chevron.right" size={20} color={Colors.textTertiary} />
        </View>
      ) : (
        <View style={styles.pendingPill}>
          <IconSymbol name="clock.fill" size={13} color={Colors.pendingText} />
          <AppText variant="metaStrong" color={Colors.pendingText}>
            {S.friend.pendingBadge}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

function SelectionControl({ mutual, selected }: { mutual: boolean; selected: boolean }) {
  if (!mutual) {
    // Shown, not hidden: removing the row entirely makes people think a friend vanished.
    return <IconSymbol name="lock.fill" size={18} color={Colors.pending} />;
  }
  return (
    <View style={[styles.checkbox, selected && styles.checkboxOn]}>
      {selected ? <IconSymbol name="checkmark" size={14} color={Colors.accent} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: Size.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  rowPending: { backgroundColor: Colors.surfacePendingWash },
  rowPressed: { backgroundColor: Colors.surfacePressed },
  text: { flex: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.pendingBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.ink, borderColor: Colors.ink },
});
