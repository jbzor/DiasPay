import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { currentTrancheIndex, filterTransactions } from '@diaspay/api-client';
import type { TxFilter } from '@diaspay/api-client';
import { fontSize, palette, radius, spacing, touchTarget } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { useTransactions } from '@/state/api';
import { Card, Chip, Screen, txChip } from '@/ui';

export default function Transactions() {
  const { t, locale, money } = useI18n();
  const [filter, setFilter] = useState<TxFilter>('ALL');
  const txs = filterTransactions(useTransactions(), filter);
  const filters: Array<[TxFilter, string]> = [['ALL', t('all')], ['ACTIVE', t('active')], ['REVIEW', t('toReview')], ['CLOSED', t('closed')]];
  return (
    <Screen>
      <Text style={st.title}>{t('tabTx')}</Text>
      <View style={st.filters}>
        {filters.map(([k, label]) => (
          <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: filter === k }} onPress={() => setFilter(k)}
            style={[st.filter, filter === k && st.filterOn]}>
            <Text style={[st.filterText, filter === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {txs.map((tx) => {
        const evidence = tx.tranches.some((r) => r.status === 'EVIDENCE_SUBMITTED');
        return (
          <Pressable key={tx.id} accessibilityRole="button" onPress={() => router.push(`/tx/${tx.id}`)}>
            <Card style={st.row}>
              <View style={{ flexShrink: 1 }}>
                <Text style={st.rowTitle}>{verticalLabel(tx.vertical, locale)} · {tx.purpose}</Text>
                <Text style={st.sub}>{money(tx.amount)}{tx.tranches.length > 1 ? ` · ${currentTrancheIndex(tx)}/${tx.tranches.length}` : ''}</Text>
              </View>
              <Chip kind={evidence ? 'pending' : txChip(tx.status)} label={evidence ? t('evidenceToValidate') : t(txStatusKey(tx.status))} />
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const st = StyleSheet.create({
  title: { fontSize: fontSize.headline, fontWeight: '600', color: palette.ink },
  filters: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  filter: { minHeight: touchTarget, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card, justifyContent: 'center' },
  filterOn: { backgroundColor: palette.green, borderColor: palette.green },
  filterText: { fontSize: fontSize.small, fontWeight: '600', color: palette.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted, marginTop: 2 },
});
