import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { CURRENCIES, findModule, toIsoDate } from '@diaspay/domain';
import type { Currency, NeedDraft } from '@diaspay/domain';
import { fontSize, palette } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { dispatch, needContext, useWizard } from '@/state/needWizard';
import { getModules } from '@/state/modules';
import { AmountField } from '@/features/need/AmountField';
import { useNeedText } from '@/features/need/text';
import { issueFor, stepIssues } from '@/features/need/wizard';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Field, Segmented } from '@/ui';
import { DateField } from '@/ui/DateField';

/** G2 — Détails : montant, devise, objectif, bénéficiaire, date souhaitée (+ téléphone du payeur pour un demandeur). */
export default function NeedDetails() {
  const { t, locale } = useI18n();
  const { issueText, planLabels } = useNeedText();
  const wiz = useWizard();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const missingCurrency = !!wiz && !wiz.draft.currency;
  useEffect(() => {
    if (missingCurrency) dispatch({ type: 'patch', patch: { currency: 'XAF' }, labels: planLabels, today: toIsoDate(new Date()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingCurrency]);
  if (!wiz) return null;
  const d = wiz.draft;
  const ctx = needContext();
  const issues = stepIssues(wiz, ctx);
  const err = (path: string) => (touched[path] ? issueText(issueFor(issues, path)) : null);
  const touch = (path: string) => setTouched((s) => ({ ...s, [path]: true }));
  const patch = (p: Partial<NeedDraft>) => dispatch({ type: 'patch', patch: p, labels: planLabels, today: ctx.today });
  const currency: Currency = d.currency ?? 'XAF';
  const isRequester = ctx.creatorRole === 'REQUESTER';
  const beneficiaryMode = findModule(d.vertical, getModules())?.beneficiaryMode ?? 'NAME';

  return (
    <WizardFrame detail={d.vertical ? verticalLabel(d.vertical, locale) : undefined}>
      <AmountField label={t('amount')} value={d.amountMinor} currency={currency}
        onChange={(v) => { touch('amountMinor'); patch({ amountMinor: v }); }} error={err('amountMinor')} />
      <Segmented<Currency> options={CURRENCIES.map((c) => [c, t(`cur_${c}`)] as const)} value={currency}
        onChange={(c) => patch({ currency: c })} accessibilityLabel={t('currency')} />
      <Field label={t('purpose')} value={d.purpose ?? ''} placeholder={t('purposePlaceholder')} maxLength={500}
        onChangeText={(v) => patch({ purpose: v })} onBlur={() => touch('purpose')} error={err('purpose')} />
      {/* Lot X v2 (X6, K13) : le module dit comment désigner le bénéficiaire (nom, référence minimale, ou rien). */}
      {beneficiaryMode === 'NAME' ? (
        <Field label={t('beneficiary')} value={d.beneficiaryName ?? ''} placeholder={t('beneficiaryPlaceholder')} autoCapitalize="words"
          onChangeText={(v) => patch({ beneficiaryName: v })} onBlur={() => touch('beneficiaryName')} error={err('beneficiaryName')} />
      ) : beneficiaryMode === 'REFERENCE_ONLY' ? (
        <View style={{ gap: 4 }}>
          <Field label={t('beneficiaryReference')} value={d.beneficiaryReference ?? ''} autoCapitalize="characters" maxLength={16}
            onChangeText={(v) => patch({ beneficiaryReference: v })} onBlur={() => touch('beneficiaryReference')} error={err('beneficiaryReference')} />
          <Text style={st.help}>{t('beneficiaryReferenceHint')}</Text>
        </View>
      ) : null}
      <DateField label={t('desiredDate')} value={d.desiredDate} minimumDate={toIsoDate(new Date())} clearable
        onChange={(v) => { touch('desiredDate'); patch({ desiredDate: v }); }} error={err('desiredDate')} />
      {isRequester ? (
        // Ajout lot 3, absent de la maquette G2 : à valider par le client.
        <View style={{ gap: 4 }}>
          <Field label={t('payerPhone')} value={d.counterpartyPhone ?? ''} placeholder={t('phoneIntlPlaceholder')} keyboardType="phone-pad"
            textContentType="telephoneNumber" onChangeText={(v) => patch({ counterpartyPhone: v })} onBlur={() => touch('counterpartyPhone')}
            error={err('counterpartyPhone')} />
          <Text style={st.help}>{t('payerPhoneHelp')}</Text>
        </View>
      ) : null}
      <Text style={st.help}>{t('earmarkNote')}</Text>
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  help: { fontSize: fontSize.small, lineHeight: 19, color: palette.muted },
});
