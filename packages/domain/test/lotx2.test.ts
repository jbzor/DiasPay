import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DomainError, OPERATION_TRANSITIONS, PAYMENT_REQUEST_STATUSES, PAYMENT_REQUEST_TRANSITIONS, TX_STATUSES, canOpenDispute,
  canTransitionOperation, canTransitionPaymentRequest, checkApproveRelease, checkSubmitEvidence, confirmService, disputeOpening,
  isAutoReleasable, isRequestFinal, paymentOutcome, resolveDisputeDecision, shouldCloseOperation, submissionTarget, transitionOperation,
  transitionPaymentRequest,
} from '../src';
import type { Actor, ConditionalState, OperationActor, PaymentRequestStatus, RequestActor, TxStatus } from '../src';

// Lot X version 2 : machines d’états du modèle cible (docs/specs/modele-cible-v2.md, sections 3.1 et 3.2),
// libération conditionnelle (CONDITIONAL seulement) et litige distinct. Miroirs de 0014_lotx2_core.sql.

const root = join(__dirname, '..', '..', '..');
const core = readFileSync(join(root, 'supabase', 'migrations', '0014_lotx2_core.sql'), 'utf8');
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'OK'; };

const initiator: Actor = { kind: 'USER', roles: ['REQUESTER'], isValidator: false, isCreator: true };
const payer: Actor = { kind: 'USER', roles: ['PAYER'], isValidator: false };
const payerInitiator: Actor = { kind: 'USER', roles: ['PAYER'], isValidator: false, isCreator: true };
const provider: Actor = { kind: 'USER', roles: ['PROVIDER'], isValidator: false };
const staff: Actor = { kind: 'USER', roles: [], isValidator: true };
const staffParty: Actor = { kind: 'USER', roles: ['PAYER'], isValidator: true };
const admin: Actor = { kind: 'USER', roles: [], isValidator: true, isAdmin: true };
const system: Actor = { kind: 'SYSTEM' };
const ctx = { totalMinor: 100, tranches: [{ label: 'Scolarité', amountMinor: 100 }], hasSupportingDocument: true };

/** Lignes d’un insert SQL (from, to, role, validator_only) de la migration 0014. */
function sqlRows(table: string): Array<[string, string, string, boolean]> {
  const block = core.slice(core.indexOf(`insert into ${table}`));
  const body = block.slice(0, block.indexOf(';'));
  return [...body.matchAll(/\('([A-Z_]+)','([A-Z_]+)','([A-Z_]+)',(true|false)\)/g)].map((m) => [m[1]!, m[2]!, m[3]!, m[4] === 'true']);
}

describe('opération (section 3.1)', () => {
  const actors: Record<OperationActor, Actor> = { INITIATOR: initiator, STAFF: staff, SYSTEM: system };

  it('chaque transition permise et refusée, par acteur (toutes les paires de statuts)', () => {
    for (const from of TX_STATUSES) for (const to of TX_STATUSES) for (const [who, actor] of Object.entries(actors) as Array<[OperationActor, Actor]>) {
      const row = OPERATION_TRANSITIONS.find(([f, t]) => f === from && t === to);
      const allowed = !!row && row[2].includes(who);
      expect(canTransitionOperation(from, to, actor), `${from} → ${to} par ${who}`).toBe(allowed);
      const c = code(() => transitionOperation(from, to, actor, ctx));
      if (allowed) expect(c, `${from} → ${to} par ${who}`).toBe('OK');
      else expect(['TRANSITION_UNKNOWN', 'TRANSITION_FORBIDDEN', 'VALIDATOR_ONLY'], `${from} → ${to} par ${who}`).toContain(c);
    }
  });

  it('tableau du modèle cible : soumission, revue, suspension, clôture, annulation', () => {
    expect(transitionOperation('DRAFT', 'ACTIVE', initiator, ctx)).toBe('ACTIVE');
    expect(transitionOperation('DRAFT', 'PENDING_REVIEW', initiator, ctx)).toBe('PENDING_REVIEW');
    expect(code(() => transitionOperation('DRAFT', 'ACTIVE', provider, ctx))).toBe('TRANSITION_FORBIDDEN');   // pas l’initiateur
    expect(code(() => transitionOperation('PENDING_REVIEW', 'ACTIVE', payer))).toBe('VALIDATOR_ONLY');
    expect(code(() => transitionOperation('IN_REVIEW', 'ACTIVE', staffParty))).toBe('VALIDATOR_IS_PARTY');
    expect(transitionOperation('IN_REVIEW', 'CANCELLED', staff)).toBe('CANCELLED');
    expect(transitionOperation('ACTIVE', 'SUSPENDED', system)).toBe('SUSPENDED');
    expect(transitionOperation('SUSPENDED', 'ACTIVE', staff)).toBe('ACTIVE');
    expect(code(() => transitionOperation('SUSPENDED', 'ACTIVE', initiator))).toBe('VALIDATOR_ONLY');   // comme transition_tx
    expect(transitionOperation('ACTIVE', 'CLOSED', system)).toBe('CLOSED');
    expect(code(() => transitionOperation('ACTIVE', 'CLOSED', initiator))).toBe('TRANSITION_FORBIDDEN');
    expect(transitionOperation('ACTIVE', 'CANCELLED', initiator)).toBe('CANCELLED');
    expect(code(() => transitionOperation('CLOSED', 'ACTIVE', staff))).toBe('TRANSITION_UNKNOWN');
  });

  it('la soumission vérifie le plan et les pièces ; NEVER → ACTIVE, revue → PENDING_REVIEW', () => {
    expect(code(() => transitionOperation('DRAFT', 'ACTIVE', initiator))).toBe('TX_CONTEXT_REQUIRED');
    expect(code(() => transitionOperation('DRAFT', 'ACTIVE', initiator, { ...ctx, hasSupportingDocument: false }))).toBe('TX_NO_DOCUMENT');
    expect(code(() => transitionOperation('DRAFT', 'ACTIVE', initiator, { ...ctx, totalMinor: 99 }))).toBe('PLAN_SUM_MISMATCH');
    expect(submissionTarget({ review: false })).toBe('ACTIVE');
    expect(submissionTarget({ review: true })).toBe('PENDING_REVIEW');
  });

  it('parité avec allowed_transitions (0014) : INITIATOR, SYSTEM, personnel (validator_only)', () => {
    const fromSql = new Set(sqlRows('allowed_transitions').map(([f, t, r, v]) => `${f}>${t}:${v ? 'STAFF' : r}`));
    const domain = new Set(OPERATION_TRANSITIONS.flatMap(([f, t, who]) => who.map((w) => `${f}>${t}:${w}`)));
    expect([...domain].sort()).toEqual([...fromSql].sort());
    expect(core).toMatch(/check \(status in \('DRAFT','PENDING_REVIEW','IN_REVIEW','ACTIVE','SUSPENDED','CLOSED','CANCELLED'\)\)/);
    expect([...TX_STATUSES]).toEqual(['DRAFT', 'PENDING_REVIEW', 'IN_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED']);
  });
});

describe('demande de paiement (section 3.2)', () => {
  const actors: Record<RequestActor, Actor> = { INITIATOR: initiator, PAYER: payer, SYSTEM: system };

  it('chaque transition permise et refusée, par acteur (toutes les paires de statuts)', () => {
    for (const from of PAYMENT_REQUEST_STATUSES) for (const to of PAYMENT_REQUEST_STATUSES) for (const [who, actor] of Object.entries(actors) as Array<[RequestActor, Actor]>) {
      const row = PAYMENT_REQUEST_TRANSITIONS.find(([f, t]) => f === from && t === to);
      const allowed = !!row && row[2].includes(who);
      expect(canTransitionPaymentRequest(from, to, actor), `${from} → ${to} par ${who}`).toBe(allowed);
      const c = code(() => transitionPaymentRequest(from, to, actor));
      if (allowed) expect(c, `${from} → ${to} par ${who}`).toBe('OK');
      else expect(['TRANSITION_UNKNOWN', 'TRANSITION_FORBIDDEN', 'INITIATOR_ONLY'], `${from} → ${to} par ${who}`).toContain(c);
    }
  });

  it('décisions du payeur, réponse de l’initiateur, paiement par le système seulement', () => {
    expect(transitionPaymentRequest('SUBMITTED', 'INFO_REQUESTED', payer)).toBe('INFO_REQUESTED');
    expect(code(() => transitionPaymentRequest('SUBMITTED', 'INFO_REQUESTED', payerInitiator))).toBe('TRANSITION_FORBIDDEN');
    expect(transitionPaymentRequest('INFO_REQUESTED', 'SUBMITTED', initiator)).toBe('SUBMITTED');
    expect(code(() => transitionPaymentRequest('INFO_REQUESTED', 'SUBMITTED', payer))).toBe('INITIATOR_ONLY');
    expect(transitionPaymentRequest('SUBMITTED', 'ACCEPTED', payer)).toBe('ACCEPTED');
    expect(code(() => transitionPaymentRequest('ACCEPTED', 'PAID', payer))).toBe('TRANSITION_FORBIDDEN');
    expect(transitionPaymentRequest('ACCEPTED', 'PAID', system)).toBe('PAID');
    expect(transitionPaymentRequest('ACCEPTED', 'SUBMITTED', system)).toBe('SUBMITTED');     // toutes les tentatives échouées
    expect(transitionPaymentRequest('INFO_REQUESTED', 'REJECTED', payer)).toBe('REJECTED');
    expect(code(() => transitionPaymentRequest('PAID', 'REJECTED', payer))).toBe('TRANSITION_UNKNOWN');
    expect(code(() => transitionPaymentRequest('PAID', 'CANCELLED', initiator))).toBe('TRANSITION_UNKNOWN');   // annulation avant paiement seulement
    expect(transitionPaymentRequest('PAID', 'REFUNDED', system)).toBe('REFUNDED');
  });

  it('demande suspendue par un litige : ni information demandée ni paiement (REQUEST_ON_HOLD)', () => {
    expect(code(() => transitionPaymentRequest('SUBMITTED', 'ACCEPTED', payer, { onHold: true }))).toBe('REQUEST_ON_HOLD');
    expect(code(() => transitionPaymentRequest('SUBMITTED', 'INFO_REQUESTED', payer, { onHold: true }))).toBe('REQUEST_ON_HOLD');
    expect(transitionPaymentRequest('SUBMITTED', 'REJECTED', payer, { onHold: true })).toBe('REJECTED');
  });

  it('états finaux et clôture de l’opération (fonds en CONDITIONAL)', () => {
    expect(isRequestFinal('PAID')).toBe(true);
    expect(isRequestFinal('PAID', 'HELD')).toBe(false);
    expect(isRequestFinal('PAID', 'RELEASED')).toBe(true);
    expect(isRequestFinal('ACCEPTED')).toBe(false);
    expect(shouldCloseOperation([{ status: 'PAID' }, { status: 'REJECTED' }, { status: 'REFUNDED' }])).toBe(true);
    expect(shouldCloseOperation([{ status: 'PAID' }, { status: 'SUBMITTED' }])).toBe(false);
    expect(shouldCloseOperation([])).toBe(false);
  });

  it('parité avec tranche_transitions (0014) ; DISPUTED n’est plus un statut', () => {
    const fromSql = new Set(sqlRows('tranche_transitions').map(([f, t, r]) => `${f}>${t}:${r}`));
    const domain = new Set(PAYMENT_REQUEST_TRANSITIONS.flatMap(([f, t, who]) => who.map((w) => `${f}>${t}:${w}`)));
    expect([...domain].sort()).toEqual([...fromSql].sort());
    expect((PAYMENT_REQUEST_STATUSES as readonly string[]).includes('DISPUTED')).toBe(false);
    expect(core).toMatch(/check \(status in \('DRAFT','SUBMITTED','INFO_REQUESTED','ACCEPTED','PAID','REJECTED','CANCELLED','EXPIRED','REFUNDED'\)\)/);
  });
});

describe('libération conditionnelle (CONDITIONAL seulement)', () => {
  const held = (over: Partial<ConditionalState> = {}): ConditionalState => ({
    settlementMode: 'CONDITIONAL', status: 'PAID', fundsState: 'HELD', releaseMode: 'PROVIDER_CONFIRM', contestHours: 72, ...over,
  });
  const now = new Date('2026-11-12T10:00:00Z');

  it('issue d’un paiement : DIRECT sans blocage, CONDITIONAL fonds bloqués', () => {
    expect(paymentOutcome('DIRECT')).toEqual({ status: 'PAID', fundsState: 'NONE' });
    expect(paymentOutcome('CONDITIONAL')).toEqual({ status: 'PAID', fundsState: 'HELD' });
  });

  it('confirmation : scan du prestataire ou payeur selon le mode ; délai de contestation', () => {
    expect(confirmService(held(), { roles: ['PROVIDER'], via: 'SCAN' }, now).toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(code(() => confirmService(held(), { roles: ['PAYER'], via: 'PAYER' }, now))).toBe('WRONG_CONFIRMER');
    expect(confirmService(held({ releaseMode: 'PAYER_CONFIRM' }), { roles: ['PAYER'], via: 'PAYER' }, now)).toBeInstanceOf(Date);
    expect(code(() => confirmService(held({ settlementMode: 'DIRECT', fundsState: 'NONE' }), { roles: ['PROVIDER'], via: 'SCAN' }, now))).toBe('WRONG_MODE');
    expect(code(() => confirmService(held({ fundsState: 'RELEASED' }), { roles: ['PROVIDER'], via: 'SCAN' }, now))).toBe('NOT_PAID');
    expect(code(() => confirmService(held({ confirmedAt: now }), { roles: ['PROVIDER'], via: 'SCAN' }, now))).toBe('ALREADY_CONFIRMED');
    expect(code(() => confirmService(held({ disputeOpen: true }), { roles: ['PROVIDER'], via: 'SCAN' }, now))).toBe('DISPUTE_OPEN');
  });

  it('preuves, libération anticipée, libération automatique', () => {
    expect(code(() => checkSubmitEvidence(held(), ['PROVIDER']))).toBe('NO_EVIDENCE_NEEDED');
    expect(code(() => checkSubmitEvidence(held({ releaseMode: 'EVIDENCE_REVIEW' }), ['PROVIDER']))).toBe('EVIDENCE_MISSING');
    expect(code(() => checkSubmitEvidence(held({ releaseMode: 'EVIDENCE_REVIEW', hasEvidence: true }), ['PAYER']))).toBe('PROVIDER_ONLY');
    expect(code(() => checkSubmitEvidence(held({ releaseMode: 'EVIDENCE_REVIEW', hasEvidence: true }), ['PROVIDER']))).toBe('OK');
    expect(code(() => checkApproveRelease(held(), ['PAYER']))).toBe('NOT_CONFIRMED');
    expect(code(() => checkApproveRelease(held({ confirmedAt: now }), ['PROVIDER']))).toBe('PAYER_ONLY');
    expect(code(() => checkApproveRelease(held({ confirmedAt: now }), ['PAYER']))).toBe('OK');
    const due = held({ confirmedAt: now, contestEndsAt: now });
    expect(isAutoReleasable(due, now)).toBe(true);
    expect(isAutoReleasable({ ...due, disputeOpen: true }, now)).toBe(false);
    expect(isAutoReleasable({ ...due, releaseMode: 'EVIDENCE_REVIEW' }, now)).toBe(false);
    expect(isAutoReleasable({ ...due, settlementMode: 'DIRECT' }, now)).toBe(false);
    expect(isAutoReleasable({ ...due, txSuspended: true }, now)).toBe(false);   // lot X-C (T6) : opération suspendue
  });
});

describe('litige distinct (K5, K7)', () => {
  it('avant paiement : suspension ; après paiement : statut inchangé ; sinon refusé', () => {
    for (const s of ['SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED'] as PaymentRequestStatus[]) expect(disputeOpening(s, ['PAYER'])).toEqual({ beforePayment: true });
    for (const s of ['PAID', 'REFUNDED'] as PaymentRequestStatus[]) expect(disputeOpening(s, ['PROVIDER'])).toEqual({ beforePayment: false });
    for (const s of ['DRAFT', 'REJECTED', 'CANCELLED', 'EXPIRED'] as PaymentRequestStatus[]) expect(code(() => disputeOpening(s, ['PAYER']))).toBe('DISPUTE_NOT_ALLOWED');
    expect(code(() => disputeOpening('PAID', ['REQUESTER']))).toBe('NOT_A_PARTY');
    expect(canOpenDispute('PAID', ['PAYER'])).toBe(true);
    expect(canOpenDispute('DRAFT', ['PAYER'])).toBe(false);
  });

  it('issues : administrateur non partie ; remboursement jamais au-delà ; fonds seulement s’ils sont bloqués', () => {
    const paid = { status: 'PAID' as const, fundsState: 'NONE' as const, paidMinor: 1000, refundedMinor: 300 };
    expect(code(() => resolveDisputeDecision(paid, 'NO_ACTION', staff))).toBe('ADMIN_ONLY');
    expect(code(() => resolveDisputeDecision(paid, 'NO_ACTION', { ...admin, roles: ['PAYER'] }))).toBe('VALIDATOR_IS_PARTY');
    expect(resolveDisputeDecision(paid, 'NO_ACTION', admin)).toEqual({ refundMinor: 0 });
    expect(resolveDisputeDecision(paid, 'REFUND_FULL', admin)).toEqual({ refundMinor: 700, fundsState: undefined });
    expect(resolveDisputeDecision(paid, 'REFUND_PARTIAL', admin, 200)).toEqual({ refundMinor: 200 });
    expect(code(() => resolveDisputeDecision(paid, 'REFUND_PARTIAL', admin, 701))).toBe('REFUND_EXCEEDS_PAID');
    expect(code(() => resolveDisputeDecision(paid, 'REFUND_PARTIAL', admin))).toBe('AMOUNT_INVALID');
    expect(code(() => resolveDisputeDecision({ ...paid, refundedMinor: 1000 }, 'REFUND_FULL', admin))).toBe('REFUND_EXCEEDS_PAID');
    expect(code(() => resolveDisputeDecision(paid, 'FUNDS_RELEASED', admin))).toBe('INVALID_OUTCOME');   // règlement direct
    expect(resolveDisputeDecision({ ...paid, fundsState: 'HELD' }, 'FUNDS_RETURNED', admin)).toEqual({ refundMinor: 700, fundsState: 'RETURNED' });
    expect(resolveDisputeDecision({ ...paid, fundsState: 'HELD' }, 'REFUND_FULL', admin)).toEqual({ refundMinor: 700, fundsState: 'RETURNED' });   // 0019
    expect(resolveDisputeDecision({ ...paid, fundsState: 'HELD' }, 'FUNDS_RELEASED', admin)).toEqual({ refundMinor: 0, fundsState: 'RELEASED' });
    expect(code(() => resolveDisputeDecision({ ...paid, status: 'SUBMITTED' }, 'REFUND_FULL', admin))).toBe('INVALID_OUTCOME');   // avant paiement
    expect(resolveDisputeDecision({ ...paid, status: 'SUBMITTED' }, 'NO_ACTION', admin)).toEqual({ refundMinor: 0 });
    expect(code(() => resolveDisputeDecision(paid, 'RELEASE_TO_PROVIDER' as never, admin))).toBe('INVALID_OUTCOME');
  });

  it('SQL : le litige ne modifie jamais le statut d’une demande payée (open_dispute, _resolve_dispute_v2)', () => {
    const open = core.slice(core.indexOf('create or replace function open_dispute'), core.indexOf('create or replace function respond_dispute'));
    const resolve = core.slice(core.indexOf('create or replace function _resolve_dispute_v2'), core.indexOf('drop function if exists resolve_dispute'));
    for (const body of [open, resolve]) expect(body).not.toMatch(/_set_tranche_status/);
    expect(open).toMatch(/update tranches set on_hold = true/);
  });
});

describe('statuts : aucun ancien nom ne subsiste dans le TypeScript', () => {
  it('ni DISPUTED, ni PAID_LOCKED, ni IN_PROGRESS', () => {
    const all: readonly string[] = [...TX_STATUSES, ...PAYMENT_REQUEST_STATUSES];
    for (const old of ['DISPUTED', 'PAID_LOCKED', 'CONFIRMED', 'RELEASED', 'EVIDENCE_SUBMITTED', 'PLANNED', 'AWAITING_PAYMENT', 'IN_PROGRESS', 'VALIDATED', 'TOKEN_ISSUED']) {
      expect(all.includes(old), old).toBe(false);
    }
    const s: TxStatus = 'ACTIVE';
    expect(s).toBe('ACTIVE');
  });
});
