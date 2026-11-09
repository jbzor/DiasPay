import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/state/api';
import { bootstrap, useSession } from '@/state/auth';
import { canSetup, canUseApp } from '@/lib/flow';

export default function RootLayout() {
  const { session } = useSession();

  useEffect(() => {
    void bootstrap();
    // Équivalent du job serveur release_due_tranches() : débloque les tranches dont le délai de contestation est écoulé.
    api.runTimers();
    const id = setInterval(() => api.runTimers(), 30_000);
    return () => clearInterval(id);
  }, []);

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
        <Stack.Protected guard={canSetup(session)}>
          <Stack.Screen name="(auth)/profile-setup" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(auth)/biometrics" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={canUseApp(session)}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="tx/[id]" />
          <Stack.Screen name="pay/[trancheId]" />
          <Stack.Screen name="dispute/[trancheId]" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
