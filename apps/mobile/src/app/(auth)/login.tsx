import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { composePhone, isValidPhone } from '@/lib/format';
import { useI18n } from '@/i18n';
import { requestOtp } from '@/state/auth';
import { Banner, Button, Field, LangSwitch, Logo, Screen } from '@/ui';

export default function Login() {
  const { t, errorText } = useI18n();
  const [dial, setDial] = useState('+33');
  const [local, setLocal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = isValidPhone(dial, local);

  async function send() {
    if (!valid) return;
    const phone = composePhone(dial, local);
    setBusy(true); setError(null);
    try {
      const { resendAt } = await requestOtp(phone);
      router.push({ pathname: '/otp', params: { phone, resendAt } });
    } catch (e) {
      const err = e as { code?: string; details?: { resendAt?: string } };
      // Un code a déjà été envoyé à ce numéro il y a moins de 60 s : on reprend la saisie.
      if (err.code === 'OTP_RESEND_TOO_SOON' && err.details?.resendAt) {
        router.push({ pathname: '/otp', params: { phone, resendAt: err.details.resendAt } });
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen style={st.content}>
        <Logo size={72} />
        <Text style={st.title} accessibilityRole="header">{t('welcome')}</Text>
        <Text style={st.text}>{t('loginText')}</Text>
        <View style={st.fields}>
          <Field label={t('dialCode')} value={dial} onChangeText={(v) => setDial(v.replace(/[^\d+]/g, '').slice(0, 5))}
            keyboardType="phone-pad" containerStyle={{ width: 96 }} autoComplete="tel-country-code" />
          <Field label={t('phone')} value={local} onChangeText={setLocal} placeholder={t('phonePlaceholder')}
            keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel-national" containerStyle={{ flex: 1 }}
            returnKeyType="send" onSubmitEditing={send} autoFocus />
        </View>
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label={t('getCode')} onPress={send} disabled={!valid || busy} />
        <LangSwitch />
        <Text style={st.terms}>{t('terms')}</Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  content: { paddingTop: spacing.xxl * 2, gap: spacing.lg },
  title: { fontSize: 28, fontWeight: '700', color: palette.ink, marginTop: spacing.sm },
  text: { fontSize: fontSize.body, lineHeight: 22, color: palette.muted, marginTop: -spacing.sm },
  fields: { flexDirection: 'row', gap: spacing.md },
  terms: { fontSize: fontSize.caption, lineHeight: 17, color: palette.muted, textAlign: 'center' },
});
