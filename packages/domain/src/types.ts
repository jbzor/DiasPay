// Types du domaine DiasPay. Lot X version 2 : modèle cible après le kickoff (docs/specs/modele-cible-v2.md).
// Trois niveaux de statuts : opération (transactions), demande de paiement (tranches ; vue SQL payment_requests),
// tentative de paiement (payment_attempts). Le litige est un dossier distinct, jamais un statut.

/** Statuts d’une opération (section 3.1). IN_REVIEW : prise en charge par le bureau, dans le parcours PENDING_REVIEW. */
export const TX_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'IN_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'CANCELLED'] as const;
export type TxStatus = (typeof TX_STATUSES)[number];
export type OperationStatus = TxStatus;

/** Statuts d’une demande de paiement (section 3.2). DISPUTED n’existe plus : un litige est un dossier séparé. */
export const PAYMENT_REQUEST_STATUSES = [
  'DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED', 'PAID', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REFUNDED',
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];
/** Alias de transition : la table SQL s’appelle toujours `tranches`, le TypeScript parle de demande de paiement. */
export type TrancheStatus = PaymentRequestStatus;
export const TRANCHE_STATUSES = PAYMENT_REQUEST_STATUSES;

/** Mode de règlement (K1) : DIRECT par défaut ; CONDITIONAL (séquestre) pour les phases 2 et 3. */
export type SettlementMode = 'DIRECT' | 'CONDITIONAL';
/** État des fonds : NONE en DIRECT ; en CONDITIONAL HELD, puis RELEASED (prestataire) ou RETURNED (payeur). */
export type FundsState = 'NONE' | 'HELD' | 'RELEASED' | 'RETURNED';

export type TxRole = 'PAYER' | 'REQUESTER' | 'PROVIDER';
export type Vertical = 'EDUCATION' | 'HEALTH' | 'RENT' | 'AGRO' | 'REAL_ESTATE' | 'LAND';
/** Règle de libération (CONDITIONAL seulement). L’ancien mode IMMEDIATE est remplacé par settlement_mode = DIRECT. */
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
  | {
      kind: 'USER'; roles: readonly TxRole[]; isValidator: boolean; isAdmin?: boolean;
      /** Initiateur de l’opération (transactions.initiator_id) : soumission, réponses, annulation, jetons. */
      isCreator?: boolean;
    };

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
