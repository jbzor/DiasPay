import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { DomainError } from './types';
import type { Currency, Money, TrancheStatus } from './types';

// Lot X (X5) : fondations des paiements (exigence 5.2), sans appeler TrustPayWay.
// - PaymentPort v2 : contrat d’un partenaire de paiement (TrustPayWay plus tard, adaptateur simulé aujourd’hui).
// - PaymentEngine : miroir de 0010_lotx_x5.sql (tentatives idempotentes, événements dédupliqués et tolérants à l’ordre,
//   journal à double entrée équilibré et immuable, remboursements par contrepassation, rapprochement). Mêmes codes.
// Plan de comptes et règles : docs/specs/ledger.md.

export type PaymentMethod = 'SIMULATED' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['SIMULATED', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER'];
export type AttemptStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface PaymentParty { userId?: string; phone?: string; name?: string }

export interface CreatePaymentInput {
  idempotencyKey: string;
  trancheId: string;
  amount: Money;
  payer: PaymentParty;
  payee: PaymentParty;
  method: PaymentMethod;
}
export interface ProviderPayment { providerRef: string; status: AttemptStatus; errorCode?: string }
export interface RefundInput { paymentId: string; amountMinor: number; idempotencyKey: string }
export interface ProviderRefund { providerRef: string; status: AttemptStatus }

export type PaymentEventType = 'PAYMENT_PENDING' | 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'REFUND_SUCCEEDED' | 'REFUND_FAILED';
export const PAYMENT_EVENT_TYPES: readonly PaymentEventType[] = ['PAYMENT_PENDING', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_SUCCEEDED', 'REFUND_FAILED'];

/** Contenu d’un événement du partenaire, tel que transmis à apply_payment_event (p_payload). */
export interface PaymentEventPayload {
  type: PaymentEventType;
  idempotencyKey?: string;
  refundKey?: string;
  providerRef?: string;
  amountMinor: number;
  currency: Currency;
  feeMinor?: number;
  errorCode?: string;
}
export interface PaymentEvent { provider: string; eventId: string; occurredAt: string; payload: PaymentEventPayload }

/** Contrat d’un partenaire de paiement (v2). Ses résultats arrivent par des événements (webhooks), jamais en direct. */
export interface PaymentPort {
  readonly provider: string;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  getPaymentStatus(providerRef: string): Promise<ProviderPayment>;
  refund(input: RefundInput): Promise<ProviderRefund>;
  /** Signature du partenaire : un événement invalide est enregistré, jamais appliqué. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  parseWebhook(rawBody: string): PaymentEvent;
}

export interface IncomingWebhook { headers: Record<string, string>; rawBody: string }

// ——— Adaptateur simulé ———

export const SIMULATED_SIGNATURE_HEADER = 'x-diaspay-simulated-signature';
const hmacHex = (secret: string, body: string) => bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(body)));
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export interface SimulatedAdapterOptions {
  /** Secret de signature des événements simulés (HMAC-SHA256). */
  secret: string;
  /** Réception des événements : même chemin que les webhooks du partenaire. */
  sink: (webhook: IncomingWebhook) => Promise<void> | void;
  /** Issue d’un paiement (défaut : réussite). */
  outcome?: (input: CreatePaymentInput) => 'SUCCEEDED' | 'FAILED';
  newId?: () => string;
  clock?: () => Date;
}

/**
 * Partenaire simulé : il ne modifie rien lui-même. createPayment et refund répondent « en cours », puis le résultat arrive
 * sous forme d’événements signés remis à `sink`, traités par le même chemin que ceux du partenaire (vérification, lecture,
 * application idempotente). Aucun court-circuit.
 */
export class SimulatedPaymentAdapter implements PaymentPort {
  readonly provider = 'SIMULATED';
  private readonly payments = new Map<string, { key: string; input: CreatePaymentInput; status: AttemptStatus }>();
  private readonly byKey = new Map<string, string>();
  private readonly refunds = new Map<string, { providerRef: string; status: AttemptStatus }>();
  private seq = 0;
  constructor(private readonly opts: SimulatedAdapterOptions) {}

  private id(prefix: string): string { return `${prefix}-${this.opts.newId ? this.opts.newId() : `${Date.now().toString(36)}${(++this.seq).toString(36)}`}`; }
  private now(): string { return (this.opts.clock ?? (() => new Date()))().toISOString(); }

  /** Signe et remet un événement (le test peut aussi en forger un, avec une mauvaise signature). */
  signed(event: PaymentEvent, secret = this.opts.secret): IncomingWebhook {
    const rawBody = JSON.stringify({ id: event.eventId, provider: event.provider, occurredAt: event.occurredAt, data: event.payload });
    return { headers: { [SIMULATED_SIGNATURE_HEADER]: hmacHex(secret, rawBody) }, rawBody };
  }
  private async emit(payload: PaymentEventPayload): Promise<void> {
    await this.opts.sink(this.signed({ provider: this.provider, eventId: this.id('sim'), occurredAt: this.now(), payload }));
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const known = this.byKey.get(input.idempotencyKey);
    if (known) { const p = this.payments.get(known)!; return { providerRef: known, status: p.status }; }
    const providerRef = this.id('SIM');
    this.payments.set(providerRef, { key: input.idempotencyKey, input, status: 'PENDING' });
    this.byKey.set(input.idempotencyKey, providerRef);
    const outcome = this.opts.outcome?.(input) ?? 'SUCCEEDED';
    const base = { idempotencyKey: input.idempotencyKey, providerRef, amountMinor: input.amount.amountMinor, currency: input.amount.currency };
    await this.emit({ type: 'PAYMENT_PENDING', ...base });
    this.payments.get(providerRef)!.status = outcome;
    await this.emit(outcome === 'SUCCEEDED' ? { type: 'PAYMENT_SUCCEEDED', ...base } : { type: 'PAYMENT_FAILED', ...base, errorCode: 'SIMULATED_DECLINE' });
    return { providerRef, status: 'PENDING' };
  }

  async getPaymentStatus(providerRef: string): Promise<ProviderPayment> {
    const p = this.payments.get(providerRef);
    if (!p) throw new DomainError('PAYMENT_NOT_FOUND', 'Paiement introuvable');
    return { providerRef, status: p.status };
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const known = this.refunds.get(input.idempotencyKey);
    if (known) return known;
    const p = this.payments.get(input.paymentId);
    if (!p) throw new DomainError('PAYMENT_NOT_FOUND', 'Paiement introuvable');
    const r = { providerRef: this.id('SIMR'), status: 'SUCCEEDED' as AttemptStatus };
    this.refunds.set(input.idempotencyKey, r);
    await this.emit({ type: 'REFUND_SUCCEEDED', refundKey: input.idempotencyKey, providerRef: r.providerRef, amountMinor: input.amountMinor,
                      currency: p.input.amount.currency });
    return { providerRef: r.providerRef, status: 'PENDING' };
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean {
    const got = headers[SIMULATED_SIGNATURE_HEADER] ?? '';
    return safeEqual(got, hmacHex(this.opts.secret, rawBody));
  }

  parseWebhook(rawBody: string): PaymentEvent {
    let o: { id?: unknown; provider?: unknown; occurredAt?: unknown; data?: Record<string, unknown> };
    try { o = JSON.parse(rawBody) as typeof o; } catch { throw new DomainError('VALIDATION', 'Événement illisible'); }
    const d = o.data ?? {};
    if (typeof o.id !== 'string' || typeof o.provider !== 'string' || !PAYMENT_EVENT_TYPES.includes(d.type as PaymentEventType)
        || !Number.isSafeInteger(d.amountMinor)) {
      throw new DomainError('VALIDATION', 'Événement incomplet (fournisseur, identifiant, contenu)');
    }
    return { provider: o.provider, eventId: o.id, occurredAt: String(o.occurredAt ?? ''), payload: d as unknown as PaymentEventPayload };
  }
}

// ——— Journal financier à double entrée ———

export type LedgerAccount = 'PARTNER_CASH' | 'DUE_TO_PROVIDER' | 'REFUNDS_PAYABLE' | 'FEES';
/** Plan de comptes minimal (miroir de ledger_accounts). DiasPay ne détient pas de fonds : le journal reflète le partenaire. */
export const LEDGER_ACCOUNTS: Record<LedgerAccount, { kind: 'ASSET' | 'LIABILITY' | 'REVENUE'; fr: string; en: string }> = {
  PARTNER_CASH: { kind: 'ASSET', fr: 'Fonds chez le partenaire de paiement', en: 'Funds held by the payment partner' },
  DUE_TO_PROVIDER: { kind: 'LIABILITY', fr: 'Dû aux prestataires', en: 'Due to providers' },
  REFUNDS_PAYABLE: { kind: 'LIABILITY', fr: 'Remboursements à effectuer', en: 'Refunds payable' },
  FEES: { kind: 'REVENUE', fr: 'Frais', en: 'Fees' },
};
export type JournalKind = 'PAYMENT' | 'RELEASE' | 'REFUND_REQUESTED' | 'REFUND_SETTLED' | 'REFUND_REVERSED';
export interface LedgerLine { account: LedgerAccount; currency: Currency; debitMinor: number; creditMinor: number }
export interface LedgerJournal {
  id: string; kind: JournalKind; trancheId: string; attemptId?: string; refundId?: string; reversesJournalId?: string;
  lines: readonly LedgerLine[]; at: string;
}

/** Un journal a au moins deux lignes, chacune au débit ou au crédit, et s’équilibre par devise (miroir de _ledger_check_balanced). */
export function journalBalanced(lines: readonly LedgerLine[]): boolean {
  if (lines.length < 2) return false;
  const sums = new Map<string, number>();
  for (const l of lines) {
    const okLine = (l.debitMinor > 0 && l.creditMinor === 0) || (l.creditMinor > 0 && l.debitMinor === 0);
    if (!okLine || !Number.isSafeInteger(l.debitMinor) || !Number.isSafeInteger(l.creditMinor)) return false;
    sums.set(l.currency, (sums.get(l.currency) ?? 0) + l.debitMinor - l.creditMinor);
  }
  return [...sums.values()].every((v) => v === 0);
}

export interface PaymentAttempt {
  id: string; txId: string; trancheId: string; idempotencyKey: string; provider: string; method: PaymentMethod; status: AttemptStatus;
  amountMinor: number; currency: Currency; providerRef?: string; errorCode?: string; createdBy?: string;
}
export interface Refund {
  id: string; attemptId: string; trancheId: string; idempotencyKey: string; amountMinor: number; currency: Currency; status: AttemptStatus;
  reason: string; providerRef?: string;
}
export type EventResult = 'APPLIED' | 'IGNORED' | 'REJECTED' | 'INVALID_SIGNATURE' | 'DUPLICATE';
export interface StoredEvent {
  provider: string; eventId: string; signatureValid: boolean; payload: PaymentEventPayload;
  result: Exclude<EventResult, 'DUPLICATE'>; error?: string; attemptId?: string; refundId?: string;
}
export interface EventOutcome { result: EventResult; error?: string; original?: string; attemptId?: string; refundId?: string }

/** Ce que le moteur demande à l’appelant (simulateur, serveur) au moment d’un paiement réussi : faire avancer la tranche. */
export interface PaymentContext {
  /** État courant de la tranche (et de sa transaction : « active » si IN_PROGRESS). */
  tranche(trancheId: string): { status: TrancheStatus; active: boolean };
  /** Tranche à payer et transaction active : AWAITING_PAYMENT → PAID_LOCKED (ou RELEASED en mode IMMEDIATE). */
  onPaid(attempt: PaymentAttempt): void;
}

const NOT_PAID_STATUSES: readonly TrancheStatus[] = ['PLANNED', 'AWAITING_PAYMENT', 'INFO_REQUESTED', 'REJECTED', 'EXPIRED'];
const PAID_STATUSES: readonly TrancheStatus[] = ['PAID_LOCKED', 'EVIDENCE_SUBMITTED', 'CONFIRMED', 'RELEASED', 'DISPUTED'];
const CLOSED_STATUSES: readonly TrancheStatus[] = ['CANCELLED', 'REJECTED', 'EXPIRED'];

/** Codes d’écart du rapprochement, dans l’ordre de v_reconciliation. */
export const RECONCILIATION_ISSUES = [
  'SUCCEEDED_WITHOUT_EVENT', 'SUCCEEDED_WITHOUT_LEDGER', 'LEDGER_WITHOUT_SUCCESS', 'LEDGER_AMOUNT_MISMATCH', 'TRANCHE_NOT_PAID',
  'PAID_WITHOUT_ATTEMPT', 'RELEASED_NOT_IN_LEDGER', 'CANCELLED_NOT_REFUNDED', 'REFUNDED_TRANCHE_OPEN', 'REFUND_EXCEEDS_PAID', 'EVENT_REJECTED',
] as const;
export type ReconciliationIssue = (typeof RECONCILIATION_ISSUES)[number];
export interface ReconciliationRow { attemptId: string; trancheId: string; issues: ReconciliationIssue[] }

export interface LedgerState {
  attempts: readonly PaymentAttempt[]; events: readonly StoredEvent[]; journals: readonly LedgerJournal[]; refunds: readonly Refund[];
}

/** Rapprochement (miroir de v_reconciliation) : tentatives, événements, écritures et état des tranches. */
export function reconcile(state: LedgerState, trancheStatus: (trancheId: string) => TrancheStatus): ReconciliationRow[] {
  const sum = (kind: JournalKind, attemptId: string, account: LedgerAccount, side: 'debitMinor' | 'creditMinor') =>
    state.journals.filter((j) => j.kind === kind && j.attemptId === attemptId)
      .flatMap((j) => j.lines).filter((l) => l.account === account).reduce((s, l) => s + l[side], 0);
  return state.attempts.map((a) => {
    const st = trancheStatus(a.trancheId);
    const successEvents = state.events.filter((e) => e.attemptId === a.id && e.result === 'APPLIED' && e.payload.type === 'PAYMENT_SUCCEEDED').length;
    const rejected = state.events.filter((e) => e.attemptId === a.id && e.result === 'REJECTED' && e.signatureValid).length;
    const paid = sum('PAYMENT', a.id, 'DUE_TO_PROVIDER', 'creditMinor');
    const released = sum('RELEASE', a.id, 'DUE_TO_PROVIDER', 'debitMinor');
    const refundsOf = state.refunds.filter((r) => r.attemptId === a.id);
    const requested = refundsOf.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amountMinor, 0);
    const settled = refundsOf.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amountMinor, 0);
    const ok = a.status === 'SUCCEEDED';
    const otherSuccess = state.attempts.some((o) => o.trancheId === a.trancheId && o.status === 'SUCCEEDED');
    const issues: Array<ReconciliationIssue | null> = [
      ok && successEvents === 0 ? 'SUCCEEDED_WITHOUT_EVENT' : null,
      ok && paid === 0 ? 'SUCCEEDED_WITHOUT_LEDGER' : null,
      !ok && paid > 0 ? 'LEDGER_WITHOUT_SUCCESS' : null,
      ok && paid > 0 && paid !== a.amountMinor ? 'LEDGER_AMOUNT_MISMATCH' : null,
      ok && NOT_PAID_STATUSES.includes(st) ? 'TRANCHE_NOT_PAID' : null,
      !ok && PAID_STATUSES.includes(st) && !otherSuccess ? 'PAID_WITHOUT_ATTEMPT' : null,
      ok && st === 'RELEASED' && released === 0 && a.amountMinor > requested ? 'RELEASED_NOT_IN_LEDGER' : null,
      ok && st === 'CANCELLED' && settled < a.amountMinor ? 'CANCELLED_NOT_REFUNDED' : null,
      ok && settled >= a.amountMinor && !CLOSED_STATUSES.includes(st) ? 'REFUNDED_TRANCHE_OPEN' : null,
      requested > a.amountMinor ? 'REFUND_EXCEEDS_PAID' : null,
      rejected > 0 ? 'EVENT_REJECTED' : null,
    ];
    return { attemptId: a.id, trancheId: a.trancheId, issues: issues.filter((i): i is ReconciliationIssue => i !== null) };
  });
}

const freezeJournal = (j: LedgerJournal): LedgerJournal => Object.freeze({ ...j, lines: Object.freeze(j.lines.map((l) => Object.freeze({ ...l }))) });
const keyOk = (k: string) => k.trim().length >= 8 && k.trim().length <= 200;

/**
 * Moteur de paiement du simulateur, miroir de 0010 : tentatives (start_payment), événements (apply_payment_event),
 * remboursements (request_refund), journal (déblocage compris) et rapprochement. Journaux gelés : aucune modification.
 */
export class PaymentEngine {
  private attempts: PaymentAttempt[] = [];
  private events: StoredEvent[] = [];
  private journalsList: LedgerJournal[] = [];
  private refundsList: Refund[] = [];
  private n = 0;
  constructor(private readonly clock: () => Date = () => new Date(), state?: Partial<LedgerState>) {
    if (state) this.load(state);
  }

  private id(p: string): string { return `${p}-${(++this.n).toString(36)}-${this.clock().getTime().toString(36)}`; }

  get journals(): readonly LedgerJournal[] { return this.journalsList; }
  get refunds(): readonly Refund[] { return this.refundsList; }
  attemptsOf(trancheId: string): readonly PaymentAttempt[] { return this.attempts.filter((a) => a.trancheId === trancheId); }
  attempt(id: string): PaymentAttempt | undefined { return this.attempts.find((a) => a.id === id); }
  event(provider: string, eventId: string): StoredEvent | undefined { return this.events.find((e) => e.provider === provider && e.eventId === eventId); }

  /** État sérialisable (instantané du simulateur). */
  state(): LedgerState { return { attempts: this.attempts, events: this.events, journals: this.journalsList, refunds: this.refundsList }; }
  load(s: Partial<LedgerState>): void {
    this.attempts = [...(s.attempts ?? [])].map((a) => ({ ...a }));
    this.events = [...(s.events ?? [])].map((e) => ({ ...e }));
    this.journalsList = [...(s.journals ?? [])].map(freezeJournal);
    this.refundsList = [...(s.refunds ?? [])].map((r) => ({ ...r }));
  }

  private post(kind: JournalKind, a: PaymentAttempt, lines: Array<Omit<LedgerLine, 'currency'>>, refundId?: string): LedgerJournal {
    const full = lines.filter((l) => l.debitMinor > 0 || l.creditMinor > 0).map((l) => ({ ...l, currency: a.currency }));
    if (!journalBalanced(full)) throw new DomainError('LEDGER_UNBALANCED', 'Journal déséquilibré');
    const origin = this.journalsList.find((j) => j.attemptId === a.id && j.kind === 'PAYMENT');
    const j = freezeJournal({
      id: this.id('jr'), kind, trancheId: a.trancheId, attemptId: a.id, refundId,
      reversesJournalId: kind === 'PAYMENT' ? undefined : origin?.id, lines: full, at: this.clock().toISOString(),
    });
    this.journalsList.push(j);
    return j;
  }
  private refunded(attemptId: string): number {
    return this.refundsList.filter((r) => r.attemptId === attemptId && r.status !== 'FAILED').reduce((s, r) => s + r.amountMinor, 0);
  }

  /**
   * Démarrage d’un paiement (miroir de start_payment, après les contrôles de l’appelant : partie, payeur, transaction active).
   * Même clé : même tentative. Autre clé : PAYMENT_IN_PROGRESS si une tentative est en cours, NOT_PAYABLE si la tranche n’est plus à payer.
   */
  startPayment(input: {
    txId: string; trancheId: string; idempotencyKey: string; amountMinor: number; currency: Currency; trancheStatus: TrancheStatus;
    method?: PaymentMethod; provider?: string; createdBy?: string; providerRef?: string;
  }): { attempt: PaymentAttempt; created: boolean } {
    const key = input.idempotencyKey.trim();
    if (!keyOk(key)) throw new DomainError('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)');
    const known = this.attempts.find((a) => a.idempotencyKey === key);
    if (known) {
      if (known.trancheId !== input.trancheId || known.createdBy !== input.createdBy) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'Clé d’idempotence déjà utilisée pour un autre paiement');
      }
      return { attempt: { ...known }, created: false };
    }
    if (this.attempts.some((a) => a.trancheId === input.trancheId && a.status === 'PENDING')) {
      throw new DomainError('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
    }
    if (input.trancheStatus !== 'AWAITING_PAYMENT') throw new DomainError('NOT_PAYABLE', 'Cette tranche n’est pas à payer');
    const method = input.method ?? 'SIMULATED';
    if (!PAYMENT_METHODS.includes(method)) throw new DomainError('VALIDATION', 'Moyen de paiement inconnu');
    const a: PaymentAttempt = {
      id: this.id('pay'), txId: input.txId, trancheId: input.trancheId, idempotencyKey: key, provider: input.provider ?? 'SIMULATED',
      method, status: 'PENDING', amountMinor: input.amountMinor, currency: input.currency, providerRef: input.providerRef, createdBy: input.createdBy,
    };
    this.attempts.push(a);
    return { attempt: { ...a }, created: true };
  }

  /** Attache la référence du partenaire (réponse de createPayment) à une tentative en cours. */
  setProviderRef(attemptId: string, providerRef: string): void {
    const a = this.attempts.find((x) => x.id === attemptId);
    if (a && !a.providerRef) a.providerRef = providerRef;
  }

  /** Événement du partenaire (miroir de apply_payment_event) : dédupliqué, jamais appliqué si la signature est invalide. */
  applyEvent(ev: { provider: string; eventId: string; signatureValid: boolean; payload: PaymentEventPayload }, ctx: PaymentContext): EventOutcome {
    if (!ev.provider.trim() || !ev.eventId.trim()) throw new DomainError('VALIDATION', 'Événement incomplet (fournisseur, identifiant, contenu)');
    const dup = this.event(ev.provider, ev.eventId);
    if (dup) return { result: 'DUPLICATE', original: dup.result, error: dup.error };
    const stored: StoredEvent = { provider: ev.provider, eventId: ev.eventId, signatureValid: ev.signatureValid, payload: { ...ev.payload }, result: 'APPLIED' };
    this.events.push(stored);
    if (!ev.signatureValid) { stored.result = 'INVALID_SIGNATURE'; return { result: 'INVALID_SIGNATURE' }; }
    const p = ev.payload;
    const set = (result: StoredEvent['result'], error?: string) => { stored.result = result; stored.error = error; };
    if (p.type.startsWith('PAYMENT_')) {
      const a = this.attempts.find((x) => x.idempotencyKey === p.idempotencyKey || (!!p.providerRef && x.provider === ev.provider && x.providerRef === p.providerRef));
      if (!a) set('REJECTED', 'UNKNOWN_ATTEMPT');
      else {
        stored.attemptId = a.id;
        if (p.type === 'PAYMENT_PENDING') {
          if (a.status === 'PENDING') a.providerRef ??= p.providerRef; else set('IGNORED', 'STALE_EVENT');
        } else if (p.type === 'PAYMENT_SUCCEEDED') {
          if (a.status === 'SUCCEEDED') set('IGNORED', 'ALREADY_APPLIED');
          else if (a.status === 'FAILED') set('REJECTED', 'CONTRADICTS_FINAL_STATE');
          else if (p.amountMinor !== a.amountMinor || p.currency !== a.currency) set('REJECTED', 'AMOUNT_MISMATCH');
          else {
            const fee = Math.max(0, p.feeMinor ?? 0);
            a.status = 'SUCCEEDED'; a.providerRef ??= p.providerRef;
            this.post('PAYMENT', a, [
              { account: 'PARTNER_CASH', debitMinor: a.amountMinor + fee, creditMinor: 0 },
              { account: 'DUE_TO_PROVIDER', debitMinor: 0, creditMinor: a.amountMinor },
              { account: 'FEES', debitMinor: 0, creditMinor: fee },
            ]);
            const tr = ctx.tranche(a.trancheId);
            if (tr.status === 'AWAITING_PAYMENT' && tr.active) ctx.onPaid({ ...a }); else stored.error = 'TRANCHE_NOT_AWAITING';
          }
        } else if (p.type === 'PAYMENT_FAILED') {
          if (a.status === 'FAILED') set('IGNORED', 'ALREADY_APPLIED');
          else if (a.status === 'SUCCEEDED') set('REJECTED', 'CONTRADICTS_FINAL_STATE');
          else { a.status = 'FAILED'; a.errorCode = p.errorCode ?? 'DECLINED'; }
        } else set('REJECTED', 'UNKNOWN_TYPE');
      }
    } else if (p.type === 'REFUND_SUCCEEDED' || p.type === 'REFUND_FAILED') {
      const r = this.refundsList.find((x) => x.idempotencyKey === p.refundKey || (!!p.providerRef && x.providerRef === p.providerRef));
      const target = p.type === 'REFUND_SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
      if (!r) set('REJECTED', 'UNKNOWN_REFUND');
      else {
        stored.refundId = r.id; stored.attemptId = r.attemptId;
        const a = this.attempts.find((x) => x.id === r.attemptId)!;
        if (r.status !== 'PENDING') set(r.status === target ? 'IGNORED' : 'REJECTED', r.status === target ? 'ALREADY_APPLIED' : 'CONTRADICTS_FINAL_STATE');
        else if (p.amountMinor !== r.amountMinor) set('REJECTED', 'AMOUNT_MISMATCH');
        else if (target === 'SUCCEEDED') {
          r.status = 'SUCCEEDED'; r.providerRef ??= p.providerRef;
          this.post('REFUND_SETTLED', a, [
            { account: 'REFUNDS_PAYABLE', debitMinor: r.amountMinor, creditMinor: 0 },
            { account: 'PARTNER_CASH', debitMinor: 0, creditMinor: r.amountMinor },
          ], r.id);
        } else {
          r.status = 'FAILED';
          this.post('REFUND_REVERSED', a, [
            { account: 'REFUNDS_PAYABLE', debitMinor: r.amountMinor, creditMinor: 0 },
            { account: 'DUE_TO_PROVIDER', debitMinor: 0, creditMinor: r.amountMinor },
          ], r.id);
        }
      }
    } else set('REJECTED', 'UNKNOWN_TYPE');
    return { result: stored.result, error: stored.error, attemptId: stored.attemptId, refundId: stored.refundId };
  }

  /** Remboursement (miroir de request_refund, après le contrôle « administrateur non partie » de l’appelant). */
  requestRefund(input: { trancheId: string; amountMinor: number; idempotencyKey: string; reason: string; trancheStatus: TrancheStatus }): Refund {
    const key = input.idempotencyKey.trim();
    if (!keyOk(key)) throw new DomainError('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)');
    const known = this.refundsList.find((r) => r.idempotencyKey === key);
    if (known) {
      if (known.trancheId !== input.trancheId || known.amountMinor !== input.amountMinor) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'Clé d’idempotence déjà utilisée pour un autre remboursement');
      }
      return { ...known };
    }
    if (input.reason.trim().length < 3) throw new DomainError('REASON_REQUIRED', 'Motif du remboursement obligatoire');
    const a = this.attempts.find((x) => x.trancheId === input.trancheId && x.status === 'SUCCEEDED');
    if (!a) throw new DomainError('NOT_REFUNDABLE', 'Aucun paiement réussi pour cette tranche');
    if (input.trancheStatus === 'RELEASED') throw new DomainError('NOT_REFUNDABLE', 'Tranche débloquée : les fonds ont été versés au prestataire');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new DomainError('AMOUNT_INVALID', 'Montant invalide');
    if (this.refunded(a.id) + input.amountMinor > a.amountMinor) throw new DomainError('REFUND_EXCEEDS_PAID', 'Remboursement au-delà du montant payé');
    const r: Refund = {
      id: this.id('rf'), attemptId: a.id, trancheId: a.trancheId, idempotencyKey: key, amountMinor: input.amountMinor, currency: a.currency,
      status: 'PENDING', reason: input.reason.trim(),
    };
    this.refundsList.push(r);
    this.post('REFUND_REQUESTED', a, [
      { account: 'DUE_TO_PROVIDER', debitMinor: r.amountMinor, creditMinor: 0 },
      { account: 'REFUNDS_PAYABLE', debitMinor: 0, creditMinor: r.amountMinor },
    ], r.id);
    return { ...r };
  }

  /** Déblocage d’une tranche payée : versement du dû au prestataire (miroir du déclencheur ledger_on_release). Idempotent. */
  release(trancheId: string): void {
    const a = this.attempts.find((x) => x.trancheId === trancheId && x.status === 'SUCCEEDED');
    if (!a || this.journalsList.some((j) => j.trancheId === trancheId && j.kind === 'RELEASE')) return;
    const amount = a.amountMinor - this.refunded(a.id);
    if (amount > 0) {
      this.post('RELEASE', a, [
        { account: 'DUE_TO_PROVIDER', debitMinor: amount, creditMinor: 0 },
        { account: 'PARTNER_CASH', debitMinor: 0, creditMinor: amount },
      ]);
    }
  }

  /** Solde (débit − crédit) par compte et par devise. */
  balances(trancheId?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const j of this.journalsList) {
      if (trancheId && j.trancheId !== trancheId) continue;
      for (const l of j.lines) out[`${l.account}:${l.currency}`] = (out[`${l.account}:${l.currency}`] ?? 0) + l.debitMinor - l.creditMinor;
    }
    return out;
  }

  reconciliation(trancheStatus: (trancheId: string) => TrancheStatus): ReconciliationRow[] {
    return reconcile(this.state(), trancheStatus);
  }
}
