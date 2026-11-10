import { useCallback, useEffect, useReducer, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/text';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontSize, palette, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { trancheStatusKey, useI18n } from '@/i18n';
import { api, usePersona } from '@/state/api';
import { biometric } from '@/lib/biometric';
import { initialScanState, scanReducer } from '@/features/scan/reducer';
import { Banner, Button, Field, Icon, Row, StatusLabel } from '@/ui';

const FRAME = 220;
const CORNER = 28;

function Corners() {
  const c = { position: 'absolute' as const, width: CORNER, height: CORNER, borderColor: palette.yellow };
  return (
    <View style={st.frame} pointerEvents="none">
      <View style={[c, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 }]} />
      <View style={[c, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 }]} />
      <View style={[c, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 }]} />
      <View style={[c, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 }]} />
    </View>
  );
}

export default function Scan() {
  const { t, errorText, money } = useI18n();
  const persona = usePersona();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ ref?: string; n?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [s, dispatch] = useReducer(scanReducer, initialScanState);
  const [torch, setTorch] = useState(false);
  const [manualOpen, setManualOpen] = useState(Platform.OS === 'web');
  const [manual, setManual] = useState('');
  const [bioError, setBioError] = useState(false);

  useEffect(() => { dispatch({ type: 'START' }); }, []);

  // Lien profond du prestataire (/t/<référence>) : même parcours qu’un scan.
  useEffect(() => {
    if (params.ref) dispatch({ type: 'MANUAL', text: String(params.ref), at: Date.now() });
  }, [params.ref, params.n]);

  // Première ouverture : demande la permission de la caméra.
  useEffect(() => {
    if (focused && Platform.OS !== 'web' && permission && !permission.granted && permission.canAskAgain && permission.status === 'undetermined') {
      void requestPermission();
    }
  }, [focused, permission, requestPermission]);

  // Résolution de la référence lue.
  useEffect(() => {
    if (s.phase !== 'resolving' || !s.reference) return;
    let alive = true;
    api.resolveReference(s.reference).then(
      (info) => { if (alive) dispatch({ type: 'RESOLVED', info, now: Date.now(), isProvider: persona === 'PROVIDER' }); },
      (e) => { if (alive) dispatch({ type: 'FAILED', code: (e as { code?: string })?.code }); },
    );
    return () => { alive = false; };
  }, [s.phase, s.reference, persona]);

  const confirm = useCallback(async () => {
    if (s.phase !== 'ready' || !s.reference) return;
    setBioError(false);
    if (!(await biometric(t('bioReasonConfirm')))) { setBioError(true); return; }
    dispatch({ type: 'CONFIRM' });
    try {
      await api.confirmByReference(s.reference, new Date().toISOString());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      dispatch({ type: 'CONFIRMED' });
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      dispatch({ type: 'FAILED', code: (e as { code?: string })?.code });
    }
  }, [s.phase, s.reference, t]);

  const native = Platform.OS !== 'web';
  const granted = !!permission?.granted;
  const cameraOn = native && granted && focused; // la caméra est libérée dès que l’onglet n’est plus actif
  const topH = Math.round(height * 0.45);
  const busy = s.phase === 'resolving' || s.phase === 'confirming';
  const showSheet = s.phase !== 'scanning' && s.phase !== 'idle';

  return (
    <View style={st.screen}>
      <View style={[st.top, { height: topH, paddingTop: insets.top }]}>
        {cameraOn ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => dispatch({ type: 'SCAN', text: data, at: Date.now() })}
            accessibilityLabel={t('scanFrameHint')}
          />
        ) : null}
        {cameraOn ? (
          <>
            <View style={st.frameWrap} pointerEvents="none">
              <Corners />
              <Text style={st.hint}>{t('scanFrameHint')}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={torch ? t('torchOff') : t('torchOn')} accessibilityState={{ selected: torch }}
              onPress={() => setTorch((v) => !v)} style={[st.torch, { top: insets.top + spacing.sm }, torch ? { backgroundColor: palette.yellow } : null]}>
              <Icon name="bolt" size={22} color={torch ? palette.ink : '#FFFFFF'} />
            </Pressable>
          </>
        ) : (
          <View style={st.notice}>
            {!native ? (
              <Text style={st.noticeText}>{t('camWebNote')}</Text>
            ) : permission && !granted ? (
              <>
                <Text style={st.noticeTitle} accessibilityRole="header">{t('camDeniedTitle')}</Text>
                <Text style={st.noticeText}>{t('camDeniedText')}</Text>
                {permission.canAskAgain
                  ? <Button tone="accent" label={t('camAllow')} onPress={() => void requestPermission()} />
                  : <Button tone="accent" label={t('openSettings')} onPress={() => void Linking.openSettings()} />}
              </>
            ) : null}
          </View>
        )}
      </View>

      <View style={st.bottom}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: manualOpen }} onPress={() => setManualOpen((v) => !v)} style={st.manualToggle}>
          <Text style={st.manualToggleText}>{manualOpen ? t('hideReference') : t('enterReference')}</Text>
        </Pressable>
        {manualOpen ? (
          <View style={{ gap: spacing.sm }}>
            <Field label={t('reference')} value={manual} onChangeText={setManual} autoCapitalize="characters" autoCorrect={false}
              placeholder={t('referencePlaceholder')} returnKeyType="search"
              onSubmitEditing={() => dispatch({ type: 'MANUAL', text: manual, at: Date.now() })} />
            <Button label={t('lookUp')} disabled={manual.trim().length < 4 || busy}
              onPress={() => { dispatch({ type: 'RESET' }); dispatch({ type: 'MANUAL', text: manual, at: Date.now() }); }} />
          </View>
        ) : null}
      </View>

      {showSheet ? (
        <View style={st.sheet} accessibilityLiveRegion="polite" accessibilityLabel={t('scanSheetTitle')}>
          {s.phase === 'resolving' ? <Text style={st.sheetMuted}>{t('resolving')}</Text> : null}

          {s.phase === 'error' ? (
            <>
              <Banner tone="error" text={errorText({ code: s.error === 'GENERIC' ? undefined : s.error })} />
              <Button label={t('scanAnother')} onPress={() => dispatch({ type: 'RESET' })} />
            </>
          ) : null}

          {(s.phase === 'ready' || s.phase === 'confirming') && s.info ? (
            <>
              <StatusLabel kind="active" label={t('qrValid')} />
              <Text style={st.sheetTitle}>{t('sheetTranche', { n: s.info.seq, amount: money({ amountMinor: s.info.amountMinor, currency: s.info.currency }) })}</Text>
              <View>
                <Row label={t('beneficiary')} value={s.info.beneficiaryName} />
                <Row label={t('purpose')} value={s.info.purpose} />
                <Row label={t('status')} value={t(trancheStatusKey(s.info.status))} />
              </View>
              {bioError ? <Banner tone="error" text={t('bioFailed')} /> : null}
              <Button label={s.phase === 'confirming' ? t('confirmingMsg') : t('confirmService')} onPress={confirm} disabled={s.phase === 'confirming'} />
              <Text style={st.sheetMuted}>{t('contestNote', { hours: s.info.contestHours })}</Text>
              {s.phase === 'ready' ? <Button tone="text" label={t('cancel')} onPress={() => dispatch({ type: 'RESET' })} /> : null}
            </>
          ) : null}

          {s.phase === 'done' && s.info ? (
            <>
              <StatusLabel kind="active" label={t('scanDone')} />
              <Text style={st.sheetMuted}>{t('scanDoneNote', { label: s.info.label, hours: s.info.contestHours })}</Text>
              <Button label={t('scanAnother')} onPress={() => { setManual(''); dispatch({ type: 'RESET' }); }} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: semantic.background },
  top: { backgroundColor: palette.ink, justifyContent: 'center' },
  frameWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  frame: { width: FRAME, height: FRAME },
  hint: { color: '#FFFFFF', fontSize: fontSize.small, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  torch: { position: 'absolute', right: spacing.lg, width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  notice: { padding: spacing.xl, gap: spacing.md },
  noticeTitle: { color: '#FFFFFF', fontSize: fontSize.title, fontWeight: '700' },
  noticeText: { color: '#FFFFFF', fontSize: fontSize.body, lineHeight: 22 },
  bottom: { padding: spacing.xl, gap: spacing.md },
  manualToggle: { minHeight: touchTarget, justifyContent: 'center' },
  manualToggleText: { color: palette.green, fontSize: fontSize.body, fontWeight: '600' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.xl, gap: spacing.md, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  sheetTitle: { fontSize: 22, fontWeight: '700', color: palette.ink },
  sheetMuted: { fontSize: fontSize.small, color: palette.muted, lineHeight: 18 },
});
