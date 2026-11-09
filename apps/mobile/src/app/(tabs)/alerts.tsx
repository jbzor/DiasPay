import { Text } from 'react-native';
import { palette } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { Screen } from '@/ui';

export default function Alerts() {
  const { t } = useI18n();
  return (
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: '600', color: palette.ink }}>{t('tabAlerts')}</Text>
      <Text style={{ fontSize: 15, color: palette.muted }}>{t('noAlerts')}</Text>
    </Screen>
  );
}
