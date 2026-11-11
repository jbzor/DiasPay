import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chips, fontSize, neutralTint, radius, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { Banner, Button } from './index';
import { Text } from './text';

/** Squelette de chargement : blocs gris pulsés, à la place du contenu attendu. */
export function Skeleton({ rows = 3, height = 72 }: { rows?: number; height?: number }) {
  const { t } = useI18n();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View accessibilityLabel={t('loadingData')} accessibilityRole="progressbar" style={{ gap: spacing.md }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={[st.block, { height, opacity: pulse }]} />
      ))}
    </View>
  );
}

/** État d’erreur avec « Réessayer ». Le message vient du code d’erreur, jamais du texte brut du serveur. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t, errorText } = useI18n();
  return (
    <View style={{ gap: spacing.md }}>
      <Banner tone="error" text={errorText(error)} />
      <Button label={t('retry')} onPress={onRetry} />
    </View>
  );
}

/** Bandeau « Hors connexion » : les données affichées sont les dernières connues. */
export function OfflineBanner() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[st.offline, { paddingTop: insets.top + 4 }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={st.offlineText}>{t('offlineBanner')}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  block: { backgroundColor: neutralTint, borderRadius: radius.lg },
  offline: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: chips.pending.bg, paddingBottom: 6, paddingHorizontal: spacing.lg, zIndex: 10 },
  offlineText: { color: chips.pending.fg, fontSize: fontSize.small, fontWeight: '600', textAlign: 'center' },
});

/**
 * Affiche le contenu d’une requête : squelette au premier chargement, erreur avec « Réessayer » si rien n’est
 * connu ; sinon le contenu (la dernière donnée connue reste affichée en cas d’erreur ou hors connexion).
 */
export function QueryGate({ query, rows, height, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: unknown; refetch: () => unknown; fetchStatus: string };
  rows?: number; height?: number; children: ReactNode;
}) {
  if (query.data !== undefined) return <>{children}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending && query.fetchStatus !== 'idle') return <Skeleton rows={rows} height={height} />;
  return <>{children}</>;
}
