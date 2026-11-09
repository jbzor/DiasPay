import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/state/api';

export default function RootLayout() {
  useEffect(() => {
    // Équivalent du job serveur release_due_tranches() : débloque les tranches dont le délai de contestation est écoulé.
    api.runTimers();
    const id = setInterval(() => api.runTimers(), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
