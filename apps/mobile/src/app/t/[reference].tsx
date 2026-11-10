import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '@/ui/text';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { normalizeReference } from '@diaspay/domain';
import { fontSize, palette } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { api, usePersona } from '@/state/api';
import { bootstrap, useSession } from '@/state/auth';
import { setPendingReference } from '@/state/pendingLink';
import { canUseApp, startRoute } from '@/lib/flow';
import { linkDestination } from '@/features/links/destination';
import { Banner, Button, Screen, Title } from '@/ui';

/**
 * Point d’entrée de `diaspay://t/<référence>` et `https://<hôte>/t/<référence>`.
 * Non connecté → connexion (lien conservé, rejoué ensuite) ; connecté → écran selon le profil et l’état de la tranche.
 */
export default function OpenLink() {
  const { reference: raw } = useLocalSearchParams<{ reference: string }>();
  const { t, errorText } = useI18n();
  const persona = usePersona();
  const state = useSession();
  const [problem, setProblem] = useState<string | null>(null);

  let reference: string | null = null;
  try { reference = normalizeReference(String(raw ?? '')); } catch { reference = null; }
  const authed = canUseApp(state.session);

  useEffect(() => { void bootstrap(); }, []);

  useEffect(() => {
    if (!state.ready || !authed || !reference) return;
    let alive = true;
    api.resolveReference(reference).then(
      (info) => {
        if (!alive) return;
        const dest = linkDestination(info, reference!, persona, Date.now());
        switch (dest.kind) {
          case 'pay': router.replace(`/pay/${dest.trancheId}`); break;
          case 'confirm': router.replace({ pathname: '/scan', params: { ref: dest.reference, n: String(Date.now()) } }); break;
          case 'detail': router.replace({ pathname: '/tx/[id]', params: { id: dest.txId, tr: dest.trancheId } }); break;
          default: setProblem(t('linkInvalidText'));
        }
      },
      (e) => { if (alive) setProblem((e as { code?: string })?.code === 'NOT_A_PARTY' ? errorText(e) : t('linkInvalidText')); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ready, authed, reference, persona]);

  if (!state.ready) return <Screen><Text style={st.muted}>{t('loading')}</Text></Screen>;

  if (reference && !authed) {
    setPendingReference(reference);
    return <Redirect href={startRoute(state)} />;
  }

  if (!reference || problem) {
    return (
      <Screen>
        <Title>{t('linkInvalidTitle')}</Title>
        <Banner tone="error" text={problem ?? t('linkInvalidText')} />
        <Button label={t('goHome')} onPress={() => router.replace(authed ? '/home' : '/')} />
      </Screen>
    );
  }
  return <Screen><Text style={st.muted} accessibilityLiveRegion="polite">{t('loading')}</Text></Screen>;
}

const st = StyleSheet.create({ muted: { color: palette.muted, fontSize: fontSize.body } });
