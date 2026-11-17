import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATUSES, PaymentEngine, REFUND_STATUSES, computeFees, convertMinor } from '../src';
import type { PaymentContext } from '../src';

// Lot X version 2 (X5) : devis, contributions, statuts du modèle cible, exécution manuelle d’un remboursement.
// Miroir de 0021_lotx2_x5.sql ; les nombres attendus sont ceux de supabase/tests/06_lotx2_p2.sql (partie X5).
const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0021_lotx2_x5.sql'), 'utf8');
const code = (f: () => unknown): string | undefined => { try { f(); return undefined; } catch (e) { return (e as { code?: string }).code; } };
const RATES = { 'EUR/XAF': '655.957' };

describe('X5 v2 : statuts du modèle cible (parité SQL)', () => {
  it('tentative INITIATED, PENDING, CONFIRMED, FAILED ; remboursement REQUESTED, EXECUTED, FAILED', () => {
    expect(sql).toContain(`check (status in (${ATTEMPT_STATUSES.map((s) => `'${s}'`).join(',')}))`);
    expect(sql).toContain(`check (status in (${REFUND_STATUSES.map((s) => `'${s}'`).join(',')}))`);
  });
});

describe('X5 v2 : devis', () => {
  it('conversion exacte arrondie au supérieur (même résultat que get_quote)', () => {
    expect(convertMinor(100_000, 'XAF', 'EUR', RATES)).toMatchObject({ debitMinor: 15_245 });   // 152,449… € → 152,45 €
    expect(convertMinor(65_595_700, 'XAF', 'EUR', RATES)!.debitMinor).toBe(10_000_000);        // exact : aucun arrondi
    expect(convertMinor(10_000, 'EUR', 'XAF', RATES)!.debitMinor).toBe(65_596);                 // 100 € → 65 595,7 → 65 596 XAF
    expect(convertMinor(100, 'XAF', 'XAF', RATES)).toEqual({ debitMinor: 100, rate: '1' });
    expect(convertMinor(100, 'XAF', 'USD', RATES)).toBeNull();                                 // aucun taux inventé
    expect(sql).toContain(`'{"EUR/XAF": "655.957"}'`);
  });
  it('frais par poste en points de base, arrondis au supérieur ; change seulement entre devises différentes', () => {
    const sched = { serviceBps: 100, fxBps: 50, methodBps: { CARD: 200 } };
    expect(computeFees(15_245, sched, 'CARD', true)).toEqual({ serviceMinor: 153, fxMinor: 77, methodMinor: 305 });
    expect(computeFees(15_245, sched, 'CARD', false).fxMinor).toBe(0);
    expect(computeFees(15_245, undefined, 'CARD', true)).toEqual({ serviceMinor: 0, fxMinor: 0, methodMinor: 0 });
  });
  it('devis : NOT_CONFIGURED sans durée de vie, QUOTE_UNAVAILABLE sans taux, simulé et marqué sinon', () => {
    const e = new PaymentEngine(() => new Date('2026-11-12T10:00:00Z'));
    const base = { trancheId: 'T1', payerId: 'P', amount: { amountMinor: 100_000, currency: 'XAF' as const } };
    expect(code(() => e.createQuote({ ...base, debitCurrency: 'EUR', rates: RATES }))).toBe('NOT_CONFIGURED');
    expect(code(() => e.createQuote({ ...base, debitCurrency: 'USD', rates: RATES, ttlSeconds: 300 }))).toBe('QUOTE_UNAVAILABLE');
    const q = e.createQuote({ ...base, debitCurrency: 'EUR', rates: RATES, ttlSeconds: 300, method: 'CARD', fees: { serviceBps: 100, fxBps: 50, methodBps: { CARD: 200 } } });
    expect(q).toMatchObject({ source: 'SIMULATED', simulated: true, debitAmountMinor: 15_245, totalDebitMinor: 15_780, expiresAt: '2026-11-12T10:05:00.000Z' });
    expect(e.createQuote({ ...base, ttlSeconds: 300 })).toMatchObject({ source: 'IDENTITY', rate: '1', totalDebitMinor: 100_000 });
  });
});

describe('X5 v2 : accepter et payer, contributions, remboursement manuel', () => {
  let now = new Date('2026-11-12T10:00:00Z');
  const setup = () => {
    now = new Date('2026-11-12T10:00:00Z');
    const e = new PaymentEngine(() => now);
    const st = { status: 'SUBMITTED' as const as string, refunded: 0 };
    const ctx: PaymentContext = {
      tranche: () => ({ status: st.status as never, active: true, targetMinor: 100_000 }),
      onPaid: () => { st.status = 'PAID'; },
      onRetryAllowed: () => { st.status = 'SUBMITTED'; },
      onRefunded: (r) => { st.refunded += r.amountMinor; st.status = 'REFUNDED'; },
    };
    const pay = (key: string, quoteId?: string) => e.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: key, amountMinor: 100_000, currency: 'XAF',
      trancheStatus: st.status as never, createdBy: 'P', quoteId });
    const ev = (id: string, type: string, key: string) => e.applyEvent({ provider: 'SIMULATED', eventId: id, signatureValid: true,
      payload: { type: type as never, idempotencyKey: key, amountMinor: 100_000, currency: 'XAF' } }, ctx);
    const quote = () => e.createQuote({ trancheId: 'T1', payerId: 'P', amount: { amountMinor: 100_000, currency: 'XAF' }, debitCurrency: 'EUR', rates: RATES, ttlSeconds: 300 });
    return { e, st, ctx, pay, ev, quote };
  };

  it('devis consommé une fois, expiré refusé, d’un autre payeur refusé', () => {
    const s = setup();
    const q = s.quote();
    expect(code(() => s.e.startPayment({ txId: 'TX', trancheId: 'T1', idempotencyKey: 'cle-autre-01', amountMinor: 100_000, currency: 'XAF',
      trancheStatus: 'SUBMITTED', createdBy: 'X', quoteId: q.id }))).toBe('QUOTE_INVALID');
    now = new Date('2026-11-12T10:05:00Z');
    expect(code(() => s.pay('cle-expire-01', q.id))).toBe('QUOTE_EXPIRED');
    now = new Date('2026-11-12T10:01:00Z');
    const { attempt } = s.pay('cle-paiement-01', q.id);
    expect(attempt).toMatchObject({ status: 'INITIATED', debitCurrency: 'EUR', debitAmountMinor: 15_245, quoteId: q.id });
    expect(s.e.quote(q.id)!.usedAt).toBeDefined();
    s.st.status = 'ACCEPTED';
    s.ev('e1', 'PAYMENT_FAILED', 'cle-paiement-01');
    expect(s.st.status).toBe('SUBMITTED');
    expect(s.e.contributions.map((c) => c.status)).toEqual(['FAILED']);
    expect(code(() => s.pay('cle-paiement-02', q.id))).toBe('QUOTE_USED');
  });

  it('INITIATED → PENDING → CONFIRMED par événements ; contribution confirmée ; payée quand la somme atteint la cible', () => {
    const s = setup();
    const { attempt } = s.pay('cle-paiement-01', s.quote().id);
    s.st.status = 'ACCEPTED';
    s.ev('e1', 'PAYMENT_PENDING', 'cle-paiement-01');
    expect(s.e.attempt(attempt.id)!.status).toBe('PENDING');
    s.ev('e2', 'PAYMENT_SUCCEEDED', 'cle-paiement-01');
    expect(s.e.attempt(attempt.id)!.status).toBe('CONFIRMED');
    expect(s.e.contributions[0]).toMatchObject({ status: 'CONFIRMED', amountMinor: 100_000, payerId: 'P' });
    expect(s.st.status).toBe('PAID');
    expect(s.ev('e3', 'PAYMENT_PENDING', 'cle-paiement-01')).toMatchObject({ result: 'IGNORED', error: 'STALE_EVENT' });
  });

  it('remboursement : demandé, exécuté à la main (pilote), contrepassé ; partiel puis total ; jamais au-delà', () => {
    const s = setup();
    s.pay('cle-paiement-01', s.quote().id);
    s.st.status = 'ACCEPTED';
    s.ev('e1', 'PAYMENT_SUCCEEDED', 'cle-paiement-01');
    const r1 = s.e.requestRefund({ trancheId: 'T1', amountMinor: 30_000, idempotencyKey: 'cle-rembours-1', reason: 'Geste', fundsState: 'NONE' });
    expect(r1.status).toBe('REQUESTED');
    expect(code(() => s.e.markRefundExecuted(r1.id, '', s.ctx))).toBe('VALIDATION');
    expect(s.e.markRefundExecuted(r1.id, 'TPW-REF-0001', s.ctx)).toMatchObject({ status: 'EXECUTED', providerRef: 'TPW-REF-0001' });
    expect(s.st).toMatchObject({ status: 'REFUNDED', refunded: 30_000 });
    expect(s.e.markRefundExecuted(r1.id, 'TPW-REF-0001', s.ctx).status).toBe('EXECUTED');            // même référence : sans effet
    expect(s.st.refunded).toBe(30_000);
    expect(code(() => s.e.markRefundExecuted(r1.id, 'TPW-AUTRE-02', s.ctx))).toBe('REFUND_NOT_PENDING');
    expect(s.e.journals.find((j) => j.kind === 'REFUND_SETTLED')!.reversesJournalId).toBeDefined();
    const r2 = s.e.requestRefund({ trancheId: 'T1', amountMinor: 70_000, idempotencyKey: 'cle-rembours-2', reason: 'Solde', fundsState: 'NONE' });
    s.e.markRefundExecuted(r2.id, 'TPW-REF-0002', s.ctx);
    expect(s.e.contributions[0]!.status).toBe('REFUNDED');
    expect(code(() => s.e.requestRefund({ trancheId: 'T1', amountMinor: 1, idempotencyKey: 'cle-rembours-3', reason: 'Encore', fundsState: 'NONE' })))
      .toBe('REFUND_EXCEEDS_PAID');
  });

  it('journal : montant dans la devise de la demande, frais dans la devise débitée, équilibre par devise', () => {
    const s = setup();
    const q = s.e.createQuote({ trancheId: 'T1', payerId: 'P', amount: { amountMinor: 100_000, currency: 'XAF' }, debitCurrency: 'EUR', rates: RATES,
      ttlSeconds: 300, method: 'CARD', fees: { serviceBps: 100, fxBps: 50, methodBps: { CARD: 200 } } });
    s.pay('cle-paiement-01', q.id);
    s.st.status = 'ACCEPTED';
    s.ev('e1', 'PAYMENT_SUCCEEDED', 'cle-paiement-01');
    expect(s.e.balances('T1')).toEqual({ 'PARTNER_CASH:XAF': 100_000, 'DUE_TO_PROVIDER:XAF': -100_000, 'FEES:EUR': -535, 'PARTNER_CASH:EUR': 535 });
  });

  it('ancien instantané : statuts convertis comme par 0021', () => {
    const e = new PaymentEngine(() => now, {
      attempts: [{ id: 'a', txId: 'TX', trancheId: 'T', idempotencyKey: 'cle-ancienne-1', provider: 'SIMULATED', method: 'SIMULATED',
        status: 'SUCCEEDED' as never, amountMinor: 1, currency: 'XAF' }],
      refunds: [{ id: 'r', attemptId: 'a', trancheId: 'T', idempotencyKey: 'cle-ancienne-2', amountMinor: 1, currency: 'XAF', status: 'PENDING' as never, reason: 'x' }],
    });
    expect(e.attempt('a')!.status).toBe('CONFIRMED');
    expect(e.refunds[0]!.status).toBe('REQUESTED');
  });
});
