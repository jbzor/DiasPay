// Types du domaine DiasPay. Miroir du schéma SQL v0.2.
// Les statuts de transaction PAID_LOCKED, SERVICE_CONFIRMED, RELEASED et
// AWAITING_PAYMENT sont obsolètes depuis la v0.2 (portés par les tranches) :
// ils existent encore dans l'enum SQL pour compatibilité, mais pas ici.

export const TX_STATUSES = [
  'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'REJECTED', 'VALIDATED',
  'TOKEN_ISSUED', 'IN_PROGRESS', 'CLOSED', 'DISPUTED',
  // Lot 3 bis (décision D4) : dossier rejeté abandonné par son créateur. Trace et journal conservés.
  'CANCELLED',
] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export const TRANCHE_STATUSES = [
  'PLANNED', 'AWAITING_PAYMENT', 'PAID_LOCKED', 'EVIDENCE_SUBMITTED',
  'CONFIRMED', 'RELEASED', 'DISPUTED', 'CANCELLED', 'EXPIRED',
] as const;
export type TrancheStatus = (typeof TRANCHE_STATUSES)[number];

export const TERMINAL_TRANCHE_STATUSES: readonly TrancheStatus[] = ['RELEASED', 'CANCELLED', 'EXPIRED'];

export type TxRole = 'PAYER' | 'REQUESTER' | 'PROVIDER';
export type Vertical = 'EDUCATION' | 'HEALTH' | 'RENT' | 'AGRO' | 'REAL_ESTATE' | 'LAND';
export type ReleaseMode = 'PROVIDER_CONFIRM' | 'PAYER_CONFIRM' | 'EVIDENCE_REVIEW' | 'AUTO';
export type Currency = 'EUR' | 'USD' | 'XAF';
export type RecurrenceFreq = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';

/** Montant en unités mineures (centimes). XAF n'a pas de décimales : 1 = 1 FCFA. */
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export type Actor =
  | { kind: 'SYSTEM' }
  /** isAdmin : rôle de plateforme ADMIN (is_admin() côté serveur), seul habilité à trancher un litige. */
  | { kind: 'USER'; roles: readonly TxRole[]; isValidator: boolean; isAdmin?: boolean };

export interface TrancheDraft {
  label: string;
  amountMinor: number;
  dueDate?: string; // AAAA-MM-JJ ; absent = jalon
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
