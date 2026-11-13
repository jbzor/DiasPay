import type { Receipt, Tranche, Transaction } from '@diaspay/api-client';
import { shortHash } from '@diaspay/domain';
import { palette, semantic } from '@diaspay/ui-tokens';

// Reçu (H7) : lignes affichées, texte de partage et modèle HTML du PDF. Logique pure, testée.

export interface ReceiptLabels {
  title: string;            // « Tranche débloquée »
  date: string; payer: string; provider: string; purpose: string; reference: string; fingerprint: string;
  verified: string;         // « Journal d’audit vérifié »
  notVerified: string;      // alerte si la chaîne ne se vérifie pas
  heading: string;          // « Reçu »
  subtitle: string;         // « Tranche 1 · Scolarité »
  footer: string;           // mention de simulation / génération
}

/**
 * Reçu disponible (lot X version 2, miroir de getReceipt) : dès que la tranche est payée en règlement direct ; en déblocage
 * conditionnel, une fois les fonds remis au prestataire. Une tranche remboursée garde son reçu de paiement.
 */
export function receiptAvailable(tx: Pick<Transaction, 'settlementMode'>, tr: Pick<Tranche, 'status' | 'fundsState'>): boolean {
  if (tr.status !== 'PAID' && tr.status !== 'REFUNDED') return false;
  return tx.settlementMode === 'DIRECT' || tr.fundsState === 'RELEASED';
}

export interface ReceiptFormat {
  money: (amountMinor: number, currency: Receipt['currency']) => string;
  dateTime: (iso: string) => string;
}

export function receiptRows(r: Receipt, l: ReceiptLabels, f: ReceiptFormat): Array<[string, string]> {
  return [
    [l.date, f.dateTime(r.releasedAt)],
    [l.payer, r.payerName || '—'],
    [l.provider, r.providerName],
    [l.purpose, r.purpose],
    [l.reference, r.reference || '—'],   // règlement direct : aucun jeton, donc aucune référence
    [l.fingerprint, shortHash(r.lastHash)],
  ];
}

/** Texte pour « Partager » (sans empreinte complète, lisible dans une messagerie). */
export function receiptShareText(r: Receipt, l: ReceiptLabels, f: ReceiptFormat): string {
  const lines = [`${l.heading} · ${l.subtitle}`, `${l.title} : ${f.money(r.amountMinor, r.currency)}`,
    ...receiptRows(r, l, f).map(([k, v]) => `${k} : ${v}`), r.chainValid ? l.verified : l.notVerified];
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Modèle HTML du PDF, aux couleurs de la charte (expo-print). */
export function receiptHtml(r: Receipt, l: ReceiptLabels, f: ReceiptFormat, lang: string): string {
  const rows = receiptRows(r, l, f).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('');
  const check = r.chainValid
    ? `<p class="ok">&#10003; ${esc(l.verified)}</p>`
    : `<p class="bad">${esc(l.notVerified)}</p>`;
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(l.heading)}</title>
<style>
  @page { margin: 24mm 18mm; }
  body { font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: ${palette.ink}; background: #fff; }
  .brand { color: ${palette.green}; font-weight: 700; font-size: 20px; }
  .brand span { color: ${palette.yellow}; }
  h1 { font-size: 22px; margin: 24px 0 4px; }
  .sub { color: ${palette.muted}; font-size: 13px; margin: 0 0 24px; }
  .badge { width: 56px; height: 56px; border-radius: 28px; background: ${palette.green}; color: #fff; font-size: 30px; line-height: 56px; text-align: center; margin: 0 auto 12px; }
  .title { text-align: center; font-size: 17px; font-weight: 600; margin: 0; }
  .amount { text-align: center; font-size: 30px; font-weight: 700; margin: 4px 0 20px; }
  table { width: 100%; border-collapse: collapse; border-top: 1px solid ${palette.line}; }
  td { padding: 10px 0; font-size: 14px; border-bottom: 1px solid ${palette.line}; }
  .k { color: ${palette.muted}; } .v { text-align: right; }
  .ok { color: ${palette.greenDark}; font-weight: 700; font-size: 14px; margin-top: 16px; }
  .bad { color: ${semantic.error}; background: ${semantic.errorTint}; padding: 10px; border-radius: 8px; font-weight: 700; font-size: 14px; }
  .hash { font-family: Menlo, Consolas, monospace; font-size: 10px; color: ${palette.muted}; word-break: break-all; margin-top: 20px; }
  footer { margin-top: 28px; color: ${palette.muted}; font-size: 11px; }
</style></head><body>
<div class="brand">DiasPay<span>QR</span></div>
<h1>${esc(l.heading)}</h1><p class="sub">${esc(l.subtitle)}</p>
<div class="badge">&#10003;</div>
<p class="title">${esc(l.title)}</p>
<p class="amount">${esc(f.money(r.amountMinor, r.currency))}</p>
<table>${rows}</table>
${check}
<p class="hash">${esc(l.fingerprint)} : ${esc(r.lastHash)} · ${r.entryCount}</p>
<footer>${esc(l.footer)}</footer>
</body></html>`;
}
