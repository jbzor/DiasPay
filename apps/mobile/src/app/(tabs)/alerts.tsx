import { Text } from 'react-native';
import { fontSize, palette } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { Screen, Title } from '@/ui';

export default function Alerts() {
  const { t } = useI18n();
  return (
    <Screen>
      <Title>{t('tabAlerts')}</Title>
      <Text style={{ fontSize: fontSize.body, color: palette.muted }}>{t('noAlerts')}</Text>
    </Screen>
  );
}
