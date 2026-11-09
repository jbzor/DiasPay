import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { currentTrancheIndex, filterTransactions } from '@diaspay/api-client';
import type { TxFilter } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { useTransactions } from '@/state/api';
import { Card, Icon, Screen, Segmented, StatusLabel, Title, txStatusKind } from '@/ui';

export default function Transactions() {
  const { t, locale, money } = useI18n();
  const [filter, setFilter] = useState<TxFilter>('ALL');
  const txs = filterTransactions(useTransactions(), filter);
  const filters = [['ALL', t('all')], ['ACTIVE', t('active')], ['REVIEW', t('toReview')], ['CLOSED', t('closed')]] as const;
  return (
    <Screen>
      <Title>{t('tabTx')}</Title>
      <Segmented options={filters} value={filter} onChange={setFilter} accessibilityLabel={t('filter')} />
      <View>
        {txs.map((tx) => {
          const evidence = tx.tranches.some((r) => r.status === 'EVIDENCE_SUBMITTED');
          const statusText = evidence ? t('evidenceToValidate') : t(txStatusKey(tx.status));
          return (
            <Card key={tx.id} style={st.row} onPress={() => router.push(`/tx/${tx.id}`)}
              accessibilityLabel={`${verticalLabel(tx.vertical, locale)}, ${tx.purpose}, ${money(tx.amount)}, ${statusText}`}>
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Text style={st.rowTitle}>{verticalLabel(tx.vertical, locale)} · {tx.purpose}</Text>
                <Text style={st.sub}>{money(tx.amount)}{tx.tranches.length > 1 ? ` · ${currentTrancheIndex(tx)}/${tx.tranches.length}` : ''}</Text>
                <StatusLabel kind={evidence ? 'pending' : txStatusKind(tx.status)} label={statusText} />
              </View>
              <Icon name="chevron" size={18} color={palette.muted} />
            </Card>
          );
        })}
        {txs.length === 0 ? <Text style={[st.sub, { paddingVertical: spacing.md }]}>{t('noTx')}</Text> : null}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted },
});
