import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { DisputeView } from '@diaspay/api-client';
import type { DisputeOutcome } from '@diaspay/domain';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import type { Key } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { DEMO_REVIEW } from '@/lib/env';
import { canViewReceipt, disputeStatus, disputeSteps, isResolved, reasonKey } from '@/features/dispute/state';
import { Banner, Button, Field, Icon, Row, Screen, StatusLabel, TopBar } from '@/ui';
import { Dialog } from '@/ui/Dialog';
import { Text } from '@/ui/text';

/** H10 — Suivi d’un litige : en cours d’examen ou résolu (remboursement ou fonds remis). */
export default function DisputeTracking() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, locale, money, dateTime, date, errorText } = useI18n();
  const txs = useTransactions();
  const [dispute, setDispute] = useState<DisputeView | null | undefined>(undefined);
  const [deciding, setDeciding] = useState<DisputeOutcome | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => { void api.getDispute(trancheId).then((d) => { if (alive) setDispute(d); }).catch(() => { if (alive) setDispute(null); }); };
    load();
    const unsub = api.subscribe(load);
    return () => { alive = false; unsub(); };
  }, [trancheId]);

  const tx = txs.find((x) => x.tranches.some((r) => r.id === trancheId));
  const tr = tx?.tranches.find((r) => r.id === trancheId);
  if (!tx || !tr || dispute === null) return <Screen><TopBar title={t('notFound')} /></Screen>;
  if (dispute === undefined) return <Screen><TopBar title={t('disputeTitle')} /></Screen>;

  const subtitle = `${verticalLabel(tx.vertical, locale)} · ${t('trancheN', { n: tr.seq })}`;
  const status = disputeStatus(dispute);
  const resolved = isResolved(dispute);
  const amount = money({ amountMinor: tr.amountMinor, currency: tx.amount.currency });
  const opener = dispute.openedBy === 'PAYER'
    ? t('openedByPayer', { name: tx.payerName || t('payerWord') })
    : t('openedByProvider', { name: tx.providerName || t('providerWord') });
  const rk = reasonKey(dispute.reason);
  const dayTime = (iso: string) => dateTime(iso);
  const fullDate = (iso: string) => `${date(iso)}, ${new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}`;

  const footer = resolved
    ? (canViewReceipt(dispute) ? <Button tone="secondary" label={t('viewReceipt')} onPress={() => router.push(`/receipt/${tr.id}`)} /> : undefined)
    : <Button tone="secondary" disabled label={`${t('addPiece')} · ${t('soon')}`} />;

  return (
    <Screen footer={footer}>
      <TopBar title={t('disputeTitle')} subtitle={subtitle} />
      <StatusLabel kind={status.kind} label={t(status.key as Key)} />
      <View>
        <Row label={t('openedOn')} value={fullDate(dispute.openedAt)} />
        {resolved && dispute.resolvedAt ? <Row label={t('resolvedOn')} value={fullDate(dispute.resolvedAt)} /> : null}
        {resolved
          ? <Row label={dispute.status === 'REFUNDED_TO_PAYER' ? t('refundedAmount') : t('releasedAmount')} value={amount} />
          : (
            <>
              <Row label={t('openedBy')} value={opener} />
              <Row label={t('reason')} value={rk ? t(rk as Key) : dispute.reason} />
              <Row label={t('amount')} value={amount} />
              <Row label={t('providerLabel')} value={tx.providerName} />
            </>
          )}
      </View>
      {resolved && dispute.resolutionNote ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={st.section}>{t('adminDecision')}</Text>
          <Text style={st.note}>{dispute.resolutionNote}</Text>
        </View>
      ) : null}
      <Text style={st.section}>{t('timelineTitle')}</Text>
      <View>
        {disputeSteps(dispute).map((s, i, all) => (
          <View key={s.key} style={st.step}>
            <View style={st.rail}>
              <View style={[st.dot, { backgroundColor: s.done ? palette.green : palette.line }]}>
                {s.done ? <Icon name="check" size={14} color="#fff" /> : null}
              </View>
              {i < all.length - 1 ? <View style={st.line} /> : <View style={[st.line, { flex: 0, height: 24 }]} />}
            </View>
            <View style={st.stepBody}>
              <Text style={[st.stepTitle, !s.done ? { color: palette.muted } : null]}>{t(`step_${s.key}`)}</Text>
              <Text style={st.stepSub}>
                {s.done && s.at ? (s.dayOnly ? date(s.at).replace(/\s\d{4}$/, '') : dayTime(s.at)) : s.pending === 'inProgress' ? t('stepInProgress') : t('stepUpcoming')}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {!resolved ? <Banner text={t('disputeSuspended')} /> : null}
      {DEMO_REVIEW && !resolved ? (
        <View style={{ gap: spacing.sm }}>
          <Button tone="secondary" label={t('simRelease')} onPress={() => { setNote(''); setDeciding('RELEASED'); }} />
          <Button tone="danger" label={t('simRefund')} onPress={() => { setNote(''); setDeciding('REFUNDED'); }} />
        </View>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
      <Dialog visible={deciding !== null} title={deciding === 'RELEASED' ? t('simRelease') : t('simRefund')} confirmLabel={t('decide')} cancelLabel={t('cancel')}
        danger={deciding === 'REFUNDED'} confirmDisabled={note.trim().length < 3} onCancel={() => setDeciding(null)}
        onConfirm={() => {
          const outcome = deciding; setDeciding(null);
          if (outcome) void api.simulateDisputeResolution(tr.id, { outcome, note }).catch((e) => setError(errorText(e)));
        }}>
        <Field label={t('decisionNote')} value={note} onChangeText={setNote} placeholder={t('decisionNotePlaceholder')} autoFocus />
      </Dialog>
    </Screen>
  );
}

const st = StyleSheet.create({
  section: { fontSize: fontSize.small + 1, fontWeight: '600', color: palette.muted, marginTop: spacing.sm },
  note: { fontSize: fontSize.body + 1, lineHeight: 24, color: palette.ink, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.line },
  step: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: palette.line, marginVertical: 4, minHeight: 20 },
  stepBody: { flex: 1, paddingBottom: spacing.xl },
  stepTitle: { fontSize: fontSize.body + 1, fontWeight: '600', color: palette.ink },
  stepSub: { fontSize: fontSize.body - 1, color: palette.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
