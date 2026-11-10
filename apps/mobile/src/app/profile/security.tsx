import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { setPreferences, signOut, useSession } from '@/state/auth';
import { capitalize } from '@/lib/biometry';
import { SettingsRow } from '@/features/profile/rows';
import { useBioKind } from '@/features/profile/useBioKind';
import { Banner, Button, Screen, Toggle, TopBar } from '@/ui';
import { Dialog } from '@/ui/Dialog';
import { Text } from '@/ui/text';

/** F2 — Sécurité : biométrie (authentification système pour activer, confirmation pour désactiver), code de secours (lot 4), notifications push. */
export default function Security() {
  const { t, errorText } = useI18n();
  const { session } = useSession();
  const { kind, available } = useBioKind();
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const method = capitalize(t(`bio_${kind}`));
  const bioOn = !!session?.biometricEnabled;
  const pushOn = session?.pushEnabled !== false;

  async function toggleBio(next: boolean) {
    setError(null);
    if (!next) { setConfirmOff(true); return; }
    if (available === false) { setError(t('bioUnavailable')); return; }
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('bioEnableReason', { method }), cancelLabel: t('cancel') });
      if (!r.success) { setError(t('bioFailed')); return; }
      await setPreferences({ biometricEnabled: true });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const sw = (value: boolean, onChange: (v: boolean) => void, label: string) => <Toggle value={value} onChange={onChange} accessibilityLabel={label} />;

  return (
    <Screen footer={<Button tone="danger" label={t('signOutDevice')} onPress={async () => { await signOut(); router.replace('/login'); }} />}>
      <TopBar title={t('security')} />
      <View>
        <SettingsRow label={t('bioForPayments', { method })} sub={t('bioForPaymentsHelp')}
          accessory={sw(bioOn, (v) => void toggleBio(v), t('bioForPayments', { method }))} />
        <SettingsRow label={t('backupCode')} sub={t('backupCodeHelp', { method: kind === 'faceid' || kind === 'touchid' ? method : t(`bio_${kind}`) })}
          accessory={(
            <View style={st.soon} accessible accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={`${t('define')}, ${t('soon')}`}>
              <Text style={st.soonAction}>{t('define')}</Text>
              <Text style={st.soonText}>{t('soon')}</Text>
            </View>
          )} />
        <SettingsRow label={t('pushNotifications')} sub={t('pushNotificationsHelp')}
          accessory={sw(pushOn, (v) => void setPreferences({ pushEnabled: v }), t('pushNotifications'))} />
      </View>
      <Banner tone="active" text={t('bioPrivacy')} />
      {error ? <Banner tone="error" text={error} /> : null}
      <Dialog visible={confirmOff} danger title={t('bioDisableTitle', { method })} message={t('bioDisableText', { method })}
        confirmLabel={t('disable')} cancelLabel={t('cancel')} onCancel={() => setConfirmOff(false)}
        onConfirm={() => { setConfirmOff(false); void setPreferences({ biometricEnabled: false }); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  soon: { alignItems: 'flex-end', minHeight: 44, justifyContent: 'center', paddingLeft: spacing.sm },
  soonAction: { fontSize: fontSize.body + 1, fontWeight: '600', color: palette.muted },
  soonText: { fontSize: fontSize.caption, color: palette.muted },
});
