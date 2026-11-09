import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { canOpenDispute } from '@diaspay/domain';
import type { TxRole } from '@diaspay/domain';
import type { Tranche, Transaction } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { api, usePersona, useTransactions } from '@/state/api';
import { Button, Card, Chip, Icon, Row, Screen, TopBar, txChip } from '@/ui';

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
          <View style={st.actions}><Button small tone="accent" label={t('pay')} onPress={() => router.push(`/pay/${tr.id}`)} /></View>
        ) : null}
        {persona === 'PAYER' && tr.status === 'CONFIRMED' ? (
          <View style={st.actions}>
            {canDispute ? <Button small tone="danger" label={t('openDispute')} onPress={() => router.push(`/dispute/${tr.id}`)} /> : null}
            <Button small label={t('release')} onPress={() => api.approveRelease(tr.id)} />
          </View>
        ) : null}
        {persona === 'PAYER' && tr.status === 'PAID_LOCKED' && canDispute ? (
          <View style={st.actions}><Button small tone="danger" label={t('openDispute')} onPress={() => router.push(`/dispute/${tr.id}`)} /></View>
        ) : null}
      </View>
    </View>
  );
}

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale, money } = useI18n();
  const tx = useTransactions().find((x) => x.id === id);
  if (!tx) return <Screen><TopBar title={t('notFound')} /></Screen>;
  return (
    <Screen>
      <TopBar title={`${verticalLabel(tx.vertical, locale)} · ${tx.providerName}`} subtitle={`${money(tx.amount)} · ${tx.tranches.length}`} />
      <Card>
        <Row label={t('beneficiary')} value={tx.beneficiaryName} />
        <Row label={t('providerLabel')} value={tx.providerName} />
        <Row label={t('purpose')} value={tx.purpose} />
        <Chip kind={txChip(tx.status)} label={t(txStatusKey(tx.status))} />
      </Card>
      <View style={{ marginTop: spacing.sm }}>
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
  actions: { flexDirection: 'row', gap: spacing.sm },
});
