import type {
  CreatorRole, Currency, DraftDocument, DraftDocumentInput, Money, NeedDraft, PlanType, ReleaseMode, RequestMessageKind, TrancheStatus, TxStatus, Vertical,
} from '@diaspay/domain';
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
  /** Nom affiché du payeur (reçu). */
  payerName?: string;
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
  /** Lot 3 bis : acteur et empreinte de la ligne dans le journal chaîné. */
  actor?: string;
  hash?: string;
}

// ——— Lot 3 bis : alertes, litiges, reçus ———

/** Événement métier. Une alerte stocke l’événement, jamais un texte : la langue de l’interface fait le libellé. */
export type NotificationEvent =
  | { type: 'TX_VALIDATED'; txId: string }
  | { type: 'TX_REJECTED'; txId: string; reason: string }
  | { type: 'PAYMENT_READY'; txId: string; trancheId: string }
  | { type: 'TRANCHE_CONFIRMED'; txId: string; trancheId: string; releaseAt?: string }
  | { type: 'TRANCHE_RELEASED'; txId: string; trancheId: string }
  | { type: 'DISPUTE_OPENED'; txId: string; trancheId: string }
  | { type: 'DISPUTE_RESOLVED'; txId: string; trancheId: string; outcome: 'RELEASED' | 'REFUNDED' }
  // Lot X : demande initiée par un prestataire (au payeur), décisions du payeur et réponse de l’initiateur (aux autres parties).
  | { type: 'PAYMENT_REQUEST_RECEIVED'; txId: string }
  | { type: 'INFO_REQUESTED'; txId: string; trancheId: string }
  | { type: 'INFO_ANSWERED'; txId: string; trancheId: string }
  | { type: 'REQUEST_REJECTED'; txId: string; trancheId: string };
export interface AppNotification { id: string; event: NotificationEvent; at: string; readAt?: string }

/** Motif d’un litige : code stable, libellé traduit par l’application. */
export type DisputeReason = 'NOT_DELIVERED' | 'INCOMPLETE' | 'WRONG_AMOUNT' | 'OTHER';
export interface DisputeView {
  id: string; txId: string; trancheId: string; reason: string; description: string;
  openedBy: 'PAYER' | 'PROVIDER'; openedAt: string;
  status: 'OPEN' | 'RELEASED_TO_PROVIDER' | 'REFUNDED_TO_PAYER';
  resolvedAt?: string; resolutionNote?: string;
}

export interface Receipt {
  trancheId: string; txId: string; label: string; amountMinor: number; currency: Currency;
  releasedAt: string; payerName: string; providerName: string; purpose: string;
  reference: string; lastHash: string; chainValid: boolean; entryCount: number;
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

/** Message d’une demande (lot X) : demande d’informations, réponse de l’initiateur, motif d’un rejet. Immuable. */
export interface RequestMessage {
  id: string;
  txId: string;
  trancheId?: string;
  kind: RequestMessageKind;
  body: string;
  at: string;
  /** Écrit par l’utilisateur connecté. */
  mine: boolean;
}

/** Consultation d’une pièce (lot X, X4) : journalisée par le serveur avant que l’URL ne soit délivrée. */
export interface DocumentAccess {
  id: string;
  /** URL signée de courte durée (Supabase) ou URI locale (simulateur). */
  url: string;
  name: string;
  mimeType: string;
  contentHash?: string;
}

/** Réutilisation d’un justificatif (TrustProof) : un nombre seulement, jamais les données des autres dossiers. */
export interface DocumentReuse { reused: boolean; count: number }

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
  /**
   * Paiement d’une tranche (simulé tant que TrustPayWay n’est pas branché). Lot X (X5) : clé d’idempotence ; la même clé
   * rejouée renvoie le même résultat sans nouveau paiement (absente : une clé neuve à chaque appel).
   */
  payTranche(trancheId: string, idempotencyKey?: string): Promise<Transaction>;
  getTranche(trancheId: string): Promise<{ tx: Transaction; tranche: Tranche }>;
  getToken(trancheId: string): Promise<TrancheToken>;                     // TrustToken d'une tranche non PLANNED
  resolveReference(reference: string): Promise<ReferenceInfo>;            // miroir de resolve_tranche_reference
  confirmByReference(reference: string, deviceTime?: string): Promise<Transaction>; // prestataire (scan eQR), miroir de confirm_by_reference
  approveRelease(trancheId: string): Promise<Transaction>;                // payeur, déblocage anticipé
  openDispute(trancheId: string, reason: string, description?: string): Promise<Transaction>;
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

  // Lot 3 bis.
  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  getDispute(trancheId: string): Promise<DisputeView | null>;
  getReceipt(trancheId: string): Promise<Receipt>;
  abandonRejected(txId: string): Promise<Transaction>;         // REJECTED → CANCELLED (D4)

  // Lot X (X1) : sécurité du TrustLink. Aucun lien n’est produit : le jeton ne se lit que par le payeur, dans l’application.
  /** Révocation par l’initiateur (tranche non payée) : le QR et la référence ne valent plus rien (TOKEN_REVOKED). */
  revokeToken(trancheId: string, reason: string): Promise<void>;
  /** Révoque le jeton actif et en émet un nouveau (nouvelle référence, lue ensuite par le payeur avec getToken). */
  reissueToken(trancheId: string, reason?: string): Promise<void>;
  /** Réglage serveur eqr_image_enabled : l’image du QR peut être affichée au payeur (défaut : oui). */
  eqrImageEnabled(): Promise<boolean>;

  // Lot X (X2) : décisions du payeur, sans écran pour l’instant (lot Y).
  /** Le payeur ouvre la demande : première ouverture journalisée (REQUEST_VIEWED), idempotent. */
  markReceived(trancheId: string): Promise<void>;
  requestInfo(trancheId: string, message: string): Promise<Transaction>;   // payeur : AWAITING_PAYMENT → INFO_REQUESTED
  answerInfo(trancheId: string, message: string): Promise<Transaction>;    // initiateur : INFO_REQUESTED → AWAITING_PAYMENT
  rejectRequest(trancheId: string, reason: string): Promise<Transaction>;  // payeur : → REJECTED (terminal), jeton révoqué
  listMessages(trancheId: string): Promise<RequestMessage[]>;

  // Lot X (X3) : création avec un rôle explicite (PROVIDER : prestataire autorisé, payeur désigné par téléphone).
  createDraft(input: { vertical: Vertical; creatorRole: CreatorRole }): Promise<NeedDraft>;

  // Lot X (X4) : TrustVault.
  /** Consultation d’une pièce par une partie (ou le personnel) : DOCUMENT_VIEWED journalisé, puis URL de courte durée. */
  getDocumentAccess(documentId: string): Promise<DocumentAccess>;
  /** Cette empreinte apparaît-elle dans d’autres dossiers ? (pièce visible par l’utilisateur ; sinon NOT_FOUND) */
  documentReuse(contentHash: string, txId?: string): Promise<DocumentReuse>;
}
