import { useState } from 'react';
import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { saveProfile } from '@/state/auth';
import { Button, Field, Screen, Title } from '@/ui';

export default function ProfileSetup() {
  const { t } = useI18n();
  const [fullName, setFullName] = useState('');
  const submit = async () => { await saveProfile({ fullName, country: 'FR', primaryRole: 'PAYER' }); router.replace('/biometrics'); };
  return (
    <Screen footer={<Button label={t('continue')} disabled={fullName.trim().length < 2} onPress={submit} />}>
      <Title>{t('yourProfile')}</Title>
      <Field label={t('fullName')} value={fullName} onChangeText={setFullName} />
    </Screen>
  );
}
