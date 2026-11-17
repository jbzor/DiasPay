import { checkContentHash, checkFile, checkFileCount, emptyDraft, normalizeReference } from '@diaspay/domain';
import type {
  CreatorRole, Currency, DisputeOutcome, DraftDocument, DraftDocumentInput, EnrolmentDocumentInput, EnrolmentLevel, ModuleCode, NeedDraft, PaymentMethod,
  RequestModule,
} from '@diaspay/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, fetchHasher, newUuid } from '../need';
import type { FileHasher, ProviderSummary } from '../need';
import type {
  AppNotification, AuditEntry, DisputeView, DocumentAccess, DocumentReuse, EnrolmentCaseView, EnrolmentView, PaymentQuote, Receipt, ReferenceInfo, RequestMessage, Tranche, TrancheToken, Transaction,
  TransactionApi,
} from '../types';
import type { Database, Json } from './database.types';
import {
  TX_SELECT, draftFromServer, draftToServer, storagePath, storagePathOf, toAuditEntry, toDispute, toMessage, toModule, toNotification, toProvider,
  toReceipt, toReferenceInfo, toToken, toTransaction, toEnrolment, toEnrolmentCase, toQuote,
} from './convert';
import type { TxWithRelations } from './convert';
import { toDomainError, unwrap, unwrapMaybe } from './errors';

export type DiasPayClient = SupabaseClient<Database>;
export const REALTIME_TABLES = ['transactions', 'tranches', 'disputes', 'notifications'] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];
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
  /** Lot X (X4) : empreinte SHA-256 du fichier avant l’envoi (application : expo-crypto ; défaut : fetchHasher). */
  hashFile?: FileHasher;
  /** Clé publique (publishable) : en-tête apikey de l’envoi signé. */
  anonKey: string;
  /**
   * Lot X-C (T2) : démonstration côté client (EXPO_PUBLIC_DEMO=1). Le partenaire simulé confirme alors chaque tentative
   * aussitôt (demo_settle_payment ; mock_mode du serveur requis, DEMO_DISABLED sinon). Défaut : faux — la tentative reste
   * en cours (INITIATED ou PENDING) jusqu’à l’événement du partenaire, reçu par le temps réel (table tranches).
   */
  demoSettle?: boolean;
}

/**
 * Implémentation de TransactionApi sur Supabase. Toutes les règles sont appliquées par le serveur (0005) ;
 * toute erreur devient une DomainError à code stable (voir errors.ts et docs/error-codes.md).
 */
export class SupabaseApi implements TransactionApi {
  private readonly uploader: FileUploader;
  private readonly hashFile: FileHasher;
  private readonly demoSettle: boolean;
  /** URL d’envoi signée par pièce : une reprise réutilise le même chemin (upsert) au lieu de créer un doublon. */
  private readonly pendingUploads = new Map<string, { path: string; url: string; at: number }>();

  constructor(private readonly sb: DiasPayClient, private readonly opts: SupabaseApiOptions) {
    this.uploader = opts.uploader ?? fetchUploader;
    this.hashFile = opts.hashFile ?? fetchHasher;
    this.demoSettle = opts.demoSettle ?? false;
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

  /**
   * Lot X (X5) : tentative idempotente (start_payment), puis réponse du partenaire. Lot X-C (T2) : hors démonstration,
   * la tentative reste en cours (INITIATED ou PENDING) jusqu’à l’événement du partenaire, reçu par le temps réel ;
   * en démonstration (demoSettle), le partenaire simulé répond aussitôt par le même chemin (demo_settle_payment →
   * apply_payment_event ; mock_mode du serveur requis). Même clé : même tentative, aucun nouveau paiement.
   */
  async payTranche(trancheId: string, idempotencyKey: string = newUuid()): Promise<Transaction> {
    const a = unwrap(await this.sb.rpc('start_payment', { p_tranche: trancheId, p_idempotency_key: idempotencyKey }), 'payTranche') as Record<string, unknown>;
    return this.afterPayment(a, 'payTranche');
  }

  /** Après la tentative : confirmation immédiate par le partenaire simulé en démonstration seulement (demoSettle). */
  private async afterPayment(a: Record<string, unknown>, op: string): Promise<Transaction> {
    if (this.demoSettle && (a.status === 'INITIATED' || a.status === 'PENDING')) unwrap(await this.sb.rpc('demo_settle_payment', { p_attempt: String(a.id) }), op);
    return this.getTransaction(String(a.txId));
  }

  async getQuote(trancheId: string, debitCurrency?: Currency, method: PaymentMethod = 'SIMULATED'): Promise<PaymentQuote> {
    return toQuote(unwrap(await this.sb.rpc('get_quote', { p_request: trancheId, ...(debitCurrency ? { p_debit_currency: debitCurrency } : {}), p_method: method }), 'getQuote'));
  }

  async acceptAndPay(trancheId: string, quoteId: string, idempotencyKey: string = newUuid()): Promise<Transaction> {
    const a = unwrap(await this.sb.rpc('accept_and_pay', { p_request: trancheId, p_idempotency_key: idempotencyKey, p_quote_id: quoteId }), 'acceptAndPay') as Record<string, unknown>;
    return this.afterPayment(a, 'acceptAndPay');
  }

  async getToken(trancheId: string): Promise<TrancheToken> {
    // Lot X : seul le jeton actif ; la RLS ne le montre qu’au payeur de la tranche.
    const row = unwrapMaybe(await this.sb.from('tranche_tokens').select('*').eq('tranche_id', trancheId).is('revoked_at', null).maybeSingle(), 'getToken');
    if (!row) {
      await this.txOfTranche(trancheId); // TRANCHE_NOT_FOUND si la tranche est inaccessible
      throw new ApiError('NO_TOKEN', 'Jeton pas encore émis');
    }
    return toToken(row);
  }

  /** Lot X : le serveur répond null pour une référence inconnue comme pour un dossier étranger (échec enregistré). */
  async resolveReference(reference: string): Promise<ReferenceInfo> {
    const info = unwrapMaybe(await this.sb.rpc('resolve_reference_info', { p_ref: normalizeReference(reference) }), 'resolveReference');
    if (info === null) throw new ApiError('UNKNOWN_REFERENCE', 'Référence inconnue');
    return toReferenceInfo(info);
  }

  async confirmByReference(reference: string, deviceTime?: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('confirm_by_reference', {
      p_ref: normalizeReference(reference), ...(deviceTime ? { p_device_time: deviceTime } : {}),
    }), 'confirmByReference');
    return this.getTransaction(tr.tx_id);
  }

  /** Lot X v2 : libération anticipée par le payeur (CONDITIONAL, après confirmation). */
  async approveRelease(trancheId: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('approve_release', { p_tranche: trancheId }), 'approveRelease');
    return this.getTransaction(tr.tx_id);
  }

  async confirmService(trancheId: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('confirm_service', { p_tranche: trancheId }), 'confirmService');
    return this.getTransaction(tr.tx_id);
  }

  async acceptPlan(txId: string): Promise<Transaction> {
    unwrap(await this.sb.rpc('accept_plan', { p_operation: txId }), 'acceptPlan');
    return this.getTransaction(txId);
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

  async searchProviders(query: string, vertical: ModuleCode): Promise<ProviderSummary[]> {
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
    // Lot X (X4) : empreinte calculée avant l’envoi, enregistrée avec la pièce (add_document), immuable ensuite.
    let contentHash: string | undefined;
    try {
      contentHash = checkContentHash(file.contentHash ?? await this.hashFile({ uri: file.uri, mimeType, sizeBytes: file.sizeBytes }));
    } catch (e) {
      throw e instanceof ApiError || (e as { code?: string }).code === 'HASH_INVALID' ? e : new ApiError('UPLOAD_FAILED', 'Lecture du fichier impossible');
    }
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
      ...(contentHash ? { p_hash: contentHash } : {}),
    }), 'addDocument');
    this.pendingUploads.delete(key);
    onProgress?.(1);
    const o = doc as Record<string, unknown>;
    return {
      id: String(o.id), kind: file.kind, name: file.name, mimeType, sizeBytes: file.sizeBytes, uri: file.uri, status: 'UPLOADED', contentHash,
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

  /** URL signée de courte durée pour consulter une pièce (bucket privé), après consultation journalisée (lot X, X4). */
  async documentUrl(documentId: string): Promise<string> {
    return (await this.getDocumentAccess(documentId)).url;
  }

  /**
   * Lot X (X4) : get_document_access journalise DOCUMENT_VIEWED (qui, rôle, quelle pièce), puis le stockage autorise la lecture
   * du fichier pendant 2 minutes : l’URL signée est créée aussitôt (60 secondes).
   */
  async getDocumentAccess(documentId: string): Promise<DocumentAccess> {
    const o = unwrap(await this.sb.rpc('get_document_access', { p_document: documentId }), 'getDocumentAccess') as Record<string, unknown>;
    const path = String(o.path ?? '');
    const url = unwrap(await this.sb.storage.from(BUCKET).createSignedUrl(path, VIEW_URL_TTL_S), 'createSignedUrl').signedUrl;
    return {
      id: String(o.id ?? documentId), url, name: String(o.name ?? ''), mimeType: String(o.mimeType ?? ''),
      contentHash: typeof o.contentHash === 'string' ? o.contentHash : undefined,
    };
  }

  async documentReuse(contentHash: string, txId?: string): Promise<DocumentReuse> {
    const o = unwrap(await this.sb.rpc('document_reuse', { p_hash: contentHash, ...(txId ? { p_tx: txId } : {}) }), 'documentReuse') as Record<string, unknown>;
    return { reused: o.reused === true, count: Number(o.count ?? 0) };
  }

  /**
   * Soumission (lot X v2, submit_operation) : le serveur revérifie tout (codes D2, plan, type), puis active l’opération
   * (platform_review NEVER, défaut) ou la place en revue (PENDING_REVIEW).
   */
  async submitNeed(draftId: string): Promise<Transaction> {
    unwrap(await this.sb.rpc('submit_operation', { p_tx: draftId }), 'submitNeed');
    return this.getTransaction(draftId);
  }

  /** Initiateur : annule l’opération (DRAFT ou ACTIVE ; en ACTIVE, les demandes non payées seulement). */
  async cancelOperation(txId: string, reason?: string): Promise<Transaction> {
    unwrap(await this.sb.rpc('transition_tx', { p_tx: txId, p_to: 'CANCELLED', ...(reason ? { p_reason: reason } : {}) }), 'cancelOperation');
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

  // ——— Lot X : sécurité du TrustLink, décisions du payeur, création par un prestataire ———

  async revokeToken(trancheId: string, reason: string): Promise<void> {
    unwrap(await this.sb.rpc('revoke_token', { p_tranche: trancheId, p_reason: reason }), 'revokeToken');
  }

  async reissueToken(trancheId: string, reason?: string): Promise<void> {
    unwrap(await this.sb.rpc('reissue_token', { p_tranche: trancheId, ...(reason ? { p_reason: reason } : {}) }), 'reissueToken');
  }

  /** app_config.eqr_image_enabled (lisible par tout utilisateur connecté). Lot X-C (T9) : absent = image masquée (X1.8). */
  async eqrImageEnabled(): Promise<boolean> {
    const row = unwrapMaybe(await this.sb.from('app_config').select('value').eq('key', 'eqr_image_enabled').maybeSingle(), 'eqrImageEnabled');
    return row?.value === 'true';
  }

  async markReceived(trancheId: string): Promise<void> {
    unwrap(await this.sb.rpc('mark_received', { p_tranche: trancheId }), 'markReceived');
  }

  async requestInfo(trancheId: string, message: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('request_info', { p_tranche: trancheId, p_message: message }), 'requestInfo');
    return this.getTransaction(tr.tx_id);
  }

  async answerInfo(trancheId: string, message: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('answer_info', { p_tranche: trancheId, p_message: message }), 'answerInfo');
    return this.getTransaction(tr.tx_id);
  }

  async rejectRequest(trancheId: string, reason: string): Promise<Transaction> {
    const tr = unwrap(await this.sb.rpc('reject_request', { p_tranche: trancheId, p_reason: reason }), 'rejectRequest');
    return this.getTransaction(tr.tx_id);
  }

  async listMessages(trancheId: string): Promise<RequestMessage[]> {
    const { data } = await this.sb.auth.getSession();
    const rows = unwrap(await this.sb.from('request_messages').select('*').eq('tranche_id', trancheId).order('created_at').order('id'), 'listMessages');
    return rows.map((r) => toMessage(r, data.session?.user.id));
  }

  /** Brouillon vide enregistré avec son rôle de créateur (save_draft vérifie l’autorisation d’un prestataire). */
  async createDraft(input: { vertical: ModuleCode; creatorRole: CreatorRole }): Promise<NeedDraft> {
    return this.saveDraft({ ...emptyDraft(newUuid(), new Date()), vertical: input.vertical, creatorRole: input.creatorRole });
  }

  /** Lot X (X6) : types de besoin (request_modules, lisible par tout utilisateur connecté), dans l’ordre d’affichage. */
  async listModules(): Promise<RequestModule[]> {
    const rows = unwrap(await this.sb.from('request_modules').select('*').order('display_order').order('code'), 'listModules');
    return rows.map(toModule);
  }

  // ——— Lot X v2 (X4) : enrôlement ———

  async getEnrolment(): Promise<EnrolmentView> {
    return toEnrolment(unwrap(await this.sb.rpc('my_enrolment'), 'getEnrolment'));
  }

  async submitEnrolment(input: { level: EnrolmentLevel; documents: EnrolmentDocumentInput[]; data?: Record<string, string> }): Promise<EnrolmentCaseView> {
    const o = unwrap(await this.sb.rpc('submit_enrolment', {
      p_level: input.level, p_documents: input.documents as unknown as Json, p_data: (input.data ?? {}) as Json,
    }), 'submitEnrolment');
    return toEnrolmentCase(o);
  }

  // ——— Temps réel ———

  /**
   * Abonnement aux changements (Realtime, postgres_changes) des tables lues par l’application. Supabase applique
   * la RLS : seules les lignes visibles par l’utilisateur sont notifiées. Renvoie la fonction de désabonnement.
   */
  subscribeChanges(onChange: (table: RealtimeTable) => void, onStatus?: (status: string) => void): () => void {
    const channel = this.sb.channel(`diaspay-${newUuid()}`);
    for (const table of REALTIME_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange(table));
    }
    channel.subscribe((status) => onStatus?.(status));
    return () => { void this.sb.removeChannel(channel); };
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
