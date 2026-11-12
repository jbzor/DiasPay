import { describe, expect, it, vi } from 'vitest';
import { DomainError, emptyDraft } from '@diaspay/domain';
import { assertPublicKey, convert, setErrorLogger, toAuthError, toDomainError } from '../src';
import type { TxWithRelations } from '../src/supabase/convert';

const T = '2026-11-11T10:00:00.123+00:00';
const TX = 'e3000000-0000-4000-8000-000000000001';

function txRow(over: Partial<TxWithRelations> = {}): TxWithRelations {
  return {
    id: TX, vertical: 'EDUCATION', purpose: 'Scolarité 2026-2027', amount_minor: 900000, currency: 'XAF', status: 'IN_PROGRESS',
    created_by: 'u1', due_date: null, expires_at: null, reject_reason: null, created_at: T, updated_at: T,
    beneficiary_name: 'Awa', provider_id: null, provider_name: 'Lycée Leclerc', plan_type: 'PARTIAL', draft_data: {},
    tranches: [
      { id: 't2', tx_id: TX, seq: 2, label: 'Solde', amount_minor: 500000, due_date: null, status: 'PLANNED', release_mode: 'PROVIDER_CONFIRM',
        contest_hours: 72, contest_ends_at: null, released_at: null, created_at: T, updated_at: T, tranche_tokens: null },
      { id: 't1', tx_id: TX, seq: 1, label: 'Inscription', amount_minor: 400000, due_date: '2026-11-15', status: 'CONFIRMED', release_mode: 'PROVIDER_CONFIRM',
        contest_hours: 72, contest_ends_at: '2026-11-14T10:00:00+00:00', released_at: null, created_at: T, updated_at: T,
        tranche_tokens: { reference: '4f9a2c71b8e01d3ca9', revoked_at: null } },
    ],
    documents: [
      { id: 'd1', tranche_id: null, deleted_at: null },
      { id: 'd2', tranche_id: null, deleted_at: T },
      { id: 'd3', tranche_id: 't1', deleted_at: null },
    ],
    ...over,
  } as TxWithRelations;
}

describe('conversion des lignes du serveur', () => {
  it('transaction : snake_case → domaine, tranches triées, pièces archivées exclues', () => {
    const tx = convert.toTransaction(txRow());
    expect(tx).toMatchObject({
      id: TX, vertical: 'EDUCATION', amount: { amountMinor: 900000, currency: 'XAF' }, status: 'IN_PROGRESS',
      providerName: 'Lycée Leclerc', beneficiaryName: 'Awa', planType: 'PARTIAL', documentCount: 1, ownerId: 'u1',
      createdAt: '2026-11-11T10:00:00.123Z',
    });
    expect(tx.tranches.map((t) => t.seq)).toEqual([1, 2]);
    expect(tx.tranches[0]).toMatchObject({ reference: '4f9a2c71b8e01d3ca9', contestEndsAt: '2026-11-14T10:00:00.000Z', evidenceCount: 1, dueDate: '2026-11-15' });
    expect(tx.tranches[1]).toMatchObject({ reference: undefined, dueDate: undefined, evidenceCount: 0 });
  });

  it('bigint transmis en chaîne : converti exactement', () => {
    expect(convert.toMinor('12500000')).toBe(12_500_000);
    expect(() => convert.toMinor('9007199254740993')).toThrow(expect.objectContaining({ code: 'UNEXPECTED' }));
    expect(() => convert.toMinor(1.5)).toThrow(expect.objectContaining({ code: 'UNEXPECTED' }));
  });

  it('valeur hors domaine : UNEXPECTED, jamais propagée', () => {
    expect(() => convert.toTransaction(txRow({ status: 'BIDON' as never }))).toThrow(expect.objectContaining({ code: 'UNEXPECTED' }));
    expect(() => convert.toTransaction(txRow({ vertical: 'CASINO' as never }))).toThrow(expect.objectContaining({ code: 'UNEXPECTED' }));
  });

  it('jeton renvoyé sous forme de tableau (relation non unique) : accepté', () => {
    const row = txRow();
    row.tranches[1]!.tranche_tokens = [{ reference: 'bbbbbbbbbbbbbbbbbb', revoked_at: T }, { reference: 'aaaaaaaaaaaaaaaaaa', revoked_at: null }];
    expect(convert.toTransaction(row).tranches[0]!.reference).toBe('aaaaaaaaaaaaaaaaaa');
  });

  it('notification : événement lu dans payload, type inconnu ignoré', () => {
    const base = { id: 'n1', user_id: 'u1', tx_id: TX, read_at: null, created_at: T };
    expect(convert.toNotification({ ...base, event: 'TX_REJECTED', payload: { type: 'TX_REJECTED', txId: TX, reason: 'Devis illisible' } }))
      .toEqual({ id: 'n1', at: '2026-11-11T10:00:00.123Z', readAt: undefined, event: { type: 'TX_REJECTED', txId: TX, reason: 'Devis illisible' } });
    expect(convert.toNotification({ ...base, event: 'DISPUTE_RESOLVED', payload: { type: 'DISPUTE_RESOLVED', txId: TX, trancheId: 't1', outcome: 'REFUNDED' } })?.event)
      .toEqual({ type: 'DISPUTE_RESOLVED', txId: TX, trancheId: 't1', outcome: 'REFUNDED' });
    expect(convert.toNotification({ ...base, event: 'FUTUR', payload: { type: 'FUTUR' } })).toBeNull();
  });

  it('journal : entrée d’audit', () => {
    expect(convert.toAuditEntry({ id: 3, tx_id: TX, tranche_id: 't1', actor_id: null, event: 'TRANCHE_CHANGE', from_status: null, to_status: null,
      payload: { tranche_to: 'CONFIRMED' }, prev_hash: 'a', hash: 'b', created_at: T }))
      .toEqual({ at: '2026-11-11T10:00:00.123Z', event: 'TRANCHE_CHANGE', trancheId: 't1', detail: 'CONFIRMED', actor: undefined, hash: 'b' });
  });

  it('reçu, litige, référence', () => {
    expect(convert.toReceipt({ trancheId: 't1', txId: TX, label: 'Inscription', amountMinor: 400000, currency: 'XAF', releasedAt: T,
      payerName: 'Marie', providerName: 'Lycée', purpose: 'Scolarité', reference: 'r', lastHash: 'h', chainValid: true, entryCount: 9 }))
      .toMatchObject({ amountMinor: 400000, chainValid: true, releasedAt: '2026-11-11T10:00:00.123Z' });
    expect(convert.toDispute(null)).toBeNull();
    expect(convert.toDispute({ id: 'd', txId: TX, trancheId: 't1', reason: 'NOT_DELIVERED', description: 'x', openedBy: 'PROVIDER', openedAt: T, status: 'OPEN' }))
      .toMatchObject({ openedBy: 'PROVIDER', status: 'OPEN', resolvedAt: undefined });
    expect(() => convert.toDispute({ id: 'd', txId: TX, trancheId: 't1', openedAt: T, status: 'PERDU' })).toThrow(expect.objectContaining({ code: 'UNEXPECTED' }));
    expect(convert.toReferenceInfo({ trancheId: 't1', txId: TX, label: 'L', amountMinor: 5, currency: 'EUR', status: 'PAID_LOCKED', expiresAt: T, used: false, seq: 2, contestHours: 48 }))
      .toMatchObject({ currency: 'EUR', status: 'PAID_LOCKED', seq: 2, contestHours: 48, providerName: '' });
  });

  it('brouillon : aller (sans pièces ni URI locale) et retour', () => {
    const d = { ...emptyDraft(TX, new Date(T)), vertical: 'HEALTH' as const, amountMinor: 1000,
      documents: [{ id: 'x', kind: 'QUOTE' as const, name: 'q.pdf', mimeType: 'application/pdf', sizeBytes: 9, uri: 'file:///q.pdf', status: 'UPLOADED' as const }] };
    const out = convert.draftToServer(d) as Record<string, unknown>;
    expect(out.documents).toBeUndefined();
    expect(out).toMatchObject({ id: TX, vertical: 'HEALTH', amountMinor: 1000 });
    const back = convert.draftFromServer({ ...out, updatedAt: T, ownerId: 'u1',
      documents: [{ id: 'srv', kind: 'QUOTE', name: 'q.pdf', mimeType: 'application/pdf', sizeBytes: 9, status: 'UPLOADED', storagePath: `${TX}/QUOTE/a.pdf`, uploadedAt: T }] });
    expect(back.documents).toEqual([{ id: 'srv', kind: 'QUOTE', name: 'q.pdf', mimeType: 'application/pdf', sizeBytes: 9, status: 'UPLOADED', uploadedAt: '2026-11-11T10:00:00.123Z' }]);
    expect(back).toMatchObject({ id: TX, vertical: 'HEALTH', amountMinor: 1000, ownerId: 'u1', updatedAt: '2026-11-11T10:00:00.123Z' });
  });

  it('chemin de stockage <tx>/<type>/<uuid>.<ext>', () => {
    expect(convert.storagePath(TX, 'QUOTE', 'f1', 'application/pdf')).toBe(`${TX}/QUOTE/f1.pdf`);
    expect(convert.storagePath(TX, 'BENEFICIARY_ID', 'f2', 'image/png')).toBe(`${TX}/BENEFICIARY_ID/f2.png`);
    expect(convert.storagePath(TX, 'BENEFICIARY_ID', 'f3', 'image/jpeg')).toBe(`${TX}/BENEFICIARY_ID/f3.jpg`);
  });
});

describe('erreurs du serveur → DomainError', () => {
  it('code lu dans hint, détails exploitables', () => {
    const e = toDomainError({ code: 'P0001', message: 'Pièce obligatoire manquante', details: 'BENEFICIARY_ID', hint: 'DOCUMENT_REQUIRED' });
    expect(e).toBeInstanceOf(DomainError);
    expect(e).toMatchObject({ code: 'DOCUMENT_REQUIRED', details: { kind: 'BENEFICIARY_ID' } });
    expect(toDomainError({ code: 'P0001', message: 'x', details: '{"sum": 100000, "total": 180000, "gap": 80000}', hint: 'PLAN_SUM_MISMATCH' }))
      .toMatchObject({ code: 'PLAN_SUM_MISMATCH', details: { sum: 100000, total: 180000, gap: 80000 } });
  });

  it('sans hint : UNEXPECTED, journalisée, message brut jamais repris', () => {
    const log = vi.fn();
    setErrorLogger(log);
    const e = toDomainError({ code: '23505', message: 'duplicate key value violates unique constraint "secret_idx"' }, 'test');
    expect(e.code).toBe('UNEXPECTED');
    expect(e.message).not.toContain('secret_idx');
    expect(log).toHaveBeenCalledWith('test', expect.anything());
    expect(toDomainError({ code: 'P0001', message: 'x', hint: 'CODE_INCONNU' }).code).toBe('UNEXPECTED');
  });

  it('réseau coupé : OFFLINE', () => {
    expect(toDomainError(new TypeError('Network request failed')).code).toBe('OFFLINE');
    expect(toDomainError({ message: 'TypeError: Failed to fetch' }).code).toBe('OFFLINE');
  });

  it('une DomainError reste telle quelle', () => {
    const e = new DomainError('TOKEN_USED', 'x');
    expect(toDomainError(e)).toBe(e);
  });
});

describe('erreurs de Supabase Auth → codes OTP (décision D5)', () => {
  const now = 1_000_000;
  it('otp_expired : OTP_WRONG avant l’expiration locale, OTP_EXPIRED après', () => {
    expect(toAuthError({ code: 'otp_expired', status: 403 }, { step: 'verify', otpExpiresAt: now + 1, now }).code).toBe('OTP_WRONG');
    expect(toAuthError({ code: 'otp_expired', status: 403 }, { step: 'verify', otpExpiresAt: now, now }).code).toBe('OTP_EXPIRED');
  });
  it('code erroné sans nombre d’essais restants', () => {
    expect((toAuthError({ code: 'otp_expired' }, { step: 'verify', otpExpiresAt: now + 1, now }) as { details?: { remaining?: number } }).details?.remaining).toBeUndefined();
  });
  it('limites de débit', () => {
    expect(toAuthError({ code: 'over_sms_send_rate_limit', status: 429 }, { step: 'request' }).code).toBe('OTP_RESEND_TOO_SOON');
    expect(toAuthError({ code: 'over_request_rate_limit', status: 429 }, { step: 'verify' }).code).toBe('OTP_LOCKED');
    expect(toAuthError({ status: 429 }, { step: 'verify' }).code).toBe('OTP_LOCKED');
  });
  it('erreur inconnue : UNEXPECTED ; réseau : OFFLINE', () => {
    setErrorLogger(() => {});
    expect(toAuthError({ code: 'sms_send_failed', status: 500 }, { step: 'request' }).code).toBe('UNEXPECTED');
    expect(toAuthError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, { step: 'request' }).code).toBe('OFFLINE');
  });
});

describe('clé du client', () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
  it('refuse la clé service_role et les clés secrètes', () => {
    expect(() => assertPublicKey(jwt('service_role'))).toThrow(/refusée/);
    expect(() => assertPublicKey('sb_secret_abc')).toThrow(/refusée/);
  });
  it('accepte la clé publique', () => {
    expect(() => assertPublicKey(jwt('anon'))).not.toThrow();
    expect(() => assertPublicKey('sb_publishable_abc')).not.toThrow();
  });
});
