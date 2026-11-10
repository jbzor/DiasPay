import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { canOpenDispute } from '@diaspay/domain';
import type { TxRole } from '@diaspay/domain';
import type { Tranche, Transaction } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { trancheStatusKey, txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { api, usePersona, useTransactions } from '@/state/api';
import { Banner, Button, Field, H2, Icon, Row, Screen, StatusLabel, TopBar, txStatusKind } from '@/ui';
import { Dialog } from '@/ui/Dialog';
import { openDraft } from '@/state/needWizard';
import { DEMO_REVIEW } from '@/lib/env';

/** Dossier soumis, en validation ou rejeté : bandeau, motif, correction ; simulation du bureau de contrôle (démo). */
function ReviewPanel({ tx }: { tx: Transaction }) {
  const { t, errorText } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inReview = tx.status === 'SUBMITTED' || tx.status === 'IN_REVIEW';
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError(errorText(e)); } };

  async function correct() {
    await run(async () => {
      const draft = await api.reopenForCorrection(tx.id);
      const step = openDraft(draft);
      router.replace(`/need/${step}`);
    });
  }

  if (!inReview && tx.status !== 'REJECTED') return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {inReview ? <Banner text={t('inReviewBanner')} /> : null}
      {tx.status === 'REJECTED' ? (
        <View style={st.rejected}>
          <Text style={st.statusLabel}>{t('rejectionReason')}</Text>
          <Text style={st.reason}>{tx.rejectionReason ?? ''}</Text>
          <Button label={t('correct')} onPress={() => void correct()} />
        </View>
      ) : null}
      {DEMO_REVIEW && inReview ? (
        <View style={st.actions}>
          <Button small label={t('simApprove')} onPress={() => void run(() => api.simulateReview(tx.id, { approved: true }))} />
          <Button small tone="danger" label={t('simReject')} onPress={() => { setReason(''); setRejecting(true); }} />
        </View>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Dialog visible={rejecting} danger title={t('simReject')} confirmLabel={t('confirmReject')} cancelLabel={t('cancel')}
        confirmDisabled={reason.trim().length < 3} onCancel={() => setRejecting(false)}
        onConfirm={() => { setRejecting(false); void run(() => api.simulateReview(tx.id, { approved: false, reason })); }}>
        <Field label={t('rejectionReason')} value={reason} onChangeText={setReason} placeholder={t('simRejectPlaceholder')} autoFocus />
      </Dialog>
    </View>
  );
}

const dotColor = (s: Tranche['status']) =>
  s === 'RELEASED' ? palette.green : s === 'AWAITING_PAYMENT' ? palette.yellow : s === 'DISPUTED' ? palette.red : s === 'PLANNED' ? palette.disabled : palette.green;

function TrancheItem({ tx, tr, last }: { tx: Transaction; tr: Tranche; last: boolean }) {
  const { t, date, dateTime, money } = useI18n();
  const persona = usePersona();
  const roles: TxRole[] = persona === 'PAYER' ? ['PAYER'] : ['PROVIDER'];
  const canDispute = canOpenDispute({
    status: tr.status, releaseMode: tr.releaseMode, contestHours: tr.contestHours,
    contestEndsAt: tr.contestEndsAt ? new Date(tr.contestEndsAt) : undefined,
  }, roles, new Date());
  const amount = money({ amountMinor: tr.amountMinor, currency: tx.amount.currency });

  const info =
    tr.status === 'RELEASED' ? t('releasedOn', { date: tr.releasedAt ? date(tr.releasedAt) : '' })
    : tr.status === 'PLANNED' ? (tr.dueDate ? t('plannedOn', { date: date(tr.dueDate) }) : t('milestone'))
    : tr.status === 'AWAITING_PAYMENT' ? (tr.dueDate ? t('payBefore', { date: date(tr.dueDate) }) : '')
    : tr.status === 'PAID_LOCKED' ? t('awaitingProvider')
    : tr.status === 'CONFIRMED' ? t('confirmedAuto', { date: tr.contestEndsAt ? dateTime(tr.contestEndsAt) : '' })
    : tr.status === 'EVIDENCE_SUBMITTED' ? t('evidencePending')
    : tr.status === 'DISPUTED' ? t('disputed') : '';

  return (
    <View style={st.item}>
      <View style={st.rail}>
        <View style={[st.dot, { backgroundColor: dotColor(tr.status) }]}>
          {tr.status === 'RELEASED' ? <Icon name="check" size={16} color="#fff" /> : <Text style={[st.dotText, { color: tr.status === 'AWAITING_PAYMENT' ? palette.ink : '#fff' }]}>{tr.seq}</Text>}
        </View>
        {last ? null : <View style={st.line} />}
      </View>
      <View style={st.body}>
        <Text style={st.itemTitle}>{tr.label} · {amount}</Text>
        <Text style={st.itemInfo}>{info}</Text>
        {persona === 'PAYER' && tr.status === 'AWAITING_PAYMENT' ? (
          <View style={st.actions}>
            <Button small tone="accent" label={t('pay')} onPress={() => router.push(`/pay/${tr.id}`)} />
            <Button small tone="secondary" label={t('showQr')} onPress={() => router.push(`/token/${tr.id}`)} />
          </View>
        ) : null}
        {persona === 'PAYER' && tr.status === 'CONFIRMED' ? (
          <View style={st.actions}>
            {canDispute ? <Button small tone="danger" label={t('openDispute')} onPress={() => router.push(`/dispute/${tr.id}`)} /> : null}
            <Button small label={t('release')} onPress={() => api.approveRelease(tr.id)} />
          </View>
        ) : null}
        {persona === 'PAYER' && tr.status === 'PAID_LOCKED' ? (
          <View style={st.actions}>
            {canDispute ? <Button small tone="danger" label={t('openDispute')} onPress={() => router.push(`/dispute/${tr.id}`)} /> : null}
            <Button small tone="secondary" label={t('showQr')} onPress={() => router.push(`/token/${tr.id}`)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function TransactionDetail() {
  const { id, tr: linkedTranche } = useLocalSearchParams<{ id: string; tr?: string }>();
  const { t, locale, money } = useI18n();
  const tx = useTransactions().find((x) => x.id === id);
  if (!tx) return <Screen><TopBar title={t('notFound')} /></Screen>;
  // Arrivée par un lien /t/<référence> sur une tranche qui n’appelle aucune action immédiate : on explique son état.
  const linked = linkedTranche ? tx.tranches.find((x) => x.id === linkedTranche) : undefined;
  return (
    <Screen>
      <TopBar title={`${verticalLabel(tx.vertical, locale)} · ${tx.providerName}`} subtitle={t('trancheCount', { n: tx.tranches.length })} />
      {linked ? <Banner tone="pending" text={t('linkNotice', { n: linked.seq, status: t(trancheStatusKey(linked.status)) })} /> : null}
      <View>
        <View style={st.statusRow}>
          <Text style={st.statusLabel}>{t('status')}</Text>
          <StatusLabel kind={txStatusKind(tx.status)} label={t(txStatusKey(tx.status))} />
        </View>
        <Row label={t('total')} value={money(tx.amount)} />
        <Row label={t('beneficiary')} value={tx.beneficiaryName} />
        <Row label={t('providerLabel')} value={tx.providerName} />
        <Row label={t('purpose')} value={tx.purpose} />
      </View>
      <ReviewPanel tx={tx} />
      <H2>{t('tranches')}</H2>
      <View style={{ marginTop: spacing.xs }}>
        {tx.tranches.map((tr, i) => <TrancheItem key={tr.id} tx={tx} tr={tr} last={i === tx.tranches.length - 1} />)}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center' },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: fontSize.small, fontWeight: '600' },
  line: { flex: 1, width: 2, backgroundColor: palette.line, marginTop: 4 },
  body: { flex: 1, paddingBottom: spacing.lg },
  itemTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  itemInfo: { fontSize: fontSize.small, color: palette.muted, marginTop: 2, marginBottom: spacing.sm },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  statusLabel: { fontSize: 14, color: palette.muted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  rejected: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  reason: { fontSize: fontSize.body, lineHeight: 22, color: palette.ink },
});
