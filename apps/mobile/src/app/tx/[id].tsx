import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import { canOpenDispute } from '@diaspay/domain';
import { placeIn } from '@diaspay/api-client';
import type { Tranche, Transaction } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { trancheStatusKey, txStatusKey, useI18n, verticalLabel } from '@/i18n';
import type { Key } from '@/i18n/messages';
import { trancheInfo } from '@/features/tx/trancheInfo';
import { trackingKey, trackingKind, trackingOf } from '@/features/tx/tracking';
import { api, getCurrentUser } from '@/state/api';
import { useDemo, useDisputeQuery, useTransactionsQuery } from '@/state/queries';
import { QueryGate } from '@/ui/states';
import { Banner, Button, Divider, Field, Icon, Row, Screen, StatusLabel, TopBar, txStatusKind } from '@/ui';
import { Dialog } from '@/ui/Dialog';
import { receiptAvailable } from '@/features/receipt/receipt';
import { showToast } from '@/ui/Toast';

/**
 * Lot X version 2 : opération en revue (bandeau, simulation du bureau de contrôle en démonstration), suspendue (litige
 * ouvert avant paiement) ou rejetée par le bureau (CANCELLED avec motif : motif affiché, aucune correction possible).
 * L’initiateur peut annuler une opération active (cancelOperation) : à la place de l’ancien « Abandonner ».
 */
function ReviewPanel({ tx }: { tx: Transaction }) {
  const { t, errorText } = useI18n();
  const demo = useDemo();
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inReview = tx.status === 'PENDING_REVIEW' || tx.status === 'IN_REVIEW';
  const rejected = tx.status === 'CANCELLED' && !!tx.rejectionReason;
  const me = getCurrentUser();
  // Initiateur seulement ; pas pendant un paiement en cours (ACCEPTED), que l’annulation ne peut pas interrompre.
  const canCancel = tx.status === 'ACTIVE' && placeIn(tx, me?.id).initiator && !tx.tranches.some((r) => r.status === 'ACCEPTED');
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError(errorText(e)); } };

  if (!inReview && !rejected && !canCancel && tx.status !== 'SUSPENDED') return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {inReview ? <Banner text={t('inReviewBanner')} /> : null}
      {tx.status === 'SUSPENDED' ? <Banner tone="error" text={t('txSuspendedBanner')} /> : null}
      {rejected ? (
        <View style={st.rejected}>
          <Text style={st.statusLabel}>{t('rejectionReason')}</Text>
          <Text style={st.reason}>{tx.rejectionReason ?? ''}</Text>
          <Text style={st.statusLabel}>{t('rejectedFinal')}</Text>
        </View>
      ) : null}
      {canCancel ? (
        <View style={st.actions}>
          <Button small tone="secondary" label={t('cancelOperation')} onPress={() => setCancelling(true)} />
        </View>
      ) : null}
      {demo && inReview ? (
        <View style={st.actions}>
          <Button small label={t('simApprove')} onPress={() => void run(() => api.simulateReview(tx.id, { approved: true }))} />
          <Button small tone="danger" label={t('simReject')} onPress={() => { setReason(''); setRejecting(true); }} />
        </View>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Dialog visible={cancelling} danger title={t('cancelOperation')} message={t('cancelOperationConfirm')} confirmLabel={t('cancelOperation')} cancelLabel={t('cancel')}
        onCancel={() => setCancelling(false)}
        onConfirm={() => { setCancelling(false); void run(() => api.cancelOperation(tx.id)); }} />
      <Dialog visible={rejecting} danger title={t('simReject')} confirmLabel={t('confirmReject')} cancelLabel={t('cancel')}
        confirmDisabled={reason.trim().length < 3} onCancel={() => setRejecting(false)}
        onConfirm={() => { setRejecting(false); void run(() => api.simulateReview(tx.id, { approved: false, reason })); }}>
        <Field label={t('rejectionReason')} value={reason} onChangeText={setReason} placeholder={t('simRejectPlaceholder')} autoFocus />
      </Dialog>
    </View>
  );
}

/** Tranche terminée côté payeur : payée en règlement direct, ou fonds traités en déblocage conditionnel. */
const settled = (tx: Transaction, tr: Tranche) =>
  (tr.status === 'PAID' || tr.status === 'REFUNDED') && (tx.settlementMode === 'DIRECT' || tr.fundsState !== 'HELD');

const dotColor = (tx: Transaction, tr: Tranche) =>
  tr.onHold ? palette.red
  : settled(tx, tr) || tr.status === 'PAID' ? palette.green
  : tr.status === 'SUBMITTED' || tr.status === 'INFO_REQUESTED' || tr.status === 'ACCEPTED' ? palette.yellow
  : palette.disabled;

/** Litige possible à cette étape (avant ou après paiement) : on lit le dossier de litige éventuel. */
const DISPUTABLE: readonly Tranche['status'][] = ['SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED', 'PAID', 'REFUNDED'];

function TrancheItem({ tx, tr, last }: { tx: Transaction; tr: Tranche; last: boolean }) {
  const { t, shortDate: date, dateTime, money, errorText } = useI18n();
  // Lot A (T5) : place de l’utilisateur dans cette opération (parties du dossier), jamais le rôle principal du profil.
  const place = placeIn(tx, getCurrentUser()?.id);
  const roles = tx.myRoles ?? [];
  const dq = useDisputeQuery(DISPUTABLE.includes(tr.status) || tr.onHold ? tr.id : undefined);
  const dispute = dq.data ?? null;
  const disputeOpen = !!dispute && dispute.status !== 'RESOLVED';
  const canDispute = !disputeOpen && canOpenDispute(tr.status, roles);
  const conditional = tx.settlementMode === 'CONDITIONAL';
  const held = conditional && tr.status === 'PAID' && tr.fundsState === 'HELD';
  const amount = money({ amountMinor: tr.amountMinor, currency: tx.amount.currency });
  const act = (fn: () => Promise<unknown>) => { void fn().catch((e) => showToast(errorText(e))); };

  // Ligne d’état extraite et testée (features/tx/trancheInfo, lot X-C T2) : ACCEPTED = « paiement en cours »,
  // mis à jour par le temps réel (tranches) quand l’événement du partenaire arrive.
  const d = trancheInfo(tx, tr, {
    date, dateTime, statusKey: trancheStatusKey,
    money: (amountMinor) => money({ amountMinor, currency: tx.amount.currency }),
  });
  const info = d.key ? t(d.key as Key, d.params) : '';
  // Lot A (T6) : libellé de suivi du Dr, et « en retard » à côté.
  const tracking = trackingOf(tx, tr, new Date());
  const trackingText = tracking.overdue ? `${t(trackingKey(tracking) as Key)} · ${t('overdue')}` : t(trackingKey(tracking) as Key);

  const canPay = place.payer && tx.status === 'ACTIVE' && tr.status === 'SUBMITTED' && !tr.onHold;
  return (
    <View style={st.item}>
      <View style={st.rail}>
        <View style={[st.dot, { backgroundColor: dotColor(tx, tr) }]}>
          {settled(tx, tr) ? <Icon name="check" size={16} color="#fff" /> : <Text style={[st.dotText, { color: dotColor(tx, tr) === palette.yellow ? palette.ink : '#fff' }]}>{tr.seq}</Text>}
        </View>
        {last ? null : <View style={st.line} />}
      </View>
      <View style={st.body}>
        <Text style={st.itemTitle}>{t('trancheTitle', { n: tr.seq, amount })}</Text>
        <View style={{ marginTop: 2 }}><StatusLabel kind={trackingKind(tracking)} label={trackingText} /></View>
        <Text style={st.itemInfo}>{info}</Text>
        {canPay || canDispute ? (
          <View style={st.actions}>
            {canPay ? <Button small tone="accent" label={t('pay')} onPress={() => router.push(`/pay/${tr.id}`)} /> : null}
            {canDispute ? <Button small tone="danger" label={t('openDispute')} onPress={() => router.push(`/dispute/${tr.id}`)} /> : null}
          </View>
        ) : null}
        {/* Déblocage conditionnel seulement : QR à présenter, confirmation par le payeur, déblocage anticipé. */}
        {place.payer && held && !disputeOpen ? (
          <View style={st.actions}>
            {!tr.confirmedAt && tr.releaseMode === 'PROVIDER_CONFIRM'
              ? <Button small tone="secondary" label={t('showQr')} onPress={() => router.push(`/token/${tr.id}`)} /> : null}
            {!tr.confirmedAt && tr.releaseMode === 'PAYER_CONFIRM'
              ? <Button small label={t('confirmService')} onPress={() => act(() => api.confirmService(tr.id))} /> : null}
            {tr.confirmedAt ? <Button small label={t('release')} onPress={() => act(() => api.approveRelease(tr.id))} /> : null}
          </View>
        ) : null}
        {dispute ? (
          <View style={st.actions}><Button small tone="secondary" label={t('viewDispute')} onPress={() => router.push(`/dispute/view/${tr.id}`)} /></View>
        ) : null}
        {receiptAvailable(tx, tr) ? (
          <View style={st.actions}><Button small tone="secondary" label={t('viewReceipt')} onPress={() => router.push(`/receipt/${tr.id}`)} /></View>
        ) : null}
      </View>
    </View>
  );
}

/** Lot A (T6) : demandes que le payeur ouvre pour la première fois (« Reçue par le payeur »). */
const RECEIVABLE: readonly Tranche['status'][] = ['SUBMITTED', 'INFO_REQUESTED'];

export default function TransactionDetail() {
  const { id, tr: linkedTranche } = useLocalSearchParams<{ id: string; tr?: string }>();
  const { t, locale, money } = useI18n();
  const q = useTransactionsQuery();
  const tx = q.data?.find((x) => x.id === id);
  // Lot A (T6) : à l’ouverture du détail par le payeur, première ouverture enregistrée (mark_received : une fois, payeur seul).
  const unseen = tx && placeIn(tx, getCurrentUser()?.id).payer
    ? tx.tranches.filter((r) => RECEIVABLE.includes(r.status) && !r.firstViewedAt).map((r) => r.id) : [];
  const unseenKey = unseen.join(',');
  useEffect(() => {
    for (const trId of unseenKey ? unseenKey.split(',') : []) void api.markReceived(trId).catch(() => undefined);
  }, [unseenKey]);
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
        {tx.beneficiaryReference ? <Row label={t('beneficiaryReference')} value={tx.beneficiaryReference} />
          : tx.beneficiaryName ? <Row label={t('beneficiary')} value={tx.beneficiaryName} /> : null}
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
