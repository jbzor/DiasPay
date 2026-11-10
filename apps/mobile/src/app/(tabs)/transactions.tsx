import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { currentTrancheIndex, filterTransactions } from '@diaspay/api-client';
import type { TxFilter } from '@diaspay/api-client';
import type { NeedDraft } from '@diaspay/domain';
import { fontSize, palette, spacing, touchTarget } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { useDrafts } from '@/state/drafts';
import { openDraft } from '@/state/needWizard';
import { stepIndex, STEP_COUNT } from '@/features/need/wizard';
import { Card, Icon, Screen, Segmented, StatusLabel, Title, txStatusKind } from '@/ui';
import { Dialog } from '@/ui/Dialog';

const FILTERS: readonly TxFilter[] = ['ALL', 'ACTIVE', 'REVIEW', 'CLOSED'];

export default function Transactions() {
  const { t, locale, money, date } = useI18n();
  const params = useLocalSearchParams<{ filter?: string; focus?: string }>();
  const [filter, setFilter] = useState<TxFilter>('ALL');
  const [toDelete, setToDelete] = useState<NeedDraft | null>(null);
  // Retour après l’envoi d’un dossier : filtre « À valider », dossier mis en évidence.
  useEffect(() => {
    if (params.filter && (FILTERS as readonly string[]).includes(params.filter)) setFilter(params.filter as TxFilter);
  }, [params.filter]);
  const txs = filterTransactions(useTransactions(), filter);
  const drafts = useDrafts(api);
  const filters = [['ALL', t('all')], ['ACTIVE', t('active')], ['REVIEW', t('toReview')], ['CLOSED', t('closed')]] as const;

  function resume(d: NeedDraft) {
    const step = openDraft(d);
    router.push(`/need/${step}`);
  }

  return (
    <Screen>
      <Title>{t('tabTx')}</Title>
      <Segmented options={filters} value={filter} onChange={setFilter} accessibilityLabel={t('filter')} />
      <View>
        {filter === 'ALL' ? drafts.map((d) => {
          const title = d.vertical ? `${verticalLabel(d.vertical, locale)} · ${d.purpose?.trim() || t('untitledDraft')}` : t('untitledDraft');
          const amount = d.amountMinor ? money({ amountMinor: d.amountMinor, currency: d.currency ?? 'XAF' }) : '';
          const step = t('stepOf', { n: stepIndex(d.step ?? 'type'), total: STEP_COUNT });
          return (
            <View key={d.id} style={st.draftRow}>
              <Card style={[st.row, { flex: 1 }]} onPress={() => resume(d)}
                accessibilityLabel={`${title}, ${t('txDraft')}, ${step}. ${t('resume')}`}>
                <View style={{ flexShrink: 1, gap: 2 }}>
                  <Text style={st.rowTitle}>{title}</Text>
                  <Text style={st.sub}>{[amount, step, t('draftUpdated', { date: date(d.updatedAt) })].filter(Boolean).join(' · ')}</Text>
                  <StatusLabel kind="draft" label={d.correctionOf ? `${t('txDraft')} · ${t('correctionLabel')}` : t('txDraft')} />
                </View>
              </Card>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('deleteDraft')} : ${title}`} onPress={() => setToDelete(d)} style={st.trash}>
                <Icon name="close" size={18} color={palette.muted} />
              </Pressable>
            </View>
          );
        }) : null}
        {txs.map((tx) => {
          const evidence = tx.tranches.some((r) => r.status === 'EVIDENCE_SUBMITTED');
          const statusText = evidence ? t('evidenceToValidate') : t(txStatusKey(tx.status));
          const focused = params.focus === tx.id;
          return (
            <Card key={tx.id} style={[st.row, focused ? st.focus : null]} onPress={() => router.push(`/tx/${tx.id}`)}
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
        {txs.length === 0 && (filter !== 'ALL' || drafts.length === 0) ? <Text style={[st.sub, { paddingVertical: spacing.md }]}>{t('noTx')}</Text> : null}
      </View>

      <Dialog visible={toDelete !== null} danger title={t('deleteDraft')}
        message={toDelete?.correctionOf ? t('deleteCorrectionConfirm') : t('deleteDraftConfirm')}
        confirmLabel={t('delete')} cancelLabel={t('cancel')} onCancel={() => setToDelete(null)}
        onConfirm={() => { if (toDelete) void api.deleteDraft(toDelete.id); setToDelete(null); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  draftRow: { flexDirection: 'row', alignItems: 'stretch' },
  trash: { width: touchTarget, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: palette.line },
  focus: { backgroundColor: palette.greenTint, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted },
});
