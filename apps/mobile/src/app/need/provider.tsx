import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ProviderSummary } from '@diaspay/api-client';
import { isNormalizablePhone, normalizePhone } from '@diaspay/domain';
import type { NeedProvider } from '@diaspay/domain';
import { fontSize, palette, radius, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api } from '@/state/api';
import { dispatch, needContext, useWizard } from '@/state/needWizard';
import { useNeedText } from '@/features/need/text';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Button, Card, Field, Radio, StatusLabel } from '@/ui';

const SEARCH_DEBOUNCE_MS = 300;

/** G3 — Prestataire : recherche (anti-rebond 300 ms), choix d’un prestataire vérifié ou invitation par téléphone. */
export default function NeedProvider() {
  const { t, locale } = useI18n();
  const { planLabels, issueText } = useNeedText();
  const wiz = useWizard();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProviderSummary[] | null>(null);
  const [invite, setInvite] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const vertical = wiz?.draft.vertical;

  useEffect(() => {
    if (!vertical) return;
    let alive = true;
    const id = setTimeout(() => { void api.searchProviders(query, vertical).then((r) => { if (alive) setResults(r); }); }, SEARCH_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(id); };
  }, [query, vertical]);

  if (!wiz || !vertical) return null;
  const chosen = wiz.draft.provider;
  const choose = (p: NeedProvider) => dispatch({ type: 'patch', patch: { provider: p }, labels: planLabels, today: needContext().today });
  const phoneOk = isNormalizablePhone(phone);
  const nameOk = name.trim().length >= 2;

  return (
    <WizardFrame detail={t('providerLabel')}>
      <Field label={t('searchProvider')} value={query} onChangeText={setQuery} placeholder={t('searchProvider')}
        autoCorrect={false} returnKeyType="search" />
      <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('providerLabel')}>
        {chosen && !chosen.id ? (
          <Card variant="choice" selected accessibilityLabel={`${chosen.name}, ${t('invitedProvider', { phone: chosen.invitedPhone ?? '' })}`}>
            <Radio on />
            <View style={{ flex: 1 }}>
              <Text style={st.name}>{chosen.name}</Text>
              <Text style={st.sub}>{t('invitedProvider', { phone: chosen.invitedPhone ?? '' })}</Text>
            </View>
          </Card>
        ) : null}
        {(results ?? []).map((p) => {
          const on = chosen?.id === p.id;
          const city = t('providerCity', { city: p.city, vertical: verticalLabel(vertical, locale) });
          return (
            <Card key={p.id} variant="choice" selected={on} onPress={() => choose({ id: p.id, name: p.name })}
              accessibilityLabel={`${p.name}, ${city}${p.verified ? `, ${t('verified')}` : ''}`}>
              <Radio on={on} />
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{p.name}</Text>
                <Text style={st.sub}>{city}</Text>
              </View>
              {p.verified ? <StatusLabel kind="active" label={t('verified')} /> : null}
            </Card>
          );
        })}
        {results && results.length === 0 ? <Text style={st.empty}>{t('noProviderFound')}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => { setName(query); setInvite(true); }} style={st.invite}>
          <Text style={st.inviteText}>+ {t('inviteProvider')}</Text>
        </Pressable>
      </View>

      <Modal visible={invite} transparent animationType="slide" onRequestClose={() => setInvite(false)}>
        <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView edges={['bottom']} style={st.sheet}>
            <Text style={st.sheetTitle} accessibilityRole="header">{t('inviteTitle')}</Text>
            <Field label={t('providerName')} value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label={t('phone')} value={phone} onChangeText={setPhone} placeholder={t('phoneIntlPlaceholder')} keyboardType="phone-pad"
              textContentType="telephoneNumber" onBlur={() => setPhoneTouched(true)}
              error={phoneTouched && !phoneOk ? issueText({ path: 'provider.invitedPhone', code: 'PHONE_INVALID' }) : null} />
            <Button label={t('invite')} disabled={!phoneOk || !nameOk}
              onPress={() => { choose({ name: name.trim(), invitedPhone: normalizePhone(phone) }); setInvite(false); }} />
            <Button tone="secondary" label={t('cancel')} onPress={() => setInvite(false)} />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  name: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  sub: { fontSize: fontSize.caption, color: palette.muted, marginTop: 2 },
  empty: { fontSize: fontSize.small, color: palette.muted, paddingVertical: spacing.sm },
  invite: { minHeight: touchTarget + 4, borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.green, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inviteText: { fontSize: fontSize.small + 1, fontWeight: '700', color: palette.green },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,26,0.4)' },
  sheet: { backgroundColor: semantic.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  sheetTitle: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
});
