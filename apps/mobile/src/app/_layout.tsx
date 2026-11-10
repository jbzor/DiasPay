import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { palette, semantic, spacing } from '@diaspay/ui-tokens';
import { ToastHost } from '@/ui/Toast';
import { Text } from '@/ui/text';
import { api } from '@/state/api';
import { bootstrap, useSession } from '@/state/auth';
import { canSetup, canUseApp } from '@/lib/flow';
import { demoReleaseViolation } from '@/lib/releaseGuard';
import { useI18n } from '@/i18n';

// L’écran de lancement natif reste affiché tant que la police n’est pas chargée.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const DEMO_IN_RELEASE = demoReleaseViolation({
  dev: __DEV__, demo: process.env.EXPO_PUBLIC_DEMO, allow: process.env.EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE,
});

/** Build de production avec le mode démonstration : écran bloquant. */
function DemoInReleaseBlocked() {
  const { t } = useI18n();
  useEffect(() => {
    console.error('[DiasPay] Anomalie de build : EXPO_PUBLIC_DEMO=1 dans un build de production. Application bloquée.');
  }, []);
  return (
    <View style={st.blocked} accessibilityRole="alert">
      <Text style={st.blockedTitle}>{t('demoInReleaseTitle')}</Text>
      <Text style={st.blockedText}>{t('demoInReleaseText')}</Text>
    </View>
  );
}

export default function RootLayout() {
  const { session } = useSession();
  const [fontsLoaded, fontError] = useFonts([{
    fontFamily: 'Inter',
    fontDefinitions: [
      { path: Inter_400Regular, weight: 400 },
      { path: Inter_500Medium, weight: 500 },
      { path: Inter_600SemiBold, weight: 600 },
      { path: Inter_700Bold, weight: 700 },
    ],
  }]);
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    if (DEMO_IN_RELEASE) return;
    void bootstrap();
    // Équivalent du job serveur release_due_tranches() : débloque les tranches dont le délai de contestation est écoulé.
    api.runTimers();
    const id = setInterval(() => api.runTimers(), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady]);

  if (DEMO_IN_RELEASE) return <DemoInReleaseBlocked />;
  if (!fontsReady) return null;

  // Garde d’accès : un écran dont la garde est fausse est inaccessible, y compris par lien profond ;
  // Expo Router redirige alors vers l’écran de lancement (index), qui oriente selon l’état.
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="(onboarding)/slides" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)/login" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)/otp" />
        {/* Lien profond : accessible sans session pour mémoriser la référence et la rejouer après la connexion. */}
        <Stack.Screen name="t/[reference]" options={{ animation: 'fade' }} />
        <Stack.Protected guard={canSetup(session)}>
          <Stack.Screen name="(auth)/profile-setup" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(auth)/biometrics" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={canUseApp(session)}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="tx/[id]" />
          <Stack.Screen name="pay/[trancheId]" />
          <Stack.Screen name="token/[trancheId]" />
          <Stack.Screen name="dispute/[trancheId]" />
          <Stack.Screen name="dispute/view/[trancheId]" />
          <Stack.Screen name="receipt/[trancheId]" />
          <Stack.Screen name="profile/security" />
          <Stack.Screen name="profile/edit" />
          <Stack.Screen name="need" />
          <Stack.Screen name="need-done/[txId]" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
      <ToastHost />
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  blocked: { flex: 1, backgroundColor: semantic.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  blockedTitle: { fontSize: 20, fontWeight: '700', color: semantic.error, textAlign: 'center' },
  blockedText: { fontSize: 15, lineHeight: 22, color: palette.ink, textAlign: 'center' },
});
