import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { Button, Icon, Screen } from '@/ui';

const AUTO_RETURN_MS = 2000;

/** Confirmation brève après l’envoi, puis retour à la liste sur le dossier en validation. */
export default function NeedDone() {
  const { t } = useI18n();
  const { txId } = useLocalSearchParams<{ txId: string }>();
  const goToList = () => router.replace({ pathname: '/transactions', params: { filter: 'REVIEW', focus: txId } });
  useEffect(() => {
    const id = setTimeout(goToList, AUTO_RETURN_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Screen scroll={false} footer={<Button label={t('goToList')} onPress={goToList} />}>
      <View style={st.center}>
        <View style={st.check}><Icon name="check" size={40} color="#fff" /></View>
        <Text style={st.title} accessibilityRole="header">{t('submittedTitle')}</Text>
        <Text style={st.text}>{t('submittedText')}</Text>
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
