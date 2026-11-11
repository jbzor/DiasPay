import {
  DomainError, RELEASE_RULES, appendEntry, canOpenDispute, checkFile, checkFileCount, formatReference, isAutoReleasable, normalizeReference,
  resolveDisputeTransition, shouldActivateTranche, shouldCloseTransaction, toIsoDate, transitionTranche, transitionTx, validateNeed, verifyChain,
  validatorDecisionError,
} from '@diaspay/domain';
import type { Actor, ChainedAuditEntry, DisputeOutcome, DraftDocument, DraftDocumentInput, NeedDraft, TrancheStatus, TxRole, Vertical } from '@diaspay/domain';
import type {
  AppNotification, AuditEntry, DisputeView, NotificationEvent, Persona, Receipt, ReferenceInfo, Tranche, TrancheToken, Transaction, TransactionApi,
} from './types';
import { ApiError, MemoryDraftStore, SEED_PROVIDERS, foldText, newId } from './need';
import type { DraftStore, ProviderSummary, StateStore } from './need';

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
  /** Persistance de l’état du simulateur (transactions, alertes, journal, litiges). Absent = mémoire seule. */
  state?: StateStore;
  /** Anti-rebond de l’enregistrement de l’état (ms). */
  stateSaveDelayMs?: number;
  /** Alertes de démonstration au démarrage (défaut : oui). */
  seedNotifications?: boolean;
}

/** Version de l’instantané : un instantané d’une autre version est ignoré (on repart du jeu de démonstration). */
export const STATE_VERSION = 1;

interface Snapshot {
  version: number;
  savedAt: string;
  txs: Transaction[];
  chains: Record<string, ChainedAuditEntry[]>;
  anchors: Record<string, { count: number; lastHash: string }>;
  notifications: AppNotification[];
  disputes: Record<string, DisputeView>;
  tokens: TrancheToken[];
  submitted: Array<[string, NeedDraft]>;
}

/** Utilisateur connecté vu par la simulation : propriétaire des brouillons et rôle du créateur. */
export interface MockUser { id: string; role: 'PAYER' | 'REQUESTER' | 'PROVIDER'; name?: string }

/** Bureau de contrôle simulé : validateur non partie au dossier. */
const VALIDATOR: Actor = { kind: 'USER', roles: [], isValidator: true };
/** Administrateur simulé, non partie (RG-09 : seul un administrateur tranche un litige). */
const ADMIN: Actor = { kind: 'USER', roles: [], isValidator: true, isAdmin: true };
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
    payerName: 'Marie N.', providerName: 'École Les Palmiers', beneficiaryName: 'Aïcha N.', createdAt: iso(-30 * 24 * HOUR),
    tranches: [
      mkTranche(1, 'Inscription', 300_000, { vertical: 'EDUCATION', status: 'CONFIRMED', dueDate: '2026-10-15', contestEndsAt: iso(48 * HOUR), reference: '4f9a2c71b8e01d3ca9' }),
      mkTranche(2, 'Scolarité T1', 300_000, { vertical: 'EDUCATION', status: 'AWAITING_PAYMENT', dueDate: '2026-11-15', reference: '7b31d0a9c5e24f8a61' }),
      mkTranche(3, 'Scolarité T2', 300_000, { vertical: 'EDUCATION', status: 'PLANNED', dueDate: '2027-01-15' }),
    ],
  };
  const health: Transaction = {
    id: 'tx-health', vertical: 'HEALTH', purpose: 'Opération du genou',
    amount: { amountMinor: 180_000, currency: 'XAF' }, status: 'IN_REVIEW',
    payerName: 'Marie N.', providerName: 'Hôpital Central', beneficiaryName: 'Rose M.', createdAt: iso(-1 * 24 * HOUR),
    tranches: [mkTranche(1, 'Soins', 180_000, { vertical: 'HEALTH', dueDate: '2026-11-20' })],
  };
  const rent: Transaction = {
    id: 'tx-rent', vertical: 'RENT', purpose: 'Loyer studio',
    amount: { amountMinor: 1_800_000, currency: 'XAF' }, status: 'IN_PROGRESS',
    payerName: 'Marie N.', providerName: 'Studio Bastos', beneficiaryName: 'Marie N.', createdAt: iso(-100 * 24 * HOUR),
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
    payerName: 'Marie N.', providerName: 'Étude notariale Mbarga', beneficiaryName: 'Jean K.', createdAt: iso(-60 * 24 * HOUR),
    tranches: [
      mkTranche(1, 'Promesse de vente', 2_500_000, { vertical: 'LAND', status: 'RELEASED' }),
      mkTranche(2, 'Signature de l’acte notarié', 4_000_000, { vertical: 'LAND', status: 'EVIDENCE_SUBMITTED', evidenceCount: 1 }),
      mkTranche(3, 'Remise du titre foncier', 6_000_000, { vertical: 'LAND' }),
    ],
  };
  const agro: Transaction = {
    id: 'tx-agro', vertical: 'AGRO', purpose: 'Semences', amount: { amountMinor: 450_000, currency: 'XAF' },
    status: 'DRAFT', payerName: 'Marie N.', providerName: 'Coopérative Agri-Plus', beneficiaryName: 'Paul T.', createdAt: iso(-2 * HOUR),
    tranches: [mkTranche(1, 'Livraison', 450_000, { vertical: 'AGRO' })],
  };
  // Une tranche débloquée du jeu de démonstration a sa date de déblocage (nécessaire au reçu).
  for (const tx of [school, health, rent, land, agro]) {
    for (const tr of tx.tranches) {
      if (tr.status === 'RELEASED' && !tr.releasedAt) tr.releasedAt = tr.dueDate ? `${tr.dueDate}T14:00:00.000Z` : iso(-20 * 24 * HOUR);
    }
  }
  return [school, health, rent, land, agro];
}

export class MockApi implements TransactionApi {
  private txs: Transaction[];
  /** Journal chaîné par transaction, et ancre (nombre de lignes et dernière empreinte) tenue « côté serveur ». */
  private chains: Record<string, ChainedAuditEntry[]> = {};
  private anchors: Record<string, { count: number; lastHash: string }> = {};
  private notifications: AppNotification[] = [];
  private disputes: Record<string, DisputeView> = {};
  private readonly stateStore?: StateStore;
  private readonly stateSaveDelayMs: number;
  private readonly seedNotifs: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
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
  private submitted = new Map<string, NeedDraft>();
  user: MockUser | null = null;

  constructor(private readonly clock: () => Date = () => new Date(), seed?: Transaction[], options: MockApiOptions = {}) {
    this.txs = seed ?? seedTransactions(clock());
    this.validityMs = (options.tokenValidityHours ?? TOKEN_VALIDITY_HOURS) * HOUR;
    this.drafts = options.drafts ?? new MemoryDraftStore();
    this.providers = options.providers ?? SEED_PROVIDERS;
    this.uploadDelayMs = options.uploadDelayMs ?? 0;
    this.uploadFailureRate = options.uploadFailureRate ?? 0;
    this.random = options.random ?? Math.random;
    this.stateStore = options.state;
    this.stateSaveDelayMs = options.stateSaveDelayMs ?? 500;
    this.seedNotifs = options.seedNotifications ?? true;
    this.initSeed(seed === undefined);
  }

  /** Jetons, journal et alertes du jeu de démonstration. */
  private initSeed(withNotifications: boolean): void {
    this.refreshVisible();
    for (const tx of this.txs) {
      this.record(tx.id, 'DEMO_SEED', undefined, tx.status);
      for (const tr of tx.tranches) {
        if (tr.status !== 'PLANNED') { this.ensureToken(tr); this.record(tx.id, 'DEMO_SEED', tr.id, tr.status); }
      }
    }
    if (!withNotifications || !this.seedNotifs) return;
    const at = (h: number) => new Date(this.clock().getTime() - h * HOUR).toISOString();
    const school = this.txs.find((t) => t.id === 'tx-school');
    const rent = this.txs.find((t) => t.id === 'tx-rent');
    if (school?.tranches[0] && school.tranches[1]) {
      this.pushNotification({ type: 'TRANCHE_CONFIRMED', txId: school.id, trancheId: school.tranches[0].id, releaseAt: school.tranches[0].contestEndsAt }, at(1), false);
      this.pushNotification({ type: 'PAYMENT_READY', txId: school.id, trancheId: school.tranches[1].id }, at(3), false);
    }
    const released = rent?.tranches.filter((t) => t.status === 'RELEASED').at(-1);
    if (rent && released) this.pushNotification({ type: 'TRANCHE_RELEASED', txId: rent.id, trancheId: released.id }, at(26), false);
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
  private emit(): void { this.txs = [...this.txs]; this.refreshVisible(); this.listeners.forEach((l) => l()); this.scheduleSave(); }
  setUser(user: MockUser | null): void { this.user = user; this.emit(); }
  /** Ajoute une ligne au journal chaîné de la transaction et met à jour l’ancre. */
  private record(txId: string, event: string, trancheId?: string, detail?: string, actor = 'system'): void {
    const chain = appendEntry(this.chains[txId] ?? [], { at: this.clock().toISOString(), actor, event, txId, trancheId, detail });
    this.chains[txId] = chain;
    const last = chain[chain.length - 1] as ChainedAuditEntry;
    this.anchors[txId] = { count: chain.length, lastHash: last.hash };
  }

  private pushNotification(event: NotificationEvent, at: string, audit = true): void {
    this.notifications.push({ id: newId('nt'), event, at });
    if (audit) this.record(event.txId, event.type, 'trancheId' in event ? event.trancheId : undefined, 'reason' in event ? event.reason : 'outcome' in event ? event.outcome : undefined);
  }
  /** Chaque événement crée une alerte et une ligne du journal chaîné. */
  private notify(event: NotificationEvent): void { this.pushNotification(event, this.clock().toISOString()); }

  private snapshot(): Snapshot {
    return {
      version: STATE_VERSION, savedAt: this.clock().toISOString(), txs: this.txs, chains: this.chains, anchors: this.anchors,
      notifications: this.notifications, disputes: this.disputes, tokens: [...this.tokens.values()], submitted: [...this.submitted],
    };
  }
  private scheduleSave(): void {
    if (!this.stateStore) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.flushState(); }, this.stateSaveDelayMs);
  }
  /** Enregistre l’état tout de suite (fin de test, mise en arrière-plan). */
  async flushState(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.stateStore) await this.stateStore.save(JSON.parse(JSON.stringify(this.snapshot())));
  }
  /**
   * Recharge l’état enregistré. Renvoie false (et garde le jeu de démonstration) si rien n’est enregistré
   * ou si l’instantané est d’une autre version ou illisible.
   */
  async hydrate(): Promise<boolean> {
    if (!this.stateStore) return false;
    let raw: unknown;
    try { raw = await this.stateStore.load(); } catch { raw = null; }
    const snap = raw as Partial<Snapshot> | null;
    if (!snap || snap.version !== STATE_VERSION || !Array.isArray(snap.txs) || !snap.chains || !Array.isArray(snap.notifications)) {
      if (snap) await this.stateStore.clear().catch(() => undefined);
      return false;
    }
    this.txs = snap.txs;
    this.chains = snap.chains;
    this.anchors = snap.anchors ?? {};
    this.notifications = snap.notifications;
    this.disputes = snap.disputes ?? {};
    this.tokens = new Map((snap.tokens ?? []).map((t) => [t.trancheId, t]));
    this.submitted = new Map(snap.submitted ?? []);
    this.refreshVisible();
    this.listeners.forEach((l) => l());
    return true;
  }
  /** Repart du jeu de démonstration : transactions, alertes, journal, litiges et brouillons effacés. */
  async resetDemoData(): Promise<void> {
    this.txs = seedTransactions(this.clock());
    this.chains = {}; this.anchors = {}; this.notifications = []; this.disputes = {};
    this.tokens = new Map(); this.submitted = new Map();
    this.initSeed(true);
    for (const d of await this.drafts.list()) await this.drafts.remove(d.id);
    await this.stateStore?.clear();
    this.emit();
  }

  /** Test uniquement : modifie une ligne du journal, pour vérifier que la falsification est détectée. */
  tamperAuditForTest(txId: string, seq: number, patch: Partial<ChainedAuditEntry>): void {
    const chain = this.chains[txId];
    const i = (chain ?? []).findIndex((e) => e.seq === seq);
    if (chain && i >= 0) chain[i] = { ...(chain[i] as ChainedAuditEntry), ...patch };
  }

  private find(trancheId: string): { tx: Transaction; tr: Tranche } {
    for (const tx of this.txs) {
      const tr = tx.tranches.find((t) => t.id === trancheId);
      if (tr) return { tx, tr };
    }
    throw new DomainError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
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
    this.record(tx.id, event, tr.id, `${tr.label} → ${to}`, actor.kind === 'SYSTEM' ? 'system' : actor.roles.join('+').toLowerCase());
    if (to === 'CONFIRMED') this.notify({ type: 'TRANCHE_CONFIRMED', txId: tx.id, trancheId: tr.id, releaseAt: tr.contestEndsAt });
    if (to === 'RELEASED') this.notify({ type: 'TRANCHE_RELEASED', txId: tx.id, trancheId: tr.id });
    this.closeIfDone(tx);
    this.emit();
    return tx;
  }

  private closeIfDone(tx: Transaction): void {
    if (tx.status === 'IN_PROGRESS' && shouldCloseTransaction(tx.tranches.map((t) => t.status))) {
      tx.status = transitionTx(tx.status, 'CLOSED', SYSTEM);
      this.record(tx.id, 'TX_CLOSED');
    }
  }

  async listTransactions() { return this.visible; }
  async getTransaction(id: string) {
    const tx = this.txs.find((t) => t.id === id);
    if (!tx) throw new DomainError('TX_NOT_FOUND', 'Transaction introuvable');
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
  async openDispute(trancheId: string, reason: string, description?: string) {
    const { tx, tr } = this.find(trancheId);
    const text = (description ?? reason).trim();
    if (text.length < 10) throw new DomainError('REASON_TOO_SHORT', 'Décrivez le problème (10 caractères minimum)');
    const ok = canOpenDispute({
      status: tr.status, releaseMode: tr.releaseMode, contestHours: tr.contestHours,
      contestEndsAt: tr.contestEndsAt ? new Date(tr.contestEndsAt) : undefined,
    }, actorFor(this.persona).kind === 'USER' ? (this.persona === 'PAYER' ? ['PAYER'] : ['PROVIDER']) : [], this.clock());
    if (!ok) throw new DomainError('DISPUTE_NOT_ALLOWED', 'Litige impossible (état ou délai de contestation écoulé)');
    tr.status = 'DISPUTED';
    const openedBy = this.persona === 'PROVIDER' ? 'PROVIDER' : 'PAYER';
    this.disputes[tr.id] = {
      id: newId('dp'), txId: tx.id, trancheId: tr.id, reason: description === undefined ? 'OTHER' : reason, description: text,
      openedBy, openedAt: this.clock().toISOString(), status: 'OPEN',
    };
    this.notify({ type: 'DISPUTE_OPENED', txId: tx.id, trancheId: tr.id });
    this.emit();
    return tx;
  }
  async timeline(txId: string): Promise<AuditEntry[]> {
    return (this.chains[txId] ?? []).map((e) => ({ at: e.at, event: e.event, trancheId: e.trancheId, detail: e.detail, actor: e.actor, hash: e.hash }));
  }

  // ——— Lot 3 bis : alertes, litiges, reçus, abandon ———

  async listNotifications(): Promise<AppNotification[]> {
    // Plus récente d’abord ; à heure égale, la dernière créée d’abord.
    return this.notifications.map((n, i) => ({ n, i }))
      .sort((a, b) => b.n.at.localeCompare(a.n.at) || b.i - a.i)
      .map(({ n }) => ({ ...n }));
  }
  async markNotificationRead(id: string): Promise<void> {
    const n = this.notifications.find((x) => x.id === id);
    if (!n) throw new ApiError('NOT_FOUND', 'Alerte introuvable');
    if (!n.readAt) { n.readAt = this.clock().toISOString(); this.emit(); }
  }
  async markAllNotificationsRead(): Promise<void> {
    const now = this.clock().toISOString();
    let changed = false;
    for (const n of this.notifications) if (!n.readAt) { n.readAt = now; changed = true; }
    if (changed) this.emit();
  }

  async getDispute(trancheId: string): Promise<DisputeView | null> {
    this.find(trancheId);
    const d = this.disputes[trancheId];
    return d ? { ...d } : null;
  }

  /**
   * Mode démonstration : décision d’un administrateur sur un litige, par la machine d’états de la tranche.
   * Libération → RELEASED (fonds remis au prestataire) ; remboursement → CANCELLED (paiement simulé remboursé).
   */
  async simulateDisputeResolution(trancheId: string, decision: { outcome: DisputeOutcome; note: string }): Promise<Transaction> {
    const { tx, tr } = this.find(trancheId);
    const dispute = this.disputes[trancheId];
    if (!dispute || dispute.status !== 'OPEN') throw new ApiError('NO_OPEN_DISPUTE', 'Aucun litige en cours sur cette tranche');
    if (decision.note.trim().length < 3) throw new ApiError('REASON_REQUIRED', 'Note de décision obligatoire');
    const now = this.clock().toISOString();
    tr.status = resolveDisputeTransition(tr, decision.outcome, ADMIN);
    if (tr.status === 'RELEASED') tr.releasedAt = now;
    dispute.status = decision.outcome === 'RELEASED' ? 'RELEASED_TO_PROVIDER' : 'REFUNDED_TO_PAYER';
    dispute.resolvedAt = now;
    dispute.resolutionNote = decision.note.trim();
    this.record(tx.id, decision.outcome === 'RELEASED' ? 'DISPUTE_RELEASED' : 'PAYMENT_REFUNDED', tr.id, dispute.resolutionNote, 'validator');
    this.notify({ type: 'DISPUTE_RESOLVED', txId: tx.id, trancheId: tr.id, outcome: decision.outcome });
    this.closeIfDone(tx);
    this.emit();
    return tx;
  }

  /** Reçu d’une tranche débloquée ; `chainValid` vient de la vérification du journal chaîné (avec l’ancre). */
  async getReceipt(trancheId: string): Promise<Receipt> {
    const { tx, tr } = this.find(trancheId);
    if (tr.status !== 'RELEASED' || !tr.releasedAt) throw new ApiError('NOT_RELEASED', 'Le reçu n’existe que pour une tranche débloquée');
    const chain = this.chains[tx.id] ?? [];
    const check = verifyChain(chain, this.anchors[tx.id]);
    const token = this.ensureToken(tr);
    return {
      trancheId: tr.id, txId: tx.id, label: tr.label, amountMinor: tr.amountMinor, currency: tx.amount.currency,
      releasedAt: tr.releasedAt, payerName: tx.payerName ?? '', providerName: tx.providerName, purpose: tx.purpose,
      reference: formatReference(token.reference), lastHash: check.lastHash, chainValid: check.valid, entryCount: check.count,
    };
  }

  /** Décision D4 : un dossier rejeté est abandonné (REJECTED → CANCELLED) ; sa trace et son journal sont conservés. */
  async abandonRejected(txId: string): Promise<Transaction> {
    const user = this.requireUser();
    const tx = await this.getTransaction(txId);
    if (tx.ownerId && tx.ownerId !== user.id) throw new ApiError('TX_NOT_FOUND', 'Transaction introuvable');
    if (tx.status !== 'REJECTED') throw new ApiError('NOT_REJECTED', 'Seul un dossier rejeté peut être abandonné');
    tx.status = transitionTx(tx.status, 'CANCELLED', this.creatorActor());
    this.record(tx.id, 'TX_ABANDONED', undefined, undefined, user.role.toLowerCase());
    this.emit();
    return tx;
  }

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
    if (!d || (d.ownerId && d.ownerId !== user.id)) throw new ApiError('TX_NOT_FOUND', 'Brouillon introuvable');
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
      throw new ApiError('TX_NOT_FOUND', 'Brouillon introuvable');
    }
    const saved: NeedDraft = { ...draft, ownerId: user.id, updatedAt: this.clock().toISOString() };
    await this.drafts.put(saved);
    this.emit();
    return saved;
  }

  async deleteDraft(id: string): Promise<void> {
    const d = await this.ownDraft(id);
    // Décision D4 : seul un brouillon jamais soumis se supprime. Une correction appartient à un dossier audité.
    if (d.correctionOf) throw new ApiError('AUDITED_FILE', 'Ce dossier a un historique : il ne peut pas être supprimé');
    await this.drafts.remove(id);
    this.emit();
  }

  async attachDocument(draftId: string, file: DraftDocumentInput, onProgress?: (p: number) => void): Promise<DraftDocument> {
    const mimeType = checkFile(file);
    const current = await this.ownDraft(draftId);
    checkFileCount(current.documents.filter((x) => x.kind === file.kind && x.status === 'UPLOADED' && x.id !== file.id).length);
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
      ownerId: user.id, rejectionReason: undefined, payerName: user.role === 'REQUESTER' ? undefined : user.name,
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
    if (tx.ownerId && tx.ownerId !== user.id) throw new ApiError('TX_NOT_FOUND', 'Transaction introuvable');
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
    // Même règle que decide_tx (lot 5) ; le validateur simulé coche la case « montant vérifié » (comme demo_review).
    const invalid = validatorDecisionError({ approved: decision.approved, amountChecked: true, reason: decision.reason });
    if (invalid) throw new ApiError(invalid, 'Décision incomplète');
    if (!decision.approved) {
      const reason = decision.reason?.trim() ?? '';
      tx.status = transitionTx(tx.status, 'REJECTED', VALIDATOR);
      tx.rejectionReason = reason;
      this.record(tx.id, 'NEED_REJECTED', undefined, reason, 'validator');
      this.notify({ type: 'TX_REJECTED', txId, reason });
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
    this.record(tx.id, 'NEED_VALIDATED', undefined, undefined, 'validator');
    this.notify({ type: 'TX_VALIDATED', txId });
    if (first?.status === 'AWAITING_PAYMENT') this.notify({ type: 'PAYMENT_READY', txId, trancheId: first.id });
    this.emit();
    return tx;
  }


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
