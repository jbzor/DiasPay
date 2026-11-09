import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { currentTrancheIndex, lockedFunds, nextPayment, trancheCount } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { usePersona, useTransactions } from '@/state/api';
import { Avatar, Button, Card, H2, Icon, Screen, StatusLabel, txStatusKind } from '@/ui';

export default function Home() {
  const { t, locale, money, date } = useI18n();
  const txs = useTransactions();
  const persona = usePersona();
  const funds = lockedFunds(txs);
  const next = nextPayment(txs);
  const name = persona === 'PAYER' ? 'Marie' : 'École Les Palmiers';
  return (
    <Screen>
      <View style={st.header}>
        <View>
          <Text style={st.hello} accessibilityRole="header">{t('hello', { name })}</Text>
          <Text style={st.sub}>{persona === 'PAYER' ? t('payer') : t('provider')}</Text>
        </View>
        <Avatar initials={name.slice(0, 1)} />
      </View>

      <View style={st.hero}>
        <Text style={st.heroLabel}>{t('lockedFunds')}</Text>
        {funds.length === 0
          ? <Text style={st.heroAmount}>{money({ amountMinor: 0, currency: 'XAF' })}</Text>
          : funds.map((f) => <Text key={f.currency} style={st.heroAmount}>{money(f)}</Text>)}
        <Text style={st.heroLabel}>{t('counts', { tx: txs.length, tr: trancheCount(txs) })}</Text>
      </View>

      {next ? (
        <>
          <H2>{t('todo')}</H2>
          <View>
            <Card style={{ gap: 4 }}>
              <StatusLabel kind="pending" label={t('dueOn', { date: next.tranche.dueDate ? date(next.tranche.dueDate) : '' })} />
              <Text style={st.rowTitle}>{verticalLabel(next.tx.vertical, locale)} · {next.tx.providerName}</Text>
              <Text style={st.rowSub}>{t('trancheOf', { n: next.tranche.seq, total: next.tx.tranches.length })} · {money({ amountMinor: next.tranche.amountMinor, currency: next.tx.amount.currency })}</Text>
            </Card>
            <Button label={t('payTranche')} onPress={() => router.push(`/pay/${next.tranche.id}`)} />
          </View>
        </>
      ) : null}

      <H2>{t('myTx')}</H2>
      <View>
        {txs.slice(0, 3).map((tx) => (
          <Card key={tx.id} style={st.row} onPress={() => router.push(`/tx/${tx.id}`)}
            accessibilityLabel={`${verticalLabel(tx.vertical, locale)}, ${tx.providerName}, ${money(tx.amount)}, ${t(txStatusKey(tx.status))}`}>
            <View style={{ flexShrink: 1, gap: 2 }}>
              <Text style={st.rowTitle}>{verticalLabel(tx.vertical, locale)} · {tx.providerName}</Text>
              <Text style={st.rowSub}>{tx.tranches.length > 1 ? `${t('trancheOf', { n: currentTrancheIndex(tx), total: tx.tranches.length })} · ` : ''}{money(tx.amount)}</Text>
              <StatusLabel kind={txStatusKind(tx.status)} label={t(txStatusKey(tx.status))} />
            </View>
            <Icon name="chevron" size={18} color={palette.muted} />
          </Card>
        ))}
      </View>
      <Button label={`${t('newNeed')} · ${t('soon')}`} tone="disabled" disabled />
      <Text style={st.note}>{t('demoNote')}</Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { fontSize: fontSize.headline, fontWeight: '700', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted },
  hero: { gap: 2, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.line },
  heroLabel: { color: palette.muted, fontSize: 13 },
  heroAmount: { color: palette.green, fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  rowSub: { fontSize: fontSize.small, color: palette.muted },
  note: { textAlign: 'center', fontSize: fontSize.caption, color: palette.muted },
});
