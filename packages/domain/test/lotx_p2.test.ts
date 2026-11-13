import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DomainError, HASH_ALGO, LEDGER_ACCOUNTS, PaymentEngine, RECONCILIATION_ISSUES, SIMULATED_SIGNATURE_HEADER, SimulatedPaymentAdapter, bufferToHex,
  checkContentHash, documentLockError, isContentHash, journalBalanced, normalizeContentHash, otherDossiersWithHash, reconcile, sha256Hex,
} from '../src';
import { DEFAULT_MODULES, checkAddPayer, checkModule, describeRelease, maxFilesFor, moduleLabel, platformReviewDecision, sortModules, validateStep } from '../src';
import { paymentOutcome } from '../src';
import type { FundsState, IncomingWebhook, PaymentAttempt, PaymentContext, PlatformReview, RequestModule, SettlementMode, TrancheStatus } from '../src';

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

  it('immuabilité : modifiable en brouillon seulement, pièce de réponse pendant INFO_REQUESTED (miroir de _documents_immutable, 0014)', () => {
    expect(documentLockError('DRAFT')).toBeNull();
    expect(documentLockError('PENDING_REVIEW')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('ACTIVE')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('CANCELLED')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('ACTIVE', 'INFO_REQUESTED')).toBeNull();
    expect(documentLockError('ACTIVE', 'PAID')).toBe('DOCUMENT_LOCKED');
    const fn = sql('0014_lotx2_core.sql');
    expect(fn).toMatch(/if v_status = 'DRAFT' then return/);
    expect(fn).toMatch(/v_tr = 'INFO_REQUESTED'/);
  });

  it('réutilisation : autres dossiers seulement, brouillons et pièces archivées exclus (miroir de _hash_reuse)', () => {
    const h = 'c'.repeat(64);
    const docs = [
      { txId: 'A', contentHash: h, txStatus: 'ACTIVE' as const },
      { txId: 'B', contentHash: h.toUpperCase(), txStatus: 'ACTIVE' as const },
      { txId: 'B', contentHash: h, txStatus: 'ACTIVE' as const },
      { txId: 'C', contentHash: h, txStatus: 'DRAFT' as const },
      { txId: 'D', contentHash: h, txStatus: 'CLOSED' as const, deleted: true },
      { txId: 'E', contentHash: 'd'.repeat(64), txStatus: 'PENDING_REVIEW' as const },
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
  // Lot X v2 : la demande soumise est acceptée au démarrage du paiement (SUBMITTED → ACCEPTED), payée par l’événement du
  // partenaire (ACCEPTED → PAID, fonds NONE en DIRECT avec versement au journal, HELD en CONDITIONAL), redevient payable si
  // toutes les tentatives échouent (ACCEPTED → SUBMITTED), passe en REFUNDED au premier remboursement versé.
  function setup(outcome: 'CONFIRMED' | 'FAILED' = 'CONFIRMED', mode: SettlementMode = 'CONDITIONAL') {
    const status: Record<string, TrancheStatus> = { T1: 'SUBMITTED' };
    const funds: Record<string, FundsState> = { T1: 'NONE' };
    const engine = new PaymentEngine(() => new Date('2026-11-12T10:00:00Z'));
    const ctx: PaymentContext = {
      tranche: (id) => ({ status: status[id] ?? 'DRAFT', active: true }),
      onPaid: (a: PaymentAttempt) => {
        const o = paymentOutcome(mode); status[a.trancheId] = o.status; funds[a.trancheId] = o.fundsState;
        if (mode === 'DIRECT') engine.release(a.trancheId);
      },
      onRetryAllowed: (a) => { status[a.trancheId] = 'SUBMITTED'; },
      onRefunded: (r) => { if (status[r.trancheId] === 'PAID') status[r.trancheId] = 'REFUNDED'; },
    };
    const view = (id: string) => ({ status: status[id] ?? 'DRAFT', fundsState: funds[id] ?? 'NONE' });
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
        status.T1 = 'ACCEPTED';
        const res = await adapter.createPayment({ idempotencyKey: key, trancheId: 'T1', amount: { amountMinor: 100_000, currency: 'XAF' },
          payer: { userId: 'payeur' }, payee: { name: 'École' }, method: 'SIMULATED' });
        engine.setProviderRef(attempt.id, res.providerRef);
      }
      return engine.attempt(attempt.id)!;
    }
    return { status, funds, view, engine, ctx, adapter, received, outcomes, deliver, pay };
  }
  const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof DomainError ? e.code : 'OTHER'; } };

  it('PaymentPort simulé : résultats par événements signés, appliqués par le même chemin (aucun court-circuit)', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    expect(a.status).toBe('CONFIRMED');
    expect(s.status.T1).toBe('PAID');
    expect(s.funds.T1).toBe('HELD');
    expect(s.received.map((w) => JSON.parse(w.rawBody).data.type)).toEqual(['PAYMENT_PENDING', 'PAYMENT_SUCCEEDED']);
    expect(s.received.every((w) => w.headers[SIMULATED_SIGNATURE_HEADER]?.length === 64)).toBe(true);
    expect(await s.adapter.getPaymentStatus(a.providerRef!)).toMatchObject({ status: 'CONFIRMED' });
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
      trancheStatus: 'SUBMITTED', createdBy: 'payeur' }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(code(() => s.engine.startPayment({ txId: 'TX', trancheId: 'T2', idempotencyKey: 'court', amountMinor: 1, currency: 'XAF',
      trancheStatus: 'SUBMITTED' }))).toBe('VALIDATION');
  });

  it('une seule tentative en cours par tranche ; après un échec, une nouvelle tentative est possible', async () => {
    const s = setup('FAILED');
    const failed = await s.pay('cle-paiement-0001');
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'SIMULATED_DECLINE' });
    expect(s.status.T1).toBe('SUBMITTED');   // ACCEPTED → SUBMITTED : toutes les tentatives ont échoué
    const e = new PaymentEngine();
    e.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-en-cours-01', amountMinor: 5, currency: 'XAF', trancheStatus: 'SUBMITTED' });
    expect(code(() => e.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-en-cours-02', amountMinor: 5, currency: 'XAF',
      trancheStatus: 'SUBMITTED' }))).toBe('PAYMENT_IN_PROGRESS');
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
    expect(s.engine.attempt(a.id)!.status).toBe('CONFIRMED');
    expect(s.engine.journals).toHaveLength(1);
    // Signature invalide (événement forgé avec un autre secret) : enregistré, jamais appliqué.
    const s2 = setup();
    const { attempt } = s2.engine.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF',
      trancheStatus: 'SUBMITTED', createdBy: 'payeur' });
    s2.status.T1 = 'ACCEPTED';
    const forged = s2.adapter.signed({ provider: 'SIMULATED', eventId: 'forge-1', occurredAt: '', payload: { type: 'PAYMENT_SUCCEEDED',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF' } }, 'mauvais-secret');
    expect(s2.adapter.verifyWebhook(forged.headers, forged.rawBody)).toBe(false);
    s2.deliver(forged);
    expect(s2.outcomes.at(-1)).toEqual({ result: 'INVALID_SIGNATURE' });
    expect(s2.engine.attempt(attempt.id)!.status).toBe('INITIATED');
    expect(s2.engine.event('SIMULATED', 'forge-1')?.result).toBe('INVALID_SIGNATURE');
    // Montant différent : rejeté.
    expect(s2.engine.applyEvent({ provider: 'SIMULATED', eventId: 'm-1', signatureValid: true, payload: { type: 'PAYMENT_SUCCEEDED',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 1, currency: 'XAF' } }, s2.ctx)).toMatchObject({ error: 'AMOUNT_MISMATCH' });
    // Ordre inversé : la réussite arrive avant « en cours ».
    expect(s2.engine.applyEvent({ provider: 'SIMULATED', eventId: 'ok-1', signatureValid: true, payload: { type: 'PAYMENT_SUCCEEDED',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF' } }, s2.ctx).result).toBe('APPLIED');
    expect(s2.engine.applyEvent({ provider: 'SIMULATED', eventId: 'pend-1', signatureValid: true, payload: { type: 'PAYMENT_PENDING',
      idempotencyKey: 'cle-paiement-0009', amountMinor: 100_000, currency: 'XAF' } }, s2.ctx).result).toBe('IGNORED');
    expect(s2.status.T1).toBe('PAID');
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
    const r1 = s.engine.requestRefund({ trancheId: 'T1', amountMinor: 30_000, idempotencyKey: 'remb-0001', reason: 'Trop perçu', fundsState: 'HELD' });
    expect(s.engine.requestRefund({ trancheId: 'T1', amountMinor: 30_000, idempotencyKey: 'remb-0001', reason: 'Trop perçu', fundsState: 'HELD' }).id).toBe(r1.id);
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 40_000, idempotencyKey: 'remb-0001', reason: 'x', fundsState: 'HELD' }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 80_000, idempotencyKey: 'remb-0002', reason: 'Annulation', fundsState: 'HELD' }))).toBe('REFUND_EXCEEDS_PAID');
    const r2 = s.engine.requestRefund({ trancheId: 'T1', amountMinor: 70_000, idempotencyKey: 'remb-0003', reason: 'Reste', fundsState: 'HELD' });
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 1, idempotencyKey: 'remb-0004', reason: 'Encore', fundsState: 'HELD' }))).toBe('REFUND_EXCEEDS_PAID');
    expect(code(() => s.engine.requestRefund({ trancheId: 'T9', amountMinor: 1, idempotencyKey: 'remb-0005', reason: 'Rien', fundsState: 'HELD' }))).toBe('NOT_REFUNDABLE');
    await s.adapter.refund({ paymentId: a.providerRef!, amountMinor: 30_000, idempotencyKey: 'remb-0001' });
    await s.adapter.refund({ paymentId: a.providerRef!, amountMinor: 70_000, idempotencyKey: 'remb-0003' });
    expect(s.engine.refunds.map((r) => r.status)).toEqual(['EXECUTED', 'EXECUTED']);
    expect(s.engine.journals.map((j) => j.kind)).toEqual(['PAYMENT', 'REFUND_REQUESTED', 'REFUND_REQUESTED', 'REFUND_SETTLED', 'REFUND_SETTLED']);
    expect(s.engine.journals.filter((j) => j.kind !== 'PAYMENT').every((j) => j.reversesJournalId === s.engine.journals[0]!.id)).toBe(true);
    expect(Object.values(s.engine.balances('T1')).every((v) => v === 0)).toBe(true);
    expect(r2.status).toBe('REQUESTED');
  });

  it('remboursement refusé par le partenaire : contrepassation de la demande, le montant redevient dû', async () => {
    const s = setup();
    await s.pay('cle-paiement-0001');
    s.engine.requestRefund({ trancheId: 'T1', amountMinor: 10_000, idempotencyKey: 'remb-0001', reason: 'Essai', fundsState: 'HELD' });
    s.engine.applyEvent({ provider: 'SIMULATED', eventId: 'rf-ko', signatureValid: true, payload: { type: 'REFUND_FAILED', refundKey: 'remb-0001',
      amountMinor: 10_000, currency: 'XAF' } }, s.ctx);
    expect(s.engine.balances('T1')['DUE_TO_PROVIDER:XAF']).toBe(-100_000);
    expect(s.engine.balances('T1')['REFUNDS_PAYABLE:XAF']).toBe(0);
  });

  it('DIRECT (remplace IMMEDIATE) : payée sans blocage, versement au journal ; CONDITIONAL libéré : non remboursable', async () => {
    const s = setup('CONFIRMED', 'DIRECT');
    await s.pay('cle-paiement-0001');
    expect(s.status.T1).toBe('PAID');
    expect(s.funds.T1).toBe('NONE');
    expect(s.engine.journals.map((j) => j.kind)).toEqual(['PAYMENT', 'RELEASE']);
    expect(s.engine.balances('T1')['DUE_TO_PROVIDER:XAF']).toBe(0);
    expect(code(() => s.engine.requestRefund({ trancheId: 'T1', amountMinor: 1, idempotencyKey: 'remb-0001', reason: 'Trop tard', fundsState: 'RELEASED' }))).toBe('NOT_REFUNDABLE');
  });

  it('rapprochement : aucun écart quand tout concorde ; écart volontaire détecté (miroir de v_reconciliation)', async () => {
    const s = setup();
    const a = await s.pay('cle-paiement-0001');
    expect(s.engine.reconciliation(s.view)).toEqual([{ attemptId: a.id, trancheId: 'T1', issues: [] }]);
    // Écart : tentative réussie sans événement ni écriture, tranche non payée.
    const st = s.engine.state();
    const forged = { ...st, attempts: [...st.attempts, { ...a, id: 'pay-forge', trancheId: 'T2', idempotencyKey: 'cle-forge-0001' }] };
    expect(reconcile(forged, (id) => (id === 'T2' ? { status: 'SUBMITTED', fundsState: 'NONE' } : s.view(id))).find((r) => r.attemptId === 'pay-forge')?.issues)
      .toEqual(['SUCCEEDED_WITHOUT_EVENT', 'SUCCEEDED_WITHOUT_LEDGER', 'TRANCHE_NOT_PAID']);
    // Tranche annulée (litige) sans remboursement versé.
    expect(s.engine.reconciliation(() => ({ status: 'CANCELLED', fundsState: 'HELD' }))[0]?.issues).toEqual(['CANCELLED_NOT_REFUNDED']);
    // Mêmes codes, même ordre que la vue SQL.
    const view = sql('0010_lotx_x5.sql');
    const sqlCodes = [...view.slice(view.indexOf('create or replace view v_reconciliation')).matchAll(/then '([A-Z_]+)' end/g)].map((m) => m[1]);
    expect(sqlCodes).toEqual([...RECONCILIATION_ISSUES]);
  });
});

// ——— X6 : types de besoin configurables ———
describe('X6 — modules (types de besoin) décrits par des données', () => {
  const testModule = (over: Partial<RequestModule> = {}): RequestModule => ({
    code: 'TEST_NEVER', labels: { fr: 'Module de test', en: 'Test module' }, enabled: true, wave: 1, settlementMode: 'DIRECT', releaseMode: 'PAYER_CONFIRM', contestHours: 24,
    dualValidation: false, platformReview: 'NEVER', multiplePayers: false, displayOrder: 90,
    requiredDocuments: [{ kind: 'INVOICE', required: true, maxFiles: 1, labels: { fr: 'Facture', en: 'Invoice' } }], ...over,
  });

  it('DEFAULT_MODULES (RELEASE_RULES, REQUIRED_DOCUMENTS, vague 1) coïncide avec l’amorçage SQL de request_modules (0011, complété par 0014)', () => {
    const mig = sql('0011_lotx_x6.sql');
    const block = mig.slice(mig.indexOf('-- seed:begin'), mig.indexOf('-- seed:end'));
    const json = block.slice(block.indexOf('$seed$') + 6, block.lastIndexOf('$seed$'));
    const seed = JSON.parse(json) as Array<Record<string, unknown>>;
    const fromSql: RequestModule[] = seed.map((x) => ({
      code: String(x.code), labels: { fr: String(x.label_fr), en: String(x.label_en) },
      descriptions: { fr: String(x.description_fr), en: String(x.description_en) },
      enabled: x.enabled as boolean, wave: x.wave as number, releaseMode: x.release_mode as RequestModule['releaseMode'],
      contestHours: x.contest_hours as number, dualValidation: x.dual_validation as boolean,
      // 0014 (lot X v2) : platform_review passe à NEVER partout ; vague 1 en DIRECT, vague 2 en CONDITIONAL.
      platformReview: (x.platform_review === 'ALWAYS' ? 'NEVER' : x.platform_review) as PlatformReview,
      settlementMode: ['EDUCATION', 'HEALTH', 'RENT'].includes(String(x.code)) ? 'DIRECT' : 'CONDITIONAL',
      multiplePayers: x.multiple_payers as boolean, requiredDocuments: x.required_documents as RequestModule['requiredDocuments'],
      displayOrder: x.display_order as number,
    }));
    expect(fromSql).toEqual(DEFAULT_MODULES);
    for (const m of DEFAULT_MODULES) expect(() => checkModule(m)).not.toThrow();
    expect(DEFAULT_MODULES.every((m) => m.platformReview === 'NEVER' && !m.multiplePayers)).toBe(true);
    const core = sql('0014_lotx2_core.sql');
    expect(core).toMatch(/update request_modules set platform_review = 'NEVER';/);
    expect(core).toMatch(/when code in \('EDUCATION','HEALTH','RENT'\) then 'DIRECT' else 'CONDITIONAL'/);
  });

  it('platform_review : NEVER (défaut), ALWAYS, RISK_BASED ; double validation toujours appliquée (miroir de _platform_review, 0014)', () => {
    const base = { requiredValidations: 1 as const, firstRequest: false, duplicate: false };
    expect(platformReviewDecision(DEFAULT_MODULES[0], base)).toEqual({ review: false, reasons: [] });   // NEVER par défaut (K2)
    expect(platformReviewDecision({ ...DEFAULT_MODULES[0]!, platformReview: 'ALWAYS' }, base)).toEqual({ review: true, reasons: ['ALWAYS'] });
    expect(platformReviewDecision(testModule(), base)).toEqual({ review: false, reasons: [] });
    expect(platformReviewDecision(testModule(), { ...base, requiredValidations: 2 })).toEqual({ review: true, reasons: ['DUAL_VALIDATION'] });
    const risk = testModule({ platformReview: 'RISK_BASED' });
    expect(platformReviewDecision(risk, base).reasons).toEqual(['THRESHOLD_NOT_CONFIGURED']);   // seuil absent : revue par prudence
    const configured = { ...base, riskThresholdMinor: 1_000_000, amountMinor: 50_000 };
    expect(platformReviewDecision(risk, configured).review).toBe(false);
    expect(platformReviewDecision(risk, { ...configured, amountMinor: 1_000_000 }).reasons).toEqual(['AMOUNT_THRESHOLD']);
    expect(platformReviewDecision(risk, { ...configured, firstRequest: true }).reasons).toEqual(['FIRST_REQUEST']);
    expect(platformReviewDecision(risk, { ...configured, duplicate: true }).reasons).toEqual(['DUPLICATE']);
    expect(platformReviewDecision(testModule(), { ...base, firstRequest: true, duplicate: true }).review).toBe(false);   // NEVER : ni l’un ni l’autre
    expect(platformReviewDecision(undefined, base).reasons).toEqual(['ALWAYS']);
    const fn = sql('0014_lotx2_core.sql');
    expect([...fn.matchAll(/array_append\(v_reasons, '([A-Z_]+)'\)/g)].map((m) => m[1]))
      .toEqual(['ALWAYS', 'DUAL_VALIDATION', 'THRESHOLD_NOT_CONFIGURED', 'AMOUNT_THRESHOLD', 'FIRST_REQUEST', 'DUPLICATE']);
  });

  it('un module ajouté par des données guide l’assistant sans changer le code : type, pièces, règle de déblocage', () => {
    const modules = [...DEFAULT_MODULES, testModule()];
    const draft = { id: 'd1', vertical: 'TEST_NEVER', documents: [], updatedAt: '' };
    expect(validateStep('type', draft, { today: '2026-11-12', modules })).toEqual([]);
    expect(validateStep('type', draft, { today: '2026-11-12' })).toEqual([{ path: 'vertical', code: 'VERTICAL_REQUIRED' }]);
    expect(validateStep('documents', draft, { today: '2026-11-12', modules }))
      .toEqual([{ path: 'documents.INVOICE', code: 'DOCUMENT_REQUIRED', params: { kind: 'INVOICE' } }]);
    expect(describeRelease('TEST_NEVER', modules)).toEqual({ releaseMode: 'PAYER_CONFIRM', contestHours: 24, dualValidation: false });
    expect(maxFilesFor(testModule(), 'INVOICE')).toBe(1);
    expect(maxFilesFor(DEFAULT_MODULES[0], 'ENROLMENT_CERTIFICATE')).toBe(3);
    expect(moduleLabel('TEST_NEVER', 'en', modules)).toBe('Test module');
    // Vague 2 désactivée : refusée.
    expect(validateStep('type', { ...draft, vertical: 'AGRO' }, { today: '2026-11-12', modules })).toEqual([{ path: 'vertical', code: 'VERTICAL_UNAVAILABLE' }]);
    expect(sortModules([testModule({ displayOrder: 0 }), ...DEFAULT_MODULES])[0]?.code).toBe('TEST_NEVER');
    expect(() => checkModule(testModule({ code: 'x' }))).toThrow(DomainError);
    expect(() => checkModule(testModule({ requiredDocuments: [testModule().requiredDocuments[0]!, testModule().requiredDocuments[0]!] }))).toThrow(DomainError);
  });
});

// ——— X7 : structure multi-payeurs ———
describe('X7 — plusieurs payeurs, derrière un réglage du module', () => {
  it('un second payeur n’est accepté que si le module l’autorise (miroir de _check_multiple_payers) ; faux partout par défaut', () => {
    const edu = DEFAULT_MODULES[0]!;
    expect(() => checkAddPayer(edu, 0)).not.toThrow();
    expect(code(() => checkAddPayer(edu, 1))).toBe('MULTIPLE_PAYERS_NOT_ALLOWED');
    expect(code(() => checkAddPayer(undefined, 1))).toBe('MULTIPLE_PAYERS_NOT_ALLOWED');
    expect(() => checkAddPayer({ ...edu, multiplePayers: true }, 3)).not.toThrow();
    expect(DEFAULT_MODULES.some((m) => m.multiplePayers)).toBe(false);
    const fn = sql('0012_lotx_x7.sql');
    expect(fn).toMatch(/_err\('MULTIPLE_PAYERS_NOT_ALLOWED'/);
    expect(fn).toMatch(/unique \(tx_id, user_id, role\)/);
    expect(fn).toMatch(/unique \(tx_id, invited_phone, role\)/);
  });
});
