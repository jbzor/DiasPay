import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { PLAN_TYPES, RECURRING_MAX, RECURRING_MIN, INSTALLMENTS_MAX, INSTALLMENTS_MIN } from '@diaspay/domain';
import type { PlanType, RecurrenceFreq, Vertical } from '@diaspay/domain';
import { fontSize, palette, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { dispatch, needContext, useWizard } from '@/state/needWizard';
import { AmountField } from '@/features/need/AmountField';
import { useNeedText } from '@/features/need/text';
import { issueFor, planGap, stepIssues } from '@/features/need/wizard';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Button, Field, Icon, Segmented } from '@/ui';
import { DateField } from '@/ui/DateField';

/** Plan proposé à l’ouverture selon le type de besoin (modifiable). */
const DEFAULT_PLAN: Partial<Record<Vertical, PlanType>> = { RENT: 'RECURRING', EDUCATION: 'INSTALLMENTS', HEALTH: 'SINGLE' };
const FREQS: RecurrenceFreq[] = ['WEEKLY', 'MONTHLY', 'QUARTERLY'];
/** Décision D3 : texte d’aide par type de plan. */
const PLAN_HELP = {
  SINGLE: 'plan_help_single', PARTIAL: 'plan_help_partial', INSTALLMENTS: 'plan_help_installments', RECURRING: 'plan_help_recurring',
} as const satisfies Record<PlanType, string>;

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <View style={st.stepperRow}>
      <Text style={st.fieldLabel}>{label}</Text>
      <View style={st.stepper}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('decrease')} : ${label}`} disabled={value <= min}
          onPress={() => onChange(value - 1)} style={[st.stepBtn, value <= min ? { opacity: 0.4 } : null]}><Text style={st.stepTxt}>−</Text></Pressable>
        <Text style={st.stepValue} accessibilityLiveRegion="polite">{value}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('increase')} : ${label}`} disabled={value >= max}
          onPress={() => onChange(value + 1)} style={[st.stepBtn, value >= max ? { opacity: 0.4 } : null]}><Text style={st.stepTxt}>+</Text></Pressable>
      </View>
    </View>
  );
}

/** G4 — Plan de paiement : unique, partiel, échelonné ou récurrent ; somme contrôlée par le domaine. */
export default function NeedPlan() {
  const { t, money } = useI18n();
  const { planLabels, issueText, planName } = useNeedText();
  const wiz = useWizard();
  const [touched, setTouched] = useState(false);
  const needsDefault = !!wiz && !wiz.draft.planType;
  useEffect(() => {
    const v = wiz?.draft.vertical;
    if (needsDefault) dispatch({ type: 'setPlanType', planType: (v && DEFAULT_PLAN[v]) || 'SINGLE', labels: planLabels, today: needContext().today });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDefault]);
  if (!wiz) return null;

  const ctx = needContext();
  const d = wiz.draft;
  const currency = d.currency ?? 'XAF';
  const m = (v: number) => money({ amountMinor: v, currency });
  const total = d.amountMinor ?? 0;
  const tranches = d.tranches ?? [];
  const gap = planGap(d);
  const issues = stepIssues(wiz, ctx);
  const field = (path: string) => (touched ? issueText(issueFor(issues, path)) : null);
  const planLevel = issues.filter((i) => (i.path === 'tranches' && i.code !== 'PLAN_SUM_MISMATCH') || i.path.startsWith('recurrence'));
  const recurring = d.planType === 'RECURRING';
  const rec = d.recurrence ?? { frequency: 'MONTHLY' as RecurrenceFreq, installments: 12, startDate: d.desiredDate ?? ctx.today };
  const setRec = (patch: Partial<typeof rec>) => dispatch({ type: 'setRecurrence', recurrence: { ...rec, ...patch }, labels: planLabels });

  return (
    <WizardFrame title={t('planTitle')}>
      <Segmented<PlanType> options={PLAN_TYPES.map((p) => [p, planName(p)] as const)} value={d.planType ?? 'SINGLE'}
        onChange={(p) => dispatch({ type: 'setPlanType', planType: p, labels: planLabels, today: ctx.today })} accessibilityLabel={t('planTitle')} />
      {d.planType ? <Text style={st.note}>{t(PLAN_HELP[d.planType])}</Text> : null}

      <View style={st.totalBlock}>
        <Text style={st.totalLabel}>{t('totalAmount')}</Text>
        <Text style={st.total}>{m(total)}</Text>
      </View>

      {d.planType === 'INSTALLMENTS' ? (
        <Stepper label={t('installmentCount')} value={tranches.length} min={INSTALLMENTS_MIN} max={INSTALLMENTS_MAX}
          onChange={(n) => dispatch({ type: 'setInstallmentCount', count: n, labels: planLabels, today: ctx.today })} />
      ) : null}

      {recurring ? (
        <View style={{ gap: spacing.md }}>
          <Text style={st.fieldLabel}>{t('frequency')}</Text>
          <Segmented<RecurrenceFreq> options={FREQS.map((f) => [f, t(`freq_${f}`)] as const)} value={rec.frequency}
            onChange={(f) => setRec({ frequency: f })} accessibilityLabel={t('frequency')} />
          <Stepper label={t('recurrenceCount')} value={rec.installments} min={RECURRING_MIN} max={RECURRING_MAX} onChange={(n) => setRec({ installments: n })} />
          <DateField label={t('startDate')} value={rec.startDate} minimumDate={ctx.today} onChange={(v) => v && setRec({ startDate: v })}
            error={issueText(issueFor(issues, 'tranches.0.dueDate'))} />
        </View>
      ) : null}

      <View>
        {tranches.map((tr, i) => (
          <View key={i} style={st.tranche}>
            {recurring ? (
              <View style={st.readRow}>
                <View>
                  <Text style={st.trTitle}>{tr.label}</Text>
                  <Text style={st.trSub}>{tr.dueDate ?? ''}</Text>
                </View>
                <Text style={st.trAmount}>{m(tr.amountMinor)}</Text>
              </View>
            ) : (
              <>
                <View style={st.trHead}>
                  <Text style={st.trTitle}>{t('trancheN', { n: i + 1 })}</Text>
                  {tranches.length > 1 ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('removeTranche', { n: i + 1 })} style={st.remove}
                      onPress={() => dispatch({ type: 'removeTranche', index: i })}>
                      <Text style={st.removeText}>{t('remove')}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Field label={t('trancheLabel')} value={tr.label} onChangeText={(v) => { setTouched(true); dispatch({ type: 'updateTranche', index: i, patch: { label: v } }); }}
                  error={field(`tranches.${i}.label`)} />
                <View style={st.pair}>
                  <View style={{ flex: 1 }}>
                    <DateField label={t('trancheDate')} value={tr.dueDate} minimumDate={ctx.today}
                      onChange={(v) => { setTouched(true); dispatch({ type: 'updateTranche', index: i, patch: { dueDate: v } }); }}
                      error={field(`tranches.${i}.dueDate`)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AmountField label={t('amount')} value={tr.amountMinor || undefined} currency={currency}
                      onChange={(v) => { setTouched(true); dispatch({ type: 'updateTranche', index: i, patch: { amountMinor: v ?? 0 } }); }} />
                  </View>
                </View>
              </>
            )}
          </View>
        ))}
      </View>

      {!recurring ? <Button tone="secondary" label={t('addTranche')} onPress={() => dispatch({ type: 'addTranche', label: t('labelInstallment') })} /> : null}

      <View style={st.sum} accessibilityLiveRegion="polite">
        <View style={[st.sumIcon, { backgroundColor: gap === 0 ? palette.greenTint : semantic.errorTint }]}>
          <Icon name={gap === 0 ? 'check' : 'alert'} size={14} color={gap === 0 ? palette.green : semantic.error} />
        </View>
        <Text style={[st.sumText, { color: gap === 0 ? palette.greenDark : semantic.error }]}>
          {t('plan_sum_ok', { sum: m(total - gap), total: m(total) })}
          {gap > 0 ? ` ${t('plan_sum_under', { gap: m(gap) })}` : gap < 0 ? ` ${t('plan_sum_over', { gap: m(-gap) })}` : ''}
        </Text>
      </View>
      {planLevel.map((i) => <Text key={i.code} style={st.error}>{issueText(i)}</Text>)}
      <Text style={st.note}>{t('plan_note')}</Text>
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  totalBlock: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.line },
  totalLabel: { fontSize: 13, color: palette.muted },
  total: { fontSize: 30, fontWeight: '700', color: palette.ink, letterSpacing: -0.5 },
  fieldLabel: { fontSize: fontSize.small, fontWeight: '700', color: palette.ink },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: { width: touchTarget, height: touchTarget, borderRadius: 22, borderWidth: 1.5, borderColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 22, color: palette.green, fontWeight: '600' },
  stepValue: { minWidth: 32, textAlign: 'center', fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
  tranche: { borderTopWidth: 1, borderTopColor: palette.line, paddingVertical: spacing.md, gap: spacing.sm },
  readRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trTitle: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  trSub: { fontSize: fontSize.caption, color: palette.muted },
  trAmount: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  remove: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  removeText: { fontSize: fontSize.small, fontWeight: '700', color: palette.red },
  pair: { flexDirection: 'row', gap: spacing.md },
  sum: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sumIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sumText: { flex: 1, fontSize: fontSize.small, fontWeight: '700' },
  error: { fontSize: fontSize.caption, color: semantic.error },
  note: { fontSize: fontSize.small, color: palette.muted, lineHeight: 19 },
});
