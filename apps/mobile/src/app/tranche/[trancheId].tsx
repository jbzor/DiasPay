import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '@/ui/text';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { api } from '@/state/api';
import { bootstrap, useSession } from '@/state/auth';
import { canUseApp, startRoute } from '@/lib/flow';
import { Banner, Button, Screen, Title } from '@/ui';

/**
 * Lien interne `diaspay://tranche/<identifiant>` (lot X, X1.2) : mène au détail du dossier de la tranche.
 * Exige une session ouverte (sinon : connexion, et le lien n’est pas rejoué) ; la tranche n’est lue que si le serveur
 * l’autorise (RLS) : introuvable sinon, sans rien révéler.
 */
export default function OpenTranche() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t } = useI18n();
  const state = useSession();
  const authed = canUseApp(state.session);
  const [problem, setProblem] = useState(false);

  useEffect(() => { void bootstrap(); }, []);

  useEffect(() => {
    if (!state.ready || !authed || !trancheId) return undefined;
    let alive = true;
    api.getTranche(String(trancheId)).then(
      ({ tx, tranche }) => { if (alive) router.replace({ pathname: '/tx/[id]', params: { id: tx.id, tr: tranche.id } }); },
      () => { if (alive) setProblem(true); },
    );
    return () => { alive = false; };
  }, [state.ready, authed, trancheId]);

  if (!state.ready) return <Screen><Text style={st.muted}>{t('loading')}</Text></Screen>;
  if (!authed) return <Redirect href={startRoute(state)} />;
  if (problem) {
    return (
      <Screen>
        <Title>{t('notFound')}</Title>
        <Banner tone="error" text={t('err_TRANCHE_NOT_FOUND')} />
        <Button label={t('goHome')} onPress={() => router.replace('/home')} />
      </Screen>
    );
  }
  return <Screen><Text style={st.muted} accessibilityLiveRegion="polite">{t('loading')}</Text></Screen>;
}

const st = StyleSheet.create({ muted: { color: palette.muted, fontSize: fontSize.body } });
