import 'react-native-get-random-values'; // crypto.getRandomValues (identifiants, chiffrement de la session) avant tout le reste
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { mockApi } from '@/state/api';
import { queryClient, useOnline, useRealtime } from '@/state/queries';
import { OfflineBanner } from '@/ui/states';
import { API_MODE, MISSING_CONFIG } from '@/state/backend';
import { bootstrap, useSession } from '@/state/auth';
import { canSetup, canUseApp } from '@/lib/flow';
import { apiReleaseReason, apiReleaseViolation, demoReleaseViolation, deviceAuthReleaseViolation } from '@/lib/releaseGuard';
import { useI18n } from '@/i18n';

// L’écran de lancement natif reste affiché tant que la police n’est pas chargée.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const DEMO_IN_RELEASE = demoReleaseViolation({
  dev: __DEV__, demo: process.env.EXPO_PUBLIC_DEMO, allow: process.env.EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE,
});
// Lot X-C (T9) : build de production sans EXPO_PUBLIC_API=supabase (simulateur) : même blocage.
const API_IN_RELEASE = apiReleaseViolation({
  dev: __DEV__, api: process.env.EXPO_PUBLIC_API, allow: process.env.EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE,
});
const API_REASON = apiReleaseReason(process.env.EXPO_PUBLIC_API);
// Lot A (T10) : export qui laisse payer sans vérification de l’appareil dans un navigateur : même blocage.
const DEVICE_AUTH_IN_RELEASE = deviceAuthReleaseViolation({
  dev: __DEV__, skip: process.env.EXPO_PUBLIC_WEB_SKIP_DEVICE_AUTH, allow: process.env.EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE,
});
type BlockReason = 'demo' | 'api' | 'deviceAuth';
const BLOCKED_IN_RELEASE: BlockReason | null = DEMO_IN_RELEASE ? 'demo' : API_IN_RELEASE ? 'api' : DEVICE_AUTH_IN_RELEASE ? 'deviceAuth' : null;

// Mode Supabase : le cache des requêtes est conservé sur l’appareil (dernières données connues hors connexion).
// Le simulateur a sa propre persistance ; son cache n’est pas conservé.
const persister = API_MODE === 'supabase'
  ? createAsyncStoragePersister({ storage: AsyncStorage, key: 'diaspay.queries.v1', throttleTime: 2_000 })
  : null;

function DataProvider({ children }: { children: React.ReactNode }) {
  if (!persister) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 24 * 3_600_000, buster: 'lot4' }}>
      {children}
    </PersistQueryClientProvider>
  );
}

/** Temps réel, bandeau hors connexion et purge du cache à la déconnexion. */
function DataLifecycle() {
  const { session } = useSession();
  const online = useOnline();
  useRealtime();
  const uid = session?.userId;
  useEffect(() => {
    if (!uid) queryClient.removeQueries({ queryKey: ['diaspay'] });
  }, [uid]);
  return API_MODE === 'supabase' && !online ? <OfflineBanner /> : null;
}

/** Build de production avec le mode démonstration, ou sans le serveur (lot X-C, T9) : écran bloquant. */
function DemoInReleaseBlocked({ reason }: { reason: BlockReason }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(reason === 'demo'
      ? '[DiasPay] Anomalie de build : EXPO_PUBLIC_DEMO=1 dans un build de production. Application bloquée.'
      : reason === 'deviceAuth'
        ? '[DiasPay] Anomalie de build : EXPO_PUBLIC_WEB_SKIP_DEVICE_AUTH=1 dans un build de production. Application bloquée.'
        : '[DiasPay] Anomalie de build : EXPO_PUBLIC_API absente ou différente de « supabase » dans un build de production. Application bloquée.');
  }, [reason]);
  return (
    <View style={st.blocked} accessibilityRole="alert">
      <Text style={st.blockedTitle}>{t('demoInReleaseTitle')}</Text>
      <Text style={st.blockedText}>
        {reason === 'demo' ? t('demoInReleaseText')
          : reason === 'deviceAuth' ? t('deviceAuthInReleaseText')
          : t(`apiInReleaseText_${API_REASON}`, { value: (process.env.EXPO_PUBLIC_API ?? '').trim() })}
      </Text>
    </View>
  );
}

/**
 * Lot A (T4) : configuration incomplète (EXPO_PUBLIC_API absente, ou URL et clé publique du projet manquantes) : écran
 * bloquant qui nomme les variables manquantes (jamais leur valeur), au lieu de basculer en silence sur le simulateur.
 */
function ConfigMissing({ missing }: { missing: readonly string[] }) {
  const { t } = useI18n();
  useEffect(() => { console.error(`[DiasPay] Configuration manquante : ${missing.join(', ')}.`); }, [missing]);
  return (
    <View style={st.blocked} accessibilityRole="alert">
      <Text style={st.blockedTitle}>{t('configMissingTitle')}</Text>
      <Text style={st.blockedText}>{t('configMissingText')}</Text>
      <Text style={st.blockedText}>{missing.join('\n')}</Text>
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
    if (BLOCKED_IN_RELEASE) return;
    void bootstrap();
    // Équivalent du job serveur release_due_tranches() : débloque les tranches dont le délai de contestation est écoulé.
    // En mode Supabase, ce sont les tâches pg_cron du serveur (release_due_tranches, activate_due_tranches).
    if (!mockApi) return;
    const sim = mockApi;
    sim.runTimers();
    const id = setInterval(() => sim.runTimers(), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady]);

  if (BLOCKED_IN_RELEASE) return <DemoInReleaseBlocked reason={BLOCKED_IN_RELEASE} />;
  if (!fontsReady) return null;
  if (MISSING_CONFIG.length > 0) return <ConfigMissing missing={MISSING_CONFIG} />;

  // Garde d’accès : un écran dont la garde est fausse est inaccessible, y compris par lien profond ;
  // Expo Router redirige alors vers l’écran de lancement (index), qui oriente selon l’état.
  return (
    <DataProvider>
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="(onboarding)/slides" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)/login" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)/otp" />
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
      <DataLifecycle />
      <ToastHost />
    </SafeAreaProvider>
    </DataProvider>
  );
}

const st = StyleSheet.create({
  blocked: { flex: 1, backgroundColor: semantic.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  blockedTitle: { fontSize: 20, fontWeight: '700', color: semantic.error, textAlign: 'center' },
  blockedText: { fontSize: 15, lineHeight: 22, color: palette.ink, textAlign: 'center' },
});
