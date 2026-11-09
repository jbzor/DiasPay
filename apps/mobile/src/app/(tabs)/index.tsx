import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { currentTrancheIndex, lockedFunds, nextPayment, trancheCount } from '@diaspay/api-client';
import { fontSize, palette, radius, spacing } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { usePersona, useTransactions } from '@/state/api';
import { Button, Card, Chip, H2, Screen, txChip } from '@/ui';

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
          <Text style={st.hello}>{t('hello', { name })}</Text>
          <Text style={st.sub}>{persona === 'PAYER' ? t('payer') : t('provider')}</Text>
        </View>
        <View style={st.avatar} accessibilityElementsHidden><Text style={st.avatarText}>{name.slice(0, 1)}</Text></View>
      </View>
      <View style={st.hero}>
        <Text style={st.heroLabel}>{t('lockedFunds')}</Text>
        {funds.length === 0 ? <Text style={st.heroAmount}>0</Text> : funds.map((f) => <Text key={f.currency} style={st.heroAmount}>{money(f)}</Text>)}
        <Text style={st.heroLabel}>{t('counts', { tx: txs.length, tr: trancheCount(txs) })}</Text>
      </View>
      {next ? (
        <>
          <H2>{t('todo')}</H2>
          <Card>
            <Chip kind="pending" label={t('dueOn', { date: next.tranche.dueDate ? date(next.tranche.dueDate) : '' })} />
            <Text style={st.cardTitle}>{verticalLabel(next.tx.vertical, locale)} · {next.tx.providerName}</Text>
            <Text style={st.cardSub}>{t('trancheOf', { n: next.tranche.seq, total: next.tx.tranches.length })} · {money({ amountMinor: next.tranche.amountMinor, currency: next.tx.amount.currency })}</Text>
            <Button label={t('payTranche')} onPress={() => router.push(`/pay/${next.tranche.id}`)} />
          </Card>
        </>
      ) : null}
      <H2>{t('myTx')}</H2>
      {txs.slice(0, 3).map((tx) => (
        <Pressable key={tx.id} accessibilityRole="button" onPress={() => router.push(`/tx/${tx.id}`)}>
          <Card style={st.rowCard}>
            <View style={{ flexShrink: 1 }}>
              <Text style={st.rowTitle}>{verticalLabel(tx.vertical, locale)} · {tx.providerName}</Text>
              <Text style={st.cardSub}>{tx.tranches.length > 1 ? `${t('trancheOf', { n: currentTrancheIndex(tx), total: tx.tranches.length })} · ` : ''}{money(tx.amount)}</Text>
            </View>
            <Chip kind={txChip(tx.status)} label={t(txStatusKey(tx.status))} />
          </Card>
        </Pressable>
      ))}
      <Button label={`${t('newNeed')} · ${t('soon')}`} tone="disabled" disabled />
      <Text style={st.note}>{t('demoNote')}</Text>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { fontSize: fontSize.headline, fontWeight: '600', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '600', fontSize: 18 },
  hero: { backgroundColor: palette.green, borderRadius: radius.xl, padding: spacing.xl, gap: 4 },
  heroLabel: { color: '#fff', fontSize: fontSize.small },
  heroAmount: { color: '#fff', fontSize: fontSize.amount, fontWeight: '700' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.ink, marginTop: spacing.sm },
  cardSub: { fontSize: fontSize.small, color: palette.muted, marginTop: 2, marginBottom: spacing.md },
  rowCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  note: { textAlign: 'center', fontSize: fontSize.caption, color: palette.muted },
});
