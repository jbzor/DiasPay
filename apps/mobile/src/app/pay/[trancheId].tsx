import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { fontSize, palette, radius, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { Banner, Button, Card, Icon, Row, Screen, TopBar } from '@/ui';

async function biometric(reason: string): Promise<boolean> {
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return true; // démonstration : pas de biométrie disponible (web, simulateur)
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason });
    return r.success;
  } catch {
    return true;
  }
}

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
      <Card>
        <Text style={st.label}>{t('amountToPay')}</Text>
        <Text style={st.amount}>{money({ amountMinor: tr.amountMinor, currency: tx.amount.currency })}</Text>
        <Row label={t('purpose')} value={tx.purpose} />
        <Row label={t('beneficiary')} value={tx.beneficiaryName} />
        <Row label={t('fees')} value={t('feesTbd')} />
      </Card>
      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
        {methods.map(([k, label]) => (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: method === k }} onPress={() => setMethod(k)}
            style={[st.method, method === k && st.methodOn]}>
            <View style={[st.radio, method === k && st.radioOn]}>{method === k ? <View style={st.radioDot} /> : null}</View>
            <Text style={st.methodText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.lock}><Icon name="lock" size={20} color={palette.greenDark} /><Text style={st.lockText}>{t('lockedNote')}</Text></View>
      {error ? <Banner text={error} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  label: { fontSize: fontSize.small, color: palette.muted },
  amount: { fontSize: 28, fontWeight: '700', color: palette.ink, marginBottom: spacing.sm },
  method: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, borderRadius: 14, paddingHorizontal: 14 },
  methodOn: { borderWidth: 2, borderColor: palette.green },
  methodText: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: palette.green },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.green },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.greenTint, borderRadius: radius.md, padding: 10 },
  lockText: { flex: 1, fontSize: fontSize.small, color: palette.greenDark, lineHeight: 18 },
  sim: { textAlign: 'center', fontSize: fontSize.caption, color: palette.muted },
});
