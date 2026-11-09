import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useI18n } from '@/i18n';
import { verifyOtp } from '@/state/auth';
import { startRoute } from '@/lib/flow';
import { Button, Field, Screen, Title } from '@/ui';

export default function Otp() {
  const { t } = useI18n();
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const submit = async () => { const s = await verifyOtp(phone, code); router.replace(startRoute({ session: s, onboardingSeen: true })); };
  return (
    <Screen footer={<Button label={t('validate')} disabled={code.length !== 6} onPress={submit} />}>
      <Title>{t('otpTitle')}</Title>
      <Field label={t('otpCode')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
    </Screen>
  );
}
