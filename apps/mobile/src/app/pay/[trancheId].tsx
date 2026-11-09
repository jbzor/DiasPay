import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { biometric } from '@/lib/biometric';
import { Banner, Button, Card, H2, Icon, Radio, Row, Screen, TopBar } from '@/ui';

export default function Pay() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, locale, money, errorText } = useI18n();
  const txs = useTransactions();
  const [method, setMethod] = useState<'card' | 'momo' | 'sepa'>('card');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tx = txs.find((x) => x.tranches.some((r) => r.id === trancheId));
  const tr = tx?.tranches.find((r) => r.id === trancheId);
  if (!tx || !tr) return <Screen><TopBar title={t('notFound')} /></Screen>;

  async function pay() {
    if (!tx || !tr) return;
    setBusy(true); setError(null);
    try {
      if (!(await biometric(t('bioReason')))) { setError(t('bioFailed')); return; }
      await api.payTranche(tr.id);
      router.replace(`/tx/${tx.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const methods: Array<['card' | 'momo' | 'sepa', string]> = [['card', t('card')], ['momo', t('mobileMoney')], ['sepa', t('sepa')]];
  return (
    <Screen footer={
      <>
        <Button label={t('payWithBio')} onPress={pay} disabled={busy} />
        <Text style={st.sim}>{t('simulated')}</Text>
      </>
    }>
      <TopBar title={t('payTranche')} subtitle={`${verticalLabel(tx.vertical, locale)} · ${tx.providerName}`} />
      <View>
        <Text style={st.label}>{t('amountToPay')}</Text>
        <Text style={st.amount}>{money({ amountMinor: tr.amountMinor, currency: tx.amount.currency })}</Text>
        <Row label={t('purpose')} value={tx.purpose} />
        <Row label={t('beneficiary')} value={tx.beneficiaryName} />
        <Row label={t('fees')} value={t('feesTbd')} />
      </View>
      <H2>{t('payMethod')}</H2>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('payMethod')} style={{ gap: spacing.sm }}>
        {methods.map(([k, label]) => (
          <Card key={k} variant="choice" selected={method === k} onPress={() => setMethod(k)} accessibilityLabel={label}>
            <Radio on={method === k} />
            <Text style={st.methodText}>{label}</Text>
          </Card>
        ))}
      </View>
      <View style={st.lock}><Icon name="lock" size={20} color={palette.greenDark} /><Text style={st.lockText}>{t('lockedNote')}</Text></View>
      {error ? <Banner text={error} tone="error" /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  label: { fontSize: fontSize.small, color: palette.muted },
  amount: { fontSize: 34, fontWeight: '700', color: palette.green, letterSpacing: -0.5, marginBottom: spacing.md },
  methodText: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: spacing.sm },
  lockText: { flex: 1, fontSize: fontSize.small, color: palette.greenDark, lineHeight: 18 },
  sim: { textAlign: 'center', fontSize: fontSize.caption, color: palette.muted },
});
