import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { fontSize, palette } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { api, usePersona } from '@/state/api';
import { Banner, Button, Field, Screen, Title } from '@/ui';

export default function Scan() {
  const { t, errorText } = useI18n();
  const persona = usePersona();
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function confirm() {
    try {
      const tx = await api.confirmByReference(ref);
      const tr = tx.tranches.find((x) => x.reference === ref.replace(/[\s-]/g, '').toUpperCase());
      setMsg({ ok: true, text: t('scanOk', { label: tr?.label ?? '', hours: tr?.contestHours ?? 0 }) });
      setRef('');
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  }

  return (
    <Screen>
      <Title>{t('scanTitle')}</Title>
      {persona !== 'PROVIDER' ? <Banner text={t('providerOnly')} /> : (
        <>
          <Text style={st.hint}>{t('scanHint')}</Text>
          <Field label={t('reference')} value={ref} onChangeText={setRef} autoCapitalize="characters" autoCorrect={false} placeholder={t('referencePlaceholder')} />
          <Button label={t('confirmService')} onPress={confirm} disabled={ref.trim().length < 4} />
          {msg ? <Banner text={msg.text} tone={msg.ok ? 'active' : 'error'} /> : null}
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: fontSize.small, color: palette.muted, lineHeight: 18 },
});
