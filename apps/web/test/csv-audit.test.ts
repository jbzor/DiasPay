import { describe, expect, it } from 'vitest';
import { BOM, csvCell, toCsv } from '@/lib/csv';
import { actorLabel, eventLabel, trancheLabel } from '@/lib/audit';
import type { AuditRow } from '@/lib/bo';

describe('export CSV pour Excel', () => {
  it('UTF-8 avec BOM, séparateur point-virgule, CRLF', () => {
    const csv = toCsv(['Heure', 'Acteur'], [['2026-11-08T09:12:00Z', 'Marie N. (payeur)']]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}Heure;Acteur\r\n2026-11-08T09:12:00Z;Marie N. (payeur)\r\n`);
  });
  it('guillemets, séparateurs et retours à la ligne protégés', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('ligne\nsuivante')).toBe('"ligne\nsuivante"');
    expect(csvCell({ reason: 'x;y' })).toBe('"{""reason"":""x;y""}"');
    expect(csvCell(null)).toBe('');
  });
  it('injection de formules neutralisée', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+33 6')).toBe("'+33 6");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('accents conservés (UTF-8)', () => {
    expect(toCsv(['Événement'], [['Délai de contestation ouvert']])).toContain('Délai de contestation ouvert');
  });
});

const base: AuditRow = { id: 1, createdAt: '2026-11-08T09:12:00Z', actorId: 'u', actorName: 'Marie N.', actorRole: 'PAYER', event: 'STATUS_CHANGE',
  fromStatus: 'DRAFT', toStatus: 'PENDING_REVIEW', trancheId: null, trancheSeq: null, payload: {}, prevHash: null, hash: 'a'.repeat(64) };

describe('lignes du journal lisibles (maquette BO5)', () => {
  it('événements (lot X v2)', () => {
    expect(eventLabel(base)).toBe('Dossier soumis');
    expect(eventLabel({ ...base, fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW' })).toBe('Dossier pris en charge');
    expect(eventLabel({ ...base, fromStatus: 'IN_REVIEW', toStatus: 'ACTIVE' })).toBe('Dossier validé (opération active)');
    expect(eventLabel({ ...base, fromStatus: 'IN_REVIEW', toStatus: 'CANCELLED', payload: { reason: 'Pièce illisible' } })).toBe('Dossier rejeté (opération annulée)');
    expect(eventLabel({ ...base, fromStatus: 'ACTIVE', toStatus: 'CANCELLED' })).toBe('Opération annulée');
    expect(eventLabel({ ...base, event: 'AUTO_ACTIVATED', fromStatus: 'DRAFT', toStatus: 'ACTIVE' })).toBe('Opération activée sans revue (type de besoin sans revue)');
    expect(eventLabel({ ...base, event: 'OPERATION_SUSPENDED', fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' })).toBe('Opération suspendue');
    expect(eventLabel({ ...base, event: 'REQUEST_SUBMITTED', toStatus: null, payload: { tranche_from: 'DRAFT', tranche_to: 'SUBMITTED' } })).toBe('Demande de paiement envoyée au payeur');
    expect(eventLabel({ ...base, event: 'REQUEST_PAID', toStatus: null, payload: { tranche_from: 'ACCEPTED', tranche_to: 'PAID' } })).toBe('Demande payée');
    expect(eventLabel({ ...base, event: 'FUNDS_RELEASED', toStatus: null, payload: { funds_from: 'HELD', funds_to: 'RELEASED' } })).toBe('Fonds libérés au prestataire');
    // Événement générique : libellé tiré de tranche_to ou de funds_to.
    expect(eventLabel({ ...base, event: 'TRANCHE_CHANGE', toStatus: null, payload: { tranche_to: 'REFUNDED' } })).toBe('Demande remboursée');
    expect(eventLabel({ ...base, event: 'TRANCHE_CHANGE', toStatus: null, payload: { funds_to: 'RETURNED' } })).toBe('Fonds rendus au payeur');
  });
  it('événements du journal antérieur au lot X v2 (ajout seul : toujours lisibles)', () => {
    expect(eventLabel({ ...base, toStatus: 'SUBMITTED' })).toBe('Dossier soumis');
    expect(eventLabel({ ...base, toStatus: 'VALIDATED' })).toBe('Dossier validé');
    expect(eventLabel({ ...base, event: 'SYSTEM_SIMULATED', fromStatus: 'VALIDATED', toStatus: 'TOKEN_ISSUED' })).toBe('Jeton émis');
    expect(eventLabel({ ...base, event: 'TRANCHE_ACTIVATED', toStatus: null, payload: { tranche_to: 'AWAITING_PAYMENT' } })).toBe('Tranche activée');
    expect(eventLabel({ ...base, event: 'SYSTEM_SIMULATED', toStatus: null, payload: { tranche_to: 'PAID_LOCKED' } })).toBe('Paiement reçu (fonds bloqués)');
  });
  it('événements communs', () => {
    expect(eventLabel({ ...base, event: 'PROVIDER_SCAN', toStatus: null })).toBe('Confirmation par scan');
    expect(eventLabel({ ...base, event: 'VALIDATION_DECISION', toStatus: null, payload: { approved: true } })).toBe('Approbation d’un validateur (montant vérifié)');
    expect(eventLabel({ ...base, event: 'DOCUMENT_VIEWED', toStatus: null, payload: { file_name: 'devis.pdf' } })).toBe('Pièce consultée : devis.pdf');
    expect(eventLabel({ ...base, event: 'INCONNU', toStatus: null })).toBe('Événement INCONNU');
  });
  it('acteurs', () => {
    expect(actorLabel(base)).toBe('Marie N. (payeur)');
    expect(actorLabel({ ...base, actorRole: 'VALIDATOR', actorName: 'Validateur A' })).toBe('Validateur A (validateur)');
    expect(actorLabel({ ...base, actorId: null })).toBe('Système');
  });
  it('tranches', () => {
    expect(trancheLabel(base)).toBe('—');
    expect(trancheLabel({ ...base, trancheSeq: 1 })).toBe('Tranche 1');
    expect(trancheLabel({ ...base, event: 'SYSTEM_SIMULATED', toStatus: 'TOKEN_ISSUED' })).toBe('Toutes');
  });
});

describe('libellés du lot X v2', () => {
  it('statuts d’opération et de demande, événements nouveaux', async () => {
    const { tMaybe } = await import('@/i18n');
    for (const s of ['DRAFT', 'PENDING_REVIEW', 'IN_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED']) expect(tMaybe(`txStatus.${s}`), s).not.toBeNull();
    for (const s of ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED', 'PAID', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REFUNDED']) {
      expect(tMaybe(`trStatus.${s}`), s).not.toBeNull();
      expect(tMaybe(`event.trancheTo.${s}`), `trancheTo.${s}`).not.toBeNull();
    }
    for (const e of ['AUTO_ACTIVATED', 'REQUEST_SUBMITTED', 'REQUEST_ACCEPTED', 'REQUEST_PAID', 'REQUEST_REFUNDED', 'REQUEST_CANCELLED', 'REQUEST_EXPIRED',
      'PAYMENT_RETRY_ALLOWED', 'FUNDS_RELEASED', 'FUNDS_RETURNED', 'SERVICE_CONFIRMED', 'EVIDENCE_SUBMITTED', 'OPERATION_SUSPENDED', 'OPERATION_RESUMED',
      'PLAN_ACCEPTED', 'DISPUTE_RESPONSE_REQUESTED', 'DISPUTE_MESSAGE', 'PRESENTATION_TOKEN_ISSUED', 'PRESENTATION_TOKEN_REVOKED', 'PRESENTATION_CLAIMED',
      'TX_CANCELLED']) expect(tMaybe(`event.${e}`), e).not.toBeNull();
  });
});
