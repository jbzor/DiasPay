import {
  DomainError, RELEASE_RULES, canOpenDispute, checkFile, isAutoReleasable, normalizeReference, shouldActivateTranche, shouldCloseTransaction,
  toIsoDate, transitionTranche, transitionTx, validateNeed,
} from '@diaspay/domain';
import type { Actor, DraftDocument, DraftDocumentInput, NeedDraft, TrancheStatus, TxRole, Vertical } from '@diaspay/domain';
import type { AuditEntry, Persona, ReferenceInfo, Tranche, TrancheToken, Transaction, TransactionApi } from './types';
import { ApiError, MemoryDraftStore, SEED_PROVIDERS, foldText, newId } from './need';
import type { AppEvent, DraftStore, ProviderSummary } from './need';

type Listener = () => void;
const HOUR = 3_600_000;
/** Validité d'un TrustToken après l'activation de la tranche (configurable). */
export const TOKEN_VALIDITY_HOURS = 7 * 24;
/** Tolérance sur l'horloge de l'appareil, vers le futur. */
export const MAX_DEVICE_SKEW_MS = 5 * 60_000;
export const SIMULATED_KID = 'SIMULATED';

/** Hachage non cryptographique (FNV-1a 32 bits ×N) : suffit pour des références et signatures de démonstration. */
function hexDigest(input: string, hexLength: number): string {
  let out = '';
  let seed = 0x811c9dc5;
  while (out.length < hexLength) {
    let h = seed;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(16).padStart(8, '0');
    seed = (h + 0x9e3779b9) >>> 0;
  }
  return out.slice(0, hexLength);
}
export interface MockApiOptions {
  tokenValidityHours?: number;
  /** Persistance des brouillons (par défaut en mémoire). */
  drafts?: DraftStore;
  /** Durée simulée de chaque palier de progression d’un envoi (ms). */
  uploadDelayMs?: number;
  /** Probabilité d’échec simulé d’un envoi (0 = jamais). */
  uploadFailureRate?: number;
  random?: () => number;
  providers?: ProviderSummary[];
}

/** Utilisateur connecté vu par la simulation : propriétaire des brouillons et rôle du créateur. */
export interface MockUser { id: string; role: 'PAYER' | 'REQUESTER' | 'PROVIDER' }

/** Bureau de contrôle simulé : validateur non partie au dossier. */
const VALIDATOR: Actor = { kind: 'USER', roles: [], isValidator: true };
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

function actorFor(p: Persona): Actor {
  const roles: TxRole[] = p === 'PAYER' ? ['PAYER'] : ['PROVIDER'];
  return { kind: 'USER', roles, isValidator: false };
}
const SYSTEM: Actor = { kind: 'SYSTEM' };

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;

function mkTranche(seq: number, label: string, amountMinor: number, over: Partial<Tranche> & { vertical: keyof typeof RELEASE_RULES }): Tranche {
  const rule = RELEASE_RULES[over.vertical];
  const { vertical: _v, ...rest } = over;
  return {
    id: uid('tr'), seq, label, amountMinor, status: 'PLANNED',
    releaseMode: rule.releaseMode, contestHours: rule.contestHours, evidenceCount: 0, ...rest,
  };
}

/** Jeu de données de démonstration aligné sur les maquettes validées. */
export function seedTransactions(now: Date): Transaction[] {
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const school: Transaction = {
    id: 'tx-school', vertical: 'EDUCATION', purpose: 'Scolarité 2026-2027',
    amount: { amountMinor: 900_000, currency: 'XAF' }, status: 'IN_PROGRESS',
    providerName: 'École Les Palmiers', beneficiaryName: 'Aïcha N.', createdAt: iso(-30 * 24 * HOUR),
    tranches: [
      mkTranche(1, 'Inscription', 300_000, { vertical: 'EDUCATION', status: 'CONFIRMED', dueDate: '2026-10-15', contestEndsAt: iso(48 * HOUR), reference: '4f9a2c71b8e01d3ca9' }),
      mkTranche(2, 'Scolarité T1', 300_000, { vertical: 'EDUCATION', status: 'AWAITING_PAYMENT', dueDate: '2026-11-15', reference: '7b31d0a9c5e24f8a61' }),
      mkTranche(3, 'Scolarité T2', 300_000, { vertical: 'EDUCATION', status: 'PLANNED', dueDate: '2027-01-15' }),
    ],
  };
  const health: Transaction = {
    id: 'tx-health', vertical: 'HEALTH', purpose: 'Opération du genou',
    amount: { amountMinor: 180_000, currency: 'XAF' }, status: 'IN_REVIEW',
    providerName: 'Hôpital Central', beneficiaryName: 'Rose M.', createdAt: iso(-1 * 24 * HOUR),
    tranches: [mkTranche(1, 'Soins', 180_000, { vertical: 'HEALTH', dueDate: '2026-11-20' })],
  };
  const rent: Transaction = {
    id: 'tx-rent', vertical: 'RENT', purpose: 'Loyer studio',
    amount: { amountMinor: 1_800_000, currency: 'XAF' }, status: 'IN_PROGRESS',
    providerName: 'Studio Bastos', beneficiaryName: 'Marie N.', createdAt: iso(-100 * 24 * HOUR),
    tranches: Array.from({ length: 12 }, (_, i) =>
      mkTranche(i + 1, `Loyer ${i + 1}`, 150_000, {
        vertical: 'RENT', dueDate: `${2026 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, '0')}-05`,
        status: i < 3 ? 'RELEASED' : i === 3 ? 'AWAITING_PAYMENT' : 'PLANNED',
        reference: i === 3 ? 'a1c4e8f20b937d52e6' : undefined,
      })),
  };
  const land: Transaction = {
    id: 'tx-land', vertical: 'LAND', purpose: 'Parcelle Nkolbisson',
    amount: { amountMinor: 12_500_000, currency: 'XAF' }, status: 'IN_PROGRESS',
    providerName: 'Étude notariale Mbarga', beneficiaryName: 'Jean K.', createdAt: iso(-60 * 24 * HOUR),
    tranches: [
      mkTranche(1, 'Promesse de vente', 2_500_000, { vertical: 'LAND', status: 'RELEASED' }),
      mkTranche(2, 'Signature de l’acte notarié', 4_000_000, { vertical: 'LAND', status: 'EVIDENCE_SUBMITTED', evidenceCount: 1 }),
      mkTranche(3, 'Remise du titre foncier', 6_000_000, { vertical: 'LAND' }),
    ],
  };
  const agro: Transaction = {
    id: 'tx-agro', vertical: 'AGRO', purpose: 'Semences', amount: { amountMinor: 450_000, currency: 'XAF' },
    status: 'DRAFT', providerName: 'Coopérative Agri-Plus', beneficiaryName: 'Paul T.', createdAt: iso(-2 * HOUR),
    tranches: [mkTranche(1, 'Livraison', 450_000, { vertical: 'AGRO' })],
  };
  return [school, health, rent, land, agro];
}

export class MockApi implements TransactionApi {
  private txs: Transaction[];
  private log: Record<string, AuditEntry[]> = {};
  private listeners = new Set<Listener>();
  persona: Persona = 'PAYER';

  private tokens = new Map<string, TrancheToken>();
  private readonly validityMs: number;
  private visible: Transaction[] = [];
  private readonly drafts: DraftStore;
  private readonly providers: ProviderSummary[];
  private readonly uploadDelayMs: number;
  private readonly uploadFailureRate: number;
  private readonly random: () => number;
  /** Instantané des brouillons soumis, pour les rouvrir en correction. */
  private readonly submitted = new Map<string, NeedDraft>();
  private readonly events: AppEvent[] = [];
  user: MockUser | null = null;

  constructor(private readonly clock: () => Date = () => new Date(), seed?: Transaction[], options: MockApiOptions = {}) {
    this.txs = seed ?? seedTransactions(clock());
    this.validityMs = (options.tokenValidityHours ?? TOKEN_VALIDITY_HOURS) * HOUR;
    this.drafts = options.drafts ?? new MemoryDraftStore();
    this.providers = options.providers ?? SEED_PROVIDERS;
    this.uploadDelayMs = options.uploadDelayMs ?? 0;
    this.uploadFailureRate = options.uploadFailureRate ?? 0;
    this.random = options.random ?? Math.random;
    this.refreshVisible();
    for (const tx of this.txs) for (const tr of tx.tranches) if (tr.status !== 'PLANNED') this.ensureToken(tr);
  }

  /** Crée le jeton d'une tranche activée (idempotent). Expire 7 jours après l'activation ; les tranches déjà confirmées ou débloquées ont un jeton utilisé. */
  private ensureToken(tr: Tranche): TrancheToken {
    const existing = this.tokens.get(tr.id);
    if (existing) return existing;
    const taken = new Set(this.txs.flatMap((x) => x.tranches.map((r) => r.reference)).filter(Boolean));
    let reference = tr.reference ? normalizeReference(tr.reference) : '';
    for (let n = 0; !reference || (!tr.reference && taken.has(reference)); n++) reference = hexDigest(`${tr.id}#${n}`, 18);
    tr.reference = reference;
    const now = this.clock();
    const token: TrancheToken = {
      trancheId: tr.id, reference, kid: SIMULATED_KID, signature: `SIMULATED.${hexDigest(`sig:${reference}`, 32)}`, simulated: true,
      expiresAt: new Date(now.getTime() + this.validityMs).toISOString(),
      usedAt: tr.status === 'CONFIRMED' || tr.status === 'RELEASED' ? now.toISOString() : undefined,
    };
    this.tokens.set(tr.id, token);
    return token;
  }

  private isParty(tx: Transaction): boolean { return !tx.parties || tx.parties.includes(this.persona); }

  private byReference(reference: string): { tx: Transaction; tr: Tranche; token: TrancheToken } {
    let ref: string;
    try { ref = normalizeReference(reference); } catch { throw new DomainError('UNKNOWN_REFERENCE', 'Référence inconnue'); }
    for (const tx of this.txs) {
      for (const tr of tx.tranches) {
        if (tr.status === 'PLANNED') continue;
        const token = this.ensureToken(tr);
        if (token.reference === ref) return { tx, tr, token };
      }
    }
    throw new DomainError('UNKNOWN_REFERENCE', 'Référence inconnue');
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  /** Les brouillons ne sont jamais visibles comme transactions (y compris un dossier rouvert en correction). */
  getSnapshot = (): readonly Transaction[] => this.visible;
  private refreshVisible(): void { this.visible = this.txs.filter((t) => t.status !== 'DRAFT'); }
  setPersona(p: Persona): void { this.persona = p; this.emit(); }
  private emit(): void { this.txs = [...this.txs]; this.refreshVisible(); this.listeners.forEach((l) => l()); }
  setUser(user: MockUser | null): void { this.user = user; this.emit(); }
  private record(txId: string, event: string, trancheId?: string, detail?: string): void {
    (this.log[txId] ??= []).push({ at: this.clock().toISOString(), event, trancheId, detail });
  }

  private find(trancheId: string): { tx: Transaction; tr: Tranche } {
    for (const tx of this.txs) {
      const tr = tx.tranches.find((t) => t.id === trancheId);
      if (tr) return { tx, tr };
    }
    throw new DomainError('NOT_FOUND', 'Tranche introuvable');
  }

  private apply(trancheId: string, to: TrancheStatus, actor: Actor, event: string): Transaction {
    const { tx, tr } = this.find(trancheId);
    if (tx.status !== 'IN_PROGRESS') throw new DomainError('TX_NOT_ACTIVE', 'La transaction n’est pas active');
    const now = this.clock();
    const res = transitionTranche({
      status: tr.status, releaseMode: tr.releaseMode, contestHours: tr.contestHours,
      contestEndsAt: tr.contestEndsAt ? new Date(tr.contestEndsAt) : undefined,
      hasEvidence: tr.evidenceCount > 0,
    }, to, actor, now);
    tr.status = res.status;
    tr.contestEndsAt = res.contestEndsAt?.toISOString();
    if (to === 'RELEASED') tr.releasedAt = now.toISOString();
    this.record(tx.id, event, tr.id, `${tr.label} → ${to}`);
    if (shouldCloseTransaction(tx.tranches.map((t) => t.status))) {
      tx.status = 'CLOSED';
      this.record(tx.id, 'TX_CLOSED');
    }
    this.emit();
    return tx;
  }

  async listTransactions() { return this.visible; }
  async getTransaction(id: string) {
    const tx = this.txs.find((t) => t.id === id);
    if (!tx) throw new DomainError('NOT_FOUND', 'Transaction introuvable');
    return tx;
  }
  async payTranche(trancheId: string) {
    const { tr } = this.find(trancheId);
    if (tr.status !== 'AWAITING_PAYMENT') throw new DomainError('NOT_PAYABLE', 'Cette tranche n’est pas à payer');
    return this.apply(trancheId, 'PAID_LOCKED', SYSTEM, 'PAYMENT_SIMULATED');
  }
  async getTranche(trancheId: string) {
    const { tx, tr } = this.find(trancheId);
    return { tx, tranche: tr };
  }
  async getToken(trancheId: string): Promise<TrancheToken> {
    const { tr } = this.find(trancheId);
    if (tr.status === 'PLANNED') throw new DomainError('NO_TOKEN', 'Aucun jeton : la tranche n’est pas encore active');
    return { ...this.ensureToken(tr) };
  }
  async resolveReference(reference: string): Promise<ReferenceInfo> {
    const { tx, tr, token } = this.byReference(reference);
    if (!this.isParty(tx)) throw new DomainError('NOT_A_PARTY', 'Vous n’êtes pas partie à cette transaction');
    return {
      trancheId: tr.id, txId: tx.id, label: tr.label, amountMinor: tr.amountMinor, currency: tx.amount.currency,
      status: tr.status, expiresAt: token.expiresAt, used: !!token.usedAt, providerName: tx.providerName,
      beneficiaryName: tx.beneficiaryName, purpose: tx.purpose, seq: tr.seq, contestHours: tr.contestHours,
    };
  }
  /** Miroir de confirm_by_reference(). */
  async confirmByReference(reference: string, deviceTime?: string) {
    const { tx, tr, token } = this.byReference(reference);
    if (!this.isParty(tx)) throw new DomainError('NOT_A_PARTY', 'Vous n’êtes pas partie à cette transaction');
    if (this.persona !== 'PROVIDER') throw new DomainError('PROVIDER_ONLY', 'Réservé au prestataire');
    if (token.usedAt) throw new DomainError('TOKEN_USED', 'Ce jeton a déjà été utilisé');
    const now = this.clock();
    const device = deviceTime === undefined ? now : new Date(deviceTime);
    if (Number.isNaN(device.getTime()) || device.getTime() > now.getTime() + MAX_DEVICE_SKEW_MS) {
      throw new DomainError('DEVICE_TIME_INVALID', 'L’heure de l’appareil est incorrecte');
    }
    if (device.getTime() > new Date(token.expiresAt).getTime()) throw new DomainError('TOKEN_EXPIRED', 'Ce jeton a expiré');
    if (tr.status !== 'PAID_LOCKED') throw new DomainError('NOT_PAID', `Tranche non payée ou déjà traitée (${tr.status})`);
    if (tr.releaseMode !== 'PROVIDER_CONFIRM') throw new DomainError('WRONG_MODE', 'Cette tranche ne se confirme pas par scan');
    const res = this.apply(tr.id, 'CONFIRMED', actorFor('PROVIDER'), 'PROVIDER_SCAN');
    token.usedAt = now.toISOString();
    return res;
  }
  async approveRelease(trancheId: string) {
    return this.apply(trancheId, 'RELEASED', actorFor(this.persona), 'PAYER_APPROVAL');
  }
  async openDispute(trancheId: string, reason: string) {
    const { tx, tr } = this.find(trancheId);
    if (reason.trim().length < 10) throw new DomainError('REASON_TOO_SHORT', 'Décrivez le problème (10 caractères minimum)');
    const ok = canOpenDispute({
      status: tr.status, releaseMode: tr.releaseMode, contestHours: tr.contestHours,
      contestEndsAt: tr.contestEndsAt ? new Date(tr.contestEndsAt) : undefined,
    }, actorFor(this.persona).kind === 'USER' ? (this.persona === 'PAYER' ? ['PAYER'] : ['PROVIDER']) : [], this.clock());
    if (!ok) throw new DomainError('DISPUTE_NOT_ALLOWED', 'Litige impossible (état ou délai de contestation écoulé)');
    tr.status = 'DISPUTED';
    this.record(tx.id, 'DISPUTE_OPENED', tr.id, reason);
    this.emit();
    return tx;
  }
  async timeline(txId: string) { return this.log[txId] ?? []; }

  // ——— Lot 3 : création d’un besoin ———

  private today(): string { return toIsoDate(this.clock()); }
  private requireUser(): MockUser {
    if (!this.user) throw new ApiError('NOT_AUTHENTICATED', 'Aucun utilisateur connecté');
    return this.user;
  }
  private creatorActor(): Actor {
    const role = this.requireUser().role;
    return { kind: 'USER', roles: [role === 'REQUESTER' ? 'REQUESTER' : role === 'PROVIDER' ? 'PROVIDER' : 'PAYER'], isValidator: false };
  }
  private async ownDraft(id: string): Promise<NeedDraft> {
    const user = this.requireUser();
    const d = await this.drafts.get(id);
    if (!d || (d.ownerId && d.ownerId !== user.id)) throw new ApiError('NOT_FOUND', 'Brouillon introuvable');
    return d;
  }

  async searchProviders(query: string, vertical: Vertical): Promise<ProviderSummary[]> {
    const q = foldText(query);
    return this.providers
      .filter((p) => p.verticals.includes(vertical))
      .filter((p) => !q || foldText(p.name).includes(q) || foldText(p.city).includes(q))
      .map((p) => ({ ...p, verticals: [...p.verticals] }));
  }

  async listDrafts(): Promise<NeedDraft[]> {
    if (!this.user) return [];
    const uid = this.user.id;
    return (await this.drafts.list()).filter((d) => d.ownerId === uid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getDraft(id: string): Promise<NeedDraft> { return this.ownDraft(id); }

  async saveDraft(draft: NeedDraft): Promise<NeedDraft> {
    const user = this.requireUser();
    const existing = await this.drafts.get(draft.id);
    if ((existing?.ownerId && existing.ownerId !== user.id) || (draft.ownerId && draft.ownerId !== user.id)) {
      throw new ApiError('NOT_FOUND', 'Brouillon introuvable');
    }
    const saved: NeedDraft = { ...draft, ownerId: user.id, updatedAt: this.clock().toISOString() };
    await this.drafts.put(saved);
    this.emit();
    return saved;
  }

  async deleteDraft(id: string): Promise<void> {
    const d = await this.ownDraft(id);
    await this.drafts.remove(id);
    // Supprimer une correction abandonne le dossier : il reste au statut DRAFT (aucune transition DRAFT → REJECTED), donc masqué.
    if (d.correctionOf) this.record(d.correctionOf, 'CORRECTION_ABANDONED');
    this.emit();
  }

  async attachDocument(draftId: string, file: DraftDocumentInput, onProgress?: (p: number) => void): Promise<DraftDocument> {
    const mimeType = checkFile(file);
    await this.ownDraft(draftId);
    for (const p of [0.1, 0.35, 0.6, 0.85]) { onProgress?.(p); await sleep(this.uploadDelayMs); }
    if (this.uploadFailureRate > 0 && this.random() < this.uploadFailureRate) {
      throw new ApiError('UPLOAD_FAILED', 'L’envoi a échoué');
    }
    const doc: DraftDocument = {
      id: file.id ?? newId('doc'), kind: file.kind, name: file.name, mimeType, sizeBytes: file.sizeBytes, uri: file.uri,
      status: 'UPLOADED', uploadedAt: this.clock().toISOString(),
    };
    const d = await this.ownDraft(draftId); // relu : le brouillon a pu changer pendant l’envoi
    await this.drafts.put({ ...d, documents: [...d.documents.filter((x) => x.id !== doc.id), doc] });
    onProgress?.(1);
    this.emit();
    return doc;
  }

  async removeDocument(draftId: string, documentId: string): Promise<void> {
    const d = await this.ownDraft(draftId);
    await this.drafts.put({ ...d, documents: d.documents.filter((x) => x.id !== documentId) });
    this.emit();
  }

  /** Valide tout le dossier avec les règles du domaine, puis DRAFT → SUBMITTED → IN_REVIEW. */
  async submitNeed(draftId: string): Promise<Transaction> {
    const user = this.requireUser();
    const draft = await this.ownDraft(draftId);
    const issues = validateNeed(draft, { today: this.today(), creatorRole: user.role });
    // Une verticale absente ou indisponible prime : le reste du dossier n’a pas de sens sans elle.
    if (issues.some((i) => i.path === 'vertical')) throw new ApiError('VALIDATION', 'Dossier incomplet', { issues });
    const sum = issues.find((i) => i.code === 'PLAN_SUM_MISMATCH');
    if (sum) throw new ApiError('PLAN_SUM_MISMATCH', 'La somme des tranches ne correspond pas au montant', { ...sum.params });
    const missing = issues.find((i) => i.code === 'DOCUMENT_REQUIRED');
    if (missing) throw new ApiError('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', { kind: missing.params?.kind });
    if (issues.length) throw new ApiError('VALIDATION', 'Dossier incomplet', { issues });

    const vertical = draft.vertical as Vertical;
    const tranches = draft.tranches ?? [];
    const totalMinor = draft.amountMinor as number;
    const uploaded = draft.documents.filter((d) => d.status === 'UPLOADED');
    const previous = draft.correctionOf ? this.txs.find((t) => t.id === draft.correctionOf && t.status === 'DRAFT') : undefined;
    // Contexte de soumission réel : plan et pièces (le domaine lève PLAN_SUM_MISMATCH ou TX_NO_DOCUMENT).
    let status = transitionTx(previous?.status ?? 'DRAFT', 'SUBMITTED', this.creatorActor(), {
      totalMinor, tranches, hasSupportingDocument: uploaded.length > 0,
    });
    status = transitionTx(status, 'IN_REVIEW', VALIDATOR);

    const now = this.clock().toISOString();
    const tx: Transaction = previous ?? ({ id: newId('tx') } as Transaction);
    Object.assign(tx, {
      vertical, purpose: (draft.purpose ?? '').trim(), amount: { amountMinor: totalMinor, currency: draft.currency ?? 'XAF' },
      status, providerName: draft.provider?.name ?? '', beneficiaryName: (draft.beneficiaryName ?? '').trim(),
      tranches: tranches.map((t, i) => mkTranche(i + 1, t.label.trim(), t.amountMinor, { vertical, dueDate: t.dueDate })),
      createdAt: previous?.createdAt ?? now, submittedAt: now, planType: draft.planType, documentCount: uploaded.length,
      ownerId: user.id, rejectionReason: undefined,
    } satisfies Partial<Transaction>);
    if (!previous) this.txs.push(tx);
    this.submitted.set(tx.id, { ...draft, correctionOf: undefined, rejectionReason: undefined });
    await this.drafts.remove(draft.id);
    this.record(tx.id, previous ? 'NEED_RESUBMITTED' : 'NEED_SUBMITTED');
    this.record(tx.id, 'REVIEW_STARTED');
    this.emit();
    return tx;
  }

  /** Dossier rejeté → brouillon de correction (REJECTED → DRAFT par le domaine). */
  async reopenForCorrection(txId: string): Promise<NeedDraft> {
    const user = this.requireUser();
    const tx = await this.getTransaction(txId);
    if (tx.ownerId && tx.ownerId !== user.id) throw new ApiError('NOT_FOUND', 'Transaction introuvable');
    if (tx.status !== 'REJECTED') throw new ApiError('NOT_REJECTED', 'Seul un dossier rejeté se corrige');
    const reason = tx.rejectionReason;
    tx.status = transitionTx(tx.status, 'DRAFT', this.creatorActor());
    const snap = this.submitted.get(txId);
    const draft: NeedDraft = {
      ...(snap ?? {
        vertical: tx.vertical, amountMinor: tx.amount.amountMinor, currency: tx.amount.currency, purpose: tx.purpose,
        beneficiaryName: tx.beneficiaryName, provider: { name: tx.providerName }, planType: tx.planType,
        tranches: tx.tranches.map((t) => ({ label: t.label, amountMinor: t.amountMinor, dueDate: t.dueDate })), documents: [],
      }),
      id: newId('need'), ownerId: user.id, updatedAt: this.clock().toISOString(), step: 'recap', correctionOf: tx.id, rejectionReason: reason,
    };
    await this.drafts.put(draft);
    this.record(tx.id, 'REOPENED_FOR_CORRECTION');
    this.emit();
    return draft;
  }

  /**
   * Mode démonstration : le bureau de contrôle simulé décide.
   * Approbation : VALIDATED → TOKEN_ISSUED → IN_PROGRESS, première tranche activée selon RG-12. Rejet : REJECTED avec motif.
   */
  async simulateReview(txId: string, decision: { approved: boolean; reason?: string }): Promise<Transaction> {
    const tx = await this.getTransaction(txId);
    if (!decision.approved) {
      const reason = decision.reason?.trim() ?? '';
      if (reason.length < 3) throw new ApiError('REASON_REQUIRED', 'Motif du rejet obligatoire');
      tx.status = transitionTx(tx.status, 'REJECTED', VALIDATOR);
      tx.rejectionReason = reason;
      this.record(tx.id, 'NEED_REJECTED', undefined, reason);
      this.events.push({ id: newId('ev'), at: this.clock().toISOString(), kind: 'NEED_REJECTED', txId, reason });
      this.emit();
      return tx;
    }
    tx.status = transitionTx(tx.status, 'VALIDATED', VALIDATOR);
    tx.status = transitionTx(tx.status, 'TOKEN_ISSUED', SYSTEM);
    tx.status = transitionTx(tx.status, 'IN_PROGRESS', SYSTEM);
    const first = tx.tranches[0];
    if (first && first.status === 'PLANNED' && shouldActivateTranche(first.dueDate, this.today())) {
      first.status = transitionTranche({ status: first.status, releaseMode: first.releaseMode, contestHours: first.contestHours }, 'AWAITING_PAYMENT', SYSTEM, this.clock()).status;
      this.ensureToken(first);
      this.record(tx.id, 'TRANCHE_ACTIVATED', first.id);
    }
    this.record(tx.id, 'NEED_VALIDATED');
    this.events.push({ id: newId('ev'), at: this.clock().toISOString(), kind: 'NEED_VALIDATED', txId });
    this.emit();
    return tx;
  }

  /** Événements préparés pour les alertes (lot suivant). */
  listEvents(): readonly AppEvent[] { return [...this.events]; }

  /** Équivalent de release_due_tranches() côté serveur. Retourne le nombre de tranches débloquées. */
  runTimers(): number {
    const now = this.clock();
    let n = 0;
    for (const tx of this.txs) {
      for (const tr of tx.tranches) {
        const st = { status: tr.status, releaseMode: tr.releaseMode, contestHours: tr.contestHours,
          contestEndsAt: tr.contestEndsAt ? new Date(tr.contestEndsAt) : undefined };
        if (isAutoReleasable(st, now)) { this.apply(tr.id, 'RELEASED', SYSTEM, 'AUTO_RELEASE'); n++; }
      }
    }
    return n;
  }
}
