import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { setBiometric } from '@/state/auth';
import { Button, Screen, Title } from '@/ui';

export default function Biometrics() {
  const { t } = useI18n();
  return (
    <Screen footer={<Button tone="text" label={t('useCodeInstead')} onPress={async () => { await setBiometric(false); router.replace('/home'); }} />}>
      <Title>{t('secureTitle')}</Title>
    </Screen>
  );
}
