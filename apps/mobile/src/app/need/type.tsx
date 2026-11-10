import { StyleSheet, Text, View } from 'react-native';
import { VERTICALS, WAVE1_VERTICALS, toIsoDate } from '@diaspay/domain';
import type { Vertical } from '@diaspay/domain';
import { disabledSurface, fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { dispatch, useWizard } from '@/state/needWizard';
import { useNeedText } from '@/features/need/text';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Card } from '@/ui';

/** G1 — Type de besoin. Vague 1 : Scolarité, Santé, Loyer ; les autres sont visibles mais désactivés. */
export default function NeedType() {
  const { t, locale } = useI18n();
  const { planLabels } = useNeedText();
  const wiz = useWizard();
  if (!wiz) return null;
  const selected = wiz.draft.vertical;
  return (
    <WizardFrame>
      <Text style={st.question} accessibilityRole="header">{t('whatToFund')}</Text>
      <View style={st.grid} accessibilityRole="radiogroup" accessibilityLabel={t('whatToFund')}>
        {VERTICALS.map((v: Vertical) => {
          const open = WAVE1_VERTICALS.includes(v);
          const label = verticalLabel(v, locale);
          return (
            <View key={v} style={st.cell}>
              <Card variant="choice" selected={selected === v} style={[st.card, !open ? st.cardOff : null]}
                accessibilityLabel={open ? label : `${label}, ${t('soon')}`}
                onPress={open ? () => dispatch({ type: 'patch', patch: { vertical: v }, labels: planLabels, today: toIsoDate(new Date()) }) : undefined}>
                <View style={{ gap: 4, flex: 1 }}>
                  <Text style={[st.name, !open ? { color: palette.muted } : null]}>{label}</Text>
                  <Text style={st.desc}>{open ? t(`vdesc_${v}`) : t('soon')}</Text>
                </View>
              </Card>
            </View>
          );
        })}
      </View>
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  question: { fontSize: fontSize.body + 1, fontWeight: '700', color: palette.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
  card: { minHeight: 96, alignItems: 'flex-start', paddingVertical: spacing.md },
  cardOff: { backgroundColor: disabledSurface },
  name: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  desc: { fontSize: fontSize.caption, lineHeight: 16, color: palette.muted },
});
