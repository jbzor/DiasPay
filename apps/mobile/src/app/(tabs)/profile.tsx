import { setLocale, useI18n } from '@/i18n';
import type { Locale } from '@/i18n';
import { setPersona, usePersona } from '@/state/api';
import type { Persona } from '@diaspay/api-client';
import { Banner, H2, Screen, Segmented, Title } from '@/ui';

export default function Profile() {
  const { t, locale } = useI18n();
  const persona = usePersona();
  return (
    <Screen>
      <Title>{t('tabProfile')}</Title>
      <H2>{t('demoProfile')}</H2>
      <Segmented<Persona> options={[['PAYER', t('payer')], ['PROVIDER', t('provider')]]} value={persona} onChange={setPersona} accessibilityLabel={t('demoProfile')} />
      <H2>{t('language')}</H2>
      <Segmented<Locale> options={[['fr', t('langFr')], ['en', t('langEn')]]} value={locale} onChange={setLocale} accessibilityLabel={t('language')} />
      <Banner text={t('demoNote')} />
    </Screen>
  );
}
