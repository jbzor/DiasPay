import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { toIsoDate } from '@diaspay/domain';
import { disabledSurface, fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { dispatch, useWizard } from '@/state/needWizard';
import { useNeedText } from '@/features/need/text';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Card } from '@/ui';
import { useModuleList } from '@/state/modules';
import { useModulesQuery } from '@/state/queries';
import { en } from '@/i18n/messages';
import type { Key } from '@/i18n';

/**
 * G1 — Type de besoin. Lot X (X6) : la liste vient des modules du serveur (request_modules) ; un module désactivé
 * (vague 2) reste visible et désactivé. Vague 1 : Scolarité, Santé, Loyer.
 */
export default function NeedType() {
  const { t, locale } = useI18n();
  const { planLabels } = useNeedText();
  const wiz = useWizard();
  useModulesQuery();
  const modules = useModuleList();
  if (!wiz) return null;
  const selected = wiz.draft.vertical;
  return (
    <WizardFrame>
      <Text style={st.question} accessibilityRole="header">{t('whatToFund')}</Text>
      <View style={st.grid} accessibilityRole="radiogroup" accessibilityLabel={t('whatToFund')}>
        {modules.map((m) => {
          const v = m.code;
          const open = m.enabled;
          const label = verticalLabel(v, locale);
          const desc = `vdesc_${v}` in en ? t(`vdesc_${v}` as Key) : m.descriptions?.[locale] ?? '';
          return (
            <View key={v} style={st.cell}>
              <Card variant="choice" selected={selected === v} style={[st.card, !open ? st.cardOff : null]}
                accessibilityLabel={open ? label : `${label}, ${t('soon')}`}
                onPress={open ? () => dispatch({ type: 'patch', patch: { vertical: v }, labels: planLabels, today: toIsoDate(new Date()) }) : undefined}>
                <View style={{ gap: 4, flex: 1 }}>
                  <Text style={[st.name, !open ? { color: palette.muted } : null]}>{label}</Text>
                  <Text style={st.desc}>{open ? desc : t('soon')}</Text>
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
