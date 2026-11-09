import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { fontSize, palette, radius } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { api, usePersona } from '@/state/api';
import { Banner, Button, Screen } from '@/ui';

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
      <Text style={st.title}>{t('scanTitle')}</Text>
      {persona !== 'PROVIDER' ? <Banner text={t('providerOnly')} /> : (
        <>
          <Text style={st.hint}>{t('scanHint')}</Text>
          <Text style={st.label}>{t('reference')}</Text>
          <TextInput accessibilityLabel={t('reference')} value={ref} onChangeText={setRef} autoCapitalize="characters" autoCorrect={false}
            placeholder="7B31-D0A9-C5E2" placeholderTextColor={palette.muted} style={st.input} />
          <Button label={t('confirmService')} onPress={confirm} disabled={ref.trim().length < 4} />
          {msg ? <Banner text={msg.text} tone={msg.ok ? 'active' : 'pending'} /> : null}
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  title: { fontSize: fontSize.headline, fontWeight: '600', color: palette.ink },
  hint: { fontSize: fontSize.small, color: palette.muted, lineHeight: 18 },
  label: { fontSize: fontSize.small, fontWeight: '600', color: palette.ink },
  input: { height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, backgroundColor: palette.card, color: palette.ink },
});
