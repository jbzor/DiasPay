import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { fontSize, palette } from '@diaspay/ui-tokens';
import type { Persona } from '@diaspay/api-client';
import { setLocale, useI18n } from '@/i18n';
import type { Locale } from '@/i18n';
import { setPersona, usePersona } from '@/state/api';
import { signOut, useSession } from '@/state/auth';
import { countryKey, initials } from '@/lib/format';
import { SHOW_DEMO } from '@/lib/env';
import { Avatar, Banner, Button, H2, Row, Screen, Segmented, Title } from '@/ui';


export default function Profile() {
  const { t, locale } = useI18n();
  const persona = usePersona();
  const { session } = useSession();
  const profile = session?.profile;
  const roleLabel = profile ? t(`role_${profile.primaryRole}`) : '';
  return (
    <Screen>
      <Title>{t('tabProfile')}</Title>
      {profile ? (
        <View style={st.identity}>
          <Avatar initials={initials(profile.fullName)} size={56} />
          <View style={{ flexShrink: 1 }}>
            <Text style={st.name}>{profile.fullName}</Text>
            <Text style={st.sub}>{roleLabel}</Text>
          </View>
        </View>
      ) : null}
      {session ? (
        <View>
          <Row label={t('phone')} value={session.phone} />
          {profile ? <Row label={t('countryOfResidence')} value={t(countryKey(profile.country))} /> : null}
          <Row label={t('biometrics')} value={session.biometricEnabled ? t('enabled') : t('disabled')} />
        </View>
      ) : null}
      <H2>{t('language')}</H2>
      <Segmented<Locale> options={[['fr', t('langFr')], ['en', t('langEn')]]} value={locale} onChange={setLocale} accessibilityLabel={t('language')} />
      {SHOW_DEMO ? (
        <>
          <H2>{t('demoProfile')}</H2>
          <Segmented<Persona> options={[['PAYER', t('payer')], ['PROVIDER', t('provider')]]} value={persona} onChange={setPersona} accessibilityLabel={t('demoProfile')} />
        </>
      ) : null}
      <Banner text={t('demoNote')} />
      <Button tone="danger" label={t('signOut')} onPress={async () => { await signOut(); router.replace('/login'); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
  sub: { fontSize: fontSize.small, color: palette.muted },
});
