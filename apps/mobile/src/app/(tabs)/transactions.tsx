import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import { currentTrancheIndex, filterTransactions, placeIn } from '@diaspay/api-client';
import type { TxFilter } from '@diaspay/api-client';
import type { NeedDraft } from '@diaspay/domain';
import { fontSize, palette, radius, spacing, touchTarget } from '@diaspay/ui-tokens';
import { txStatusKey, useI18n, verticalLabel } from '@/i18n';
import { api } from '@/state/api';
import { useTransactionsQuery } from '@/state/queries';
import { useSession } from '@/state/auth';
import { QueryGate } from '@/ui/states';
import { useDraftsQuery } from '@/state/queries';
import { openDraft, removeLocalDraft } from '@/state/needWizard';
import { showToast } from '@/ui/Toast';
import { stepIndex, STEP_COUNT } from '@/features/need/wizard';
import { Card, Icon, Screen, StatusLabel, Title, txStatusKind } from '@/ui';
import { Dialog } from '@/ui/Dialog';

const FILTERS: readonly TxFilter[] = ['ALL', 'TO_PAY', 'SENT', 'ACTIVE', 'REVIEW', 'CLOSED'];

export default function Transactions() {
  const { t, locale, money, date, errorText } = useI18n();
  const params = useLocalSearchParams<{ filter?: string; focus?: string }>();
  const [filter, setFilter] = useState<TxFilter>('ALL');
  const [toDelete, setToDelete] = useState<NeedDraft | null>(null);
  // Retour après l’envoi d’un dossier : filtre « À valider », dossier mis en évidence.
  useEffect(() => {
    if (params.filter && (FILTERS as readonly string[]).includes(params.filter)) setFilter(params.filter as TxFilter);
  }, [params.filter]);
  const q = useTransactionsQuery();
  const dq = useDraftsQuery();
  // Lot A (T5) : « À payer » et « Envoyées » d’après la place de l’utilisateur dans chaque opération (parties du dossier).
  const uid = useSession().session?.userId;
  const txs = filterTransactions(q.data ?? [], filter, uid);
  const drafts = dq.data ?? [];
  const filters = [['ALL', t('all')], ['TO_PAY', t('filterToPay')], ['SENT', t('filterSent')], ['ACTIVE', t('active')], ['REVIEW', t('toReview')], ['CLOSED', t('closed')]] as const;

  function resume(d: NeedDraft) {
    const step = openDraft(d);
    router.push(`/need/${step}`);
  }

  return (
    <Screen refreshing={q.isRefetching || dq.isRefetching} onRefresh={() => { void q.refetch(); void dq.refetch(); }}>
      <Title>{t('tabTx')}</Title>
      {/* Filtres en pastilles (maquette C1) : contour, pastille active verte. */}
      <View style={st.chips} accessibilityRole="radiogroup" accessibilityLabel={t('filter')}>
        {filters.map(([k, label]) => {
          const on = k === filter;
          return (
            <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setFilter(k)} hitSlop={4}
              style={[st.chip, on ? st.chipOn : null]}>
              <Text style={[st.chipText, on ? { color: '#FFFFFF' } : null]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <QueryGate query={q} rows={4}>
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
              {/* Décision D4 : seul un brouillon jamais soumis se supprime ; une correction appartient à un dossier audité. */}
              {d.correctionOf ? null : (
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('deleteDraft')} : ${title}`} onPress={() => setToDelete(d)} style={st.trash}>
                  <Icon name="close" size={18} color={palette.muted} />
                </Pressable>
              )}
            </View>
          );
        }) : null}
        {txs.map((tx) => {
          // Preuve à examiner (déblocage conditionnel, règle EVIDENCE_REVIEW) : tranche payée, fonds bloqués, preuve déposée.
          const evidence = tx.tranches.some((r) => r.status === 'PAID' && r.fundsState === 'HELD' && r.releaseMode === 'EVIDENCE_REVIEW' && r.evidenceCount > 0 && !r.confirmedAt);
          const statusText = evidence ? t('evidenceToValidate') : t(txStatusKey(tx.status));
          const focused = params.focus === tx.id;
          const n = tx.tranches.length;
          const milestones = tx.tranches.some((r) => r.releaseMode === 'EVIDENCE_REVIEW');
          const progress = n > 1 ? ` · ${t(milestones ? 'milestoneOf' : 'trancheOfLower', { n: currentTrancheIndex(tx), total: n })}` : '';
          const place = placeIn(tx, uid);
          const placeText = place.payer ? t('placeToPay') : place.initiator ? t('placeSent') : place.provider ? t('placeProvider') : '';
          return (
            <Card key={tx.id} style={[st.row, focused ? st.focus : null]} onPress={() => router.push(`/tx/${tx.id}`)}
              accessibilityLabel={`${verticalLabel(tx.vertical, locale)}, ${tx.providerName}, ${money(tx.amount)}, ${placeText ? `${placeText}, ` : ''}${statusText}`}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.rowTitle}>{verticalLabel(tx.vertical, locale)} · {tx.providerName}</Text>
                <Text style={st.sub}>{money(tx.amount)}{progress}</Text>
                {placeText ? <Text style={st.sub}>{placeText}</Text> : null}
              </View>
              <StatusLabel kind={evidence ? 'pending' : txStatusKind(tx.status)} label={statusText} />
            </Card>
          );
        })}
        {txs.length === 0 && (filter !== 'ALL' || drafts.length === 0) ? <Text style={[st.sub, { paddingVertical: spacing.md }]}>{t('noTx')}</Text> : null}
      </View>
      </QueryGate>

      <Dialog visible={toDelete !== null} danger title={t('deleteDraft')}
        message={t('deleteDraftConfirm')}
        confirmLabel={t('delete')} cancelLabel={t('cancel')} onCancel={() => setToDelete(null)}
        onConfirm={() => { if (toDelete) void api.deleteDraft(toDelete.id).then(() => removeLocalDraft(toDelete.id)).catch((e) => showToast(errorText(e))); setToDelete(null); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // 36 px visibles + 4 px de hitSlop de chaque côté = 44 px de zone tactile.
  chip: { minHeight: 36, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card, justifyContent: 'center' },
  chipOn: { backgroundColor: palette.green, borderColor: palette.green },
  chipText: { fontSize: fontSize.small, fontWeight: '600', color: palette.ink },
  draftRow: { flexDirection: 'row', alignItems: 'stretch' },
  trash: { width: touchTarget, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: palette.line },
  focus: { backgroundColor: palette.greenTint, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm },
  rowTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted },
});
