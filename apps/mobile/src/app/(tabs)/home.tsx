import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router } from 'expo-router';
import { currentTrancheIndex, isToPay, lockedFunds, nextPayment, trancheCount } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { usePersona } from '@/state/api';
import { useTransactionsQuery } from '@/state/queries';
import { QueryGate } from '@/ui/states';
import { useSession } from '@/state/auth';
import { countryKey, initials } from '@/lib/format';
import { startNewNeed } from '@/state/needWizard';
import { Avatar, Button, Card, H2, Screen, StatusLabel, txStatusKind } from '@/ui';

export default function Home() {
  const { t, locale, money, shortDate: date } = useI18n();
  const q = useTransactionsQuery();
  const txs = q.data ?? [];
  const persona = usePersona();
  const funds = lockedFunds(txs);
  const { session } = useSession();
  // Lot A (T5) : « À faire » ne propose que les demandes dont l’utilisateur est le payeur (parties du dossier).
  const next = nextPayment(txs.filter((tx) => isToPay(tx, session?.userId)));
  const fullName = session?.profile?.fullName ?? '';
  const name = fullName.split(' ')[0] ?? '';
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <View style={st.header}>
        <View>
          <Text style={st.hello} accessibilityRole="header">{t('hello', { name })}</Text>
          <Text style={st.sub}>
            {session?.profile
              ? `${t(countryKey(session.profile.country))} · ${t(`role_${session.profile.primaryRole}`)}`
              : persona === 'PAYER' ? t('payer') : t('provider')}
          </Text>
        </View>
        <Avatar initials={initials(fullName)} />
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
          <View style={{ gap: spacing.sm }}>
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
      <QueryGate query={q} rows={3}>
      <View>
        {/* La transaction déjà présentée sous « À faire » n’est pas répétée (maquette B1). */}
        {txs.filter((tx) => tx.id !== next?.tx.id).slice(0, 3).map((tx) => {
          const i = currentTrancheIndex(tx);
          const cur = tx.tranches[Math.min(i, tx.tranches.length) - 1];
          const curAmount = cur ? money({ amountMinor: cur.amountMinor, currency: tx.amount.currency }) : money(tx.amount);
          const sub = tx.tranches.length > 1 ? `${t('trancheOf', { n: i, total: tx.tranches.length })} · ${curAmount}` : `${cur?.label ?? ''} · ${curAmount}`;
          return (
            <Card key={tx.id} style={st.row} onPress={() => router.push(`/tx/${tx.id}`)}
              accessibilityLabel={`${verticalLabel(tx.vertical, locale)}, ${tx.providerName}, ${sub}, ${t(txStatusKey(tx.status))}`}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.rowTitle}>{verticalLabel(tx.vertical, locale)} · {tx.providerName}</Text>
                <Text style={st.rowSub}>{sub}</Text>
              </View>
              <StatusLabel kind={txStatusKind(tx.status)} label={t(txStatusKey(tx.status))} />
            </Card>
          );
        })}
      </View>
      </QueryGate>
      {session?.profile?.primaryRole !== 'PROVIDER' ? (
        <Button tone="accent" label={t('newNeed')} onPress={() => { startNewNeed(); router.push('/need/type'); }} />
      ) : null}
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
});
