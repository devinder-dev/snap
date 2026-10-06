/**
 * Design tokens for Snap.
 *
 * Light-mode only by decision — dark mode is out of scope, and the camera / preview /
 * map screens carry their own dark chrome regardless. `app.json` pins
 * `userInterfaceStyle: "light"` so native chrome (keyboard, Alert, RefreshControl)
 * matches.
 *
 * Everything here is a plain module-scope constant so screens can reference tokens
 * from `StyleSheet.create` at module scope. That keeps the React Compiler from
 * re-allocating style objects on every render.
 */
import { Platform, StyleSheet } from 'react-native';

export const Colors = {
  // brand
  accent: '#FFFC00',
  accentPressed: '#E6E300',
  ink: '#000000',
  inkSoft: '#1C1C1E',

  // surfaces
  surface: '#FFFFFF',
  surfaceAlt: '#F2F2F7',
  surfacePressed: '#E5E5EA',
  surfacePendingWash: '#FFFDF5',

  // text
  text: '#000000',
  textSecondary: '#6E6E73', // 5.07:1 on white — ALL 13-16px secondary text
  textTertiary: '#8E8E93', //  3.26:1 on white — inactive glyphs + decorative ONLY
  textDisabled: '#AEAEB2',
  onAccent: '#000000', //     19.2:1 on yellow — the only foreground allowed there
  onDark: '#FFFFFF',
  onDarkMuted: 'rgba(255,255,255,0.72)',

  // lines
  border: '#D1D1D6',
  separator: '#E5E5EA',

  // semantic — the `*Text` values are darkened because the raw fills fail
  // contrast at 13-16px. Use the fill for shapes, the text value for glyphs/labels.
  sent: '#F23C57',
  sentText: '#C81E3A',
  sentBg: '#FDECEF',
  received: '#00C4FF',
  receivedText: '#0B7FA8',
  receivedBg: '#E5F8FF',
  success: '#17A34A',
  successText: '#0F7A37',
  successBg: '#E7F7EE',
  danger: '#D92D20',
  dangerText: '#B42318',
  dangerBg: '#FEE4E2',
  pending: '#B54708',
  pendingText: '#B54708',
  pendingBg: '#FEF0C7',

  // states
  disabledBg: '#E5E5EA',
  disabledText: '#AEAEB2',

  // overlay chrome (camera / preview / map)
  scrim: 'rgba(0,0,0,0.45)',
  scrimStrong: 'rgba(0,0,0,0.65)',
  control: 'rgba(0,0,0,0.40)',
  controlPressed: 'rgba(0,0,0,0.60)',
  controlBackdrop: 'rgba(0,0,0,0.35)',
} as const;

/** All >= 12:1 against #1A1A1A, so avatar initials are always legible. */
export const AvatarPalette = [
  '#FFD9E0',
  '#FFE7B8',
  '#FFF6A8',
  '#D8F5C8',
  '#C8F0EF',
  '#D3E4FF',
  '#E3D9FF',
  '#FFDCC2',
] as const;

/**
 * Genuine SF Pro Rounded on iOS (UIFontDescriptorSystemDesignRounded).
 * `undefined` on Android lets Roboto through with working numeric fontWeight —
 * never the string 'normal', which is a font-name lookup that can silently fall
 * back and interfere with weight synthesis.
 */
const rounded = Platform.select<string | undefined>({ ios: 'ui-rounded', default: undefined });

export const Type = {
  display: { fontFamily: rounded, fontSize: 34, lineHeight: 40, fontWeight: '800' },
  title: { fontFamily: rounded, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontFamily: rounded, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontFamily: rounded, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontFamily: rounded, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily: rounded, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontFamily: rounded, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  meta: { fontFamily: rounded, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  metaStrong: { fontFamily: rounded, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  caption: { fontFamily: rounded, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  button: { fontFamily: rounded, fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: 0.2 },
  overline: {
    fontFamily: rounded,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
} as const;

export type TypeVariant = keyof typeof Type;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Circles always use a numeric `size / 2`. Never '50%' — RN 0.81 percentage radii
 *  crash on Android API 35 when applied to an Image. */
export const Radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const Size = {
  touch: 44,
  control: 44,
  avatarSm: 28,
  avatar: 48,
  avatarLg: 72,
  row: 72,
  header: 56,
  inputHeight: 52,
  buttonLg: 52,
  buttonMd: 44,
  buttonSm: 36,
  shutter: 76,
  /** Excludes the safe-area bottom inset — always add `insets.bottom`. */
  pagerBar: 56,
  hairline: StyleSheet.hairlineWidth,
} as const;

/** Android `elevation` needs an opaque backgroundColor on the same View and always
 *  casts downward, so an upward shadow will not render — use a hairline border there. */
export const Shadow = {
  card: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
    default: { elevation: 2 },
  }),
  float: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
    default: { elevation: 6 },
  }),
} as const;

export const Motion = { fast: 120, base: 200 } as const;
