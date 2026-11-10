import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Platform, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/text';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { buildLink, encodeEqr, formatReference } from '@diaspay/domain';
import type { Tranche, TrancheToken, Transaction } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { trancheStatusKey, useI18n, verticalLabel } from '@/i18n';
import { api, usePersona, useTransactions } from '@/state/api';
import { LINK_BASE } from '@/lib/env';
import { tokenState } from '@/lib/expiry';
import { Banner, Button, H2, Row, Screen, TopBar } from '@/ui';
import { QrCode } from '@/ui/QrCode';

type Load =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'error' }
  | { kind: 'ready'; tx: Transaction; tranche: Tranche; token: TrancheToken };

/** Un tick par 30 s suffit pour le décompte (précision à la minute). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function TokenScreen() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, locale, dateTime, errorText } = useI18n();
  const persona = usePersona();
  const txs = useTransactions(); // se rafraîchit quand la tranche change (paiement, confirmation)
  const now = useNow();
  const { width } = useWindowDimensions();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: 'active' | 'error' } | null>(null);
  const qrRef = useRef<ComponentRef<typeof View>>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { tx, tranche } = await api.getTranche(String(trancheId));
        const token = await api.getToken(tranche.id);
        if (alive) setLoad({ kind: 'ready', tx, tranche, token });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (alive) setLoad({ kind: code === 'NOT_FOUND' || code === 'NO_TOKEN' ? 'notfound' : 'error' });
      }
    })();
    return () => { alive = false; };
  }, [trancheId, attempt, txs]);

  const retry = useCallback(() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }, []);

  if (load.kind !== 'ready') {
    return (
      <Screen>
        <TopBar title={t('tokenReadyTitle')} />
        {load.kind === 'loading' ? <Text style={st.muted} accessibilityLiveRegion="polite">{t('loading')}</Text> : null}
        {load.kind === 'notfound' ? <Banner tone="error" text={t('err_NOT_FOUND')} /> : null}
        {load.kind === 'error' ? (
          <>
            <Banner tone="error" text={t('loadFailed')} />
            <Button label={t('retry')} onPress={retry} />
          </>
        ) : null}
      </Screen>
    );
  }

  const { tx, tranche, token } = load;
  const state = tokenState(token, now);
  const usable = state.kind === 'valid';
  const link = buildLink(LINK_BASE, token.reference);
  const eqr = encodeEqr({ reference: token.reference, kid: token.kid, signature: token.signature });
  const ref = formatReference(token.reference);
  const qrSize = Math.min(276, width - 2 * spacing.xl);

  async function share() {
    setNotice(null);
    try {
      await Share.share({ message: t('shareMessage', { n: tranche.seq, link }), url: Platform.OS === 'ios' ? link : undefined });
    } catch {
      // Web sans partage natif : on copie le lien à la place.
      try { await Clipboard.setStringAsync(link); setNotice({ text: t('copied'), tone: 'active' }); }
      catch { setNotice({ text: t('shareFailed'), tone: 'error' }); }
    }
  }
  async function copy() {
    try {
      await Clipboard.setStringAsync(link);
      setNotice({ text: t('copied'), tone: 'active' });
      setTimeout(() => setNotice((n) => (n?.text === t('copied') ? null : n)), 2000);
    } catch { setNotice({ text: t('shareFailed'), tone: 'error' }); }
  }
  async function saveQr() {
    setNotice(null);
    try {
      // Capture puis partage de l’image : aucune permission de galerie n’est nécessaire.
      const uri = await captureRef(qrRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('saveQrTitle', { n: tranche.seq }), UTI: 'public.png' });
    } catch {
      setNotice({ text: t('saveFailed'), tone: 'error' });
    }
  }

  const validity =
    state.kind === 'valid' && state.countdown
      ? (state.countdown.hours > 0
        ? t('tokenCountdownHm', { h: state.countdown.hours, m: state.countdown.minutes })
        : t('tokenCountdownM', { m: state.countdown.minutes }))
      : null;

  return (
    <Screen footer={
      <>
        <Button label={t('shareLink')} onPress={share} disabled={!usable} />
        <View style={st.actions}>
          <Button small tone="secondary" label={t('copy')} onPress={copy} disabled={!usable} />
          {Platform.OS !== 'web' ? <Button small tone="secondary" label={t('saveQr')} onPress={saveQr} disabled={!usable} /> : null}
        </View>
      </>
    }>
      <TopBar title={t('tokenReadyTitle')} subtitle={t('tokenSubtitle', { type: verticalLabel(tx.vertical, locale), n: tranche.seq })} />
      <View style={st.issued}>
        <View style={[st.dot, { backgroundColor: usable ? palette.green : palette.disabled }]} />
        <Text style={st.issuedText}>{t('tokenIssued')}</Text>
      </View>

      {state.kind === 'expired' ? <Banner tone="error" text={t('tokenExpiredMsg')} /> : null}
      {state.kind === 'used' ? <Banner tone="pending" text={t('tokenUsedMsg')} /> : null}

      <View style={[st.qrBox, !usable ? { opacity: 0.35 } : null]}>
        <QrCode innerRef={qrRef} value={eqr} size={qrSize} accessibilityLabel={t('tokenQrLabel', { n: tranche.seq, ref })} />
      </View>
      <Text style={st.ref} selectable>{ref}</Text>
      <Text style={st.valid}>{t('tokenValidUntil', { date: dateTime(token.expiresAt) })}</Text>
      {validity ? <Text style={st.countdown} accessibilityLiveRegion="polite">{validity}</Text> : null}

      <H2>{t('diaspayLink')}</H2>
      <View>
        <Row label={t('diaspayLink')} value={link} />
        <Row label={t('status')} value={t(trancheStatusKey(tranche.status))} />
      </View>
      {tranche.status === 'AWAITING_PAYMENT' && persona === 'PAYER' && usable ? (
        <Button tone="text" label={t('payThisTranche')} onPress={() => router.push(`/pay/${tranche.id}`)} />
      ) : null}
      {token.simulated ? <Banner tone="pending" text={t('tokenSimBanner')} /> : null}
      {notice ? <Banner tone={notice.tone} text={notice.text} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  muted: { color: palette.muted, fontSize: fontSize.body },
  issued: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  issuedText: { fontSize: fontSize.caption, fontWeight: '700', color: palette.greenDark },
  qrBox: { alignItems: 'center', paddingVertical: spacing.sm },
  ref: { textAlign: 'center', fontSize: 20, fontWeight: '700', letterSpacing: 1, color: palette.ink, fontVariant: ['tabular-nums'] },
  valid: { textAlign: 'center', fontSize: fontSize.small, color: palette.muted },
  countdown: { textAlign: 'center', fontSize: fontSize.small, fontWeight: '700', color: palette.ink },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
