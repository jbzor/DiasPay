import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { router } from 'expo-router';
import { chips, fontSize, palette, radius, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n } from '../i18n';

export const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M4 6h16M4 12h16M4 18h16',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  back: 'M15 5l-7 7 7 7',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  check: 'M5 12l5 5 9-10',
} as const;

export function Icon({ name, size = 24, color = palette.ink }: { name: keyof typeof ICONS; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICONS[name]} />
    </Svg>
  );
}

export function Screen({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      {scroll ? <ScrollView contentContainerStyle={s.scroll}>{children}</ScrollView> : <View style={s.scroll}>{children}</View>}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { t } = useI18n();
  return (
    <View style={s.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={s.backBtn}>
        <Icon name="back" />
      </Pressable>
      <View>
        <Text style={s.topTitle}>{title}</Text>
        {subtitle ? <Text style={s.topSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type Tone = 'primary' | 'secondary' | 'accent' | 'danger' | 'disabled';
export function Button({ label, onPress, tone = 'primary', disabled, small }: { label: string; onPress?: () => void; tone?: Tone; disabled?: boolean; small?: boolean }) {
  const st = disabled ? 'disabled' : tone;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={[s.btn, small && s.btnSmall, btnBg[st]]}>
      <Text style={[s.btnText, small && { fontSize: fontSize.small + 1 }, { color: btnFg[st] }]}>{label}</Text>
    </Pressable>
  );
}
const btnBg: Record<Tone, ViewStyle> = {
  primary: { backgroundColor: palette.green },
  secondary: { borderWidth: 1.5, borderColor: palette.green },
  accent: { backgroundColor: palette.yellow },
  danger: { borderWidth: 1.5, borderColor: palette.red },
  disabled: { backgroundColor: '#ECE8D8' },
};
const btnFg: Record<Tone, string> = { primary: '#fff', secondary: palette.green, accent: palette.ink, danger: palette.red, disabled: palette.muted };

export type ChipKind = keyof typeof chips;
export function Chip({ label, kind }: { label: string; kind: ChipKind }) {
  const c = chips[kind];
  return (
    <View style={[s.chip, { backgroundColor: c.bg }]}>
      <Text style={[s.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Banner({ text, tone = 'pending' }: { text: string; tone?: 'pending' | 'active' }) {
  const c = chips[tone];
  return (
    <View style={[s.banner, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: fontSize.small, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => <Text style={s.h2}>{children}</Text>;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: semantic.background },
  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -spacing.md },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: fontSize.title, fontWeight: '600', color: semantic.text },
  topSub: { fontSize: fontSize.caption, color: semantic.textMuted },
  card: { backgroundColor: semantic.surface, borderWidth: 1, borderColor: semantic.border, borderRadius: radius.lg, padding: spacing.lg },
  btn: { height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnSmall: { height: touchTarget, flex: 1 },
  btnText: { fontSize: 16, fontWeight: '600' },
  chip: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  chipText: { fontSize: fontSize.caption, fontWeight: '600' },
  banner: { borderRadius: radius.md, padding: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm },
  rowLabel: { fontSize: 14, color: semantic.textMuted },
  rowValue: { fontSize: 14, fontWeight: '500', color: semantic.text, flexShrink: 1, textAlign: 'right' },
  h2: { fontSize: 16, fontWeight: '600', color: semantic.text, marginTop: spacing.sm },
});

export const txChip = (status: string): ChipKind =>
  status === 'IN_PROGRESS' ? 'active' : status === 'DRAFT' || status === 'CLOSED' ? 'draft' : status === 'DISPUTED' ? 'error' : 'pending';
