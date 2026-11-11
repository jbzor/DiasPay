import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH, MAX_FILES_PER_KIND, REQUIRED_DOCUMENTS, appendEntry, canTransitionTx, checkFileCount, computeEntryHash,
  missingRequiredDocuments, shortHash, transitionTx, verifyChain,
} from '../src';
import type { Actor, AuditEntryInput, ChainedAuditEntry } from '../src';

const user = (...roles: Array<'PAYER' | 'REQUESTER' | 'PROVIDER'>): Actor => ({ kind: 'USER', roles, isValidator: false });

describe('abandon d’un dossier rejeté (D4)', () => {
  it('REJECTED → CANCELLED pour le payeur et le demandeur', () => {
    expect(transitionTx('REJECTED', 'CANCELLED', user('PAYER'))).toBe('CANCELLED');
    expect(transitionTx('REJECTED', 'CANCELLED', user('REQUESTER'))).toBe('CANCELLED');
  });
  it('refusé au prestataire, au validateur et au système', () => {
    expect(() => transitionTx('REJECTED', 'CANCELLED', user('PROVIDER'))).toThrow(expect.objectContaining({ code: 'TRANSITION_FORBIDDEN' }));
    expect(canTransitionTx('REJECTED', 'CANCELLED', { kind: 'USER', roles: [], isValidator: true })).toBe(false);
    expect(canTransitionTx('REJECTED', 'CANCELLED', { kind: 'SYSTEM' })).toBe(false);
  });
  it('aucune autre transition vers CANCELLED', () => {
    for (const from of ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'VALIDATED', 'TOKEN_ISSUED', 'IN_PROGRESS', 'CLOSED', 'DISPUTED'] as const) {
      expect(() => transitionTx(from, 'CANCELLED', user('PAYER'))).toThrow(expect.objectContaining({ code: 'TRANSITION_UNKNOWN' }));
    }
    expect(() => transitionTx('CANCELLED', 'DRAFT', user('PAYER'))).toThrow(expect.objectContaining({ code: 'TRANSITION_UNKNOWN' }));
  });
});

describe('pièces (D2)', () => {
  it('listes de la vague 1 confirmées', () => {
    expect(REQUIRED_DOCUMENTS.HEALTH).toEqual([
      { kind: 'QUOTE', required: true }, { kind: 'BENEFICIARY_ID', required: true }, { kind: 'MEDICAL_CERTIFICATE', required: false },
    ]);
    expect(REQUIRED_DOCUMENTS.EDUCATION).toEqual([{ kind: 'ENROLMENT_CERTIFICATE', required: true }, { kind: 'SCHOOL_SCHEDULE', required: false }]);
    expect(REQUIRED_DOCUMENTS.RENT).toEqual([{ kind: 'LEASE', required: true }, { kind: 'LAST_RECEIPT', required: false }]);
  });
  it('jusqu’à 3 fichiers par type ; la pièce est fournie dès le premier fichier', () => {
    expect(MAX_FILES_PER_KIND).toBe(3);
    expect(() => checkFileCount(2)).not.toThrow();
    expect(() => checkFileCount(3)).toThrow(expect.objectContaining({ code: 'TOO_MANY_FILES' }));
    const f = (kind: string) => ({ kind, status: 'UPLOADED' });
    expect(missingRequiredDocuments('HEALTH', [f('QUOTE'), f('QUOTE'), f('BENEFICIARY_ID')])).toEqual([]);
  });
});

describe('journal d’audit chaîné', () => {
  const inputs: AuditEntryInput[] = [
    { at: '2026-11-08T09:12:00Z', actor: 'payer', event: 'NEED_SUBMITTED', txId: 'tx-1' },
    { at: '2026-11-08T11:40:00Z', actor: 'validator', event: 'NEED_VALIDATED', txId: 'tx-1', detail: 'ok | vu' },
    { at: '2026-11-08T14:05:00Z', actor: 'system', event: 'PAYMENT_SIMULATED', txId: 'tx-1', trancheId: 'tr-1' },
    { at: '2026-11-09T08:30:00Z', actor: 'provider', event: 'PROVIDER_SCAN', txId: 'tx-1', trancheId: 'tr-1' },
  ];
  const build = () => inputs.reduce<ChainedAuditEntry[]>((c, i) => appendEntry(c, i), []);

  it('chaîne valide, liens et numéros cohérents', () => {
    const chain = build();
    expect(chain.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    expect(chain[1]?.prevHash).toBe(chain[0]?.hash);
    expect(chain[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(chain)).toEqual({ valid: true, lastHash: chain[3]?.hash, count: 4 });
  });
  it('empreinte déterministe et sensible à chaque champ', () => {
    const e = { ...inputs[0]!, seq: 1 };
    expect(computeEntryHash(GENESIS_HASH, e)).toBe(computeEntryHash(GENESIS_HASH, { ...e }));
    expect(computeEntryHash(GENESIS_HASH, { ...e, detail: 'x' })).not.toBe(computeEntryHash(GENESIS_HASH, e));
    // Le séparateur échappé empêche deux contenus différents de donner la même ligne.
    expect(computeEntryHash(GENESIS_HASH, { ...e, actor: 'a|b', event: 'c' })).not.toBe(computeEntryHash(GENESIS_HASH, { ...e, actor: 'a', event: 'b|c' }));
  });
  it('détecte une ligne modifiée', () => {
    const chain = build();
    chain[1] = { ...chain[1]!, detail: 'refusé' };
    expect(verifyChain(chain)).toMatchObject({ valid: false, brokenAt: 2 });
  });
  it('détecte une ligne supprimée au milieu, et en fin de chaîne avec l’ancre', () => {
    const chain = build();
    expect(verifyChain([chain[0]!, chain[2]!, chain[3]!])).toMatchObject({ valid: false, brokenAt: 2 });
    const truncated = chain.slice(0, 3);
    expect(verifyChain(truncated).valid).toBe(true); // sans ancre, invisible
    expect(verifyChain(truncated, { count: 4 }).valid).toBe(false);
    expect(verifyChain(truncated, { lastHash: chain[3]!.hash }).valid).toBe(false);
  });
  it('chaîne vide', () => {
    expect(verifyChain([])).toEqual({ valid: true, lastHash: GENESIS_HASH, count: 0 });
    expect(verifyChain([], { count: 1 }).valid).toBe(false);
  });
  it('abrège l’empreinte', () => {
    expect(shortHash('a3f9' + '0'.repeat(56) + 'c71b')).toBe('a3f9…c71b');
  });
});

import { resolveDisputeTransition } from '../src';
describe('décision d’un litige (RG-09 : administrateur non partie)', () => {
  const admin: Actor = { kind: 'USER', roles: [], isValidator: true, isAdmin: true };
  const validator: Actor = { kind: 'USER', roles: [], isValidator: true };
  it('libère ou rembourse quand un administrateur non partie décide', () => {
    expect(resolveDisputeTransition({ status: 'DISPUTED' }, 'RELEASED', admin)).toBe('RELEASED');
    expect(resolveDisputeTransition({ status: 'DISPUTED' }, 'REFUNDED', admin)).toBe('CANCELLED');
  });
  it('refuse un validateur, même non partie (ADMIN_ONLY, comme resolve_dispute())', () => {
    expect(() => resolveDisputeTransition({ status: 'DISPUTED' }, 'RELEASED', validator)).toThrow(expect.objectContaining({ code: 'ADMIN_ONLY' }));
    expect(() => resolveDisputeTransition({ status: 'DISPUTED' }, 'RELEASED', user('PAYER'))).toThrow(expect.objectContaining({ code: 'ADMIN_ONLY' }));
    expect(() => resolveDisputeTransition({ status: 'DISPUTED' }, 'RELEASED', { kind: 'SYSTEM' })).toThrow(expect.objectContaining({ code: 'ADMIN_ONLY' }));
  });
  it('refuse un administrateur partie au dossier', () => {
    expect(() => resolveDisputeTransition({ status: 'DISPUTED' }, 'RELEASED', { ...admin, roles: ['PAYER'] }))
      .toThrow(expect.objectContaining({ code: 'VALIDATOR_IS_PARTY' }));
  });
  it('refuse une tranche qui n’est pas en litige', () => {
    expect(() => resolveDisputeTransition({ status: 'CONFIRMED' }, 'RELEASED', admin)).toThrow(expect.objectContaining({ code: 'NO_OPEN_DISPUTE' }));
  });
});
