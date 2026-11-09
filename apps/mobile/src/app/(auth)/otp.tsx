import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance, TextInputKeyPressEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MOCK_OTP_CODE, OTP_LENGTH } from '@diaspay/api-client';
import { fontSize, palette, radius, semantic, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { requestOtp, verifyOtp } from '@/state/auth';
import { startRoute } from '@/lib/flow';
import { fillDigits, formatCountdown } from '@/lib/format';
import { SHOW_DEMO } from '@/lib/env';
import { Banner, Button, Screen, TopBar } from '@/ui';

const EMPTY: string[] = Array.from({ length: OTP_LENGTH }, () => '');

export default function Otp() {
  const { t, errorText } = useI18n();
  const params = useLocalSearchParams<{ phone: string; resendAt?: string }>();
  const phone = params.phone ?? '';
  const [digits, setDigits] = useState<string[]>(EMPTY);
  const [resendAt, setResendAt] = useState(() => params.resendAt ?? new Date().toISOString());
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Array<TextInputInstance | null>>([]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const code = digits.join('');
  const complete = code.length === OTP_LENGTH;
  const waitMs = Date.parse(resendAt) - now;

  function focus(i: number) {
    inputs.current[Math.max(0, Math.min(OTP_LENGTH - 1, i))]?.focus();
  }

  function onChange(i: number, text: string) {
    const { digits: next, focus: f } = fillDigits(digits, i, text);
    setDigits(next);
    setError(null);
    if (f !== i) focus(f);
  }

  function onKeyPress(i: number, e: TextInputKeyPressEvent) {
    if (e.nativeEvent.key !== 'Backspace' || digits[i] || i === 0) return;
    const next = [...digits];
    next[i - 1] = '';
    setDigits(next);
    focus(i - 1);
  }

  async function submit() {
    if (!complete || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const session = await verifyOtp(phone, code);
      router.replace(startRoute({ session, onboardingSeen: true }));
    } catch (e) {
      setError(errorText(e));
      setDigits(EMPTY);
      focus(0);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null); setNotice(null);
    try {
      const r = await requestOtp(phone);
      setResendAt(r.resendAt);
      setDigits(EMPTY);
      setNotice(t('codeSent'));
      focus(0);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button label={t('validate')} onPress={submit} disabled={!complete || busy} />}>
        <TopBar title="" onBack={() => router.replace('/login')} />
        <Text style={st.title} accessibilityRole="header">{t('otpTitle')}</Text>
        <Text style={st.text}>{t('otpText', { phone })}</Text>

        <View style={st.boxes} accessibilityLabel={t('otpCode')}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(r) => { inputs.current[i] = r; }}
              value={d}
              onChangeText={(v) => onChange(i, v)}
              onKeyPress={(e) => onKeyPress(i, e)}
              onSubmitEditing={submit}
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType={i === 0 ? 'oneTimeCode' : 'none'}
              autoComplete={i === 0 ? 'sms-otp' : 'off'}
              autoFocus={i === 0}
              selectTextOnFocus
              accessibilityLabel={t('otpDigit', { n: i + 1, total: OTP_LENGTH })}
              style={[st.box, d ? st.boxFilled : null, error ? st.boxError : null]}
            />
          ))}
        </View>

        {error ? <Banner tone="error" text={error} /> : null}
        {notice ? <Banner tone="active" text={notice} /> : null}

        {waitMs > 0
          ? <Text style={st.wait} accessibilityLiveRegion="polite">{t('resendIn', { time: formatCountdown(waitMs) })}</Text>
          : <Button tone="text" label={t('resend')} onPress={resend} />}
        <Pressable accessibilityRole="link" onPress={() => router.replace('/login')} style={st.link}>
          <Text style={st.linkText}>{t('changeNumber')}</Text>
        </Pressable>
        {SHOW_DEMO ? <Text style={st.demo}>{t('simCode', { code: MOCK_OTP_CODE })}</Text> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', color: palette.ink },
  text: { fontSize: fontSize.body, lineHeight: 22, color: palette.muted },
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginVertical: spacing.md },
  box: {
    flex: 1, maxWidth: 52, height: 56, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md,
    backgroundColor: semantic.surface, textAlign: 'center', fontSize: 22, fontWeight: '700', color: palette.ink,
  },
  boxFilled: { borderColor: palette.green, borderWidth: 1.5 },
  boxError: { borderColor: semantic.error, borderWidth: 1.5 },
  wait: { fontSize: fontSize.small, color: palette.muted, textAlign: 'center', paddingVertical: spacing.md },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: fontSize.body, color: palette.green, fontWeight: '600', textDecorationLine: 'underline' },
  demo: { fontSize: fontSize.caption, color: palette.muted, textAlign: 'center' },
});
