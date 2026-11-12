import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DomainError, HASH_ALGO, LEDGER_ACCOUNTS, PaymentEngine, RECONCILIATION_ISSUES, SIMULATED_SIGNATURE_HEADER, SimulatedPaymentAdapter, bufferToHex,
  checkContentHash, documentLockError, isContentHash, journalBalanced, normalizeContentHash, otherDossiersWithHash, reconcile, sha256Hex,
} from '../src';
import type { IncomingWebhook, PaymentAttempt, PaymentContext, TrancheStatus } from '../src';

const root = join(__dirname, '..', '..', '..');
const sql = (f: string) => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8');
const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof DomainError ? e.code : 'OTHER'; } };

describe('X4 — empreintes des pièces', () => {
  it('SHA-256 : valeurs de référence (FIPS 180-4)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('SHA-256 : même résultat que la bibliothèque de référence sur des octets quelconques (dont plusieurs blocs)', () => {
    for (const n of [1, 55, 56, 64, 65, 1000, 100_000]) {
      const b = randomBytes(n);
      expect(sha256Hex(new Uint8Array(b))).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });

  it('bufferToHex : résultat d’expo-crypto ou de WebCrypto (ArrayBuffer) en hexadécimal', async () => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    expect(bufferToHex(buf)).toBe(sha256Hex('abc'));
  });

  it('format : 64 caractères hexadécimaux, normalisé en minuscules (miroir de _norm_hash et _documents_guard)', () => {
    expect(HASH_ALGO).toBe('SHA-256');
    expect(normalizeContentHash(' ' + 'A'.repeat(64) + ' ')).toBe('a'.repeat(64));
    expect(normalizeContentHash('')).toBeUndefined();
    expect(isContentHash('a'.repeat(64))).toBe(true);
    expect(isContentHash('a'.repeat(63))).toBe(false);
    expect(isContentHash('g'.repeat(64))).toBe(false);
    expect(code(() => checkContentHash('abc'))).toBe('HASH_INVALID');
    expect(code(() => checkContentHash(undefined, true))).toBe('HASH_REQUIRED');
    expect(checkContentHash(undefined)).toBeUndefined();
    expect(checkContentHash('B'.repeat(64))).toBe('b'.repeat(64));
  });

  it('immuabilité : modifiable en brouillon ou dossier rejeté, pièce de réponse pendant INFO_REQUESTED (miroir de _documents_immutable)', () => {
    expect(documentLockError('DRAFT')).toBeNull();
    expect(documentLockError('REJECTED')).toBeNull();
    expect(documentLockError('SUBMITTED')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('IN_PROGRESS')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('IN_PROGRESS', 'INFO_REQUESTED')).toBeNull();
    expect(documentLockError('IN_PROGRESS', 'PAID_LOCKED')).toBe('DOCUMENT_LOCKED');
    const fn = sql('0009_lotx_x4.sql');
    expect(fn).toMatch(/v_status in \('DRAFT','REJECTED'\)/);
    expect(fn).toMatch(/v_tr = 'INFO_REQUESTED'/);
  });

  it('réutilisation : autres dossiers seulement, brouillons et pièces archivées exclus (miroir de _hash_reuse)', () => {
    const h = 'c'.repeat(64);
    const docs = [
      { txId: 'A', contentHash: h, txStatus: 'SUBMITTED' as const },
      { txId: 'B', contentHash: h.toUpperCase(), txStatus: 'IN_PROGRESS' as const },
      { txId: 'B', contentHash: h, txStatus: 'IN_PROGRESS' as const },
      { txId: 'C', contentHash: h, txStatus: 'DRAFT' as const },
      { txId: 'D', contentHash: h, txStatus: 'CLOSED' as const, deleted: true },
      { txId: 'E', contentHash: 'd'.repeat(64), txStatus: 'SUBMITTED' as const },
    ];
    expect(otherDossiersWithHash(h, docs, 'A')).toEqual(['B']);
    expect(otherDossiersWithHash(h, docs, 'C')).toEqual(['A', 'B']);
    expect(otherDossiersWithHash('f'.repeat(64), docs)).toEqual([]);
    expect(sql('0009_lotx_x4.sql')).toMatch(/d\.tx_id is distinct from p_tx and o\.status <> 'DRAFT'/);
  });
});

// ——— X5 : fondations des paiements ———

describe('X5 — paiements, événements, journal financier', () => {
  /** Un simulateur minimal : une tranche, l’adaptateur simulé, le moteur, et la réception des webhooks (même chemin). */
  function setup(outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED', releaseMode: 'PROVIDER_CONFIRM' | 'IMMEDIATE' = 'PROVIDER_CONFIRM') {
    const status: Record<string, TrancheStatus> = { T1: 'AWAITING_PAYMENT' };
    const engine = new PaymentEngine(() => new Date('2026-11-12T10:00:00Z'));
    const ctx: PaymentContext = {
      tranche: (id) => ({ status: status[id] ?? 'PLANNED', active: true }),
      onPaid: (a: PaymentAttempt) => { status[a.trancheId] = releaseMode === 'IMMEDIATE' ? 'RELEASED' : 'PAID_LOCKED'; if (releaseMode === 'IMMEDIATE') engine.release(a.trancheId); },
    };
    const received: IncomingWebhook[] = [];
    const adapter: SimulatedPaymentAdapter = new SimulatedPaymentAdapter({
      secret: 'secret-de-test', outcome: () => outcome,
      sink: (w) => { received.push(w); deliver(w); },
    });
    const outcomes: unknown[] = [];
    function deliver(w: IncomingWebhook) {
      const valid = adapter.verifyWebhook(w.headers, w.rawBody);
      const ev = adapter.parseWebhook(w.rawBody);
      outcomes.push(engine.applyEvent({ provider: ev.provider, eventId: ev.eventId, signatureValid: valid, payload: ev.payload }, ctx));
    }
    async function pay(key: string) {
      const { attempt, created } = engine.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: key, amountMinor: 100_000, currency: 'XAF',
        trancheStatus: status.T1!, createdBy: 'payeur' });
      if (created) {
        const res = await adapter.createPayment({ idempotencyKey: key, trancheId: 'T1', amount: { amountMinor: 100_000, currency: 'XAF' },
          payer: { userId: 'payeur' }, payee: { name: 'École' }, method: 'SIMULATED' });
        engine.setProviderRef(attempt.id, res.providerRef);
      }
      return engine.attempt(attempt.id)!;
    }
    return { status, engine, ctx, adapter, received, outcomes, deliver, pay };
  }
  const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof DomainError ? e.code : 'OTHER'; } };

  it('PaymentPort simulé : résultats par événements signés, appliqués par le même chemin (aucun court-circuit)', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    expect(a.status).toBe('SUCCEEDED');
    expect(s.status.T1).toBe('PAID_LOCKED');
    expect(s.received.map((w) => JSON.parse(w.rawBody).data.type)).toEqual(['PAYMENT_PENDING', 'PAYMENT_SUCCEEDED']);
    expect(s.received.every((w) => w.headers[SIMULATED_SIGNATURE_HEADER]?.length === 64)).toBe(true);
    expect(await s.adapter.getPaymentStatus(a.providerRef!)).toMatchObject({ status: 'SUCCEEDED' });
    expect(s.engine.journals.map((j) => j.kind)).toEqual(['PAYMENT']);
  });

  it('idempotence : même clé, même tentative, aucun nouveau paiement ; autre clé refusée', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    const b = await s.pay('cle-paiement-0001');
    expect(b.id).toBe(a.id);
    expect(s.received).toHaveLength(2);
    expect(s.engine.journals).toHaveLength(1);
    expect(code(() => s.engine.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-paiement-0002', amountMinor: 100_000, currency: 'XAF',
      trancheStatus: s.status.T1!, createdBy: 'payeur' }))).toBe('NOT_PAYABLE');
    expect(code(() => s.engine.startPayment({ txId: 'TX', trancheId: 'T2', idempotencyKey: 'cle-paiement-0001', amountMinor: 1, currency: 'XAF',
      trancheStatus: 'AWAITING_PAYMENT', createdBy: 'payeur' }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(code(() => s.engine.startPayment({ txId: 'TX', trancheId: 'T2', idempotencyKey: 'court', amountMinor: 1, currency: 'XAF',
      trancheStatus: 'AWAITING_PAYMENT' }))).toBe('VALIDATION');
  });

  it('une seule tentative en cours par tranche ; après un échec, une nouvelle tentative est possible', async () => {
    const s = setup('FAILED');
    const failed = await s.pay('cle-paiement-0001');
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'SIMULATED_DECLINE' });
    expect(s.status.T1).toBe('AWAITING_PAYMENT');
    const e = new PaymentEngine();
    e.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-en-cours-01', amountMinor: 5, currency: 'XAF', trancheStatus: 'AWAITING_PAYMENT' });
    expect(code(() => e.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-en-cours-02', amountMinor: 5, currency: 'XAF',
      trancheStatus: 'AWAITING_PAYMENT' }))).toBe('PAYMENT_IN_PROGRESS');
  });

  it('événements : doublon, ordre inversé, signature invalide, montant différent, tentative inconnue', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    const replay = s.received[1]!;
    s.deliver(replay);   // même identifiant
    expect(s.outcomes.at(-1)).toEqual({ result: 'DUPLICATE', original: 'APPLIED', error: undefined });
    const apply = (eventId: string, payload: object, signatureValid = true) =>
      s.engine.applyEvent({ provider: 'SIMULATED', eventId, signatureValid, payload: { amountMinor: 100_000, currency: 'XAF', ...payload } as never }, s.ctx);
    expect(apply('e-again', { type: 'PAYMENT_SUCCEEDED', idempotencyKey: 'cle-paiement-0001' })).toMatchObject({ result: 'IGNORED', error: 'ALREADY_APPLIED' });
    expect(apply('e-late', { type: 'PAYMENT_PENDING', idempotencyKey: 'cle-paiement-0001' })).toMatchObject({ result: 'IGNORED', error: 'STALE_EVENT' });
    expect(apply('e-contra', { type: 'PAYMENT_FAILED', idempotencyKey: 'cle-paiement-0001' })).toMatchObject({ result: 'REJECTED', error: 'CONTRADICTS_FINAL_STATE' });
    expect(apply('e-unknown', { type: 'PAYMENT_SUCCEEDED', idempotencyKey: 'cle-inconnue-01' })).toMatchObject({ result: 'REJECTED', error: 'UNKNOWN_ATTEMPT' });
    expect(s.engine.attempt(a.id)!.status).toBe('SUCCEEDED');
    expect(s.engine.journals).toHaveLength(1);
    // Signature invalide (événement forgé avec un autre secret) : enregistré, jamais appliqué.
    const s2 = setup();
    const { attempt } = s2.engine.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF',
      trancheStatus: 'AWAITING_PAYMENT', createdBy: 'payeur' });
    const forged = s2.adapter.signed({ provider: 'SIMULATED', eventId: 'forge-1', occurredAt: '', payload: { type: 'PAYMENT_SUCCEEDED',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF' } }, 'mauvais-secret');
    expect(s2.adapter.verifyWebhook(forged.headers, forged.rawBody)).toBe(false);
    s2.deliver(forged);
    expect(s2.outcomes.at(-1)).toEqual({ result: 'INVALID_SIGNATURE' });
    expect(s2.engine.attempt(attempt.id)!.status).toBe('PENDING');
    expect(s2.engine.event('SIMULATED', 'forge-1')?.result).toBe('INVALID_SIGNATURE');
    // Montant différent : rejeté.
    expect(s2.engine.applyEvent({ provider: 'SIMULATED', eventId: 'm-1', signatureValid: true, payload: { type: 'PAYMENT_SUCCEEDED',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 1, currency: 'XAF' } }, s2.ctx)).toMatchObject({ error: 'AMOUNT_MISMATCH' });
    // Ordre inversé : la réussite arrive avant « en cours ».
    expect(s2.engine.applyEvent({ provider: 'SIMULATED', eventId: 'ok-1', signatureValid: true, payload: { type: 'PAYMENT_SUCCEEDED',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF' } }, s2.ctx).result).toBe('APPLIED');
    expect(s2.engine.applyEvent({ provider: 'SIMULATED', eventId: 'pend-1', signatureValid: true, payload: { type: 'PAYMENT_PENDING',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF' } }, s2.ctx).result).toBe('IGNORED');
    expect(s2.status.T1).toBe('PAID_LOCKED');
  });

  it('journal : équilibré par devise, au moins deux lignes, gelé (aucune modification)', async () => {
    expect(journalBalanced([{ account: 'PARTNER_CASH', currency: 'XAF', debitMinor: 5, creditMinor: 0 },
      { account: 'DUE_TO_PROVIDER', currency: 'XAF', debitMinor: 0, creditMinor: 5 }])).toBe(true);
    expect(journalBalanced([{ account: 'PARTNER_CASH', currency: 'XAF', debitMinor: 5, creditMinor: 0 },
      { account: 'DUE_TO_PROVIDER', currency: 'XAF', debitMinor: 0, creditMinor: 4 }])).toBe(false);
    expect(journalBalanced([{ account: 'PARTNER_CASH', currency: 'XAF', debitMinor: 5, creditMinor: 0 },
      { account: 'DUE_TO_PROVIDER', currency: 'EUR', debitMinor: 0, creditMinor: 5 }])).toBe(false);   // devises différentes
    expect(journalBalanced([{ account: 'PARTNER_CASH', currency: 'XAF', debitMinor: 0, creditMinor: 0 },
      { account: 'FEES', currency: 'XAF', debitMinor: 0, creditMinor: 0 }])).toBe(false);
    const s = setup();
    await s.pay('cle-paiement-0001');
    const j = s.engine.journals[0]!;
    expect(j.lines.map((l) => [l.account, l.debitMinor, l.creditMinor])).toEqual([['PARTNER_CASH', 100_000, 0], ['DUE_TO_PROVIDER', 0, 100_000]]);
    expect(Object.isFrozen(j) && Object.isFrozen(j.lines) && Object.isFrozen(j.lines[0])).toBe(true);
    expect(() => { (j.lines[0] as { debitMinor: number }).debitMinor = 1; }).toThrow();
    expect(Object.keys(LEDGER_ACCOUNTS).sort()).toEqual(['DUE_TO_PROVIDER', 'FEES', 'PARTNER_CASH', 'REFUNDS_PAYABLE']);
  });

  it('remboursement partiel puis total, jamais au-delà, jamais deux fois ; contrepassations', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    const r1 = s.engine.requestRefund({ trancheId: 'T1', amountMinor: 30_000, idempotencyKey: 'remb-0001', reason: 'Trop perçu', trancheStatus: 'PAID_LOCKED' });
    expect(s.engine.requestRefund({ trancheId: 'T1', amountMinor: 30_000, idempotencyKey: 'remb-0001', reason: 'Trop perçu', trancheStatus: 'PAID_LOCKED' }).id).toBe(r1.id);
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 40_000, idempotencyKey: 'remb-0001', reason: 'x', trancheStatus: 'PAID_LOCKED' }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 80_000, idempotencyKey: 'remb-0002', reason: 'Annulation', trancheStatus: 'PAID_LOCKED' }))).toBe('REFUND_EXCEEDS_PAID');
    const r2 = s.engine.requestRefund({ trancheId: 'T1', amountMinor: 70_000, idempotencyKey: 'remb-0003', reason: 'Reste', trancheStatus: 'PAID_LOCKED' });
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 1, idempotencyKey: 'remb-0004', reason: 'Encore', trancheStatus: 'PAID_LOCKED' }))).toBe('REFUND_EXCEEDS_PAID');
    expect(code(() => s.engine.requestRefund({ trancheId: 'T9', amountMinor: 1, idempotencyKey: 'remb-0005', reason: 'Rien', trancheStatus: 'PAID_LOCKED' }))).toBe('NOT_REFUNDABLE');
    await s.adapter.refund({ paymentId: a.providerRef!, amountMinor: 30_000, idempotencyKey: 'remb-0001' });
    await s.adapter.refund({ paymentId: a.providerRef!, amountMinor: 70_000, idempotencyKey: 'remb-0003' });
    expect(s.engine.refunds.map((r) => r.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(s.engine.journals.map((j) => j.kind)).toEqual(['PAYMENT', 'REFUND_REQUESTED', 'REFUND_REQUESTED', 'REFUND_SETTLED', 'REFUND_SETTLED']);
    expect(s.engine.journals.filter((j) => j.kind !== 'PAYMENT').every((j) => j.reversesJournalId === s.engine.journals[0]!.id)).toBe(true);
    expect(Object.values(s.engine.balances('T1')).every((v) => v === 0)).toBe(true);
    expect(r2.status).toBe('PENDING');
  });

  it('remboursement refusé par le partenaire : contrepassation de la demande, le montant redevient dû', async () => {
    const s = setup();
    await s.pay('cle-paiement-0001');
    s.engine.requestRefund({ trancheId: 'T1', amountMinor: 10_000, idempotencyKey: 'remb-0001', reason: 'Essai', trancheStatus: 'PAID_LOCKED' });
    s.engine.applyEvent({ provider: 'SIMULATED', eventId: 'rf-ko', signatureValid: true, payload: { type: 'REFUND_FAILED', refundKey: 'remb-0001',
      amountMinor: 10_000, currency: 'XAF' } }, s.ctx);
    expect(s.engine.balances('T1')['DUE_TO_PROVIDER:XAF']).toBe(-100_000);
    expect(s.engine.balances('T1')['REFUNDS_PAYABLE:XAF']).toBe(0);
  });

  it('IMMEDIATE : débloqué au paiement, versement au journal ; tranche débloquée non remboursable', async () => {
    const s = setup('SUCCEEDED', 'IMMEDIATE');
    await s.pay('cle-paiement-0001');
    expect(s.status.T1).toBe('RELEASED');
    expect(s.engine.journals.map((j) => j.kind)).toEqual(['PAYMENT', 'RELEASE']);
    expect(s.engine.balances('T1')['DUE_TO_PROVIDER:XAF']).toBe(0);
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 1, idempotencyKey: 'remb-0001', reason: 'Trop tard', trancheStatus: 'RELEASED' }))).toBe('NOT_REFUNDABLE');
  });

  it('rapprochement : aucun écart quand tout concorde ; écart volontaire détecté (miroir de v_reconciliation)', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    expect(s.engine.reconciliation((id) => s.status[id]!)).toEqual([{ attemptId: a.id, trancheId: 'T1', issues: [] }]);
    // Écart : tentative réussie sans événement ni écriture, tranche non payée.
    const st = s.engine.state();
    const forged = { ...st, attempts: [...st.attempts, { ...a, id: 'pay-forge', trancheId: 'T2', idempotencyKey: 'cle-forge-0001' }] };
    expect(reconcile(forged, (id) => (id === 'T2' ? 'AWAITING_PAYMENT' : s.status[id]!)).find((r) => r.attemptId === 'pay-forge')?.issues)
      .toEqual(['SUCCEEDED_WITHOUT_EVENT', 'SUCCEEDED_WITHOUT_LEDGER', 'TRANCHE_NOT_PAID']);
    // Tranche annulée (litige) sans remboursement versé.
    expect(s.engine.reconciliation(() => 'CANCELLED')[0]?.issues).toEqual(['CANCELLED_NOT_REFUNDED']);
    // Mêmes codes, même ordre que la vue SQL.
    const view = sql('0010_lotx_x5.sql');
    const sqlCodes = [...view.slice(view.indexOf('create or replace view v_reconciliation')).matchAll(/then '([A-Z_]+)' end/g)].map((m) => m[1]);
    expect(sqlCodes).toEqual([...RECONCILIATION_ISSUES]);
  });
});
