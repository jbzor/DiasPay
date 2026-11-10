import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { setBiometric } from '@/state/auth';
import { bioIcon, bioKind, capitalize } from '@/lib/biometry';
import type { BioKind } from '@/lib/biometry';
import { Banner, Button, Icon, Screen } from '@/ui';

type Availability = 'checking' | 'ready' | 'unavailable';

async function probe(): Promise<{ availability: Availability; kind: BioKind }> {
  try {
    const [hw, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return { availability: hw && enrolled ? 'ready' : 'unavailable', kind: bioKind(Platform.OS, types) };
  } catch {
    // Web ou module indisponible.
    return { availability: 'unavailable', kind: bioKind(Platform.OS, []) };
  }
}

export default function Biometrics() {
  const { t, errorText } = useI18n();
  const [availability, setAvailability] = useState<Availability>('checking');
  const [kind, setKind] = useState<BioKind>(() => bioKind(Platform.OS, []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void probe().then((r) => { if (alive) { setAvailability(r.availability); setKind(r.kind); } });
    return () => { alive = false; };
  }, []);

  const method = t(`bio_${kind}`);

  async function finish(enabled: boolean) {
    setBusy(true); setError(null);
    try {
      await setBiometric(enabled);
      router.replace('/home');
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  async function enable() {
    setBusy(true); setError(null);
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('bioPrompt'), cancelLabel: t('cancel') });
      if (!r.success) { setError(t('bioFailed')); setBusy(false); return; }
    } catch {
      setError(t('bioFailed')); setBusy(false); return;
    }
    await finish(true);
  }

  const footer = availability === 'unavailable'
    ? <Button label={t('continue')} onPress={() => void finish(false)} disabled={busy} />
    : (
      <>
        <Button label={t('enableBio', { method })} onPress={enable} disabled={busy || availability === 'checking'} />
        <Button tone="text" label={t('useCodeInstead')} onPress={() => void finish(false)} disabled={busy} />
      </>
    );

  return (
    <Screen footer={footer}>
      <View>
        <Text style={st.title} accessibilityRole="header">{t('security')}</Text>
        <Text style={st.step}>{t('stepOf', { n: 2, total: 2 })}</Text>
      </View>
      <View style={st.hero}>
        <View style={st.iconWrap}>
          <Icon name={bioIcon(kind)} size={56} color={palette.green} />
        </View>
        <Text style={st.heading}>{t('secureTitle')}</Text>
        <Text style={st.text}>{t('secureText', { method: capitalize(method) })}</Text>
      </View>
      {availability === 'unavailable' ? <Banner text={t('bioUnavailable')} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', color: palette.ink },
  step: { fontSize: fontSize.small, color: palette.muted, marginTop: 2 },
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  iconWrap: { width: 112, height: 112, borderRadius: 56, backgroundColor: palette.greenTint, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: palette.ink, textAlign: 'center', marginTop: spacing.sm },
  text: { fontSize: fontSize.body, lineHeight: 22, color: palette.muted, textAlign: 'center' },
});
