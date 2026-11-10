import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './text';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { router } from 'expo-router';
import { chips, fontSize, neutralTint, palette, radius, semantic, spacing, statusDot, touchTarget } from '@diaspay/ui-tokens';
import { setLocale, useI18n } from '../i18n';
import type { Locale } from '../i18n';

export { Logo } from './Logo';
export { IllustrationBellCheck, IllustrationLock, IllustrationProof, IllustrationPurpose } from './Illustrations';

/** Bascule de langue en boutons texte ; l’actif est gras et souligné en jaune (3 px). Appliquée et persistée immédiatement. */
export function LangSwitch({ inverse = false }: { inverse?: boolean }) {
  const { t, locale } = useI18n();
  const items: Array<[Locale, string]> = [['fr', t('langFr')], ['en', t('langEn')]];
  return (
    <View style={s.lang} accessibilityRole="radiogroup" accessibilityLabel={t('language')}>
      {items.map(([k, label]) => {
        const on = k === locale;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setLocale(k)} style={s.langItem}>
            <Text style={[s.langText, { color: inverse ? '#FFFFFF' : on ? palette.green : semantic.textMuted }, on ? s.langOn : null]}>{label}</Text>
            {inverse ? <View style={[s.langBar, on ? { backgroundColor: palette.yellow } : null]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M4 6h16M4 12h16M4 18h16',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  back: 'M15 5l-7 7 7 7',
  bolt: 'M13 2L5 14h6l-1 8 8-12h-6z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  check: 'M5 12l5 5 9-10',
  chevron: 'M9 5l7 7-7 7',
  face: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9v1M15 9v1M12 9v4h-1M9 16a4 4 0 0 0 6 0',
  fingerprint: 'M12 11v4M8.5 7.5A5 5 0 0 1 17 11v2M7 11a5 5 0 0 1 .5-2.2M7 13v1a5 5 0 0 0 2 4M17 15a8 8 0 0 1-1 4M12 7a4 4 0 0 0-4 4v2M4 9a8.5 8.5 0 0 1 16 1v3',
  alert: 'M12 7v6M12 17v.01',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  retry: 'M4 12a8 8 0 0 1 14-5.3M20 5v4h-4M20 12a8 8 0 0 1-14 5.3M4 19v-4h4',
} as const;

export function Icon({ name, size = 24, color = palette.ink, accessibilityLabel }: { name: keyof typeof ICONS; size?: number; color?: string; accessibilityLabel?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} accessibilityRole={accessibilityLabel ? 'image' : undefined}>
      <Path d={ICONS[name]} />
    </Svg>
  );
}

export function Screen({ children, scroll = true, footer, style }: { children: ReactNode; scroll?: boolean; footer?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      {scroll
        ? <ScrollView contentContainerStyle={[s.scroll, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        : <View style={[s.scroll, { flex: 1 }, style]}>{children}</View>}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function TopBar({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={s.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('back')}
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/home')))} style={s.backBtn}>
        <Icon name="back" />
      </Pressable>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.topTitle}>{title}</Text>
        {subtitle ? <Text style={s.topSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Par défaut : ligne de liste à filet (pas de fond ni de bordure, trait de 1 px en haut).
 * `variant="choice"` : carte blanche sélectionnable, réservée aux choix (moyen de paiement, motif, prestataire, type de besoin).
 */
export function Card({ children, style, variant = 'row', selected, onPress, accessibilityLabel }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; variant?: 'row' | 'choice'; selected?: boolean;
  onPress?: () => void; accessibilityLabel?: string;
}) {
  const base = variant === 'choice' ? [s.choice, selected ? s.choiceOn : null] : [s.rowCard];
  if (!onPress) return <View style={[...base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel}
      accessibilityRole={variant === 'choice' ? 'radio' : 'button'}
      accessibilityState={variant === 'choice' ? { selected: !!selected } : undefined}
      style={({ pressed }) => [...base, pressed ? { opacity: 0.7 } : null, style]}>
      {children}
    </Pressable>
  );
}

/** Indicateur de choix exclusif (dans une Card « choice »). */
export function Radio({ on }: { on: boolean }) {
  return <View style={[s.radio, on ? { borderColor: palette.green } : null]}>{on ? <View style={s.radioDot} /> : null}</View>;
}

type Tone = 'primary' | 'secondary' | 'accent' | 'danger' | 'destructive' | 'neutral' | 'text' | 'disabled';
export function Button({ label, onPress, tone = 'primary', disabled, small, accessibilityLabel }: {
  label: string; onPress?: () => void; tone?: Tone; disabled?: boolean; small?: boolean; accessibilityLabel?: string;
}) {
  const st: Tone = disabled && tone !== 'text' ? 'disabled' : tone;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, small ? s.btnSmall : null, btnBg[st], pressed ? { opacity: 0.8 } : null]}>
      <Text style={[s.btnText, small ? { fontSize: fontSize.small + 1 } : null, { color: disabled && tone === 'text' ? palette.muted : btnFg[st] }]}>{label}</Text>
    </Pressable>
  );
}
const btnBg: Record<Tone, ViewStyle> = {
  primary: { backgroundColor: palette.green },
  secondary: { borderWidth: 1.5, borderColor: palette.green },
  accent: { backgroundColor: palette.yellow },
  danger: { borderWidth: 1.5, borderColor: palette.red },
  destructive: { backgroundColor: palette.red },
  neutral: { borderWidth: 1.5, borderColor: palette.line },
  text: {},
  disabled: { backgroundColor: neutralTint },
};
const btnFg: Record<Tone, string> = { primary: '#fff', secondary: palette.green, accent: palette.ink, danger: palette.red, destructive: '#FFFFFF', neutral: palette.ink, text: palette.green, disabled: palette.muted };

export type StatusKind = keyof typeof chips;
/** Libellé de statut : point de 7 px + texte 12 px gras, sans pastille. */
export function StatusLabel({ label, kind }: { label: string; kind: StatusKind }) {
  return (
    <View style={s.status}>
      <View style={[s.statusDot, { backgroundColor: statusDot[kind] }]} />
      <Text style={[s.statusText, { color: chips[kind].fg }]}>{label}</Text>
    </View>
  );
}

export function Banner({ text, tone = 'pending' }: { text: string; tone?: 'pending' | 'active' | 'error' }) {
  const c = chips[tone];
  return (
    <View style={[s.banner, { backgroundColor: c.bg }]} accessibilityRole={tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite">
      <Text style={{ color: c.fg, fontSize: fontSize.small, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

/** Ligne libellé / valeur séparée par un filet. */
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

/** Filet de séparation (sous un en-tête, comme la maquette). */
export const Divider = () => <View style={s.divider} />;

/** Interrupteur de la maquette (pilule verte, bouton blanc), identique sur toutes les plateformes ; zone tactile de 44 px. */
export function Toggle({ value, onChange, accessibilityLabel, disabled }: { value: boolean; onChange: (v: boolean) => void; accessibilityLabel: string; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={accessibilityLabel} accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled} onPress={() => onChange(!value)} hitSlop={6} style={[s.toggle, value ? s.toggleOn : null, disabled ? { opacity: 0.5 } : null]}>
      <View style={[s.knob, value ? { alignSelf: 'flex-end' } : null]} />
    </Pressable>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => <Text style={s.h2} accessibilityRole="header">{children}</Text>;
export const Title = ({ children }: { children: ReactNode }) => <Text style={s.title} accessibilityRole="header">{children}</Text>;

/** Champ de saisie : label 13 px gras au-dessus, champ 48 px, état d’erreur avec message. */
export function Field({ label, error, style, containerStyle, ...input }: TextInputProps & { label: string; error?: string | null; containerStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={palette.muted}
        {...input} style={[s.field, error ? s.fieldError : null, style]} />
      {error ? <Text style={s.fieldErrorText} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

/** Contrôle segmenté : choix exclusif, 44 px de haut. */
export function Segmented<K extends string>({ options, value, onChange, accessibilityLabel }: {
  options: ReadonlyArray<readonly [K, string]>; value: K; onChange: (k: K) => void; accessibilityLabel?: string;
}) {
  return (
    <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map(([k, label]) => {
        const on = k === value;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(k)} style={[s.segItem, on ? s.segItemOn : null]}>
            <Text style={[s.segText, on ? { color: '#fff' } : null]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Indicateur de pages : point actif allongé (24 px, vert), inactifs 8 px. */
export function StepDots({ count, index, accessibilityLabel }: { count: number; index: number; accessibilityLabel?: string }) {
  return (
    <View style={s.dots} accessible accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: count }, (_, i) => <View key={i} style={[s.dotItem, i === index ? s.dotOn : null]} />)}
    </View>
  );
}

/** Avatar d’initiales (décoratif : le nom est affiché à côté). */
export function Avatar({ initials, size = 44 }: { initials: string; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[s.avatarText, { fontSize: Math.round(size * 0.38) }]}>{initials}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: semantic.background },
  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -spacing.md },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: fontSize.title, fontWeight: '600', color: semantic.text },
  topSub: { fontSize: fontSize.caption, color: semantic.textMuted },
  title: { fontSize: fontSize.headline, fontWeight: '700', color: semantic.text },
  rowCard: { borderTopWidth: 1, borderTopColor: palette.line, paddingVertical: spacing.md, borderRadius: 0, minHeight: touchTarget },
  choice: { backgroundColor: semantic.surface, borderWidth: 1, borderColor: semantic.border, borderRadius: 14, paddingHorizontal: 14, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  choiceOn: { borderWidth: 2, borderColor: palette.green },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.green },
  btn: { height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnSmall: { height: touchTarget, flex: 1 },
  btnText: { fontSize: 16, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: fontSize.caption, fontWeight: '700' },
  banner: { borderRadius: radius.md, padding: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 7 },
  divider: { height: 1, backgroundColor: palette.line, alignSelf: 'stretch' },
  toggle: { width: 52, height: 32, borderRadius: 16, padding: 3, backgroundColor: palette.line, justifyContent: 'center' },
  toggleOn: { backgroundColor: palette.green },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF' },
  rowLabel: { fontSize: 14, color: semantic.textMuted },
  rowValue: { fontSize: 14, fontWeight: '500', color: semantic.text, flexShrink: 1, textAlign: 'right' },
  h2: { fontSize: 16, fontWeight: '600', color: semantic.text, marginTop: spacing.sm },
  fieldLabel: { fontSize: fontSize.small, fontWeight: '700', color: semantic.text },
  field: { height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, backgroundColor: semantic.surface, color: semantic.text },
  fieldError: { borderColor: semantic.error, borderWidth: 1.5 },
  fieldErrorText: { fontSize: fontSize.caption, color: semantic.error },
  seg: { flexDirection: 'row', backgroundColor: neutralTint, borderRadius: radius.md, overflow: 'hidden' },
  segItem: { flex: 1, height: touchTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segItemOn: { backgroundColor: palette.green },
  segText: { fontSize: fontSize.small, fontWeight: '600', color: semantic.text },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  dotItem: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.line },
  dotOn: { width: 24, backgroundColor: palette.green },
  avatar: { backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  lang: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl },
  langItem: { minHeight: touchTarget, minWidth: touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  langText: { fontSize: fontSize.body, fontWeight: '400' },
  langOn: { fontWeight: '700' },
  langBar: { height: 3, alignSelf: 'stretch', marginTop: 4, borderRadius: 2, backgroundColor: 'transparent' },
});

export const txStatusKind = (status: string): StatusKind =>
  status === 'IN_PROGRESS' ? 'active' : status === 'DRAFT' || status === 'CLOSED' || status === 'CANCELLED' ? 'draft' : status === 'DISPUTED' || status === 'REJECTED' ? 'error' : 'pending';
