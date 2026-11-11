import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import type { Persona } from '@diaspay/api-client';
import { setLocale, useI18n } from '@/i18n';
import type { Locale } from '@/i18n';
import { useDemo } from '@/state/queries';
import { api, setPersona, usePersona } from '@/state/api';
import { signOut, useSession } from '@/state/auth';
import { formatPhoneDisplay, initials } from '@/lib/format';
import { HELP_URL, TERMS_URL } from '@/lib/env';
import { SectionTitle, SettingsRow } from '@/features/profile/rows';
import { useBioKind } from '@/features/profile/useBioKind';
import { Avatar, Button, Card, H2, Radio, Screen, Segmented } from '@/ui';
import { Dialog } from '@/ui/Dialog';
import { showToast } from '@/ui/Toast';
import { Text } from '@/ui/text';

/** F1 — Profil : identité, compte, sécurité, aide, déconnexion ; outils de démonstration en bas (EXPO_PUBLIC_DEMO=1). */
export default function Profile() {
  const { t, locale } = useI18n();
  const demo = useDemo();
  const persona = usePersona();
  const { session } = useSession();
  const { kind } = useBioKind();
  const [langOpen, setLangOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const profile = session?.profile;
  const method = t(`bio_${kind}`);
  const capital = method.charAt(0).toLocaleUpperCase('fr-FR') + method.slice(1);
  const version = Constants.expoConfig?.version ?? '';

  const openUrl = (url: string) => {
    if (!url) { showToast(t('soon')); return; }
    void Linking.openURL(url).catch(() => showToast(t('soon')));
  };

  return (
    <Screen>
      <View style={st.identity}>
        <Avatar initials={initials(profile?.fullName ?? '')} size={64} />
        <View style={{ flexShrink: 1 }}>
          <Text style={st.name} accessibilityRole="header">{profile?.fullName ?? ''}</Text>
          <Text style={st.sub}>
            {t('identityLine', { phone: session ? formatPhoneDisplay(session.phone) : '', role: profile ? t(`role_${profile.primaryRole}`) : '' })}
          </Text>
        </View>
      </View>

      <View>
        <SectionTitle>{t('sectionAccount')}</SectionTitle>
        <SettingsRow label={t('personalInfo')} onPress={() => router.push('/profile/edit')} />
        <SettingsRow label={t('language')} value={locale === 'fr' ? t('langFr') : t('langEn')} onPress={() => setLangOpen(true)} />
        <SectionTitle>{t('sectionSecurity')}</SectionTitle>
        <SettingsRow label={t('faceIdAndCode', { method: capital })} onPress={() => router.push('/profile/security')} />
        <SettingsRow label={t('notifications')} value={session?.pushEnabled === false ? t('notificationsOff') : t('notificationsOn')}
          onPress={() => router.push('/profile/security')} />
        <SectionTitle>{t('sectionHelp')}</SectionTitle>
        <SettingsRow label={t('helpCenter')} value={HELP_URL ? undefined : t('soon')} onPress={() => openUrl(HELP_URL)} />
        <SettingsRow label={t('termsPrivacy')} value={TERMS_URL ? undefined : t('soon')} onPress={() => openUrl(TERMS_URL)} />
        <SettingsRow label={t('about')} value={t('versionN', { v: version })} />
      </View>

      <Button tone="neutral" label={t('signOut')} onPress={async () => { await signOut(); router.replace('/login'); }} />

      {demo ? (
        <View style={st.demo}>
          <H2>{t('demoProfile')}</H2>
          <Segmented<Persona> options={[['PAYER', t('payer')], ['PROVIDER', t('provider')]]} value={persona} onChange={setPersona} accessibilityLabel={t('demoProfile')} />
          <Button tone="secondary" label={t('resetDemo')} onPress={() => setResetOpen(true)} />
          <Text style={st.note}>{t('demoNote')}</Text>
        </View>
      ) : null}

      <Dialog visible={langOpen} title={t('chooseLanguage')} confirmLabel={t('ok')} cancelLabel={t('cancel')}
        onConfirm={() => setLangOpen(false)} onCancel={() => setLangOpen(false)}>
        <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
          {(['fr', 'en'] as Locale[]).map((l) => (
            <Card key={l} variant="choice" selected={locale === l} onPress={() => setLocale(l)} accessibilityLabel={l === 'fr' ? t('langFr') : t('langEn')}>
              <Radio on={locale === l} />
              <Text style={st.choice}>{l === 'fr' ? t('langFr') : t('langEn')}</Text>
            </Card>
          ))}
        </View>
      </Dialog>
      <Dialog visible={resetOpen} danger title={t('resetDemo')} message={t('resetDemoConfirm')} confirmLabel={t('reset')} cancelLabel={t('cancel')}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => { setResetOpen(false); void api.resetDemoData().then(() => showToast(t('demoResetDone'))); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingTop: spacing.sm },
  name: { fontSize: fontSize.headline, fontWeight: '700', color: palette.ink },
  sub: { fontSize: fontSize.body, color: palette.muted, marginTop: 2 },
  demo: { gap: spacing.md, marginTop: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  note: { fontSize: fontSize.caption, color: palette.muted },
  choice: { fontSize: fontSize.body, color: palette.ink },
});
