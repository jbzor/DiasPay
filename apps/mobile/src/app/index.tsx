import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { bootstrap, useSession } from '@/state/auth';
import { startRoute } from '@/lib/flow';
import { LangSwitch, Logo } from '@/ui';

const MIN_DISPLAY_MS = 1200;

/** Lancement : affiché au moins 1,2 s le temps de charger l’état, puis oriente vers la bonne étape. */
export default function Launch() {
  const { t } = useI18n();
  const state = useSession();
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    void bootstrap();
    const id = setTimeout(() => setMinDone(true), MIN_DISPLAY_MS);
    return () => clearTimeout(id);
  }, []);

  if (state.ready && minDone) return <Redirect href={startRoute(state)} />;

  return (
    <SafeAreaView style={st.screen}>
      <StatusBar style="light" />
      <View style={st.center}>
        <Logo inverse size={96} />
        <Text style={st.name} accessibilityRole="header">
          {t('appName')}<Text style={{ color: palette.yellow }}>{t('appNameQr')}</Text>
        </Text>
        <Text style={st.tagline}>{t('tagline')}</Text>
      </View>
      <View style={st.bottom}>
        <LangSwitch inverse />
        <Text style={st.hub}>{t('hub')}</Text>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.green },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  name: { color: '#FFFFFF', fontSize: 34, fontWeight: '700', letterSpacing: -0.5, marginTop: spacing.sm },
  tagline: { color: '#FFFFFF', fontSize: fontSize.body + 1 },
  bottom: { alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xxl },
  hub: { color: '#FFFFFF', fontSize: fontSize.caption },
});
