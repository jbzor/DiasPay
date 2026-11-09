import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { PrimaryRole } from '@diaspay/api-client';
import { fontSize, palette, radius, semantic, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import { saveProfile, useSession } from '@/state/auth';
import { COUNTRIES, countryKey, initials } from '@/lib/format';
import type { CountryCode } from '@/lib/format';
import { Avatar, Banner, Button, Card, Field, Icon, Radio, Screen, Segmented } from '@/ui';

export default function ProfileSetup() {
  const { t, errorText } = useI18n();
  const { session } = useSession();
  const [fullName, setFullName] = useState(session?.profile?.fullName ?? '');
  const [country, setCountry] = useState<CountryCode | null>((session?.profile?.country as CountryCode | undefined) ?? null);
  const [role, setRole] = useState<PrimaryRole>(session?.profile?.primaryRole ?? 'PAYER');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = fullName.trim().length >= 2 && !!country;
  const ini = initials(fullName);

  async function submit() {
    if (!valid || !country) return;
    setBusy(true); setError(null);
    try {
      await saveProfile({ fullName, country, primaryRole: role });
      router.replace('/biometrics');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const roles = [['PAYER', t('role_PAYER')], ['REQUESTER', t('role_REQUESTER')], ['PROVIDER', t('role_PROVIDER')]] as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={<Button label={t('continue')} onPress={submit} disabled={!valid || busy} />}>
        <View>
          <Text style={st.title} accessibilityRole="header">{t('yourProfile')}</Text>
          <Text style={st.step}>{t('stepOf', { n: 1, total: 2 })}</Text>
        </View>
        <View style={st.avatarWrap}>
          {ini ? <Avatar initials={ini} size={80} /> : (
            <View style={st.avatarEmpty} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name="user" size={36} color={palette.muted} />
            </View>
          )}
        </View>
        <Field label={t('fullName')} value={fullName} onChangeText={setFullName} placeholder={t('fullNamePlaceholder')}
          autoComplete="name" textContentType="name" autoCapitalize="words" returnKeyType="next" />
        <View style={{ gap: 6 }}>
          <Text style={st.label}>{t('countryOfResidence')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('countryOfResidence')}, ${country ? t(countryKey(country)) : t('chooseCountry')}`}
            onPress={() => setPicker(true)} style={st.select}>
            <Text style={[st.selectText, !country ? { color: palette.muted } : null]}>{country ? t(countryKey(country)) : t('chooseCountry')}</Text>
            <Icon name="chevron" size={18} color={palette.muted} />
          </Pressable>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={st.label}>{t('mainRole')}</Text>
          <Segmented options={roles} value={role} onChange={setRole} accessibilityLabel={t('mainRole')} />
          <Text style={st.help}>{t(`roleHelp_${role}`)}</Text>
        </View>
        {error ? <Banner tone="error" text={error} /> : null}
      </Screen>

      <Modal visible={picker} animationType="slide" transparent onRequestClose={() => setPicker(false)}>
        <View style={st.backdrop}>
          <SafeAreaView edges={['bottom']} style={st.sheet}>
            <Text style={st.sheetTitle} accessibilityRole="header">{t('countryOfResidence')}</Text>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} accessibilityRole="radiogroup">
              {COUNTRIES.map((c) => (
                <Card key={c} variant="choice" selected={country === c} accessibilityLabel={t(countryKey(c))}
                  onPress={() => { setCountry(c); setPicker(false); }}>
                  <Radio on={country === c} />
                  <Text style={st.selectText}>{t(countryKey(c))}</Text>
                </Card>
              ))}
            </ScrollView>
            <Button tone="secondary" label={t('cancel')} onPress={() => setPicker(false)} />
          </SafeAreaView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', color: palette.ink },
  step: { fontSize: fontSize.small, color: palette.muted, marginTop: 2 },
  avatarWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  avatarEmpty: { width: 80, height: 80, borderRadius: 40, backgroundColor: semantic.surface, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: fontSize.small, fontWeight: '700', color: palette.ink },
  select: { height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: semantic.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { fontSize: 16, color: palette.ink },
  help: { fontSize: fontSize.small, lineHeight: 19, color: palette.muted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,26,0.4)' },
  sheet: { backgroundColor: semantic.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md, maxHeight: '80%' },
  sheetTitle: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
});
