import { useState } from 'react';
import { router } from 'expo-router';
import { composePhone, isValidPhone } from '@/lib/format';
import { useI18n } from '@/i18n';
import { requestOtp } from '@/state/auth';
import { Button, Field, Screen, Title } from '@/ui';

export default function Login() {
  const { t } = useI18n();
  const [local, setLocal] = useState('');
  const send = async () => { const phone = composePhone('+33', local); await requestOtp(phone); router.push({ pathname: '/otp', params: { phone } }); };
  return (
    <Screen footer={<Button label={t('getCode')} disabled={!isValidPhone('+33', local)} onPress={send} />}>
      <Title>{t('welcome')}</Title>
      <Field label={t('phone')} value={local} onChangeText={setLocal} keyboardType="phone-pad" />
    </Screen>
  );
}
