import type { Currency, DraftDocument, DraftDocumentInput, Money, NeedDraft, PlanType, ReleaseMode, TrancheStatus, TxStatus, Vertical } from '@diaspay/domain';
import type { ProviderSummary } from './need';

export interface Tranche {
  id: string;
  seq: number;
  label: string;
  amountMinor: number;
  dueDate?: string;
  status: TrancheStatus;
  releaseMode: ReleaseMode;
  contestHours: number;
  contestEndsAt?: string; // ISO
  reference?: string;     // 18 hex minuscules, portée par l'eQR (présente dès que la tranche n'est plus PLANNED)
  evidenceCount: number;
  releasedAt?: string;
}

export interface Transaction {
  id: string;
  vertical: Vertical;
  purpose: string;
  amount: Money;
  status: TxStatus;
  providerName: string;
  beneficiaryName: string;
  tranches: Tranche[];
  createdAt: string;
  /** Lot 3 : dossier créé dans l’application. */
  planType?: PlanType;
  documentCount?: number;
  rejectionReason?: string;
  ownerId?: string;
  submittedAt?: string;
  /** Mock uniquement : profils de démonstration parties à la transaction (absent = tous). Sert à tester NOT_A_PARTY. */
  parties?: Persona[];
}

/** Profil de démonstration : le payeur (diaspora) ou le prestataire. */
export type Persona = 'PAYER' | 'PROVIDER';

export interface AuditEntry {
  at: string;
  event: string;
  trancheId?: string;
  detail?: string;
}

export interface TrancheToken {
  trancheId: string;
  reference: string;       // 18 hex, minuscules
  kid: string;
  signature: string;
  simulated: boolean;
  expiresAt: string;       // ISO
  usedAt?: string;
}

export interface ReferenceInfo {
  trancheId: string;
  txId: string;
  label: string;
  amountMinor: number;
  currency: Currency;
  status: TrancheStatus;
  expiresAt: string;
  used: boolean;
  providerName: string;
  beneficiaryName: string;
  purpose: string;
  /** Numéro de la tranche (1-based) et délai de contestation, pour l'affichage. */
  seq: number;
  contestHours: number;
}

/** Contrat unique entre les apps et le serveur. Le mock puis le TrustEngine l'implémentent. */
export interface TransactionApi {
  listTransactions(): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction>;
  payTranche(trancheId: string): Promise<Transaction>;                    // simulé
  getTranche(trancheId: string): Promise<{ tx: Transaction; tranche: Tranche }>;
  getToken(trancheId: string): Promise<TrancheToken>;                     // TrustToken d'une tranche non PLANNED
  resolveReference(reference: string): Promise<ReferenceInfo>;            // miroir de resolve_tranche_reference
  confirmByReference(reference: string, deviceTime?: string): Promise<Transaction>; // prestataire (scan eQR), miroir de confirm_by_reference
  approveRelease(trancheId: string): Promise<Transaction>;                // payeur, déblocage anticipé
  openDispute(trancheId: string, reason: string): Promise<Transaction>;
  timeline(txId: string): Promise<AuditEntry[]>;

  // Lot 3 : création d’un besoin.
  searchProviders(query: string, vertical: Vertical): Promise<ProviderSummary[]>;
  listDrafts(): Promise<NeedDraft[]>;
  getDraft(id: string): Promise<NeedDraft>;
  saveDraft(draft: NeedDraft): Promise<NeedDraft>;            // crée ou met à jour
  deleteDraft(id: string): Promise<void>;
  attachDocument(draftId: string, file: DraftDocumentInput, onProgress?: (p: number) => void): Promise<DraftDocument>;
  removeDocument(draftId: string, documentId: string): Promise<void>;
  submitNeed(draftId: string): Promise<Transaction>;
  reopenForCorrection(txId: string): Promise<NeedDraft>;       // REJECTED → DRAFT
}
