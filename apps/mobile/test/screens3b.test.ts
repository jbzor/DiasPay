import { describe, expect, it } from 'vitest';
import type { AppNotification, DisputeView, Receipt, Transaction } from '@diaspay/api-client';
import { ALERT_TYPES, alertKeys, groupByDay, localDay, unreadCount } from '../src/features/alerts/alerts';
import { canViewReceipt, disputeStatus, disputeSteps, isResolved, reasonKey } from '../src/features/dispute/state';
import { receiptHtml, receiptRows, receiptShareText } from '../src/features/receipt/receipt';
import type { ReceiptFormat, ReceiptLabels } from '../src/features/receipt/receipt';
import { formatPhoneDisplay } from '../src/lib/format';
import { en, fr } from '../src/i18n/messages';

const at = (d: string) => new Date(d).toISOString();
const n = (id: string, iso: string, event: AppNotification['event'], readAt?: string): AppNotification => ({ id, at: at(iso), event, readAt });

describe('alertes : regroupement par jour', () => {
  const now = new Date('2026-11-10T18:00:00');
  const list = [
    n('a', '2026-11-10T08:15:00', { type: 'PAYMENT_READY', txId: 'tx', trancheId: 'tr2' }),
    n('b', '2026-11-09T17:03:00', { type: 'TX_VALIDATED', txId: 'tx' }, at('2026-11-09T18:00:00')),
    n('c', '2026-11-10T10:42:00', { type: 'TRANCHE_CONFIRMED', txId: 'tx', trancheId: 'tr1' }),
    n('d', '2026-11-02T09:00:00', { type: 'TRANCHE_RELEASED', txId: 'tx', trancheId: 'tr1' }),
  ];
  it('Aujourd’hui, Hier, puis la date ; la plus récente d’abord', () => {
    const g = groupByDay(list, now);
    expect(g.map((x) => x.key)).toEqual(['today', 'yesterday', '2026-11-02']);
    expect(g[0]?.items.map((x) => x.id)).toEqual(['c', 'a']);
    expect(localDay(at('2026-11-10T23:59:00'))).toBe('2026-11-10');
  });
  it('compte les non lues', () => {
    expect(unreadCount(list)).toBe(3);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('alertes : libellés', () => {
  const tx = {
    id: 'tx', vertical: 'EDUCATION', providerName: 'École Les Palmiers',
    tranches: [{ id: 'tr1', seq: 1 }, { id: 'tr2', seq: 2, dueDate: '2026-11-15' }],
  } as unknown as Transaction;
  const fmt = { vertical: () => 'Scolarité', date: () => '15 nov.', dateTime: () => '10 nov., 14:00', outcome: (o: string) => (o === 'RELEASED' ? 'remis' : 'remboursé') };
  it('clés et paramètres par type d’événement', () => {
    expect(alertKeys(n('1', '2026-11-10', { type: 'PAYMENT_READY', txId: 'tx', trancheId: 'tr2' }), [tx], fmt))
      .toEqual({ title: 'alert_PAYMENT_READY_title', body: 'alert_PAYMENT_READY_body', params: { type: 'Scolarité', provider: 'École Les Palmiers', n: 2, date: '15 nov.' } });
    expect(alertKeys(n('2', '2026-11-10', { type: 'TRANCHE_CONFIRMED', txId: 'tx', trancheId: 'tr1', releaseAt: at('2026-11-12') }), [tx], fmt).params)
      .toMatchObject({ n: 1, date: '10 nov., 14:00' });
    expect(alertKeys(n('3', '2026-11-10', { type: 'TX_REJECTED', txId: 'tx', reason: 'Pièce illisible' }), [tx], fmt).params.reason).toBe('Pièce illisible');
    expect(alertKeys(n('4', '2026-11-10', { type: 'DISPUTE_RESOLVED', txId: 'tx', trancheId: 'tr1', outcome: 'REFUNDED' }), [tx], fmt).params.outcome).toBe('remboursé');
    // Transaction inconnue : pas de plantage.
    expect(alertKeys(n('5', '2026-11-10', { type: 'TX_VALIDATED', txId: 'autre' }), [tx], fmt).params).toEqual({ type: '', provider: '', n: '' });
  });
  it('chaque type d’événement a son titre et son texte en français et en anglais, avec les mêmes paramètres', () => {
    const keys = ALERT_TYPES.flatMap((t) => [`alert_${t}_title`, `alert_${t}_body`]);
    keys.push('alert_PAYMENT_READY_body_nodate', 'alert_TRANCHE_CONFIRMED_body_noauto', 'outcome_RELEASED', 'outcome_REFUNDED');
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    for (const k of keys) {
      const f = (fr as Record<string, string>)[k];
      const e = (en as Record<string, string>)[k];
      expect(f, k).toBeTruthy();
      expect(e, k).toBeTruthy();
      expect(ph(e as string), k).toBe(ph(f as string));
    }
  });
});

describe('litige : état et déroulement', () => {
  const open: DisputeView = {
    id: 'd', txId: 'tx', trancheId: 'tr', reason: 'NOT_DELIVERED', description: 'x', openedBy: 'PAYER', openedAt: at('2026-11-09T10:12:00'), status: 'OPEN',
  };
  it('en cours : deux étapes accomplies, examen en cours, décision à venir', () => {
    expect(disputeSteps(open).map((s) => [s.key, s.done, s.pending ?? null])).toEqual([
      ['opened', true, null], ['providerNotified', true, null], ['review', false, 'inProgress'], ['decision', false, 'upcoming'],
    ]);
    expect(disputeStatus(open)).toEqual({ key: 'disputeInReview', kind: 'pending' });
    expect(isResolved(open)).toBe(false);
    expect(canViewReceipt(open)).toBe(false);
  });
  it('résolu : déroulement complet ; reçu seulement si les fonds sont remis', () => {
    const refunded: DisputeView = { ...open, status: 'REFUNDED_TO_PAYER', resolvedAt: at('2026-11-10T16:40:00'), resolutionNote: 'n' };
    expect(disputeSteps(refunded).every((s) => s.done)).toBe(true);
    expect(disputeSteps(refunded)[2]).toMatchObject({ key: 'review', dayOnly: true, at: refunded.resolvedAt });
    expect(disputeStatus(refunded)).toEqual({ key: 'disputeResolvedRefunded', kind: 'active' });
    expect(canViewReceipt(refunded)).toBe(false);
    const released: DisputeView = { ...refunded, status: 'RELEASED_TO_PROVIDER' };
    expect(disputeStatus(released).key).toBe('disputeResolvedReleased');
    expect(canViewReceipt(released)).toBe(true);
  });
  it('motif : code traduit, ancien texte libre conservé', () => {
    expect(reasonKey('INCOMPLETE')).toBe('disputeReason_INCOMPLETE');
    expect(reasonKey('Prestation non réalisée : texte')).toBeNull();
  });
});

describe('reçu : formateur et modèle PDF', () => {
  const r: Receipt = {
    trancheId: 'tr', txId: 'tx', label: 'Inscription', amountMinor: 300_000, currency: 'XAF', releasedAt: at('2026-11-10T14:00:00'),
    payerName: 'Marie N.', providerName: 'École <Les> Palmiers', purpose: 'Scolarité 2026-2027', reference: '4F9A-2C71-B8E0-1D3C-A9',
    lastHash: `a3f9${'0'.repeat(56)}c71b`, chainValid: true, entryCount: 7,
  };
  const l: ReceiptLabels = {
    title: 'Tranche débloquée', date: 'Date', payer: 'Payeur', provider: 'Prestataire', purpose: 'Objectif', reference: 'Référence',
    fingerprint: 'Empreinte du journal', verified: 'Journal d’audit vérifié', notVerified: 'Journal non vérifié', heading: 'Reçu',
    subtitle: 'Tranche 1 · Scolarité', footer: 'Données simulées',
  };
  const f: ReceiptFormat = { money: (v) => `${v / 1000} 000 FCFA`, dateTime: () => '10 nov. 2026, 14:00' };
  it('lignes dans l’ordre de la maquette, empreinte abrégée', () => {
    expect(receiptRows(r, l, f)).toEqual([
      ['Date', '10 nov. 2026, 14:00'], ['Payeur', 'Marie N.'], ['Prestataire', 'École <Les> Palmiers'], ['Objectif', 'Scolarité 2026-2027'],
      ['Référence', '4F9A-2C71-B8E0-1D3C-A9'], ['Empreinte du journal', 'a3f9…c71b'],
    ]);
    expect(receiptRows({ ...r, payerName: '' }, l, f)[1]).toEqual(['Payeur', '—']);
  });
  it('texte de partage : la mention suit la vérification réelle de la chaîne', () => {
    expect(receiptShareText(r, l, f)).toContain('Journal d’audit vérifié');
    expect(receiptShareText({ ...r, chainValid: false }, l, f)).toContain('Journal non vérifié');
  });
  it('modèle HTML : couleurs de la charte, valeurs échappées, alerte si la chaîne ne se vérifie pas', () => {
    const html = receiptHtml(r, l, f, 'fr');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('#0A7C3E');
    expect(html).toContain('École &lt;Les&gt; Palmiers');
    expect(html).not.toContain('<Les>');
    expect(html).toContain(r.lastHash);
    expect(html).toContain('class="ok"');
    expect(receiptHtml({ ...r, chainValid: false }, l, f, 'fr')).toContain('class="bad"');
  });
});

describe('numéro affiché', () => {
  it('groupe le numéro national', () => {
    expect(formatPhoneDisplay('+33612345678')).toBe('+33 6 12 34 56 78');
    expect(formatPhoneDisplay('+237699001122')).toBe('+237 6 99 00 11 22');
    expect(formatPhoneDisplay('pas un numéro')).toBe('pas un numéro');
  });
});
