import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Receipt } from '@diaspay/api-client';
import { fontSize, palette, semantic, spacing } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { useReceiptQuery, useTransactions } from '@/state/queries';
import { receiptHtml, receiptRows, receiptShareText } from '@/features/receipt/receipt';
import type { ReceiptFormat, ReceiptLabels } from '@/features/receipt/receipt';
import { Banner, Button, Icon, Row, Screen, TopBar } from '@/ui';
import { Text } from '@/ui/text';

/** H7 — Reçu d’une tranche payée (règlement direct) ou débloquée (conditionnel) : vérification réelle du journal chaîné, export PDF et partage. */
export default function ReceiptScreen() {
  const { trancheId } = useLocalSearchParams<{ trancheId: string }>();
  const { t, locale, money, date, errorText } = useI18n();
  const txs = useTransactions();
  const rq = useReceiptQuery(trancheId);
  const receipt: Receipt | null = rq.data ?? null;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (rq.error ? errorText(rq.error) : null);

  const tx = txs.find((x) => x.tranches.some((r) => r.id === trancheId));
  const tr = tx?.tranches.find((r) => r.id === trancheId);
  const subtitle = tx && tr ? t('receiptSubtitle', { n: tr.seq, type: verticalLabel(tx.vertical, locale) }) : '';
  const labels: ReceiptLabels = {
    // Règlement direct : reçu dès le paiement ; conditionnel : à la libération des fonds.
    title: tx?.settlementMode === 'CONDITIONAL' ? t('trancheReleased') : t('tranchePaid'),
    date: t('receiptDate'), payer: t('payerWord'), provider: t('providerLabel'), purpose: t('purpose'),
    reference: t('reference'), fingerprint: t('fingerprint'), verified: t('auditVerified'), notVerified: t('auditNotVerified'),
    heading: t('receiptTitle'), subtitle, footer: t('receiptFooter'),
  };
  const fmt: ReceiptFormat = {
    money: (amountMinor, currency) => money({ amountMinor, currency }),
    dateTime: (iso) => `${date(iso)}, ${new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}`,
  };

  async function exportPdf() {
    if (!receipt) return;
    setError(null);
    const html = receiptHtml(receipt, labels, fmt, locale);
    try {
      if (Platform.OS === 'web') {
        // Web : expo-print imprime la page courante ; on ouvre le reçu seul et on lance l’impression (« Enregistrer en PDF »).
        const w = window.open('', '_blank');
        if (!w) { setError(t('pdfUnavailable')); return; }
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) { setError(t('pdfUnavailable')); return; }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: labels.heading });
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function share() {
    if (!receipt) return;
    try { await Share.share({ message: receiptShareText(receipt, labels, fmt) }); } catch (e) { setError(errorText(e)); }
  }

  return (
    <Screen footer={receipt ? (
      <>
        <Button label={t('exportPdf')} onPress={() => void exportPdf()} />
        <Button tone="secondary" label={t('share')} onPress={() => void share()} />
      </>
    ) : undefined}>
      <TopBar title={t('receiptTitle')} subtitle={subtitle} />
      {receipt ? (
        <>
          <View style={st.hero}>
            <View style={st.badge}><Icon name="check" size={34} color="#fff" /></View>
            <Text style={st.title}>{t('trancheReleased')}</Text>
            <Text style={st.amount}>{money({ amountMinor: receipt.amountMinor, currency: receipt.currency })}</Text>
          </View>
          <View>
            {receiptRows(receipt, labels, fmt).map(([k, v]) => <Row key={k} label={k} value={v} />)}
          </View>
          {receipt.chainValid ? (
            <View style={st.verified} accessibilityRole="text">
              <View style={st.verifiedIcon}><Icon name="check" size={14} color={palette.green} /></View>
              <Text style={st.verifiedText}>{t('auditVerified')}</Text>
            </View>
          ) : <Banner tone="error" text={t('auditNotVerified')} />}
        </>
      ) : null}
      {error ? <Banner tone="error" text={error} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.line },
  badge: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { fontSize: fontSize.title, fontWeight: '600', color: palette.ink },
  amount: { fontSize: 30, fontWeight: '700', color: palette.ink, letterSpacing: -0.5 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  verifiedIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.greenTint, alignItems: 'center', justifyContent: 'center' },
  verifiedText: { fontSize: fontSize.body, fontWeight: '600', color: semantic.primary },
});
