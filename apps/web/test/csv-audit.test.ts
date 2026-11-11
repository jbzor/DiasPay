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
  fromStatus: 'DRAFT', toStatus: 'SUBMITTED', trancheId: null, trancheSeq: null, payload: {}, prevHash: null, hash: 'a'.repeat(64) };

describe('lignes du journal lisibles (maquette BO5)', () => {
  it('événements', () => {
    expect(eventLabel(base)).toBe('Dossier soumis');
    expect(eventLabel({ ...base, toStatus: 'VALIDATED' })).toBe('Dossier validé');
    expect(eventLabel({ ...base, event: 'SYSTEM_SIMULATED', fromStatus: 'VALIDATED', toStatus: 'TOKEN_ISSUED' })).toBe('Jeton émis');
    expect(eventLabel({ ...base, event: 'TRANCHE_ACTIVATED', toStatus: null, payload: { tranche_to: 'AWAITING_PAYMENT' } })).toBe('Tranche activée');
    expect(eventLabel({ ...base, event: 'SYSTEM_SIMULATED', toStatus: null, payload: { tranche_to: 'PAID_LOCKED' } })).toBe('Paiement reçu (fonds bloqués)');
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
