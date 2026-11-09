import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { markOnboardingSeen } from '@/state/auth';
import { Button, Screen, Title } from '@/ui';

export default function Slides() {
  const { t } = useI18n();
  return (
    <Screen footer={<Button label={t('start')} onPress={async () => { await markOnboardingSeen(); router.replace('/login'); }} />}>
      <Title>{t('slide1Title')}</Title>
    </Screen>
  );
}
