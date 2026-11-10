import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RECURRING_MAX, RECURRING_MIN, formatAmountInput } from '@diaspay/domain';
import type { PlanType, RecurrenceFreq, Vertical } from '@diaspay/domain';
import { fontSize, palette, radius, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { dispatch, needContext, useWizard } from '@/state/needWizard';
import { AmountField } from '@/features/need/AmountField';
import { useNeedText } from '@/features/need/text';
import { issueFor, planGap, stepIssues } from '@/features/need/wizard';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Button, Divider, Field, Icon, Segmented } from '@/ui';
import { DateField } from '@/ui/DateField';
import { Text } from '@/ui/text';

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

/**
 * G4 — Plan de paiement : unique, partiel, échelonné ou récurrent ; somme contrôlée par le domaine.
 * Tranches en lignes compactes (maquette) ; toucher une tranche ouvre sa fiche de modification.
 */
export default function NeedPlan() {
  const { t, locale, money, date } = useI18n();
  const { planLabels, issueText, planName } = useNeedText();
  const wiz = useWizard();
  const [editing, setEditing] = useState<number | null>(null);
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
  const n = (v: number) => formatAmountInput(v, currency, locale) || '0';
  const total = d.amountMinor ?? 0;
  const tranches = d.tranches ?? [];
  const gap = planGap(d);
  const issues = stepIssues(wiz, ctx);
  const planLevel = issues.filter((i) => (i.path === 'tranches' && i.code !== 'PLAN_SUM_MISMATCH') || i.path.startsWith('recurrence'));
  const rowError = (i: number) => issueText(issueFor(issues, `tranches.${i}.label`) ?? issueFor(issues, `tranches.${i}.dueDate`));
  const recurring = d.planType === 'RECURRING';
  const rec = d.recurrence ?? { frequency: 'MONTHLY' as RecurrenceFreq, installments: 12, startDate: d.desiredDate ?? ctx.today };
  const setRec = (patch: Partial<typeof rec>) => dispatch({ type: 'setRecurrence', recurrence: { ...rec, ...patch }, labels: planLabels });
  const current = editing !== null ? tranches[editing] : undefined;

  return (
    <WizardFrame title={t('planTitle')}
      extraFooter={!recurring ? <Button tone="secondary" label={t('addTranche')} onPress={() => { dispatch({ type: 'addTranche', label: t('labelInstallment') }); setEditing(tranches.length); }} /> : undefined}>
      <Segmented<PlanType> options={(['SINGLE', 'PARTIAL', 'INSTALLMENTS', 'RECURRING'] as const).map((p) => [p, planName(p)] as const)} value={d.planType ?? 'SINGLE'}
        onChange={(p) => dispatch({ type: 'setPlanType', planType: p, labels: planLabels, today: ctx.today })} accessibilityLabel={t('planTitle')} />
      {d.planType ? <Text style={st.note}>{t(PLAN_HELP[d.planType])}</Text> : null}

      <Divider />
      <View>
        <Text style={st.totalLabel}>{t('totalAmount')}</Text>
        <Text style={st.total}>{m(total)}</Text>
      </View>

      {recurring ? (
        <View style={{ gap: spacing.md }}>
          <Text style={st.fieldLabel}>{t('frequency')}</Text>
          <Segmented<RecurrenceFreq> options={FREQS.map((f) => [f, t(`freq_${f}`)] as const)} value={rec.frequency}
            onChange={(f) => setRec({ frequency: f })} accessibilityLabel={t('frequency')} />
          <Stepper label={t('recurrenceCount')} value={rec.installments} min={RECURRING_MIN} max={RECURRING_MAX} onChange={(k) => setRec({ installments: k })} />
          <DateField label={t('startDate')} value={rec.startDate} minimumDate={ctx.today} onChange={(v) => v && setRec({ startDate: v })}
            error={issueText(issueFor(issues, 'tranches.0.dueDate'))} />
        </View>
      ) : null}

      <View>
        {tranches.map((tr, i) => {
          const isDefault = !tr.label.trim() || tr.label.trim() === `${planLabels.installment} ${i + 1}`;
          const title = isDefault ? t('trancheN', { n: i + 1 }) : t('trancheTitleLabel', { n: i + 1, label: tr.label.trim() });
          const err = rowError(i);
          const content = (
            <>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.trTitle}>{title}</Text>
                <Text style={[st.trSub, err ? { color: semantic.error } : null]}>{err ?? (tr.dueDate ? date(tr.dueDate) : t('trancheDate'))}</Text>
              </View>
              <Text style={st.trAmount}>{n(tr.amountMinor)}</Text>
              {!recurring ? <Icon name="chevron" size={18} color={palette.muted} /> : null}
            </>
          );
          return recurring
            ? <View key={i} style={st.trRow}>{content}</View>
            : (
              <Pressable key={i} accessibilityRole="button" accessibilityLabel={`${title}, ${tr.dueDate ? date(tr.dueDate) : ''}, ${m(tr.amountMinor)}`}
                onPress={() => setEditing(i)} style={({ pressed }) => [st.trRow, pressed ? { opacity: 0.7 } : null]}>
                {content}
              </Pressable>
            );
        })}
      </View>

      <View style={st.sum} accessibilityLiveRegion="polite">
        <View style={[st.sumIcon, { backgroundColor: gap === 0 ? palette.greenTint : semantic.errorTint }]}>
          <Icon name={gap === 0 ? 'check' : 'alert'} size={14} color={gap === 0 ? palette.green : semantic.error} />
        </View>
        <Text style={[st.sumText, { color: gap === 0 ? palette.greenDark : semantic.error }]}>
          {t('plan_sum_ok', { sum: n(total - gap), total: m(total) })}
          {gap > 0 ? ` ${t('plan_sum_under', { gap: m(gap) })}` : gap < 0 ? ` ${t('plan_sum_over', { gap: m(-gap) })}` : ''}
        </Text>
      </View>
      {planLevel.map((i) => <Text key={i.code} style={st.error}>{issueText(i)}</Text>)}
      <Text style={st.note}>{t('plan_note')}</Text>

      <Modal visible={current !== undefined} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView edges={['bottom']} style={st.sheet}>
            {current && editing !== null ? (
              <>
                <Text style={st.sheetTitle} accessibilityRole="header">{t('trancheN', { n: editing + 1 })}</Text>
                <Field label={t('trancheLabel')} value={current.label}
                  onChangeText={(v) => dispatch({ type: 'updateTranche', index: editing, patch: { label: v } })}
                  error={issueText(issueFor(issues, `tranches.${editing}.label`))} />
                <View style={st.pair}>
                  <View style={{ flex: 1 }}>
                    <DateField label={t('trancheDate')} value={current.dueDate} minimumDate={ctx.today}
                      onChange={(v) => dispatch({ type: 'updateTranche', index: editing, patch: { dueDate: v } })}
                      error={issueText(issueFor(issues, `tranches.${editing}.dueDate`))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AmountField label={t('amount')} value={current.amountMinor || undefined} currency={currency}
                      onChange={(v) => dispatch({ type: 'updateTranche', index: editing, patch: { amountMinor: v ?? 0 } })} />
                  </View>
                </View>
                <Button label={t('ok')} onPress={() => setEditing(null)} />
                {tranches.length > 1 ? (
                  <Button tone="danger" label={t('removeTranche', { n: editing + 1 })}
                    onPress={() => { dispatch({ type: 'removeTranche', index: editing }); setEditing(null); }} />
                ) : null}
              </>
            ) : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  totalLabel: { fontSize: 13, color: palette.muted },
  total: { fontSize: 28, fontWeight: '700', color: palette.ink, letterSpacing: -0.5 },
  fieldLabel: { fontSize: fontSize.small, fontWeight: '700', color: palette.ink },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: { width: touchTarget, height: touchTarget, borderRadius: 22, borderWidth: 1.5, borderColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 22, color: palette.green, fontWeight: '600' },
  stepValue: { minWidth: 32, textAlign: 'center', fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
  trRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 64, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  trTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  trSub: { fontSize: fontSize.caption + 1, color: palette.muted },
  trAmount: { fontSize: fontSize.body + 1, fontWeight: '600', color: palette.ink },
  pair: { flexDirection: 'row', gap: spacing.md },
  sum: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sumIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sumText: { flex: 1, fontSize: fontSize.small, fontWeight: '700' },
  error: { fontSize: fontSize.caption, color: semantic.error },
  note: { fontSize: fontSize.small, color: palette.muted, lineHeight: 19 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,26,0.4)' },
  sheet: { backgroundColor: semantic.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  sheetTitle: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
});
