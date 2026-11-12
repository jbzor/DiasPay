import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import { canOpenDispute } from '@diaspay/domain';
import type { TxRole } from '@diaspay/domain';
import type { Tranche, Transaction } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { trancheStatusKey, txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { api, usePersona } from '@/state/api';
import { useDemo, useTransactionsQuery } from '@/state/queries';
import { QueryGate } from '@/ui/states';
import { Banner, Button, Divider, Field, Icon, Row, Screen, StatusLabel, TopBar, txStatusKind } from '@/ui';
import { Dialog } from '@/ui/Dialog';
import { openDraft } from '@/state/needWizard';

/** Dossier soumis, en validation ou rejeté : bandeau, motif, correction ; simulation du bureau de contrôle (démo). */
function ReviewPanel({ tx }: { tx: Transaction }) {
  const { t, errorText } = useI18n();
  const demo = useDemo();
  const [rejecting, setRejecting] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
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
          <View style={st.actions}>
            <Button small tone="secondary" label={t('abandon')} onPress={() => setAbandoning(true)} />
            <Button small label={t('correct')} onPress={() => void correct()} />
          </View>
        </View>
      ) : null}
      {demo && inReview ? (
        <View style={st.actions}>
          <Button small label={t('simApprove')} onPress={() => void run(() => api.simulateReview(tx.id, { approved: true }))} />
          <Button small tone="danger" label={t('simReject')} onPress={() => { setReason(''); setRejecting(true); }} />
        </View>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Dialog visible={abandoning} danger title={t('abandonTitle')} message={t('abandonConfirm')} confirmLabel={t('abandon')} cancelLabel={t('cancel')}
        onCancel={() => setAbandoning(false)}
        onConfirm={() => { setAbandoning(false); void run(() => api.abandonRejected(tx.id)); }} />
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
  const { t, shortDate: date, dateTime, money } = useI18n();
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
    : tr.status === 'CONFIRMED' ? t('confirmedAutoBy', { provider: tx.providerName, date: tr.contestEndsAt ? dateTime(tr.contestEndsAt) : '' })
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
        <Text style={st.itemTitle}>{t('trancheTitle', { n: tr.seq, amount })}</Text>
        <Text style={st.itemInfo}>{info}</Text>
        {persona === 'PAYER' && tr.status === 'AWAITING_PAYMENT' ? (
          <View style={st.actions}>
            <Button small tone="accent" label={t('pay')} onPress={() => router.push(`/pay/${tr.id}`)} />
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
        {tr.status === 'DISPUTED' || tr.status === 'CANCELLED' ? (
          <View style={st.actions}><Button small tone="secondary" label={t('viewDispute')} onPress={() => router.push(`/dispute/view/${tr.id}`)} /></View>
        ) : null}
        {tr.status === 'RELEASED' ? (
          <View style={st.actions}><Button small tone="secondary" label={t('viewReceipt')} onPress={() => router.push(`/receipt/${tr.id}`)} /></View>
        ) : null}
      </View>
    </View>
  );
}

export default function TransactionDetail() {
  const { id, tr: linkedTranche } = useLocalSearchParams<{ id: string; tr?: string }>();
  const { t, locale, money } = useI18n();
  const q = useTransactionsQuery();
  const tx = q.data?.find((x) => x.id === id);
  if (!tx) {
    // Chargement ou erreur sans donnée connue : squelette ou « Réessayer » ; sinon le dossier est introuvable.
    if (q.data === undefined) return <Screen><TopBar title={t('loadingData')} /><QueryGate query={q} rows={4}>{null}</QueryGate></Screen>;
    return <Screen><TopBar title={t('notFound')} /></Screen>;
  }
  // Arrivée par un lien interne (/tranche/<id>, depuis une notification) : on rappelle l’état de la tranche.
  const linked = linkedTranche ? tx.tranches.find((x) => x.id === linkedTranche) : undefined;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <TopBar title={`${verticalLabel(tx.vertical, locale)} · ${tx.providerName}`}
        subtitle={`${money(tx.amount)} · ${tx.tranches.length > 1 ? t('tranchesMany', { n: tx.tranches.length }) : t('tranchesOne')}`} />
      <Divider />
      {linked ? <Banner tone="pending" text={t('linkNotice', { n: linked.seq, status: t(trancheStatusKey(linked.status)) })} /> : null}
      <View>
        <Row label={t('beneficiary')} value={tx.beneficiaryName} />
        <Row label={t('providerLabel')} value={tx.providerName} />
        <Row label={t('purpose')} value={tx.purpose} />
        <View style={{ paddingTop: spacing.xs }}><StatusLabel kind={txStatusKind(tx.status)} label={t(txStatusKey(tx.status))} /></View>
      </View>
      <ReviewPanel tx={tx} />
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
