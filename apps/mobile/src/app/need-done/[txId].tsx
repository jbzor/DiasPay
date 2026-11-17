import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { Button, Icon, Screen } from '@/ui';
import { useTransactions } from '@/state/queries';

const AUTO_RETURN_MS = 2000;

/** Confirmation brève après l’envoi, puis retour à la liste sur le dossier (en validation, ou actif sans revue). */
export default function NeedDone() {
  const { t } = useI18n();
  const { txId } = useLocalSearchParams<{ txId: string }>();
  // Lot X version 2 : sans revue du bureau (platform_review NEVER), le dossier est actif dès l’envoi.
  const active = useTransactions().find((x) => x.id === txId)?.status === 'ACTIVE';
  const goToList = () => router.replace({ pathname: '/transactions', params: { filter: active ? 'ACTIVE' : 'REVIEW', focus: txId } });
  const latest = useRef(goToList);
  latest.current = goToList;   // le retour automatique lit le statut connu au moment du départ
  useEffect(() => {
    const id = setTimeout(() => latest.current(), AUTO_RETURN_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Screen scroll={false} footer={<Button label={t('goToList')} onPress={goToList} />}>
      <View style={st.center}>
        <View style={st.check}><Icon name="check" size={40} color="#fff" /></View>
        <Text style={st.title} accessibilityRole="header">{t('submittedTitle')}</Text>
        <Text style={st.text}>{active ? t('submittedActiveText') : t('submittedText')}</Text>
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  check: { width: 80, height: 80, borderRadius: 40, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: palette.ink },
  text: { fontSize: fontSize.body, color: palette.muted, textAlign: 'center', lineHeight: 22 },
});
