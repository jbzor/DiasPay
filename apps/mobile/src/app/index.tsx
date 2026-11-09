import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { palette } from '@diaspay/ui-tokens';
import { bootstrap, useSession } from '@/state/auth';
import { startRoute } from '@/lib/flow';

/** Lancement : charge l’état puis oriente (présentation, connexion, profil ou onglets). */
export default function Launch() {
  const state = useSession();
  const [minDone, setMinDone] = useState(false);
  useEffect(() => {
    void bootstrap();
    const id = setTimeout(() => setMinDone(true), 1200);
    return () => clearTimeout(id);
  }, []);
  if (state.ready && minDone) return <Redirect href={startRoute(state)} />;
  return <View style={{ flex: 1, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
}
