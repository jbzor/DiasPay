/**
 * Conversion entre les lignes du serveur (snake_case, bigint, NULL) et les types du domaine.
 * Aucune valeur inattendue ne traverse : un statut ou un montant hors domaine lève UNEXPECTED.
 */
import { TRANCHE_STATUSES, TX_STATUSES, VERTICALS } from '@diaspay/domain';
import type { Currency, DocumentKind, DraftDocument, NeedDraft, PlanType, ReleaseMode, TrancheStatus, TxStatus, Vertical } from '@diaspay/domain';
import { ApiError } from '../need';
import type { ProviderSummary } from '../need';
import type {
  AppNotification, AuditEntry, DisputeView, NotificationEvent, Receipt, ReferenceInfo, Tranche, TrancheToken, Transaction,
} from '../types';
import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];
export type TxRow = Tables['transactions']['Row'];
export type TrancheRow = Tables['tranches']['Row'];
export type TokenRow = Tables['tranche_tokens']['Row'];
export type NotificationRow = Tables['notifications']['Row'];
export type AuditRow = Tables['audit_log']['Row'];
export type DocumentRow = Pick<Tables['documents']['Row'], 'id' | 'tranche_id' | 'deleted_at'>;

/** Ligne de transaction lue avec ses tranches, leurs jetons et ses pièces (voir TX_SELECT). */
export type TxWithRelations = TxRow & {
  tranches: Array<TrancheRow & { tranche_tokens: Pick<TokenRow, 'reference'> | Pick<TokenRow, 'reference'>[] | null }>;
  documents: DocumentRow[];
};
export const TX_SELECT = '*, tranches(*, tranche_tokens(reference)), documents(id, tranche_id, deleted_at)';

const CURRENCIES: readonly string[] = ['EUR', 'USD', 'XAF'];
const RELEASE_MODES: readonly string[] = ['PROVIDER_CONFIRM', 'PAYER_CONFIRM', 'EVIDENCE_REVIEW', 'AUTO'];
const PLAN_TYPES: readonly string[] = ['SINGLE', 'PARTIAL', 'INSTALLMENTS', 'RECURRING'];

function bad(what: string, value: unknown): never {
  throw new ApiError('UNEXPECTED', `Valeur inattendue du serveur (${what})`, { what, value });
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
  const tok = Array.isArray(row.tranche_tokens) ? row.tranche_tokens[0] : row.tranche_tokens;
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
  };
}

export function toTransaction(row: TxWithRelations): Transaction {
  const docs = row.documents ?? [];
  return {
    id: row.id,
    vertical: oneOf<Vertical>(row.vertical, VERTICALS, 'verticale'),
    purpose: row.purpose ?? '',
    amount: {
      amountMinor: row.amount_minor === null ? 0 : toMinor(row.amount_minor),
      currency: row.currency === null ? 'XAF' : oneOf<Currency>(row.currency, CURRENCIES, 'devise'),
    },
    status: oneOf<TxStatus>(row.status, TX_STATUSES, 'statut de transaction'),
    providerName: row.provider_name ?? '',
    beneficiaryName: row.beneficiary_name ?? '',
    tranches: [...(row.tranches ?? [])].sort((a, b) => a.seq - b.seq).map((t) => toTranche(t, docs)),
    createdAt: toIso(row.created_at),
    planType: row.plan_type === null ? undefined : oneOf<PlanType>(row.plan_type, PLAN_TYPES, 'type de plan'),
    documentCount: docs.filter((d) => d.tranche_id === null && !d.deleted_at).length,
    rejectionReason: opt(row.reject_reason),
    ownerId: row.created_by,
  };
}

export function toToken(row: TokenRow): TrancheToken {
  return {
    trancheId: row.tranche_id, reference: row.reference, kid: row.kid, signature: row.signature,
    simulated: row.simulated, expiresAt: toIso(row.expires_at), usedAt: toIso(row.used_at),
  };
}

const NOTIFICATION_TYPES = ['TX_VALIDATED', 'TX_REJECTED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED'];

/** Le serveur écrit l’événement dans payload (déclencheur sur audit_log) ; jamais de texte affiché. */
export function toNotification(row: NotificationRow): AppNotification | null {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const type = typeof p.type === 'string' ? p.type : row.event;
  if (!NOTIFICATION_TYPES.includes(type)) return null; // type futur inconnu : ignoré, pas d’écran cassé
  const event = { ...p, type, txId: (p.txId as string | undefined) ?? row.tx_id ?? '' } as NotificationEvent;
  if (event.type === 'TX_REJECTED' && typeof event.reason !== 'string') (event as { reason: string }).reason = '';
  return { id: row.id, event, at: toIso(row.created_at), readAt: toIso(row.read_at) };
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
  return { id: row.id, name: row.name, city: row.city, verified: row.verified, verticals: row.verticals.filter((v): v is Vertical => VERTICALS.includes(v as Vertical)) };
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
    status: oneOf<DisputeView['status']>(o.status, ['OPEN', 'RELEASED_TO_PROVIDER', 'REFUNDED_TO_PAYER'], 'statut de litige'),
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
    expiresAt: toIso(String(o.expiresAt)), used: o.used === true, providerName: String(o.providerName ?? ''),
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
  if (draft.vertical !== undefined && !VERTICALS.includes(draft.vertical)) bad('verticale', draft.vertical);
  if (draft.amountMinor !== undefined && draft.amountMinor !== null) draft.amountMinor = Number(draft.amountMinor);
  draft.updatedAt = toIso(String(o.updatedAt));
  return draft;
}

/** Chemin d’une pièce dans le bucket « dossiers » : <tx_id>/<kind>/<uuid>.<ext> (contrôlé par 0005). */
export function storagePath(txId: string, kind: string, fileId: string, mimeType: string): string {
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  return `${txId}/${kind}/${fileId}.${ext}`;
}
