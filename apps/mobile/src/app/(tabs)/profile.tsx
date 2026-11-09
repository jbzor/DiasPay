import { Text } from 'react-native';
import { palette } from '@diaspay/ui-tokens';
import { setLocale, useI18n } from '@/i18n';
import { setPersona, usePersona } from '@/state/api';
import { Banner, Button, H2, Screen } from '@/ui';

export default function Profile() {
  const { t, locale } = useI18n();
  const persona = usePersona();
  return (
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: '600', color: palette.ink }}>{t('tabProfile')}</Text>
      <H2>{t('demoProfile')}</H2>
      <Button label={t('payer')} tone={persona === 'PAYER' ? 'primary' : 'secondary'} onPress={() => setPersona('PAYER')} />
      <Button label={t('provider')} tone={persona === 'PROVIDER' ? 'primary' : 'secondary'} onPress={() => setPersona('PROVIDER')} />
      <H2>{t('language')}</H2>
      <Button label="Français" tone={locale === 'fr' ? 'primary' : 'secondary'} onPress={() => setLocale('fr')} />
      <Button label="English" tone={locale === 'en' ? 'primary' : 'secondary'} onPress={() => setLocale('en')} />
      <Banner text={t('demoNote')} />
    </Screen>
  );
}
