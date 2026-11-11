'use client';
import { DomainError } from '@diaspay/domain';
import { toDomainError } from '@diaspay/api-client';

import { browserClient } from './supabase/browser';

/**
 * Accès aux données du bureau de contrôle : uniquement les vues et fonctions de la migration 0006 (et 0005),
 * avec le jeton de l’utilisateur connecté. Aucune règle métier ici : la base décide, l’écran affiche.
 * Toute erreur devient une DomainError à code stable (table des erreurs) ; une session expirée renvoie à la connexion.
 */

export type CheckResult = 'OK' | 'ATTENTION' | 'ECHEC';
export interface Check { code: string; result: CheckResult; detail: Record<string, unknown> }

export interface DossierRow {
  id: string; reference: string; vertical: string; purpose: string; amountMinor: number; currency: string; status: string;
  submittedAt: string | null; requesterName: string | null; payerName: string | null; providerName: string | null;
  beneficiaryName: string | null; required: number; received: number; decidedByMe: boolean; isParty: boolean;
}
export interface TrancheInfo { id: string; seq: number; label: string; amountMinor: number; dueDate: string | null; status: string; releaseMode: string; contestHours: number }
export interface DocumentInfo { id: string; kind: string; name: string; mimeType: string; sizeBytes: number; trancheId: string | null; uploadedAt: string }
export interface Decision { validatorId: string; validatorName: string; approved: boolean; reason: string | null; amountChecked: boolean; decidedAt: string; isMe: boolean }
export interface DossierDetail { tranches: TrancheInfo[]; documents: DocumentInfo[]; checks: Check[]; decisions: Decision[] }

export interface EvidenceRow {
  trancheId: string; txId: string; reference: string; seq: number; label: string; amountMinor: number; currency: string; vertical: string;
  purpose: string; providerName: string | null; submittedAt: string | null; required: number; received: number; decidedByMe: boolean; isParty: boolean;
}
export interface EvidenceDetail { documents: DocumentInfo[]; checks: Check[]; decisions: Decision[] }

export interface DisputeRow {
  id: string; txId: string; trancheId: string; reference: string; trancheSeq: number; trancheLabel: string; amountMinor: number; trancheStatus: string;
  currency: string; vertical: string; purpose: string; reasonCode: string; description: string; openedByRole: 'PAYER' | 'PROVIDER'; openedAt: string;
  status: 'OPEN' | 'RELEASED_TO_PROVIDER' | 'REFUNDED_TO_PAYER'; response: string | null; respondedAt: string | null; notifiedAt: string | null;
  resolutionNote: string | null; resolvedAt: string | null; resolvedByName: string | null; payerName: string | null; providerName: string | null; isParty: boolean;
}

export interface AuditRow {
  id: number; createdAt: string; actorId: string | null; actorName: string | null; actorRole: string | null; event: string;
  fromStatus: string | null; toStatus: string | null; trancheId: string | null; trancheSeq: number | null; payload: Record<string, unknown>;
  prevHash: string | null; hash: string;
}
export interface AuditCheck { valid: boolean; count: number; lastHash: string | null }
export interface FoundTransaction {
  id: string; reference: string; vertical: string; purpose: string; amountMinor: number; currency: string; status: string; createdAt: string;
  payerName: string | null; providerName: string | null;
}

const sb = () => browserClient();

/** Session expirée (jeton refusé par PostgREST) : retour à la connexion. */
function sessionExpired(e: { code?: string; status?: number; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || e.status === 401 || /JWT expired/i.test(e.message ?? ''));
}

function fail(error: unknown, context: string): never {
  if (sessionExpired(error as { code?: string })) {
    if (typeof window !== 'undefined') window.location.assign('/connexion?motif=expiree');
    throw new DomainError('NOT_AUTHENTICATED', 'Session expirée');
  }
  throw toDomainError(error, `bo.${context}`);
}

async function call<T>(p: PromiseLike<{ data: unknown; error: unknown }>, context: string): Promise<T> {
  const { data, error } = await p;
  if (error) fail(error, context);
  return data as T;
}

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? '' : String(v));
const sn = (v: unknown) => (v == null || v === '' ? null : String(v));

// ——— Dossiers à valider ———

export async function listDossiers(): Promise<DossierRow[]> {
  const rows = await call<Array<Record<string, unknown>>>(sb().from('bo_dossiers').select('*').order('submitted_at', { ascending: true }), 'listDossiers');
  return rows.map((r) => ({
    id: s(r.id), reference: s(r.reference), vertical: s(r.vertical), purpose: s(r.purpose), amountMinor: n(r.amount_minor), currency: s(r.currency),
    status: s(r.status), submittedAt: sn(r.submitted_at), requesterName: sn(r.requester_name), payerName: sn(r.payer_name), providerName: sn(r.provider_name),
    beneficiaryName: sn(r.beneficiary_name), required: n(r.validations_required), received: n(r.validations_received), decidedByMe: !!r.decided_by_me, isParty: !!r.is_party,
  }));
}

/** Prise en charge (D8) : SUBMITTED → IN_REVIEW au nom du validateur ; sans effet sur un dossier déjà en validation. */
export async function claimDossier(txId: string): Promise<string> {
  const row = await call<{ status: string }>(sb().rpc('claim_dossier', { p_tx: txId }), 'claimDossier');
  return row.status;
}

const toDocs = (raw: unknown): DocumentInfo[] => (Array.isArray(raw) ? raw : []).map((d: Record<string, unknown>) => ({
  id: s(d.id), kind: s(d.kind), name: s(d.name), mimeType: s(d.mimeType), sizeBytes: n(d.sizeBytes), trancheId: sn(d.trancheId), uploadedAt: s(d.uploadedAt),
}));
const toChecks = (raw: unknown): Check[] => (raw as Array<Record<string, unknown>>).map((c) => ({
  code: s(c.code), result: s(c.result) as CheckResult, detail: (c.detail ?? {}) as Record<string, unknown>,
}));
const toDecisions = (raw: unknown): Decision[] => (raw as Array<Record<string, unknown>>).map((d) => ({
  validatorId: s(d.validator_id), validatorName: s(d.validator_name), approved: !!d.approved, reason: sn(d.reason),
  amountChecked: !!d.amount_checked, decidedAt: s(d.decided_at), isMe: !!d.is_me,
}));

export async function dossierDetail(txId: string): Promise<DossierDetail> {
  const [tranches, documents, checks, decisions] = await Promise.all([
    call<Array<Record<string, unknown>>>(sb().from('tranches').select('id, seq, label, amount_minor, due_date, status, release_mode, contest_hours').eq('tx_id', txId).order('seq'), 'tranches'),
    call<unknown>(sb().rpc('dossier_documents', { p_tx: txId }), 'dossierDocuments'),
    call<unknown>(sb().rpc('dossier_checks', { p_tx: txId }), 'dossierChecks'),
    call<unknown>(sb().rpc('bo_decisions', { p_tx: txId }), 'decisions'),
  ]);
  return {
    tranches: tranches.map((r) => ({
      id: s(r.id), seq: n(r.seq), label: s(r.label), amountMinor: n(r.amount_minor), dueDate: sn(r.due_date), status: s(r.status),
      releaseMode: s(r.release_mode), contestHours: n(r.contest_hours),
    })),
    documents: toDocs(documents).filter((d) => d.trancheId === null),
    checks: toChecks(checks),
    decisions: toDecisions(decisions),
  };
}

/** Décision sur un dossier (decide_tx, 0006) : la base exige la case pour approuver et un motif pour rejeter. */
export async function decideDossier(txId: string, d: { approved: boolean; amountChecked: boolean; reason?: string }): Promise<string> {
  const row = await call<{ status: string }>(sb().rpc('decide_tx', {
    p_tx: txId, p_approved: d.approved, p_amount_checked: d.amountChecked, p_reason: d.reason?.trim() || undefined,
  }), 'decideDossier');
  return row.status;
}

// ——— Preuves de jalons ———

export async function listEvidence(): Promise<EvidenceRow[]> {
  const rows = await call<Array<Record<string, unknown>>>(sb().from('bo_evidence_queue').select('*').order('submitted_at', { ascending: true }), 'listEvidence');
  return rows.map((r) => ({
    trancheId: s(r.tranche_id), txId: s(r.tx_id), reference: s(r.reference), seq: n(r.seq), label: s(r.label), amountMinor: n(r.amount_minor),
    currency: s(r.currency), vertical: s(r.vertical), purpose: s(r.purpose), providerName: sn(r.provider_name), submittedAt: sn(r.submitted_at),
    required: n(r.validations_required), received: n(r.validations_received), decidedByMe: !!r.decided_by_me, isParty: !!r.is_party,
  }));
}

export async function evidenceDetail(txId: string, trancheId: string): Promise<EvidenceDetail> {
  const [documents, checks, decisions] = await Promise.all([
    call<unknown>(sb().rpc('dossier_documents', { p_tx: txId }), 'dossierDocuments'),
    call<unknown>(sb().rpc('evidence_checks', { p_tranche: trancheId }), 'evidenceChecks'),
    call<unknown>(sb().rpc('bo_decisions', { p_tx: txId, p_tranche: trancheId }), 'decisions'),
  ]);
  return { documents: toDocs(documents).filter((d) => d.trancheId === trancheId), checks: toChecks(checks), decisions: toDecisions(decisions) };
}

export async function decideEvidence(trancheId: string, d: { approved: boolean; reason?: string }): Promise<string> {
  const row = await call<{ status: string }>(sb().rpc('decide_tranche', { p_tranche: trancheId, p_approved: d.approved, p_reason: d.reason?.trim() || undefined }), 'decideEvidence');
  return row.status;
}

// ——— Litiges (administrateurs) ———

export async function listDisputes(): Promise<DisputeRow[]> {
  const rows = await call<Array<Record<string, unknown>>>(sb().from('bo_disputes').select('*').order('opened_at', { ascending: true }), 'listDisputes');
  return rows.map((r) => ({
    id: s(r.id), txId: s(r.tx_id), trancheId: s(r.tranche_id), reference: s(r.reference), trancheSeq: n(r.tranche_seq), trancheLabel: s(r.tranche_label),
    amountMinor: n(r.amount_minor), trancheStatus: s(r.tranche_status), currency: s(r.currency), vertical: s(r.vertical), purpose: s(r.purpose),
    reasonCode: s(r.reason_code), description: s(r.description), openedByRole: s(r.opened_by_role) === 'PROVIDER' ? 'PROVIDER' : 'PAYER',
    openedAt: s(r.opened_at), status: s(r.status) as DisputeRow['status'], response: sn(r.response), respondedAt: sn(r.responded_at),
    notifiedAt: sn(r.notified_at), resolutionNote: sn(r.resolution_note), resolvedAt: sn(r.resolved_at), resolvedByName: sn(r.resolved_by_name),
    payerName: sn(r.payer_name), providerName: sn(r.provider_name), isParty: !!r.is_party,
  }));
}

export async function disputeDocuments(txId: string, trancheId: string): Promise<DocumentInfo[]> {
  const docs = toDocs(await call<unknown>(sb().rpc('dossier_documents', { p_tx: txId }), 'dossierDocuments'));
  return docs.filter((d) => d.trancheId === null || d.trancheId === trancheId);
}

/** Décision de litige (resolve_dispute : administrateur non partie, note obligatoire). Renvoie le nouvel état de la tranche. */
export async function resolveDispute(disputeId: string, trancheId: string, outcome: 'RELEASE_TO_PROVIDER' | 'REFUND_PAYER', note: string): Promise<string> {
  await call(sb().rpc('resolve_dispute', { p_dispute: disputeId, p_outcome: outcome, p_note: note.trim() }), 'resolveDispute');
  const tr = await call<{ status: string }>(sb().from('tranches').select('status').eq('id', trancheId).single(), 'trancheStatus');
  return tr.status;
}

// ——— Pièces ———

/**
 * Ouverture d’une pièce : consultation journalisée par la base (open_document), puis URL signée de 60 secondes
 * (permise par la politique du stockage juste après la consultation), téléchargement et URL blob: locale.
 */
export async function openDocument(docId: string): Promise<{ url: string; name: string; mimeType: string }> {
  const info = await call<{ path: string; name: string; mimeType: string }>(sb().rpc('open_document', { p_doc: docId }), 'openDocument');
  const signed = await sb().storage.from('dossiers').createSignedUrl(info.path, 60);
  if (signed.error || !signed.data) fail(signed.error, 'signedUrl');
  const res = await fetch(signed.data.signedUrl, { referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!res.ok) throw new DomainError('NOT_FOUND', 'Fichier introuvable');
  const blob = new Blob([await res.arrayBuffer()], { type: info.mimeType });
  return { url: URL.createObjectURL(blob), name: info.name, mimeType: info.mimeType };
}

// ——— Journal d’audit ———

export async function findTransactions(query: string): Promise<FoundTransaction[]> {
  const rows = await call<Array<Record<string, unknown>>>(sb().rpc('bo_find_transactions', { p_query: query }), 'findTransactions');
  return rows.map((r) => ({
    id: s(r.id), reference: s(r.reference), vertical: s(r.vertical), purpose: s(r.purpose), amountMinor: n(r.amount_minor), currency: s(r.currency),
    status: s(r.status), createdAt: s(r.created_at), payerName: sn(r.payer_name), providerName: sn(r.provider_name),
  }));
}

export async function auditRows(txId: string): Promise<AuditRow[]> {
  const rows = await call<Array<Record<string, unknown>>>(sb().rpc('bo_audit', { p_tx: txId }), 'audit');
  return rows.map((r) => ({
    id: n(r.id), createdAt: s(r.created_at), actorId: sn(r.actor_id), actorName: sn(r.actor_name), actorRole: sn(r.actor_role), event: s(r.event),
    fromStatus: sn(r.from_status), toStatus: sn(r.to_status), trancheId: sn(r.tranche_id), trancheSeq: r.tranche_seq == null ? null : n(r.tranche_seq),
    payload: (r.payload ?? {}) as Record<string, unknown>, prevHash: sn(r.prev_hash), hash: s(r.hash),
  }));
}

export async function auditVerify(txId: string): Promise<AuditCheck> {
  const r = await call<Record<string, unknown>>(sb().rpc('bo_audit_verify', { p_tx: txId }), 'auditVerify');
  return { valid: r.valid === true, count: n(r.count), lastHash: sn(r.lastHash) };
}

export async function logAuditExport(txId: string, rows: number): Promise<void> {
  await call(sb().rpc('log_audit_export', { p_tx: txId, p_rows: rows }), 'logAuditExport');
}
