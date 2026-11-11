import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette, radius, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api } from '@/state/api';
import { useTransactions } from '@/state/queries';
import { Banner, Button, Card, Radio, Row, Screen, TopBar } from '@/ui';

const REASON_CODES = ['NOT_DELIVERED', 'INCOMPLETE', 'WRONG_AMOUNT', 'OTHER'] as const;

export default function Dispute() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, locale, money, dateTime, errorText } = useI18n();
  const txs = useTransactions();
  const reasons = [t('reasonNone'), t('reasonPartial'), t('reasonAmount'), t('reasonOther')];
  const [reason, setReason] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tx = txs.find((x) => x.tranches.some((r) => r.id === trancheId));
  const tr = tx?.tranches.find((r) => r.id === trancheId);
  if (!tx || !tr) return <Screen><TopBar title={t('notFound')} /></Screen>;

  async function submit() {
    if (!tr) return;
    try {
      // Motif : code stable (traduit à l’affichage) ; description : texte saisi.
      await api.openDispute(tr.id, REASON_CODES[reason] ?? 'OTHER', text);
      router.back();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Screen footer={<><Button tone="destructive" label={t('openDisputeAction')} onPress={submit} /><Button tone="secondary" label={t('cancel')} onPress={() => router.back()} /></>}>
      <TopBar title={t('openDispute')} subtitle={`${verticalLabel(tx.vertical, locale)} · ${t('trancheN', { n: tr.seq })}`} />
      <Banner text={t('disputeBanner')} />
      <View>
        <Row label={t('amount')} value={money({ amountMinor: tr.amountMinor, currency: tx.amount.currency })} />
        <Row label={t('providerLabel')} value={tx.providerName} />
        {tr.contestEndsAt ? <Row label={t('contestPossibleUntil')} value={dateTime(tr.contestEndsAt)} /> : null}
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('reason')} style={{ gap: spacing.sm }}>
        {reasons.map((r, i) => (
          <Card key={r} variant="choice" selected={reason === i} onPress={() => setReason(i)} accessibilityLabel={r}>
            <Radio on={reason === i} />
            <Text style={st.optText}>{r}</Text>
          </Card>
        ))}
      </View>
      <Text style={st.label}>{t('describe')}</Text>
      <TextInput accessibilityLabel={t('describe')} multiline value={text} onChangeText={setText} placeholder={t('min10')} placeholderTextColor={palette.muted} style={st.area} />
      {/* Ajout de pièces à un litige : hors périmètre du lot (maquette H9). */}
      <View style={st.join} accessible accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={`${t('joinPiece')}, ${t('soon')}`}>
        <Text style={st.joinText}>+ {t('joinPiece')} · {t('soon')}</Text>
      </View>
      {error ? <Banner text={error} tone="error" /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  join: { minHeight: 48, borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.line, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  joinText: { fontSize: fontSize.small + 1, fontWeight: '600', color: palette.muted },
  label: { fontSize: fontSize.small, fontWeight: '600', color: palette.ink },
  optText: { fontSize: fontSize.body, color: palette.ink },
  area: { minHeight: 96, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, fontSize: 15, backgroundColor: palette.card, color: palette.ink, textAlignVertical: 'top' },
});
