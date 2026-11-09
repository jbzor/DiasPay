import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette, radius, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { Banner, Button, Card, Row, Screen, TopBar } from '@/ui';

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
      <Card>
        <Row label={t('amountToPay')} value={money({ amountMinor: tr.amountMinor, currency: tx.amount.currency })} />
        <Row label={t('providerLabel')} value={tx.providerName} />
        {tr.contestEndsAt ? <Row label={t('confirmedAuto', { date: '' }).replace(/\s*:?\s*$/, '')} value={dateTime(tr.contestEndsAt)} /> : null}
      </Card>
      <Text style={st.label}>{t('reason')}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
        {reasons.map((r, i) => (
          <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: reason === i }} onPress={() => setReason(i)} style={[st.opt, reason === i && st.optOn]}>
            <View style={[st.radio, reason === i && { borderColor: palette.green }]}>{reason === i ? <View style={st.dot} /> : null}</View>
            <Text style={st.optText}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.label}>{t('describe')}</Text>
      <TextInput accessibilityLabel={t('describe')} multiline value={text} onChangeText={setText} placeholder={t('min10')} placeholderTextColor={palette.muted} style={st.area} />
      {error ? <Banner text={error} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  label: { fontSize: fontSize.small, fontWeight: '600', color: palette.ink },
  opt: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, borderRadius: 14, paddingHorizontal: 14 },
  optOn: { borderWidth: 2, borderColor: palette.green },
  optText: { fontSize: fontSize.body, color: palette.ink },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.green },
  area: { minHeight: 96, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, fontSize: 15, backgroundColor: palette.card, color: palette.ink, textAlignVertical: 'top' },
});
