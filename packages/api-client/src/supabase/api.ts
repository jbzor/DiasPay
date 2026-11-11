import { checkFile, checkFileCount, normalizeReference } from '@diaspay/domain';
import type { DisputeOutcome, DraftDocument, DraftDocumentInput, NeedDraft, Vertical } from '@diaspay/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, newUuid } from '../need';
import type { ProviderSummary } from '../need';
import type { AppNotification, AuditEntry, DisputeView, Receipt, ReferenceInfo, Tranche, TrancheToken, Transaction, TransactionApi } from '../types';
import type { Database } from './database.types';
import {
  TX_SELECT, draftFromServer, draftToServer, storagePath, storagePathOf, toAuditEntry, toDispute, toNotification, toProvider,
  toReceipt, toReferenceInfo, toToken, toTransaction,
} from './convert';
import type { TxWithRelations } from './convert';
import { toDomainError, unwrap, unwrapMaybe } from './errors';

export type DiasPayClient = SupabaseClient<Database>;
export const BUCKET = 'dossiers';
/** Durée de validité des URL signées de consultation d’une pièce (secondes). */
export const VIEW_URL_TTL_S = 60;

export interface UploadTarget { url: string; headers: Record<string, string> }
export interface UploadFile { uri: string; mimeType: string; sizeBytes: number }
/**
 * Envoi d’un fichier vers une URL signée (PUT, corps binaire). L’application fournit une implémentation native
 * avec progression (expo-file-system) ; `fetchUploader` sert sur le web et dans les tests.
 */
export type FileUploader = (target: UploadTarget, file: UploadFile, onProgress?: (p: number) => void) => Promise<void>;

export const fetchUploader: FileUploader = async (target, file, onProgress) => {
  onProgress?.(0.05);
  const blob = await (await fetch(file.uri)).blob();
  onProgress?.(0.3);
  const res = await fetch(target.url, { method: 'PUT', headers: target.headers, body: blob });
  if (!res.ok) throw new ApiError('UPLOAD_FAILED', `Envoi refusé (${res.status})`);
  onProgress?.(1);
};

export interface SupabaseApiOptions {
  uploader?: FileUploader;
  /** Clé publique (publishable) : en-tête apikey de l’envoi signé. */
  anonKey: string;
}

/**
 * Implémentation de TransactionApi sur Supabase. Toutes les règles sont appliquées par le serveur (0005) ;
 * toute erreur devient une DomainError à code stable (voir errors.ts et docs/error-codes.md).
 */
export class SupabaseApi implements TransactionApi {
  private readonly uploader: FileUploader;
  /** URL d’envoi signée par pièce : une reprise réutilise le même chemin (upsert) au lieu de créer un doublon. */
  private readonly pendingUploads = new Map<string, { path: string; url: string; at: number }>();

  constructor(private readonly sb: DiasPayClient, private readonly opts: SupabaseApiOptions) {
    this.uploader = opts.uploader ?? fetchUploader;
  }

  private async userId(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new ApiError('NOT_AUTHENTICATED', 'Aucune session');
    return id;
  }

  // ——— Transactions ———

  async listTransactions(): Promise<Transaction[]> {
    const rows = unwrap(await this.sb.from('transactions').select(TX_SELECT).neq('status', 'DRAFT').order('created_at', { ascending: false }), 'listTransactions');
    return (rows as unknown as TxWithRelations[]).map(toTransaction);
  }

  async getTransaction(id: string): Promise<Transaction> {
    const row = unwrapMaybe(await this.sb.from('transactions').select(TX_SELECT).eq('id', id).maybeSingle(), 'getTransaction');
    if (!row) throw new ApiError('TX_NOT_FOUND', 'Transaction introuvable');
    return toTransaction(row as unknown as TxWithRelations);
  }

  private async txOfTranche(trancheId: string): Promise<string> {
    const row = unwrapMaybe(await this.sb.from('tranches').select('tx_id').eq('id', trancheId).maybeSingle(), 'txOfTranche');
    if (!row) throw new ApiError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
    return row.tx_id;
  }

  async getTranche(trancheId: string): Promise<{ tx: Transaction; tranche: Tranche }> {
    const tx = await this.getTransaction(await this.txOfTranche(trancheId));
    const tranche = tx.tranches.find((t) => t.id === trancheId);
    if (!tranche) throw new ApiError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
    return { tx, tranche };
  }

  /** Paiement simulé (mock_mode du serveur uniquement ; DEMO_DISABLED sinon). */
  async payTranche(trancheId: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('simulate_tranche_system', { p_tranche: trancheId, p_to: 'PAID_LOCKED' }), 'payTranche');
    return this.getTransaction(tr.tx_id);
  }

  async getToken(trancheId: string): Promise<TrancheToken> {
    const row = unwrapMaybe(await this.sb.from('tranche_tokens').select('*').eq('tranche_id', trancheId).maybeSingle(), 'getToken');
    if (!row) {
      await this.txOfTranche(trancheId); // TRANCHE_NOT_FOUND si la tranche est inaccessible
      throw new ApiError('NO_TOKEN', 'Jeton pas encore émis');
    }
    return toToken(row);
  }

  async resolveReference(reference: string): Promise<ReferenceInfo> {
    return toReferenceInfo(unwrap(await this.sb.rpc('resolve_reference_info', { p_ref: normalizeReference(reference) }), 'resolveReference'));
  }

  async confirmByReference(reference: string, deviceTime?: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('confirm_by_reference', {
      p_ref: normalizeReference(reference), ...(deviceTime ? { p_device_time: deviceTime } : {}),
    }), 'confirmByReference');
    return this.getTransaction(tr.tx_id);
  }

  async approveRelease(trancheId: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('transition_tranche', { p_tranche: trancheId, p_to: 'RELEASED' }), 'approveRelease');
    return this.getTransaction(tr.tx_id);
  }

  /** Même convention que le simulateur : `reason` est le code du motif quand une description est fournie. */
  async openDispute(trancheId: string, reason: string, description?: string): Promise<Transaction> {
    const d = unwrap(await this.sb.rpc('open_dispute', {
      p_tranche: trancheId, p_reason: (description ?? reason).trim(), ...(description !== undefined ? { p_reason_code: reason } : {}),
    }), 'openDispute');
    return this.getTransaction(d.tx_id);
  }

  async timeline(txId: string): Promise<AuditEntry[]> {
    const rows = unwrap(await this.sb.from('audit_log').select('*').eq('tx_id', txId).order('id'), 'timeline');
    return rows.map(toAuditEntry);
  }

  // ——— Création d’un besoin ———

  async searchProviders(query: string, vertical: Vertical): Promise<ProviderSummary[]> {
    return unwrap(await this.sb.rpc('search_providers', { p_query: query, p_vertical: vertical }), 'searchProviders').map(toProvider);
  }

  async listDrafts(): Promise<NeedDraft[]> {
    const v = unwrap(await this.sb.rpc('get_drafts'), 'listDrafts');
    return (Array.isArray(v) ? v : []).map(draftFromServer);
  }

  async getDraft(id: string): Promise<NeedDraft> {
    return draftFromServer(unwrap(await this.sb.rpc('get_draft', { p_tx: id }), 'getDraft'));
  }

  async saveDraft(draft: NeedDraft): Promise<NeedDraft> {
    return draftFromServer(unwrap(await this.sb.rpc('save_draft', { p_draft: draftToServer(draft) }), 'saveDraft'));
  }

  /** Ordre documenté : fichiers du bucket d’abord, puis la ligne (delete_draft). Un dossier audité est refusé (AUDITED_FILE). */
  async deleteDraft(id: string): Promise<void> {
    const draft = await this.getDraft(id);
    if (draft.correctionOf) throw new ApiError('AUDITED_FILE', 'Ce dossier a un historique : il ne peut pas être supprimé');
    await this.removeFiles(await this.documentPaths(id));
    unwrapMaybe(await this.sb.rpc('delete_draft', { p_tx: id }), 'deleteDraft');
  }

  private async documentPaths(txId: string): Promise<string[]> {
    const rows = unwrap(await this.sb.from('documents').select('storage_path').eq('tx_id', txId), 'documentPaths');
    return rows.map((r) => r.storage_path);
  }

  private async removeFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const res = await this.sb.storage.from(BUCKET).remove(paths);
    if (res.error) throw toDomainError(res.error, 'storage.remove');
  }

  /**
   * Envoi d’une pièce : contrôles du domaine, URL signée (<tx>/<kind>/<uuid>.<ext>), envoi avec progression,
   * puis enregistrement (add_document, qui revérifie limites, type et taille). Le brouillon doit exister sur le serveur.
   */
  async attachDocument(draftId: string, file: DraftDocumentInput, onProgress?: (p: number) => void): Promise<DraftDocument> {
    const mimeType = checkFile(file);
    const current = await this.getDraft(draftId);
    checkFileCount(current.documents.filter((x) => x.kind === file.kind && x.id !== file.id).length);
    const fileId = file.id ?? newUuid();
    const key = `${draftId}/${fileId}`;
    let pending = this.pendingUploads.get(key);
    if (!pending || Date.now() - pending.at > 90 * 60_000) {
      const path = storagePath(draftId, file.kind, fileId, mimeType);
      const signed = unwrap(await this.sb.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true }), 'createSignedUploadUrl');
      pending = { path, url: signed.signedUrl, at: Date.now() };
      this.pendingUploads.set(key, pending);
    }
    onProgress?.(0);
    try {
      await this.uploader(
        { url: pending.url, headers: { 'content-type': mimeType, 'x-upsert': 'true', apikey: this.opts.anonKey } },
        { uri: file.uri, mimeType, sizeBytes: file.sizeBytes }, onProgress,
      );
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError('UPLOAD_FAILED', 'L’envoi a échoué');
    }
    const doc = unwrap(await this.sb.rpc('add_document', {
      p_tx: draftId, p_kind: file.kind, p_path: pending.path, p_name: file.name, p_mime: mimeType, p_size: file.sizeBytes,
    }), 'addDocument');
    this.pendingUploads.delete(key);
    onProgress?.(1);
    const o = doc as Record<string, unknown>;
    return {
      id: String(o.id), kind: file.kind, name: file.name, mimeType, sizeBytes: file.sizeBytes, uri: file.uri, status: 'UPLOADED',
      uploadedAt: typeof o.uploadedAt === 'string' ? new Date(o.uploadedAt).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Retrait d’une pièce. Brouillon jamais audité : le fichier est supprimé du bucket d’abord, puis la ligne.
   * Dossier audité (correction) : la ligne est archivée (deleted_at) et le fichier conservé.
   */
  async removeDocument(draftId: string, documentId: string): Promise<void> {
    const draft = await this.getDraft(draftId);
    if (!draft.correctionOf) {
      const row = unwrapMaybe(await this.sb.from('documents').select('storage_path').eq('id', documentId).maybeSingle(), 'removeDocument');
      if (!row) throw new ApiError('NOT_FOUND', 'Pièce introuvable');
      await this.removeFiles([row.storage_path]);
    }
    unwrap(await this.sb.rpc('remove_document', { p_doc: documentId }), 'removeDocument');
  }

  /** URL signée de courte durée pour consulter une pièce (bucket privé). */
  async documentUrl(documentId: string): Promise<string> {
    const row = unwrapMaybe(await this.sb.from('documents').select('storage_path').eq('id', documentId).maybeSingle(), 'documentUrl');
    if (!row) throw new ApiError('NOT_FOUND', 'Pièce introuvable');
    return unwrap(await this.sb.storage.from(BUCKET).createSignedUrl(row.storage_path, VIEW_URL_TTL_S), 'createSignedUrl').signedUrl;
  }

  /** Le brouillon a été synchronisé par save_draft ; le serveur revérifie tout (codes D2, plan, verticale). */
  async submitNeed(draftId: string): Promise<Transaction> {
    unwrap(await this.sb.rpc('transition_tx', { p_tx: draftId, p_to: 'SUBMITTED' }), 'submitNeed');
    return this.getTransaction(draftId);
  }

  /** REJECTED → DRAFT : la correction garde l’identifiant du dossier (correctionOf = id). */
  async reopenForCorrection(txId: string): Promise<NeedDraft> {
    unwrap(await this.sb.rpc('transition_tx', { p_tx: txId, p_to: 'DRAFT' }), 'reopenForCorrection');
    return this.getDraft(txId);
  }

  async abandonRejected(txId: string): Promise<Transaction> {
    unwrap(await this.sb.rpc('transition_tx', { p_tx: txId, p_to: 'CANCELLED' }), 'abandonRejected');
    return this.getTransaction(txId);
  }

  // ——— Alertes, litiges, reçus ———

  async listNotifications(): Promise<AppNotification[]> {
    const rows = unwrap(await this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(200), 'listNotifications');
    return rows.map(toNotification).filter((n): n is AppNotification => n !== null);
  }

  async markNotificationRead(id: string): Promise<void> {
    const rows = unwrap(await this.sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).select('id'), 'markNotificationRead');
    if (rows.length === 0) throw new ApiError('NOT_FOUND', 'Alerte introuvable');
  }

  async markAllNotificationsRead(): Promise<void> {
    const uid = await this.userId();
    unwrapMaybe(await this.sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null), 'markAllNotificationsRead');
  }

  async getDispute(trancheId: string): Promise<DisputeView | null> {
    return toDispute(unwrapMaybe(await this.sb.rpc('get_dispute', { p_tranche: trancheId }), 'getDispute'));
  }

  async getReceipt(trancheId: string): Promise<Receipt> {
    return toReceipt(unwrap(await this.sb.rpc('get_receipt', { p_tranche: trancheId }), 'getReceipt'));
  }

  // ——— Démonstration : disponible seulement si le serveur est en mock_mode ———

  /** Lit app_config.mock_mode (lisible par tous les utilisateurs connectés). */
  async serverMockMode(): Promise<boolean> {
    const row = unwrapMaybe(await this.sb.from('app_config').select('value').eq('key', 'mock_mode').maybeSingle(), 'mockMode');
    return row?.value === 'true';
  }

  async simulateReview(txId: string, decision: { approved: boolean; reason?: string }): Promise<Transaction> {
    unwrap(await this.sb.rpc('demo_review', { p_tx: txId, p_approved: decision.approved, ...(decision.reason ? { p_reason: decision.reason } : {}) }), 'demoReview');
    return this.getTransaction(txId);
  }

  async simulateDisputeResolution(trancheId: string, decision: { outcome: DisputeOutcome; note: string }): Promise<Transaction> {
    const d = unwrap(await this.sb.rpc('demo_resolve_dispute', { p_tranche: trancheId, p_outcome: decision.outcome, p_note: decision.note }), 'demoResolveDispute');
    return this.getTransaction(d.tx_id);
  }

  /** Réinitialisation : fichiers des dossiers de l’utilisateur d’abord, puis demo_reset (dossiers, journal, alertes). */
  async resetDemoData(): Promise<void> {
    const uid = await this.userId();
    const txs = unwrap(await this.sb.from('transactions').select('id').eq('created_by', uid), 'resetDemoData');
    for (const t of txs) await this.removeFiles(await this.documentPaths(t.id));
    unwrap(await this.sb.rpc('demo_reset'), 'demoReset');
  }
}
