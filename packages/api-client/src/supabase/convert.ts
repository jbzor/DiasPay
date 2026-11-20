/**
 * Conversion entre les lignes du serveur (snake_case, bigint, NULL) et les types du domaine.
 * Aucune valeur inattendue ne traverse : un statut ou un montant hors domaine lève UNEXPECTED.
 */
import { BENEFICIARY_MODES, DISPUTE_OUTCOMES, DISPUTE_STATUSES, ENROLMENT_LEVELS, PAYMENT_METHODS, MODULE_CODE_RE, PLATFORM_REVIEWS, TRANCHE_STATUSES, TX_STATUSES } from '@diaspay/domain';
import type {
  Currency, DisputeOutcome, DisputeStatus, DocumentKind, DraftDocument, FundsState, ModuleCode, ModuleDocument, SettlementMode, NeedDraft, PlanType, PlatformReview, ReleaseMode, RequestMessageKind, RequestModule, TrancheStatus,
  TxRole, TxStatus, EnrolmentCaseStatus, EnrolmentLevel, KycResult, PaymentMethod, BeneficiaryMode,
} from '@diaspay/domain';
import { ApiError } from '../need';
import type { ProviderSummary } from '../need';
import type {
  AppNotification, AuditEntry, DisputeView, EnrolmentCaseView, EnrolmentView, NotificationEvent, PaymentQuote, Receipt, ReferenceInfo, RequestMessage, Tranche, TrancheToken, Transaction,
} from '../types';
import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];
export type TxRow = Tables['transactions']['Row'];
export type TrancheRow = Tables['tranches']['Row'];
export type TokenRow = Tables['tranche_tokens']['Row'];
export type NotificationRow = Tables['notifications']['Row'];
export type AuditRow = Tables['audit_log']['Row'];
export type DocumentRow = Pick<Tables['documents']['Row'], 'id' | 'tranche_id' | 'deleted_at'>;
export type MessageRow = Tables['request_messages']['Row'];
type TokenRef = Pick<TokenRow, 'reference' | 'revoked_at'>;

/** Ligne de transaction lue avec ses tranches, leurs jetons et ses pièces (voir TX_SELECT). */
export type TxWithRelations = TxRow & {
  tranches: Array<TrancheRow & { tranche_tokens: TokenRef | TokenRef[] | null }>;
  documents: DocumentRow[];
  /** Lot A (T5) : les seules lignes de l’utilisateur connecté (filtre sur transaction_parties.user_id), rôle et identifiant. */
  transaction_parties?: Array<{ role: string; user_id: string | null }> | null;
};
// Lot X : une tranche peut avoir des jetons révoqués ; seul le jeton actif compte, et seul le payeur le lit (RLS).
// Lot A (T5) : colonnes nommées, jamais « * » : draft_data (saisie de l’initiateur) contient les numéros des autres parties
// (counterpartyPhone, provider.invitedPhone) et n’est lu que par get_draft, pour le seul créateur du brouillon.
const TX_COLUMNS = 'id, vertical, settlement_mode, accepted_at, purpose, amount_minor, currency, status, provider_name, beneficiary_name, '
  + 'beneficiary_reference, created_at, plan_type, reject_reason, created_by, initiator_id';
export const TX_SELECT = `${TX_COLUMNS}, tranches(*, tranche_tokens(reference, revoked_at)), documents(id, tranche_id, deleted_at)`;
/**
 * Lot A (T5) : même lecture, avec la place de l’utilisateur dans l’opération. Seuls le rôle et l’identifiant sont lus, et
 * seulement ses propres lignes (filtre sur la table liée, voir SupabaseApi) : jamais le numéro d’une autre partie.
 */
export const TX_SELECT_WITH_PLACE = `${TX_SELECT}, transaction_parties(role, user_id)`;
const PARTY_ROLES: readonly string[] = ['PAYER', 'REQUESTER', 'PROVIDER'];

const CURRENCIES: readonly string[] = ['EUR', 'USD', 'XAF'];
const RELEASE_MODES: readonly string[] = ['PROVIDER_CONFIRM', 'PAYER_CONFIRM', 'EVIDENCE_REVIEW', 'AUTO'];
const SETTLEMENT_MODES: readonly string[] = ['DIRECT', 'CONDITIONAL'];
const FUNDS_STATES: readonly string[] = ['NONE', 'HELD', 'RELEASED', 'RETURNED'];
const PLAN_TYPES: readonly string[] = ['SINGLE', 'PARTIAL', 'INSTALLMENTS', 'RECURRING'];

function bad(what: string, value: unknown): never {
  throw new ApiError('UNEXPECTED', `Valeur inattendue du serveur (${what})`, { what, value });
}

/** Code d’un type de besoin (module, lot X : X6) : tout code bien formé, y compris un module ajouté par des données. */
export function moduleCode(v: unknown): ModuleCode {
  if (typeof v !== 'string' || !MODULE_CODE_RE.test(v)) bad('type de besoin', v);
  return v;
}

export type ModuleRow = Tables['request_modules']['Row'];

/** Ligne de request_modules → RequestModule (pièces requises : JSON contrôlé par la base, relu ici). */
export function toModule(row: ModuleRow): RequestModule {
  const docs = Array.isArray(row.required_documents) ? row.required_documents : bad('pièces du module', row.required_documents);
  return {
    code: moduleCode(row.code),
    labels: { fr: row.label_fr, en: row.label_en },
    descriptions: { ...(row.description_fr ? { fr: row.description_fr } : {}), ...(row.description_en ? { en: row.description_en } : {}) },
    enabled: row.enabled, wave: row.wave,
    releaseMode: oneOf<ReleaseMode>(row.release_mode, RELEASE_MODES, 'mode de déblocage'),
    contestHours: row.contest_hours, dualValidation: row.dual_validation,
    settlementMode: oneOf<SettlementMode>(row.settlement_mode, SETTLEMENT_MODES, 'mode de règlement'),
    ...(row.request_expiry_days === null ? {} : { requestExpiryDays: row.request_expiry_days }),
    platformReview: oneOf<PlatformReview>(row.platform_review, PLATFORM_REVIEWS, 'platform_review'),
    multiplePayers: row.multiple_payers,
    requiredDocuments: docs.map((d): ModuleDocument => {
      const o = asObject(d, 'pièce du module');
      const labels = asObject(o.labels as Json, 'libellés de la pièce');
      return { kind: String(o.kind), required: o.required === true, maxFiles: Number(o.maxFiles ?? 3), labels: { fr: String(labels.fr ?? ''), en: String(labels.en ?? '') },
               sensitivity: o.sensitivity === 'SENSITIVE' ? 'SENSITIVE' : 'STANDARD' };
    }),
    displayOrder: row.display_order,
    beneficiaryMode: oneOf<BeneficiaryMode>(row.beneficiary_mode, BENEFICIARY_MODES, 'mode du bénéficiaire'),
    ...(row.retention_days === null ? {} : { retentionDays: row.retention_days }),
  };
}

/** bigint PostgreSQL → nombre JS exact (les montants restent bien en deçà de 2^53). */
export function toMinor(v: unknown, what = 'montant'): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) bad(what, v);
  return n;
}
function oneOf<T extends string>(v: unknown, allowed: readonly string[], what: string): T {
  if (typeof v !== 'string' || !allowed.includes(v)) bad(what, v);
  return v as T;
}
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
/** Horodatage PostgREST (« 2026-11-11T10:00:00.123+00:00 ») → ISO UTC (« …Z »). */
export function toIso(v: string): string;
export function toIso(v: string | null | undefined): string | undefined;
export function toIso(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) bad('date', v);
  return d.toISOString();
}

export function toTranche(row: TxWithRelations['tranches'][number], documents: DocumentRow[]): Tranche {
  const toks = Array.isArray(row.tranche_tokens) ? row.tranche_tokens : row.tranche_tokens ? [row.tranche_tokens] : [];
  const tok = toks.find((k) => !k.revoked_at);
  return {
    id: row.id,
    seq: row.seq,
    label: row.label,
    amountMinor: toMinor(row.amount_minor),
    dueDate: opt(row.due_date),
    status: oneOf<TrancheStatus>(row.status, TRANCHE_STATUSES, 'statut de tranche'),
    releaseMode: oneOf<ReleaseMode>(row.release_mode, RELEASE_MODES, 'mode de déblocage'),
    contestHours: row.contest_hours,
    contestEndsAt: toIso(row.contest_ends_at),
    reference: tok?.reference ?? undefined,
    evidenceCount: documents.filter((d) => d.tranche_id === row.id && !d.deleted_at).length,
    releasedAt: toIso(row.released_at),
    paidAt: toIso(row.paid_at),
    fundsState: oneOf<FundsState>(row.funds_state, FUNDS_STATES, 'état des fonds'),
    onHold: row.on_hold,
    refundedMinor: toMinor(row.refunded_minor, 'montant remboursé'),
    expiresAt: toIso(row.expires_at),
    confirmedAt: toIso(row.confirmed_at),
  };
}

export function toTransaction(row: TxWithRelations): Transaction {
  const docs = row.documents ?? [];
  return {
    id: row.id,
    vertical: moduleCode(row.vertical),
    settlementMode: oneOf<SettlementMode>(row.settlement_mode, SETTLEMENT_MODES, 'mode de règlement'),
    acceptedAt: toIso(row.accepted_at),
    purpose: row.purpose ?? '',
    amount: {
      amountMinor: row.amount_minor === null ? 0 : toMinor(row.amount_minor),
      currency: row.currency === null ? 'XAF' : oneOf<Currency>(row.currency, CURRENCIES, 'devise'),
    },
    status: oneOf<TxStatus>(row.status, TX_STATUSES, 'statut de transaction'),
    providerName: row.provider_name ?? '',
    beneficiaryName: row.beneficiary_name ?? '',
    ...(row.beneficiary_reference ? { beneficiaryReference: row.beneficiary_reference } : {}),
    tranches: [...(row.tranches ?? [])].sort((a, b) => a.seq - b.seq).map((t) => toTranche(t, docs)),
    createdAt: toIso(row.created_at),
    planType: row.plan_type === null ? undefined : oneOf<PlanType>(row.plan_type, PLAN_TYPES, 'type de plan'),
    documentCount: docs.filter((d) => d.tranche_id === null && !d.deleted_at).length,
    rejectionReason: opt(row.reject_reason),
    ownerId: row.created_by,
    initiatorId: row.initiator_id ?? row.created_by,
    ...(row.transaction_parties ? {
      myRoles: [...new Set(row.transaction_parties.map((p) => p.role).filter((r): r is TxRole => PARTY_ROLES.includes(r)))],
    } : {}),
  };
}

export function toToken(row: TokenRow): TrancheToken {
  return {
    trancheId: row.tranche_id, reference: row.reference, kid: row.kid, signature: row.signature,
    simulated: row.simulated, expiresAt: toIso(row.expires_at), usedAt: toIso(row.used_at),
  };
}

const NOTIFICATION_TYPES = [
  'TX_VALIDATED', 'TX_REJECTED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED',
  'PAYMENT_REQUEST_RECEIVED', 'INFO_REQUESTED', 'INFO_ANSWERED', 'REQUEST_REJECTED', 'REQUEST_PAID', 'PLAN_ACCEPTED',
];

/** Le serveur écrit l’événement dans payload (déclencheur sur audit_log) ; jamais de texte affiché. */
export function toNotification(row: NotificationRow): AppNotification | null {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const type = typeof p.type === 'string' ? p.type : row.event;
  if (!NOTIFICATION_TYPES.includes(type)) return null; // type futur inconnu : ignoré, pas d’écran cassé
  const event = { ...p, type, txId: (p.txId as string | undefined) ?? row.tx_id ?? '' } as NotificationEvent;
  if (event.type === 'TX_REJECTED' && typeof event.reason !== 'string') (event as { reason: string }).reason = '';
  return { id: row.id, event, at: toIso(row.created_at), readAt: toIso(row.read_at) };
}

const MESSAGE_KINDS: readonly string[] = ['INFO_REQUEST', 'INFO_ANSWER', 'NOTE'];

export function toMessage(row: MessageRow, me: string | undefined): RequestMessage {
  return {
    id: row.id, txId: row.tx_id, trancheId: opt(row.tranche_id), kind: oneOf<RequestMessageKind>(row.kind, MESSAGE_KINDS, 'type de message'),
    body: row.body, at: toIso(row.created_at), mine: me !== undefined && row.author_id === me,
  };
}

export function toAuditEntry(row: AuditRow): AuditEntry {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const detail = row.to_status ?? (typeof p.tranche_to === 'string' ? p.tranche_to : undefined);
  return {
    at: toIso(row.created_at),
    event: row.event,
    trancheId: opt(row.tranche_id),
    detail: detail ?? undefined,
    actor: opt(row.actor_id),
    hash: row.hash,
  };
}

export function toProvider(row: { id: string; name: string; city: string; verticals: string[]; verified: boolean }): ProviderSummary {
  return { id: row.id, name: row.name, city: row.city, verified: row.verified, verticals: row.verticals.filter((v) => MODULE_CODE_RE.test(v)) };
}

function asObject(v: Json, what: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) bad(what, v);
  return v as Record<string, unknown>;
}

export function toReceipt(v: Json): Receipt {
  const o = asObject(v, 'reçu');
  return {
    trancheId: String(o.trancheId), txId: String(o.txId), label: String(o.label ?? ''), amountMinor: toMinor(o.amountMinor),
    currency: oneOf<Currency>(o.currency, CURRENCIES, 'devise'), releasedAt: toIso(String(o.releasedAt)),
    payerName: String(o.payerName ?? ''), providerName: String(o.providerName ?? ''), purpose: String(o.purpose ?? ''),
    reference: String(o.reference ?? ''), lastHash: String(o.lastHash ?? ''), chainValid: o.chainValid === true,
    entryCount: Number(o.entryCount ?? 0),
  };
}

export function toDispute(v: Json): DisputeView | null {
  if (v === null) return null;
  const o = asObject(v, 'litige');
  return {
    id: String(o.id), txId: String(o.txId), trancheId: String(o.trancheId), reason: String(o.reason ?? 'OTHER'),
    description: String(o.description ?? ''), openedBy: o.openedBy === 'PROVIDER' ? 'PROVIDER' : 'PAYER',
    openedAt: toIso(String(o.openedAt)),
    status: oneOf<DisputeStatus>(o.status, DISPUTE_STATUSES, 'statut de litige'),
    outcome: o.outcome === undefined || o.outcome === null ? undefined : oneOf<DisputeOutcome>(o.outcome, DISPUTE_OUTCOMES, 'issue de litige'),
    beforePayment: o.beforePayment === true,
    refundAmountMinor: o.refundAmountMinor === undefined || o.refundAmountMinor === null ? undefined : toMinor(o.refundAmountMinor),
    resolvedAt: typeof o.resolvedAt === 'string' ? toIso(o.resolvedAt) : undefined,
    resolutionNote: typeof o.resolutionNote === 'string' ? o.resolutionNote : undefined,
  };
}

export function toReferenceInfo(v: Json): ReferenceInfo {
  const o = asObject(v, 'référence');
  return {
    trancheId: String(o.trancheId), txId: String(o.txId), label: String(o.label ?? ''), amountMinor: toMinor(o.amountMinor),
    currency: oneOf<Currency>(o.currency, CURRENCIES, 'devise'),
    status: oneOf<TrancheStatus>(o.status, TRANCHE_STATUSES, 'statut de tranche'),
    expiresAt: o.expiresAt == null ? undefined : toIso(String(o.expiresAt)), used: o.used === true, providerName: String(o.providerName ?? ''),
    beneficiaryName: String(o.beneficiaryName ?? ''), purpose: String(o.purpose ?? ''), seq: Number(o.seq ?? 1),
    contestHours: Number(o.contestHours ?? 0),
  };
}

// ——— Brouillons ———

/** Brouillon → JSON de save_draft : les pièces (gérées par add_document) et les URI locales ne partent pas. */
export function draftToServer(d: NeedDraft): Json {
  const { documents: _docs, ...rest } = d;
  return JSON.parse(JSON.stringify(rest)) as Json;
}

function toDraftDocument(v: unknown): DraftDocument | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.kind !== 'string') return null;
  return {
    id: o.id, kind: o.kind as DocumentKind, name: String(o.name ?? ''), mimeType: String(o.mimeType ?? ''),
    sizeBytes: Number(o.sizeBytes ?? 0), status: 'UPLOADED',
    uploadedAt: typeof o.uploadedAt === 'string' ? toIso(o.uploadedAt) : undefined,
  };
}

/** Chemin de stockage d’une pièce renvoyée par le serveur (absent du type du domaine). */
export function storagePathOf(v: unknown): string | undefined {
  const p = (v as { storagePath?: unknown } | null)?.storagePath;
  return typeof p === 'string' ? p : undefined;
}

/** JSON de _draft_json (serveur) → NeedDraft. Les montants sont des nombres ; le reste est l’état brut de l’assistant. */
export function draftFromServer(v: Json): NeedDraft {
  const o = asObject(v, 'brouillon');
  const docs = Array.isArray(o.documents) ? o.documents.map(toDraftDocument).filter((d): d is DraftDocument => d !== null) : [];
  const draft = { ...o, documents: docs } as unknown as NeedDraft & { storagePath?: unknown };
  if (draft.vertical !== undefined && draft.vertical !== null) draft.vertical = moduleCode(draft.vertical);
  if (draft.amountMinor !== undefined && draft.amountMinor !== null) draft.amountMinor = Number(draft.amountMinor);
  draft.updatedAt = toIso(String(o.updatedAt));
  return draft;
}

/** Chemin d’une pièce dans le bucket « dossiers » : <tx_id>/<kind>/<uuid>.<ext> (contrôlé par 0005). */
export function storagePath(txId: string, kind: string, fileId: string, mimeType: string): string {
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  return `${txId}/${kind}/${fileId}.${ext}`;
}

// ——— Lot X v2 (X4) : enrôlement ———

const ENROLMENT_CASE_STATUSES: readonly EnrolmentCaseStatus[] = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'];
const KYC_RESULTS: readonly KycResult[] = ['APPROVED', 'REJECTED', 'REVIEW'];

export function toEnrolmentCase(v: Json): EnrolmentCaseView {
  const o = asObject(v, 'dossier d’enrôlement');
  return {
    id: String(o.id),
    requestedLevel: oneOf<EnrolmentLevel>(o.requestedLevel, ENROLMENT_LEVELS, 'niveau d’enrôlement'),
    status: oneOf<EnrolmentCaseStatus>(o.status, ENROLMENT_CASE_STATUSES, 'statut d’enrôlement'),
    route: o.route === 'MANUAL' ? 'MANUAL' : 'KYC',
    kycResult: o.kycResult === undefined || o.kycResult === null ? undefined : oneOf<KycResult>(o.kycResult, KYC_RESULTS, 'résultat KYC'),
    rejectionReason: typeof o.rejectionReason === 'string' ? o.rejectionReason : undefined,
    submittedAt: toIso(String(o.submittedAt)),
    reviewedAt: typeof o.reviewedAt === 'string' ? toIso(o.reviewedAt) : undefined,
  };
}

export function toEnrolment(v: Json): EnrolmentView {
  const o = asObject(v, 'enrôlement');
  const c = o.case === undefined || o.case === null ? undefined : toEnrolmentCase(o.case as Json);
  return { level: oneOf<EnrolmentLevel>(o.level, ENROLMENT_LEVELS, 'niveau d’enrôlement'), ...(c ? { case: c } : {}) };
}

// ——— Lot X v2 (X5) : devis ———

export function toQuote(v: Json): PaymentQuote {
  const o = asObject(v, 'devis');
  const fees = asObject((o.fees ?? {}) as Json, 'frais du devis');
  return {
    id: String(o.id), trancheId: String(o.trancheId),
    requestCurrency: oneOf<Currency>(o.requestCurrency, CURRENCIES, 'devise'), requestAmountMinor: toMinor(o.requestAmountMinor),
    debitCurrency: oneOf<Currency>(o.debitCurrency, CURRENCIES, 'devise'), rate: String(o.rate), source: String(o.source), simulated: o.simulated === true,
    method: oneOf<PaymentMethod>(o.method, PAYMENT_METHODS, 'moyen de paiement'), debitAmountMinor: toMinor(o.debitAmountMinor),
    fees: { serviceMinor: toMinor(fees.serviceMinor ?? 0), fxMinor: toMinor(fees.fxMinor ?? 0), methodMinor: toMinor(fees.methodMinor ?? 0) },
    totalDebitMinor: toMinor(o.totalDebitMinor), quotedAt: toIso(String(o.quotedAt)), expiresAt: toIso(String(o.expiresAt)),
  };
}
