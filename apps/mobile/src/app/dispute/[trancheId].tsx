import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette, radius, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { Banner, Button, Card, Radio, Row, Screen, TopBar } from '@/ui';

export default function Dispute() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, money, dateTime, errorText } = useI18n();
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
      await api.openDispute(tr.id, `${reasons[reason]} : ${text}`);
      router.back();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Screen footer={<><Button tone="danger" label={t('openDispute')} onPress={submit} /><Button tone="secondary" label={t('cancel')} onPress={() => router.back()} /></>}>
      <TopBar title={t('openDispute')} subtitle={`${tx.purpose} · ${tr.label}`} />
      <Banner text={t('disputeBanner')} />
      <View>
        <Row label={t('amount')} value={money({ amountMinor: tr.amountMinor, currency: tx.amount.currency })} />
        <Row label={t('providerLabel')} value={tx.providerName} />
        {tr.contestEndsAt ? <Row label={t('contestEnds')} value={dateTime(tr.contestEndsAt)} /> : null}
      </View>
      <Text style={st.label}>{t('reason')}</Text>
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
      {error ? <Banner text={error} tone="error" /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  label: { fontSize: fontSize.small, fontWeight: '600', color: palette.ink },
  optText: { fontSize: fontSize.body, color: palette.ink },
  area: { minHeight: 96, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, fontSize: 15, backgroundColor: palette.card, color: palette.ink, textAlignVertical: 'top' },
});
