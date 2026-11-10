import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router } from 'expo-router';
import type { ApiError } from '@diaspay/api-client';
import { describeRelease } from '@diaspay/domain';
import type { NeedIssue } from '@diaspay/domain';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api } from '@/state/api';
import { discardWizard, saveNow, useWizard } from '@/state/needWizard';
import { useNeedText } from '@/features/need/text';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Banner, Button, Divider, Row } from '@/ui';
import { showToast } from '@/ui/Toast';

/** G6 — Récapitulatif : contrôle complet par le domaine à l’envoi ; brouillon enregistrable. */
export default function NeedRecap() {
  const { t, locale, money, date, errorText } = useI18n();
  const { issueText, docLabel } = useNeedText();
  const wiz = useWizard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!wiz || !wiz.draft.vertical) return null;
  const d = wiz.draft;
  const vertical = d.vertical as NonNullable<typeof d.vertical>;
  const currency = d.currency ?? 'XAF';
  const total = { amountMinor: d.amountMinor ?? 0, currency };
  const tranches = d.tranches ?? [];
  const docs = d.documents.filter((x) => x.status === 'UPLOADED').length;
  const rule = describeRelease(vertical);
  const firstDue = tranches[0]?.dueDate;
  const planLine = d.planType === 'SINGLE'
    ? t('planSummary_SINGLE', { amount: money(total) })
    : d.planType ? t(`planSummary_${d.planType}`, { n: tranches.length }) : '';

  async function submit() {
    setBusy(true); setError(null);
    try {
      await saveNow();
      const tx = await api.submitNeed(d.id);
      discardWizard();
      router.replace(`/need-done/${tx.id}`);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'DOCUMENT_REQUIRED') setError(t('need_DOCUMENT_REQUIRED', { doc: docLabel(String(err.details?.kind ?? '')) }));
      else if (err.code === 'VALIDATION') {
        const issues = (err.details?.issues as NeedIssue[] | undefined) ?? [];
        setError(issues.length ? issues.map((i) => issueText(i)).join('\n') : errorText(e));
      } else setError(errorText(e));
      setBusy(false);
    }
  }

  async function saveDraftAndLeave() {
    await saveNow();
    showToast(t('draftSaved'));
    router.dismissTo('/transactions');
  }

  return (
    <WizardFrame title={t('recapTitle')} footer={(
      <>
        <Button label={t('submitNeed')} onPress={submit} disabled={busy} />
        <Button tone="secondary" label={t('saveDraft')} onPress={saveDraftAndLeave} disabled={busy} />
      </>
    )}>
      <Divider />
      {d.rejectionReason ? <Banner tone="error" text={t('rejectedBanner', { reason: d.rejectionReason })} /> : null}
      <View>
        <Row label={t('needType')} value={verticalLabel(vertical, locale)} />
        <Row label={t('purpose')} value={d.purpose ?? ''} />
        <Row label={t('beneficiary')} value={d.beneficiaryName ?? ''} />
        <Row label={t('providerLabel')} value={d.provider?.name ?? ''} />
        <Row label={t('amount')} value={money(total)} />
        {d.counterpartyPhone ? <Row label={t('payerPhone')} value={d.counterpartyPhone} /> : null}
      </View>
      <View style={st.block}>
        <Text style={st.blockLabel}>{t('planTitle')}</Text>
        <Text style={st.blockTitle}>{planLine}</Text>
        {firstDue ? <Text style={st.blockSub}>{t('planFirstDue', { date: date(firstDue) })}</Text> : null}
      </View>
      <View style={st.block}>
        <Text style={st.blockLabel}>{t('documentsTitle')}</Text>
        <Text style={st.blockTitle}>{docs === 1 ? t('docsCountOne') : t('docsCount', { n: docs })}</Text>
      </View>
      <View style={st.block}>
        <Text style={st.blockLabel}>{t('releaseRule')}</Text>
        <Text style={st.blockTitle}>{t(`release_${rule.releaseMode}`, { hours: rule.contestHours })}</Text>
      </View>
      <Banner tone="active" text={t('reviewNote')} />
      {error ? <Banner tone="error" text={error} /> : null}
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  block: { borderTopWidth: 1, borderTopColor: palette.line, paddingTop: spacing.md, gap: 2 },
  blockLabel: { fontSize: fontSize.caption, color: palette.muted },
  blockTitle: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  blockSub: { fontSize: fontSize.caption, color: palette.muted },
});
