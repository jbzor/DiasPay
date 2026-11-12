import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/text';
import { useLocalSearchParams } from 'expo-router';
import { encodeEqr, formatReference } from '@diaspay/domain';
import type { Tranche, TrancheToken, Transaction } from '@diaspay/api-client';
import { fontSize, palette, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api, usePersona } from '@/state/api';
import { useTransactions } from '@/state/queries';
import { tokenState } from '@/lib/expiry';
import { useNoScreenCapture } from '@/lib/screenCapture';
import { Banner, Button, Divider, Screen, TopBar } from '@/ui';
import { QrCode } from '@/ui/QrCode';

type Load =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'error' }
  | { kind: 'unavailable'; tx: Transaction; tranche: Tranche }
  | { kind: 'ready'; tx: Transaction; tranche: Tranche; token: TrancheToken; image: boolean };

/** Un tick par 30 s suffit pour le décompte (précision à la minute). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * eQR d’une tranche (lot X, exigence 5.1 du cahier) : affiché uniquement au payeur connecté, pour sa propre tranche payée,
 * à présenter en personne au prestataire. Aucun lien, aucun partage, aucune copie, aucun enregistrement, aucune capture.
 * L’image du QR dépend du réglage serveur eqr_image_enabled ; la référence reste lisible pour la saisie manuelle.
 */
export default function TokenScreen() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, locale, dateTime } = useI18n();
  const persona = usePersona();
  const txs = useTransactions(); // se rafraîchit quand la tranche change (paiement, confirmation)
  const now = useNow();
  const { width } = useWindowDimensions();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useNoScreenCapture('token');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { tx, tranche } = await api.getTranche(String(trancheId));
        if (persona !== 'PAYER' || tranche.status !== 'PAID_LOCKED') {
          if (alive) setLoad({ kind: 'unavailable', tx, tranche });
          return;
        }
        const [token, image] = await Promise.all([api.getToken(tranche.id), api.eqrImageEnabled()]);
        if (alive) setLoad({ kind: 'ready', tx, tranche, token, image });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (alive) setLoad({ kind: code === 'NOT_FOUND' || code === 'TRANCHE_NOT_FOUND' || code === 'TX_NOT_FOUND' || code === 'NO_TOKEN' ? 'notfound' : 'error' });
      }
    })();
    return () => { alive = false; };
  }, [trancheId, attempt, txs, persona]);

  const retry = useCallback(() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }, []);

  if (load.kind !== 'ready') {
    return (
      <Screen>
        <TopBar title={t('tokenReadyTitle')}
          subtitle={load.kind === 'unavailable' ? t('tokenSubtitle', { type: verticalLabel(load.tx.vertical, locale), n: load.tranche.seq }) : undefined} />
        {load.kind === 'loading' ? <Text style={st.muted} accessibilityLiveRegion="polite">{t('loading')}</Text> : null}
        {load.kind === 'unavailable' ? <Banner tone="pending" text={t('tokenOnlyWhenPaid')} /> : null}
        {load.kind === 'notfound' ? <Banner tone="error" text={t('err_TRANCHE_NOT_FOUND')} /> : null}
        {load.kind === 'error' ? (
          <>
            <Banner tone="error" text={t('loadFailed')} />
            <Button label={t('retry')} onPress={retry} />
          </>
        ) : null}
      </Screen>
    );
  }

  const { tx, tranche, token, image } = load;
  const state = tokenState(token, now);
  const usable = state.kind === 'valid';
  const eqr = encodeEqr({ reference: token.reference, kid: token.kid, signature: token.signature });
  const ref = formatReference(token.reference);
  const qrSize = Math.min(200, width - 2 * spacing.xl);
  const validity =
    state.kind === 'valid' && state.countdown
      ? (state.countdown.hours > 0
        ? t('tokenCountdownHm', { h: state.countdown.hours, m: state.countdown.minutes })
        : t('tokenCountdownM', { m: state.countdown.minutes }))
      : null;

  return (
    <Screen>
      <TopBar title={t('tokenReadyTitle')} subtitle={t('tokenSubtitle', { type: verticalLabel(tx.vertical, locale), n: tranche.seq })} />
      <Divider />
      <View style={st.issued}>
        <View style={[st.dot, { backgroundColor: usable ? palette.green : palette.disabled }]} />
        <Text style={st.issuedText}>{t('tokenIssued')}</Text>
      </View>

      {state.kind === 'expired' ? <Banner tone="error" text={t('tokenExpiredMsg')} /> : null}
      {state.kind === 'used' ? <Banner tone="pending" text={t('tokenUsedMsg')} /> : null}

      {image ? (
        <View style={[st.qrBox, !usable ? { opacity: 0.35 } : null]}>
          <QrCode value={eqr} size={qrSize} accessibilityLabel={t('tokenQrLabel', { n: tranche.seq, ref })} />
        </View>
      ) : <Banner tone="pending" text={t('tokenImageOff')} />}
      <Text style={st.ref}>{t('refPrefix', { ref })}</Text>
      <Text style={st.valid}>{t('tokenValidUntil', { date: dateTime(token.expiresAt) })}</Text>
      {validity ? <Text style={st.countdown} accessibilityLiveRegion="polite">{validity}</Text> : null}

      <Divider />
      <Text style={st.muted}>{t('tokenInPerson')}</Text>
      {token.simulated ? <Banner tone="pending" text={t('tokenSimBanner')} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  muted: { color: palette.muted, fontSize: fontSize.body },
  issued: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  issuedText: { fontSize: fontSize.caption, fontWeight: '700', color: palette.greenDark },
  qrBox: { alignItems: 'center', paddingVertical: spacing.sm },
  ref: { textAlign: 'center', fontSize: 17, fontWeight: '600', letterSpacing: 1, color: palette.ink, fontVariant: ['tabular-nums'] },
  valid: { textAlign: 'center', fontSize: fontSize.small, color: palette.muted },
  countdown: { textAlign: 'center', fontSize: fontSize.small, fontWeight: '700', color: palette.ink },
});
