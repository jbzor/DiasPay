import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { fontSize, palette, spacing, touchTarget } from '@diaspay/ui-tokens';
import { Icon } from '@/ui';
import { Text } from '@/ui/text';

/** Titre de section : 13 px, atténué, filet dessous. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={st.section} accessibilityRole="header">{children}</Text>;
}

/** Ligne de réglage à filet : libellé, valeur facultative, chevron si elle s’ouvre. */
export function SettingsRow({ label, value, onPress, accessory, sub }: {
  label: string; value?: string; onPress?: () => void; accessory?: ReactNode; sub?: string;
}) {
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.label}>{label}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      {value ? <Text style={st.value}>{value}</Text> : null}
      {accessory}
      {onPress && !accessory ? <Icon name="chevron" size={20} color={palette.muted} /> : null}
    </>
  );
  if (!onPress) return <View style={st.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress}
      style={({ pressed }) => [st.row, pressed ? { opacity: 0.7 } : null]}>
      {content}
    </Pressable>
  );
}

const st = StyleSheet.create({
  section: { fontSize: fontSize.small, fontWeight: '600', color: palette.muted, paddingTop: spacing.md, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: palette.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.line },
  label: { fontSize: fontSize.body + 1, color: palette.ink },
  sub: { fontSize: fontSize.small + 1, lineHeight: 19, color: palette.muted },
  value: { fontSize: fontSize.body + 1, color: palette.muted, minHeight: touchTarget / 2 },
});
