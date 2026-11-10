import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { palette } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { takePendingReference } from '@/state/pendingLink';
import { Icon } from '@/ui';
import type { ICONS } from '@/ui';

const tab = (name: keyof typeof ICONS) => ({ color }: { color: unknown }) => <Icon name={name} size={22} color={String(color)} />;

export default function TabsLayout() {
  const { t } = useI18n();
  // Lien reçu avant la connexion : rejoué dès que les onglets sont accessibles.
  useEffect(() => {
    const ref = takePendingReference();
    if (ref) router.replace(`/t/${ref}`);
  }, []);
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: palette.green, tabBarInactiveTintColor: palette.muted,
      tabBarStyle: { height: 64, backgroundColor: palette.card, borderTopColor: palette.line },
      tabBarLabelStyle: { fontSize: 12, fontFamily: 'Inter', fontWeight: '500' },
    }}>
      <Tabs.Screen name="home" options={{ title: t('tabHome'), tabBarIcon: tab('home') }} />
      <Tabs.Screen name="transactions" options={{ title: t('tabTx'), tabBarIcon: tab('list') }} />
      <Tabs.Screen name="scan" options={{ title: t('tabScan'), tabBarIcon: tab('scan') }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabAlerts'), tabBarIcon: tab('bell') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabProfile'), tabBarIcon: tab('user') }} />
    </Tabs>
  );
}
