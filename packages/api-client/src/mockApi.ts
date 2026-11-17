import {
  DEFAULT_MODULES, DomainError, PaymentEngine, RELEASE_RULES, SimulatedPaymentAdapter, answerInfoDecision, findModule, maxFilesFor, platformReviewDecision,
  requiredValidationsFor, sortModules, appendEntry, checkApproveRelease, checkContentHash, checkFile, checkFileCount, confirmService as confirmServiceRule,
  disputeOpening, effectiveCreatorRole, emptyDraft,
  otherDossiersWithHash,
  formatReference, isAutoReleasable, messageError, normalizeReference, paymentOutcome, rejectRequestDecision, requestInfoDecision,
  resolveDisputeDecision, shouldActivateTranche, shouldCloseOperation, toIsoDate, tokenRevocationError, tooManyAttempts, transitionOperation,
  transitionPaymentRequest, validateNeed, verifyChain, validatorDecisionError,
  SimulatedKycAdapter, applyKycResult, checkBeneficiary, isAllowedKind, checkEnrolmentSubmission, checkInitiation, enrolmentRoute, checkLimits, DEV_ENROLMENT_LIMITS,
} from '@diaspay/domain';
import type {
  Actor, ChainedAuditEntry, CreatorRole, DisputeOutcome, DraftDocument, FundsState, DraftDocumentInput, IncomingWebhook, LedgerState, ModuleCode, NeedDraft,
  RequestModule, RequestMessageKind, TrancheStatus, TxRole,
  EnrolmentDocumentInput, EnrolmentLevel, KycPort, Currency, EnrolmentLimit, FeeSchedule, FxQuote, FxRates, LimitsWhenMissing, PaymentMethod,
} from '@diaspay/domain';
import type {
  AppNotification, AuditEntry, DisputeView, DocumentAccess, DocumentReuse, EnrolmentCaseView, EnrolmentView, NotificationEvent, PaymentQuote, Persona, Receipt, ReferenceInfo, RequestMessage, Tranche,
  TrancheToken, Transaction, TransactionApi,
} from './types';
import { ApiError, MemoryDraftStore, SEED_PROVIDERS, foldText, newId, uriHasher } from './need';
import type { DraftStore, FileHasher, ProviderSummary, StateStore } from './need';

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
  /** Réglage serveur eqr_image_enabled simulé (défaut : oui). */
  eqrImageEnabled?: boolean;
  /** Lot X (X4) : empreinte d’un fichier avant l’envoi. L’application passe la même fonction qu’au serveur ; défaut : uriHasher. */
  hashFile?: FileHasher;
  /** Lot X (X6) : types de besoin (défaut : DEFAULT_MODULES, valeurs du code). */
  modules?: readonly RequestModule[];
  /** Lot X v2 (X4) : adaptateur KYC (défaut : simulé, résultat APPROVED, comme kyc_simulated_result en développement). */
  kyc?: KycPort;
  /** Lot X v2 (X4, X5) : plafonds (défaut : lignes de développement sans plafond, comme l’amorçage mock_mode) et règle d’absence. */
  limits?: readonly EnrolmentLimit[];
  limitsWhenMissing?: LimitsWhenMissing;
  /** Lot X v2 (X5) : devis : durée de vie (défaut 300 s, valeur de développement), taux simulés (défaut : parité EUR/XAF), frais (défaut : aucun). */
  quoteTtlSeconds?: number;
  fxRates?: FxRates;
  feeSchedule?: FeeSchedule;
}

/** Jeton révoqué (lot X) : conservé pour refuser explicitement sa référence (TOKEN_REVOKED). */
interface RevokedToken extends TrancheToken { revokedAt: string; reason: string }
/** Message d’une demande, tel que conservé par le simulateur. */
interface StoredMessage { id: string; txId: string; trancheId: string; kind: RequestMessageKind; body: string; at: string; authorId: string }

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
  // Lot X (absents d’un instantané antérieur : valeurs vides).
  revoked?: RevokedToken[];
  withdrawn?: string[];
  messages?: StoredMessage[];
  creators?: Record<string, CreatorRole>;
  viewed?: Record<string, string>;
  /** Lot X (X5) : tentatives, événements, remboursements et journal financier du simulateur. */
  payments?: LedgerState;
  /** Lot X v2 (X4) : niveaux et dossiers d’enrôlement. */
  enrolments?: Record<string, { level?: EnrolmentLevel; cases: EnrolmentCaseView[] }>;
}

/** Utilisateur connecté vu par la simulation : propriétaire des brouillons et rôle du créateur. */
export interface MockUser {
  id: string; role: 'PAYER' | 'REQUESTER' | 'PROVIDER'; name?: string;
  /** Lot X v2 (X4) : niveau d’enrôlement de départ (défaut N0, comme profiles.enrolment_level) ; relevé par submitEnrolment. */
  enrolmentLevel?: EnrolmentLevel;
  /** Numéro du compte, pour refuser qu’un prestataire initiateur se désigne payeur. */
  phone?: string;
}

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

function mkTranche(seq: number, label: string, amountMinor: number, over: Partial<Tranche> & { vertical: ModuleCode }): Tranche {
  // Règle du code pour le jeu de démonstration ; un module ajouté par des données passe releaseMode et contestHours.
  const rule = RELEASE_RULES[over.vertical as keyof typeof RELEASE_RULES] ?? { releaseMode: 'PROVIDER_CONFIRM', contestHours: 0 };
  const { vertical: _v, ...rest } = over;
  return {
    id: uid('tr'), seq, label, amountMinor, status: 'DRAFT',
    releaseMode: rule.releaseMode, contestHours: rule.contestHours, evidenceCount: 0, fundsState: 'NONE', onHold: false, refundedMinor: 0, ...rest,
  };
}

/**
 * Jeu de données de démonstration (lot X version 2) : règlement direct par défaut (Scolarité, Santé, Loyer), libération
 * conditionnelle pour Terrain et Agro (vague 2).
 */
export function seedTransactions(now: Date): Transaction[] {
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const school: Transaction = {
    id: 'tx-school', vertical: 'EDUCATION', settlementMode: 'DIRECT', purpose: 'Scolarité 2026-2027',
    amount: { amountMinor: 900_000, currency: 'XAF' }, status: 'ACTIVE',
    payerName: 'Marie N.', providerName: 'École Les Palmiers', beneficiaryName: 'Aïcha N.', createdAt: iso(-30 * 24 * HOUR),
    tranches: [
      mkTranche(1, 'Inscription', 300_000, { vertical: 'EDUCATION', status: 'PAID', dueDate: '2026-10-15', paidAt: iso(-2 * HOUR) }),
      mkTranche(2, 'Scolarité T1', 300_000, { vertical: 'EDUCATION', status: 'SUBMITTED', dueDate: '2026-11-15' }),
      mkTranche(3, 'Scolarité T2', 300_000, { vertical: 'EDUCATION', status: 'DRAFT', dueDate: '2027-01-15' }),
    ],
  };
  const health: Transaction = {
    id: 'tx-health', vertical: 'HEALTH', settlementMode: 'DIRECT', purpose: 'Opération du genou',
    amount: { amountMinor: 180_000, currency: 'XAF' }, status: 'ACTIVE',
    payerName: 'Marie N.', providerName: 'Hôpital Central', beneficiaryName: '', beneficiaryReference: 'RM-12', createdAt: iso(-1 * 24 * HOUR),
    tranches: [mkTranche(1, 'Soins', 180_000, { vertical: 'HEALTH', status: 'SUBMITTED', dueDate: '2026-11-20' })],
  };
  const rent: Transaction = {
    id: 'tx-rent', vertical: 'RENT', settlementMode: 'DIRECT', purpose: 'Loyer studio',
    amount: { amountMinor: 1_800_000, currency: 'XAF' }, status: 'ACTIVE',
    payerName: 'Marie N.', providerName: 'Studio Bastos', beneficiaryName: 'Marie N.', createdAt: iso(-100 * 24 * HOUR),
    tranches: Array.from({ length: 12 }, (_, i) => {
      const dueDate = `${2026 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, '0')}-05`;
      return mkTranche(i + 1, `Loyer ${i + 1}`, 150_000, {
        vertical: 'RENT', dueDate, status: i < 3 ? 'PAID' : i === 3 ? 'SUBMITTED' : 'DRAFT',
        paidAt: i < 3 ? `${dueDate}T14:00:00.000Z` : undefined,
      });
    }),
  };
  const land: Transaction = {
    id: 'tx-land', vertical: 'LAND', settlementMode: 'CONDITIONAL', purpose: 'Parcelle Nkolbisson',
    amount: { amountMinor: 12_500_000, currency: 'XAF' }, status: 'ACTIVE',
    payerName: 'Marie N.', providerName: 'Étude notariale Mbarga', beneficiaryName: 'Jean K.', createdAt: iso(-60 * 24 * HOUR),
    tranches: [
      mkTranche(1, 'Promesse de vente', 2_500_000, { vertical: 'LAND', status: 'PAID', fundsState: 'RELEASED', paidAt: iso(-40 * 24 * HOUR), releasedAt: iso(-20 * 24 * HOUR) }),
      mkTranche(2, 'Signature de l’acte notarié', 4_000_000, { vertical: 'LAND', status: 'PAID', fundsState: 'HELD', evidenceCount: 1, paidAt: iso(-5 * 24 * HOUR) }),
      mkTranche(3, 'Remise du titre foncier', 6_000_000, { vertical: 'LAND' }),
    ],
  };
  const agro: Transaction = {
    id: 'tx-agro', vertical: 'AGRO', settlementMode: 'CONDITIONAL', purpose: 'Semences', amount: { amountMinor: 450_000, currency: 'XAF' },
    status: 'DRAFT', payerName: 'Marie N.', providerName: 'Coopérative Agri-Plus', beneficiaryName: 'Paul T.', createdAt: iso(-2 * HOUR),
    tranches: [mkTranche(1, 'Livraison', 450_000, { vertical: 'AGRO' })],
  };
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
  // Lot X : jetons révoqués, tranches sans jeton actif après révocation, messages, rôle du créateur, ouvertures, échecs.
  private revoked: RevokedToken[] = [];
  private withdrawn = new Set<string>();
  private messages: StoredMessage[] = [];
  private creators: Record<string, CreatorRole> = {};
  private viewed: Record<string, string> = {};
  private failures = new Map<string, number[]>();
  private readonly eqrImage: boolean;
  private readonly hashFile: FileHasher;
  private readonly modules: readonly RequestModule[];
  /** Lot X v2 (X4) : niveaux relevés et dossiers d’enrôlement, par utilisateur. */
  private enrolments: Record<string, { level?: EnrolmentLevel; cases: EnrolmentCaseView[] }> = {};
  private readonly kyc: KycPort;
  private readonly limits: readonly EnrolmentLimit[];
  private readonly limitsWhenMissing: LimitsWhenMissing;
  private readonly quoteTtl: number;
  private readonly fxRates: FxRates;
  private readonly feeSchedule?: FeeSchedule;
  /** Lot X (X5) : moteur de paiement (miroir de 0010) et partenaire simulé, qui répond par des événements signés. */
  private payments: PaymentEngine;
  private readonly paymentPort: SimulatedPaymentAdapter;
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
    this.eqrImage = options.eqrImageEnabled ?? false;   // 0015 : image du QR retirée du parcours par défaut
    this.hashFile = options.hashFile ?? uriHasher;
    this.modules = options.modules ?? DEFAULT_MODULES;
    this.kyc = options.kyc ?? new SimulatedKycAdapter();
    this.limits = options.limits ?? DEV_ENROLMENT_LIMITS;
    this.limitsWhenMissing = options.limitsWhenMissing ?? 'REFUSE';
    this.quoteTtl = options.quoteTtlSeconds ?? 300;           // DÉVELOPPEMENT, comme fx_quote_ttl_seconds en mock_mode
    this.fxRates = options.fxRates ?? { 'EUR/XAF': '655.957' };
    this.feeSchedule = options.feeSchedule;
    this.payments = new PaymentEngine(clock);
    // Secret du simulateur (pas un secret réel) : les événements sont signés et vérifiés comme ceux d’un partenaire.
    this.paymentPort = new SimulatedPaymentAdapter({ secret: 'diaspay-simulateur', sink: (w) => this.receiveWebhook(w), clock, newId: () => newId('evt') });
    this.initSeed(seed === undefined);
  }

  /** Jetons, journal et alertes du jeu de démonstration. */
  private initSeed(withNotifications: boolean): void {
    this.refreshVisible();
    for (const tx of this.txs) {
      this.record(tx.id, 'DEMO_SEED', undefined, tx.status);
      for (const tr of tx.tranches) {
        if (tr.status !== 'DRAFT') { this.ensureToken(tr); this.record(tx.id, 'DEMO_SEED', tr.id, tr.status); }   // lot X-C (T7) : tous modes
      }
    }
    if (!withNotifications || !this.seedNotifs) return;
    const at = (h: number) => new Date(this.clock().getTime() - h * HOUR).toISOString();
    const school = this.txs.find((t) => t.id === 'tx-school');
    const rent = this.txs.find((t) => t.id === 'tx-rent');
    if (school?.tranches[0] && school.tranches[1]) {
      this.pushNotification({ type: 'REQUEST_PAID', txId: school.id, trancheId: school.tranches[0].id }, at(1), false);
      this.pushNotification({ type: 'PAYMENT_READY', txId: school.id, trancheId: school.tranches[1].id }, at(3), false);
    }
    const paid = rent?.tranches.filter((t) => t.status === 'PAID').at(-1);
    if (rent && paid) this.pushNotification({ type: 'REQUEST_PAID', txId: rent.id, trancheId: paid.id }, at(26), false);
  }

  /**
   * Crée le jeton d'une tranche activée (idempotent). Expire 7 jours après l'activation ; les tranches déjà confirmées ou débloquées
   * ont un jeton utilisé. Lot X : null si le jeton a été révoqué sans réémission.
   */
  private ensureToken(tr: Tranche): TrancheToken | null {
    const existing = this.tokens.get(tr.id);
    if (existing) return existing;
    if (this.withdrawn.has(tr.id)) return null;
    const taken = new Set(this.txs.flatMap((x) => x.tranches.map((r) => r.reference)).filter(Boolean));
    let reference = tr.reference ? normalizeReference(tr.reference) : '';
    for (let n = 0; !reference || (!tr.reference && taken.has(reference)); n++) reference = hexDigest(`${tr.id}#${n}`, 18);
    tr.reference = reference;
    const now = this.clock();
    // Lot X-C (T7) : en DIRECT, le jeton suit la demande (expiresAt de la demande, absente tant que la durée n’est pas fixée).
    const direct = this.txs.find((x) => x.tranches.includes(tr))?.settlementMode !== 'CONDITIONAL';
    const token: TrancheToken = {
      trancheId: tr.id, reference, kid: SIMULATED_KID, signature: `SIMULATED.${hexDigest(`sig:${reference}`, 32)}`, simulated: true,
      expiresAt: direct ? tr.expiresAt : new Date(now.getTime() + this.validityMs).toISOString(),
      usedAt: tr.confirmedAt || tr.fundsState === 'RELEASED' ? now.toISOString() : undefined,
    };
    this.tokens.set(tr.id, token);
    return token;
  }

  /**
   * Lot X-C (T7) : jeton révoqué par le statut final de la demande (miroir du déclencheur de 0028) : refusée, annulée, échue ;
   * en DIRECT aussi payée et remboursée. En CONDITIONAL, le jeton payé reste actif (QR présenté au prestataire).
   */
  private tokenSpent(tx: Transaction, tr: Tranche): boolean {
    return tr.status === 'REJECTED' || tr.status === 'CANCELLED' || tr.status === 'EXPIRED'
      || (tx.settlementMode !== 'CONDITIONAL' && (tr.status === 'PAID' || tr.status === 'REFUNDED'));
  }

  private isParty(tx: Transaction): boolean { return !tx.parties || tx.parties.includes(this.persona); }

  /**
   * Rôles de l’utilisateur au dossier. Le simulateur n’a pas de comptes multiples : le créateur garde son rôle de création ;
   * pour un dossier créé par un autre (ou du jeu de démonstration), le profil de démonstration courant (payeur par défaut).
   */
  private rolesFor(tx: Transaction): TxRole[] {
    if (tx.ownerId && this.user && tx.ownerId === this.user.id) return [this.creators[tx.id] ?? this.creatorRoleOf()];
    return this.isParty(tx) ? [this.persona] : [];
  }
  private isCreatorOf(tx: Transaction): boolean { return !!tx.ownerId && !!this.user && tx.ownerId === this.user.id; }

  /** Jeton (actif ou révoqué) d’une référence ; null si inconnue. */
  private byReference(reference: string): { tx: Transaction; tr: Tranche; token: TrancheToken; revoked: boolean } | null {
    let ref: string;
    try { ref = normalizeReference(reference); } catch { return null; }
    for (const tx of this.txs) {
      for (const tr of tx.tranches) {
        if (tr.status === 'DRAFT') continue;
        const token = this.ensureToken(tr);
        if (token?.reference === ref) return { tx, tr, token, revoked: this.tokenSpent(tx, tr) };
        const old = this.revoked.find((k) => k.trancheId === tr.id && k.reference === ref);
        if (old) return { tx, tr, token: old, revoked: true };
      }
    }
    return null;
  }

  // Lot X (X1) : limitation des résolutions échouées, par utilisateur (miroir de _reference_guard et _reference_failed).
  private failureKey(): string { return this.user?.id ?? `persona:${this.persona}`; }
  private guardAttempts(): void {
    if (tooManyAttempts(this.failures.get(this.failureKey()) ?? [], this.clock().getTime())) {
      throw new DomainError('TOO_MANY_ATTEMPTS', 'Trop de tentatives : réessayez plus tard');
    }
  }
  private recordFailure(): void {
    const k = this.failureKey();
    this.failures.set(k, [...(this.failures.get(k) ?? []), this.clock().getTime()]);
  }
  /** Référence d’une partie : inconnue et dossier étranger donnent la même réponse (UNKNOWN_REFERENCE). */
  private partyReference(reference: string, record: boolean): { tx: Transaction; tr: Tranche; token: TrancheToken } {
    this.guardAttempts();
    const hit = this.byReference(reference);
    // Miroir de _party_token (0015) : en DIRECT, seuls le payeur et l’initiateur résolvent la référence.
    const directOutsider = !!hit && hit.tx.settlementMode !== 'CONDITIONAL' && !this.rolesFor(hit.tx).includes('PAYER') && !this.isCreatorOf(hit.tx);
    if (!hit || !this.isParty(hit.tx) || directOutsider) {
      if (record) this.recordFailure();
      throw new DomainError('UNKNOWN_REFERENCE', 'Référence inconnue');
    }
    if (hit.revoked) throw new DomainError('TOKEN_REVOKED', 'Ce QR a été révoqué');
    return hit;
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
      revoked: this.revoked, withdrawn: [...this.withdrawn], messages: this.messages, creators: this.creators, viewed: this.viewed,
      payments: this.payments.state(), enrolments: this.enrolments,
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
    this.revoked = snap.revoked ?? [];
    this.withdrawn = new Set(snap.withdrawn ?? []);
    this.messages = snap.messages ?? [];
    this.creators = snap.creators ?? {};
    this.viewed = snap.viewed ?? {};
    this.payments = new PaymentEngine(this.clock, snap.payments);
    this.enrolments = snap.enrolments ?? {};
    this.refreshVisible();
    this.listeners.forEach((l) => l());
    return true;
  }
  /** Repart du jeu de démonstration : transactions, alertes, journal, litiges et brouillons effacés. */
  async resetDemoData(): Promise<void> {
    this.txs = seedTransactions(this.clock());
    this.chains = {}; this.anchors = {}; this.notifications = []; this.disputes = {};
    this.tokens = new Map(); this.submitted = new Map();
    this.revoked = []; this.withdrawn = new Set(); this.messages = []; this.creators = {}; this.viewed = {}; this.failures = new Map();
    this.payments = new PaymentEngine(this.clock);
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

  /** Transition d’une demande (machine du modèle cible) ; journal, alertes, clôture. L’opération doit être active. */
  private apply(trancheId: string, to: TrancheStatus, actor: Actor, event: string): Transaction {
    const { tx, tr } = this.find(trancheId);
    // Un remboursement versé (PAID → REFUNDED) s’applique aussi à une opération close ou suspendue (événement du partenaire).
    if (tx.status !== 'ACTIVE' && !(to === 'REFUNDED' && actor.kind === 'SYSTEM')) throw new DomainError('TX_NOT_ACTIVE', 'L’opération n’est pas active');
    tr.status = transitionPaymentRequest(tr.status, to, actor, { onHold: tr.onHold });
    if (to === 'PAID') tr.paidAt = this.clock().toISOString();
    this.record(tx.id, event, tr.id, `${tr.label} → ${to}`, actor.kind === 'SYSTEM' ? 'system' : actor.roles.join('+').toLowerCase());
    // Alerte sans seconde ligne au journal : la transition vient d’être journalisée (comme le serveur).
    if (to === 'PAID') this.pushNotification({ type: 'REQUEST_PAID', txId: tx.id, trancheId: tr.id }, this.clock().toISOString(), false);
    this.closeIfDone(tx);
    this.emit();
    return tx;
  }

  /** État des fonds (CONDITIONAL seulement) : libération (versement au journal, alerte) ou retour au payeur. */
  private setFunds(tx: Transaction, tr: Tranche, state: FundsState, event: string): void {
    tr.fundsState = state;
    if (state === 'RELEASED') { tr.releasedAt = this.clock().toISOString(); this.payments.release(tr.id); }
    this.record(tx.id, event, tr.id, `${tr.label} : fonds ${state}`, 'system');
    if (state === 'RELEASED') this.notify({ type: 'TRANCHE_RELEASED', txId: tx.id, trancheId: tr.id });
    this.closeIfDone(tx);
    this.emit();
  }

  private closeIfDone(tx: Transaction): void {
    if (tx.status === 'ACTIVE' && shouldCloseOperation(tx.tranches.map((t) => ({ status: t.status, fundsState: t.fundsState })))) {
      tx.status = transitionOperation(tx.status, 'CLOSED', SYSTEM);
      this.record(tx.id, 'TX_CLOSED');
    }
  }

  /** Soumission d’une demande au payeur (DRAFT → SUBMITTED) : jeton en CONDITIONAL ; alerte au payeur. */
  private submitRequest(tx: Transaction, tr: Tranche): void {
    tr.status = transitionPaymentRequest(tr.status, 'SUBMITTED', SYSTEM);
    // Lot X-C (T6) : expiration posée à la soumission, comme _submit_request (durée par module, point ouvert 3).
    const expiryDays = findModule(tx.vertical, this.modules)?.requestExpiryDays;
    if (expiryDays) tr.expiresAt = new Date(this.clock().getTime() + expiryDays * 86_400_000).toISOString();
    // Lot X-C (T7) : un TrustToken pour chaque demande soumise, quel que soit le mode (« TrustToken généré »).
    this.ensureToken(tr);
    this.record(tx.id, 'TOKEN_ISSUED', tr.id);
    this.record(tx.id, 'REQUEST_SUBMITTED', tr.id);
    const payerIsInitiator = (this.creators[tx.id] ?? 'PAYER') === 'PAYER';
    this.notify(payerIsInitiator ? { type: 'PAYMENT_READY', txId: tx.id, trancheId: tr.id } : { type: 'PAYMENT_REQUEST_RECEIVED', txId: tx.id });
  }

  /** Activation (miroir de _activate_operation) : ACTIVE, puis soumission des demandes dues (RG-12). */
  private activate(tx: Transaction, event: string, actor: string, byReview: boolean): void {
    tx.status = 'ACTIVE';
    this.record(tx.id, event, undefined, undefined, actor);
    if (byReview) this.notify({ type: 'TX_VALIDATED', txId: tx.id });
    tx.tranches.forEach((tr, i) => {
      if (tr.status !== 'DRAFT') return;
      const previousOpen = tx.tranches.slice(0, i).some((p) => !shouldCloseOperation([{ status: p.status, fundsState: p.fundsState }]));
      if ((tr.dueDate && shouldActivateTranche(tr.dueDate, this.today())) || (!tr.dueDate && !previousOpen)) this.submitRequest(tx, tr);
    });
    this.emit();
  }

  async listTransactions() { return this.visible; }
  async getTransaction(id: string) {
    const tx = this.txs.find((t) => t.id === id);
    if (!tx) throw new DomainError('TX_NOT_FOUND', 'Transaction introuvable');
    return tx;
  }
  /**
   * Paiement simulé (lot X, X5 ; v2 : devis puis acceptation), par le même chemin que le partenaire : devis dans la devise de la
   * demande (get_quote), puis accepter et payer (accept_and_pay), le partenaire simulé répondant par des événements signés,
   * vérifiés puis appliqués (apply_payment_event). Même clé : même tentative, aucun nouveau paiement.
   */
  async payTranche(trancheId: string, idempotencyKey?: string) {
    const { tx } = this.find(trancheId);
    if (this.replayOf(trancheId, idempotencyKey)) return tx;
    this.checkKey(idempotencyKey);   // comme start_payment : clé invalide refusée avant le devis
    const q = await this.getQuote(trancheId);
    return this.acceptAndPay(trancheId, q.id, idempotencyKey);
  }

  private checkKey(key?: string): void {
    if (key !== undefined && (key.trim().length < 8 || key.trim().length > 200)) throw new DomainError('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)');
  }
  private payerKey(): string { return this.user?.id ?? `persona:${this.persona}`; }
  private replayOf(trancheId: string, key?: string) {
    const replay = key ? this.payments.attemptsOf(trancheId).find((a) => a.idempotencyKey === key.trim()) : undefined;
    return replay && replay.createdBy === this.payerKey() ? replay : undefined;
  }
  /** Contrôles communs à get_quote et accept_and_pay, dans le même ordre que le serveur. */
  /** Lot X-C (T6) : une demande échue n’est plus payable, même avant le passage d’expiration (miroir du serveur). */
  private checkNotExpired(tr: Tranche): void {
    if (tr.expiresAt && tr.expiresAt <= this.clock().toISOString() && (tr.status === 'SUBMITTED' || tr.status === 'INFO_REQUESTED')) {
      throw new DomainError('REQUEST_EXPIRED', 'Demande expirée : elle ne peut plus être payée');
    }
  }

  private payable(trancheId: string): { tx: Transaction; tr: Tranche } {
    const { tx, tr } = this.find(trancheId);
    if (!this.isParty(tx) && !this.isCreatorOf(tx)) throw new DomainError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
    if (!this.rolesFor(tx).includes('PAYER')) throw new DomainError('PAYER_ONLY', 'Réservé au payeur');
    // Comme 0018 : la suspension par un litige est annoncée avant l’état de l’opération (qu’elle suspend).
    if (tr.onHold) throw new DomainError('REQUEST_ON_HOLD', 'Demande suspendue par un litige');
    if (tx.status !== 'ACTIVE') throw new DomainError('TX_NOT_ACTIVE', 'L’opération n’est pas active');
    return { tx, tr };
  }

  /** Devis (miroir de get_quote) : taux simulés marqués, frais du barème, durée de vie de développement. */
  async getQuote(trancheId: string, debitCurrency?: Currency, method?: PaymentMethod): Promise<PaymentQuote> {
    const { tx, tr } = this.payable(trancheId);
    if (this.payments.attemptsOf(trancheId).some((a) => a.status === 'INITIATED' || a.status === 'PENDING')) {
      throw new DomainError('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
    }
    this.checkNotExpired(tr);   // lot X-C (T6) : même ordre que get_quote
    if (tr.status !== 'SUBMITTED') throw new DomainError('NOT_PAYABLE', 'Cette demande n’est pas à payer');
    const q = this.payments.createQuote({
      trancheId, payerId: this.payerKey(), amount: { amountMinor: tr.amountMinor, currency: tx.amount.currency }, debitCurrency, method,
      ttlSeconds: this.quoteTtl, rates: this.fxRates, fees: this.feeSchedule, providerQuote: null,
    });
    this.record(tx.id, 'QUOTE_ISSUED', tr.id, undefined, 'payer');
    return toPaymentQuote(q);
  }

  /** Accepter et payer (miroir de accept_and_pay) : devis valide, plafond du niveau, contribution et tentative INITIATED. */
  async acceptAndPay(trancheId: string, quoteId: string, idempotencyKey?: string) {
    this.checkKey(idempotencyKey);
    const { tx } = this.find(trancheId);
    if (this.replayOf(trancheId, idempotencyKey)) return tx;
    const { tr } = this.payable(trancheId);
    const key = idempotencyKey ?? newId('pay');
    // Contrôles de la tentative (clé, tentative en cours, demande à payer, devis) avant le plafond, comme le serveur.
    const known = this.payments.attemptsOf(trancheId).some((a) => a.status === 'INITIATED' || a.status === 'PENDING');
    if (known) throw new DomainError('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
    this.checkNotExpired(tr);   // lot X-C (T6) : même ordre que accept_and_pay
    if (tr.status !== 'SUBMITTED') throw new DomainError('NOT_PAYABLE', 'Cette demande n’est pas à payer');
    // Lot X-C (T7) : tout paiement est associé au TrustToken actif de la demande (exigence 5.1).
    if (!this.ensureToken(tr)) throw new DomainError('TOKEN_REVOKED', 'Jeton de la demande révoqué : paiement impossible');
    const q = this.payments.quote(quoteId);
    if (!q || q.trancheId !== trancheId || q.payerId !== this.payerKey() || q.requestAmountMinor !== tr.amountMinor) {
      throw new DomainError('QUOTE_INVALID', 'Devis inconnu ou d’une autre demande');
    }
    if (q.usedAt) throw new DomainError('QUOTE_USED', 'Devis déjà utilisé');
    if (q.expiresAt <= this.clock().toISOString()) throw new DomainError('QUOTE_EXPIRED', 'Devis expiré : demandez-en un nouveau');
    const level = this.user ? this.levelOf(this.user) : 'N0';
    const now = this.clock();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    checkLimits({
      limit: this.limits.find((l) => l.level === level && l.currency === tx.amount.currency), level, currency: tx.amount.currency,
      amountMinor: tr.amountMinor, whenMissing: this.limitsWhenMissing,
      usedTodayMinor: this.payments.usedSince(this.payerKey(), tx.amount.currency, day),
      usedThisMonthMinor: this.payments.usedSince(this.payerKey(), tx.amount.currency, month),
    });
    const { attempt, created } = this.payments.startPayment({
      txId: tx.id, trancheId, idempotencyKey: key, amountMinor: tr.amountMinor, currency: tx.amount.currency,
      trancheStatus: tr.status, createdBy: this.payerKey(), quoteId,
    });
    if (created) {
      // SUBMITTED → ACCEPTED (le payeur accepte et paie), puis l’événement du partenaire décide.
      this.apply(trancheId, 'ACCEPTED', { kind: 'USER', roles: ['PAYER'], isValidator: false }, 'REQUEST_ACCEPTED');
      this.record(tx.id, 'PAYMENT_STARTED', tr.id, undefined, 'payer');
      const res = await this.paymentPort.createPayment({
        idempotencyKey: attempt.idempotencyKey, trancheId, amount: { amountMinor: tr.amountMinor, currency: tx.amount.currency },
        payer: { userId: this.user?.id }, payee: { name: tx.providerName }, method: attempt.method,
        contributionId: attempt.contributionId, quoteId,
      });
      this.payments.setProviderRef(attempt.id, res.providerRef);
    }
    this.emit();
    return tx;
  }

  /** Réception d’un événement du partenaire (simulé) : signature vérifiée, contenu lu, application idempotente. */
  private receiveWebhook(w: IncomingWebhook): void {
    const signatureValid = this.paymentPort.verifyWebhook(w.headers, w.rawBody);
    const ev = this.paymentPort.parseWebhook(w.rawBody);
    this.payments.applyEvent({ provider: ev.provider, eventId: ev.eventId, signatureValid, payload: ev.payload }, {
      tranche: (id) => { const { tx, tr } = this.find(id); return { status: tr.status, active: tx.status === 'ACTIVE', targetMinor: tr.amountMinor }; },
      onPaid: (a) => {
        // Règlement direct : payée, versée au prestataire (journal) ; CONDITIONAL : fonds bloqués jusqu’à la libération.
        const { tx, tr } = this.find(a.trancheId);
        const outcome = paymentOutcome(tx.settlementMode);
        tr.fundsState = outcome.fundsState;
        this.apply(a.trancheId, 'PAID', SYSTEM, 'REQUEST_PAID');
        if (tx.settlementMode === 'DIRECT') this.payments.release(tr.id);
      },
      onRetryAllowed: (a) => { this.apply(a.trancheId, 'SUBMITTED', SYSTEM, 'PAYMENT_RETRY_ALLOWED'); },
      onRefunded: (r) => {
        const { tr } = this.find(r.trancheId);
        tr.refundedMinor += r.amountMinor;
        if (tr.status === 'PAID') this.apply(r.trancheId, 'REFUNDED', SYSTEM, 'REQUEST_REFUNDED'); else this.emit();
      },
    });
  }

  /** Test et démonstration : état du moteur de paiement (tentatives, journal, rapprochement). */
  paymentLedger(): PaymentEngine { return this.payments; }
  async getTranche(trancheId: string) {
    const { tx, tr } = this.find(trancheId);
    return { tx, tranche: tr };
  }
  /** Lot X : jeton actif, lisible par le payeur seulement (miroir de la RLS de tranche_tokens). */
  async getToken(trancheId: string): Promise<TrancheToken> {
    const { tx, tr } = this.find(trancheId);
    if (tr.status === 'DRAFT' || this.tokenSpent(tx, tr) || !this.rolesFor(tx).includes('PAYER')) {
      throw new DomainError('NO_TOKEN', 'Aucun jeton actif : demande non soumise, ou statut final');
    }
    const token = this.ensureToken(tr);
    if (!token) throw new DomainError('NO_TOKEN', 'Aucun jeton actif');
    return { ...token };
  }
  async resolveReference(reference: string): Promise<ReferenceInfo> {
    const { tx, tr, token } = this.partyReference(reference, true);
    return {
      trancheId: tr.id, txId: tx.id, label: tr.label, amountMinor: tr.amountMinor, currency: tx.amount.currency,
      status: tr.status, expiresAt: token.expiresAt, used: !!token.usedAt, providerName: tx.providerName,
      beneficiaryName: tx.beneficiaryName, purpose: tx.purpose, seq: tr.seq, contestHours: tr.contestHours,
    };
  }
  /** Miroir de confirm_by_reference(). */
  async confirmByReference(reference: string, deviceTime?: string) {
    // Comme le serveur : l’échec n’est pas enregistré à la confirmation (l’erreur annule la transaction), la limite s’applique.
    const { tx, tr, token } = this.partyReference(reference, false);
    if (this.persona !== 'PROVIDER') throw new DomainError('PROVIDER_ONLY', 'Réservé au prestataire');
    if (token.usedAt) throw new DomainError('TOKEN_USED', 'Ce jeton a déjà été utilisé');
    const now = this.clock();
    const device = deviceTime === undefined ? now : new Date(deviceTime);
    if (Number.isNaN(device.getTime()) || device.getTime() > now.getTime() + MAX_DEVICE_SKEW_MS) {
      throw new DomainError('DEVICE_TIME_INVALID', 'L’heure de l’appareil est incorrecte');
    }
    if (token.expiresAt && device.getTime() > new Date(token.expiresAt).getTime()) throw new DomainError('TOKEN_EXPIRED', 'Ce jeton a expiré');
    // Lot X v2 : confirmation par scan en CONDITIONAL seulement (miroir de confirm_by_reference, 0014).
    const ends = confirmServiceRule(this.conditionalState(tx, tr), { roles: ['PROVIDER'], via: 'SCAN' }, now);
    tr.confirmedAt = now.toISOString();
    tr.contestEndsAt = ends.toISOString();
    token.usedAt = now.toISOString();
    this.record(tx.id, 'PROVIDER_SCAN', tr.id, undefined, 'provider');
    this.notify({ type: 'TRANCHE_CONFIRMED', txId: tx.id, trancheId: tr.id, releaseAt: tr.contestEndsAt });
    this.emit();
    return tx;
  }
  private conditionalState(tx: Transaction, tr: Tranche) {
    const d = this.disputes[tr.id];
    return {
      settlementMode: tx.settlementMode, status: tr.status, fundsState: tr.fundsState, releaseMode: tr.releaseMode, contestHours: tr.contestHours,
      confirmedAt: tr.confirmedAt ? new Date(tr.confirmedAt) : undefined, contestEndsAt: tr.contestEndsAt ? new Date(tr.contestEndsAt) : undefined,
      hasEvidence: tr.evidenceCount > 0, disputeOpen: !!d && d.status !== 'RESOLVED',
      txSuspended: tx.status === 'SUSPENDED',   // lot X-C (T6) : aucune libération automatique pour une opération suspendue
    };
  }
  /** Payeur, mode PAYER_CONFIRM (CONDITIONAL) : confirme la prestation ; le délai de contestation démarre. */
  async confirmService(trancheId: string) {
    const { tx, tr } = this.find(trancheId);
    const now = this.clock();
    const ends = confirmServiceRule(this.conditionalState(tx, tr), { roles: this.rolesFor(tx), via: 'PAYER' }, now);
    tr.confirmedAt = now.toISOString();
    tr.contestEndsAt = ends.toISOString();
    this.record(tx.id, 'SERVICE_CONFIRMED', tr.id, undefined, 'payer');
    this.notify({ type: 'TRANCHE_CONFIRMED', txId: tx.id, trancheId: tr.id, releaseAt: tr.contestEndsAt });
    this.emit();
    return tx;
  }
  /** Payeur : libération anticipée (CONDITIONAL, après confirmation). */
  async approveRelease(trancheId: string) {
    const { tx, tr } = this.find(trancheId);
    checkApproveRelease(this.conditionalState(tx, tr), this.rolesFor(tx));
    this.setFunds(tx, tr, 'RELEASED', 'FUNDS_RELEASED');
    return tx;
  }
  async openDispute(trancheId: string, reason: string, description?: string) {
    const { tx, tr } = this.find(trancheId);
    const text = (description ?? reason).trim();
    if (text.length < 10) throw new DomainError('REASON_TOO_SHORT', 'Décrivez le problème (10 caractères minimum)');
    // Lot X v2 : dossier distinct. Avant paiement : demande suspendue, opération SUSPENDED ; après : statut inchangé (K7).
    const existing = this.disputes[tr.id];
    if (existing && existing.status !== 'RESOLVED') throw new DomainError('DISPUTE_NOT_ALLOWED', 'Un litige est déjà en cours');
    const { beforePayment } = disputeOpening(tr.status, this.persona === 'PAYER' ? ['PAYER'] : ['PROVIDER']);
    const openedBy = this.persona === 'PROVIDER' ? 'PROVIDER' : 'PAYER';
    this.disputes[tr.id] = {
      id: newId('dp'), txId: tx.id, trancheId: tr.id, reason: description === undefined ? 'OTHER' : reason, description: text,
      openedBy, openedAt: this.clock().toISOString(), status: 'OPEN', beforePayment,
    };
    if (beforePayment) {
      tr.onHold = true;
      if (tx.status === 'ACTIVE') { tx.status = transitionOperation(tx.status, 'SUSPENDED', SYSTEM); this.record(tx.id, 'OPERATION_SUSPENDED'); }
    }
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
   * Mode démonstration : décision d’un administrateur non partie sur un litige (miroir de _resolve_dispute_v2). Un
   * remboursement passe par le partenaire simulé (événement) ; le statut d’une demande payée ne change que par lui.
   */
  async simulateDisputeResolution(trancheId: string, decision: { outcome: DisputeOutcome; note: string; amountMinor?: number }): Promise<Transaction> {
    const { tx, tr } = this.find(trancheId);
    const dispute = this.disputes[trancheId];
    if (!dispute || dispute.status === 'RESOLVED') throw new ApiError('NO_OPEN_DISPUTE', 'Aucun litige en cours sur cette tranche');
    if (decision.note.trim().length < 3) throw new ApiError('REASON_REQUIRED', 'Note de décision obligatoire');
    const attempt = this.payments.attemptsOf(tr.id).find((a) => a.status === 'CONFIRMED');
    const refunded = this.payments.refunds.filter((r) => r.trancheId === tr.id && r.status !== 'FAILED').reduce((n, r) => n + r.amountMinor, 0);
    const res = resolveDisputeDecision({ status: tr.status, fundsState: tr.fundsState, paidMinor: attempt?.amountMinor ?? 0, refundedMinor: refunded },
      decision.outcome, ADMIN, decision.amountMinor);
    const now = this.clock().toISOString();
    if (res.refundMinor > 0 && attempt) {
      const key = newId('litige');
      this.payments.requestRefund({ trancheId: tr.id, amountMinor: res.refundMinor, idempotencyKey: key, reason: decision.note, fundsState: tr.fundsState });
      await this.paymentPort.refund({ paymentId: attempt.providerRef ?? '', amountMinor: res.refundMinor, idempotencyKey: key });
    }
    if (res.fundsState) this.setFunds(tx, tr, res.fundsState, res.fundsState === 'RELEASED' ? 'FUNDS_RELEASED' : 'FUNDS_RETURNED');
    Object.assign(dispute, { status: 'RESOLVED', outcome: decision.outcome, resolvedAt: now, resolutionNote: decision.note.trim(),
      refundAmountMinor: res.refundMinor || undefined });
    this.record(tx.id, 'DISPUTE_RESOLVED', tr.id, `${decision.outcome} : ${dispute.resolutionNote}`, 'admin');
    this.notify({ type: 'DISPUTE_RESOLVED', txId: tx.id, trancheId: tr.id,
      outcome: decision.outcome === 'NO_ACTION' ? 'NO_ACTION' : decision.outcome === 'FUNDS_RELEASED' ? 'RELEASED' : 'REFUNDED' });
    if (dispute.beforePayment) {
      tr.onHold = false;
      if (tx.status === 'SUSPENDED' && !tx.tranches.some((t) => t.onHold)) { tx.status = 'ACTIVE'; this.record(tx.id, 'OPERATION_RESUMED'); }
    }
    this.closeIfDone(tx);
    this.emit();
    return tx;
  }

  /** Reçu d’une tranche débloquée ; `chainValid` vient de la vérification du journal chaîné (avec l’ancre). */
  async getReceipt(trancheId: string): Promise<Receipt> {
    const { tx, tr } = this.find(trancheId);
    // Lot X v2 : reçu dès PAID en règlement direct ; en CONDITIONAL, à la libération des fonds.
    const at = tx.settlementMode === 'CONDITIONAL' ? (tr.fundsState === 'RELEASED' ? tr.releasedAt : undefined) : tr.paidAt;
    if ((tr.status !== 'PAID' && tr.status !== 'REFUNDED') || !at) throw new ApiError('NOT_RELEASED', 'Le reçu n’existe que pour une demande payée');
    const chain = this.chains[tx.id] ?? [];
    const check = verifyChain(chain, this.anchors[tx.id]);
    // Lot X-C (T7) : référence du TrustToken de la demande, quel que soit le mode (dernier jeton, même révoqué, comme get_receipt).
    const token = this.ensureToken(tr) ?? [...this.revoked].reverse().find((k) => k.trancheId === tr.id);
    return {
      trancheId: tr.id, txId: tx.id, label: tr.label, amountMinor: tr.amountMinor, currency: tx.amount.currency,
      releasedAt: at, payerName: tx.payerName ?? '', providerName: tx.providerName, purpose: tx.purpose,
      reference: token ? formatReference(token.reference) : '', lastHash: check.lastHash, chainValid: check.valid, entryCount: check.count,
    };
  }

  /**
   * Initiateur : annule l’opération (miroir de transition_tx → CANCELLED). En ACTIVE, les demandes non payées sont annulées ;
   * l’opération est annulée si aucune n’est payée, close sinon.
   */
  async cancelOperation(txId: string, reason?: string): Promise<Transaction> {
    const user = this.requireUser();
    const tx = await this.getTransaction(txId);
    if (tx.ownerId && tx.ownerId !== user.id) throw new ApiError('TX_NOT_FOUND', 'Transaction introuvable');
    transitionOperation(tx.status, 'CANCELLED', { kind: 'USER', roles: this.rolesFor(tx), isValidator: false, isCreator: this.isCreatorOf(tx) });
    for (const tr of tx.tranches) if (tr.status === 'DRAFT' || tr.status === 'SUBMITTED' || tr.status === 'INFO_REQUESTED') tr.status = 'CANCELLED';
    if (tx.tranches.some((t) => t.status === 'ACCEPTED' || t.status === 'PAID' || t.status === 'REFUNDED')) this.closeIfDone(tx);
    else tx.status = 'CANCELLED';
    this.record(tx.id, 'TX_CANCELLED', undefined, reason?.trim(), user.role.toLowerCase());
    this.emit();
    return tx;
  }

  // ——— Lot 3 : création d’un besoin ———

  private today(): string { return toIsoDate(this.clock()); }
  private requireUser(): MockUser {
    if (!this.user) throw new ApiError('NOT_AUTHENTICATED', 'Aucun utilisateur connecté');
    return this.user;
  }
  /** Rôle de création par défaut, comme save_draft : demandeur si le profil l’est, sinon payeur. */
  private creatorRoleOf(draft?: Pick<NeedDraft, 'creatorRole'>): CreatorRole {
    return effectiveCreatorRole(draft ?? {}, this.requireUser().role) ?? 'PAYER';
  }
  /** Le créateur agit sur son dossier avec son rôle de création (lot X : PROVIDER pour une demande initiée par un prestataire). */
  private creatorActor(role: CreatorRole = this.creatorRoleOf()): Actor {
    return { kind: 'USER', roles: [role], isValidator: false, isCreator: true };
  }
  private async ownDraft(id: string): Promise<NeedDraft> {
    const user = this.requireUser();
    const d = await this.drafts.get(id);
    if (!d || (d.ownerId && d.ownerId !== user.id)) throw new ApiError('TX_NOT_FOUND', 'Brouillon introuvable');
    return d;
  }

  async searchProviders(query: string, vertical: ModuleCode): Promise<ProviderSummary[]> {
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
    // Miroir de save_draft (X4 v2) : niveau d’enrôlement du rôle de création (demandeur N1, prestataire N2).
    checkInitiation(this.levelOf(user), this.creatorRoleOf(draft));
    // X6 (K13) : aucun nom de bénéficiaire pour un module REFERENCE_ONLY ou NONE ; référence courte, sans espace.
    if (draft.vertical) checkBeneficiary(findModule(draft.vertical, this.modules), { name: draft.beneficiaryName, reference: draft.beneficiaryReference });
    if (draft.creatorRole === 'PROVIDER') {
      // Jamais soi-même comme payeur.
      const digits = (v?: string) => (v ?? '').replace(/\D/g, '');
      if (draft.counterpartyPhone && user.phone && digits(draft.counterpartyPhone) === digits(user.phone)) {
        throw new ApiError('SELF_PAYER', 'Vous ne pouvez pas être le payeur de votre propre demande');
      }
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
    // X6 (K13) : seul un type de pièce prévu par le module est accepté (la santé : le devis seul).
    if (!isAllowedKind(findModule(current.vertical, this.modules), file.kind)) {
      throw new ApiError('DOCUMENT_KIND_NOT_ALLOWED', 'Type de pièce non prévu pour ce type de besoin', { kind: file.kind });
    }
    checkFileCount(current.documents.filter((x) => x.kind === file.kind && x.status === 'UPLOADED' && x.id !== file.id).length,
      maxFilesFor(findModule(current.vertical, this.modules), file.kind));
    // Lot X (X4) : empreinte calculée avant l’envoi, comme pour le serveur (HASH_INVALID si une empreinte fournie est mal formée).
    const contentHash = checkContentHash(file.contentHash ?? await this.hashFile(file));
    for (const p of [0.1, 0.35, 0.6, 0.85]) { onProgress?.(p); await sleep(this.uploadDelayMs); }
    if (this.uploadFailureRate > 0 && this.random() < this.uploadFailureRate) {
      throw new ApiError('UPLOAD_FAILED', 'L’envoi a échoué');
    }
    const doc: DraftDocument = {
      id: file.id ?? newId('doc'), kind: file.kind, name: file.name, mimeType, sizeBytes: file.sizeBytes, uri: file.uri,
      status: 'UPLOADED', uploadedAt: this.clock().toISOString(), contentHash,
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
    const issues = validateNeed(draft, { today: this.today(), creatorRole: user.role, modules: this.modules });
    // Une verticale absente ou indisponible prime : le reste du dossier n’a pas de sens sans elle.
    if (issues.some((i) => i.code === 'VERTICAL_UNAVAILABLE')) throw new ApiError('VERTICAL_UNAVAILABLE', 'Ce type de besoin n’est pas encore ouvert');
    if (issues.some((i) => i.path === 'vertical')) throw new ApiError('VALIDATION', 'Dossier incomplet', { issues });
    const sum = issues.find((i) => i.code === 'PLAN_SUM_MISMATCH');
    if (sum) throw new ApiError('PLAN_SUM_MISMATCH', 'La somme des tranches ne correspond pas au montant', { ...sum.params });
    const missing = issues.find((i) => i.code === 'DOCUMENT_REQUIRED');
    if (missing) throw new ApiError('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', { kind: missing.params?.kind });
    for (const c of ['BENEFICIARY_NAME_NOT_ALLOWED', 'BENEFICIARY_REFERENCE_REQUIRED', 'BENEFICIARY_REFERENCE_INVALID'] as const) {
      if (issues.some((i) => i.code === c)) throw new ApiError(c, 'Bénéficiaire : référence minimale requise (K13)');
    }
    if (issues.length) throw new ApiError('VALIDATION', 'Dossier incomplet', { issues });

    const vertical = draft.vertical as ModuleCode;
    const module = findModule(vertical, this.modules) as RequestModule;   // validateNeed garantit un module connu et ouvert
    const tranches = draft.tranches ?? [];
    const totalMinor = draft.amountMinor as number;
    const uploaded = draft.documents.filter((d) => d.status === 'UPLOADED');
    const previous = draft.correctionOf ? this.txs.find((t) => t.id === draft.correctionOf && t.status === 'DRAFT') : undefined;
    // Contexte de soumission réel : plan et pièces (le domaine lève PLAN_SUM_MISMATCH ou TX_NO_DOCUMENT).
    const creatorRole = this.creatorRoleOf(draft);
    checkInitiation(this.levelOf(user), creatorRole);   // niveau contrôlé de nouveau à la soumission (submit_operation)
    // X6 (K13) : bénéficiaire selon le module (référence minimale pour la santé, jamais un nom).
    const beneficiary = checkBeneficiary(module, { name: draft.beneficiaryName, reference: draft.beneficiaryReference });
    if (module.beneficiaryMode === 'REFERENCE_ONLY' && !beneficiary.reference) {
      throw new ApiError('BENEFICIARY_REFERENCE_REQUIRED', 'Référence du bénéficiaire requise (code ou initiales)');
    }
    if (creatorRole === 'PROVIDER' && !draft.counterpartyPhone?.trim()) throw new ApiError('VALIDATION', 'Téléphone du payeur requis');
    // Contrôles de la soumission (plan, pièces) : DRAFT → ACTIVE ou PENDING_REVIEW, décidé ci-dessous par le module.
    transitionOperation('DRAFT', 'ACTIVE', { ...this.creatorActor(creatorRole), isCreator: true } as Actor, {
      totalMinor, tranches, hasSupportingDocument: uploaded.length > 0,
    });

    const now = this.clock().toISOString();
    const tx: Transaction = previous ?? ({ id: newId('tx') } as Transaction);
    Object.assign(tx, {
      vertical, settlementMode: module.settlementMode, purpose: (draft.purpose ?? '').trim(),
      amount: { amountMinor: totalMinor, currency: draft.currency ?? 'XAF' }, status: 'DRAFT', providerName: draft.provider?.name ?? (creatorRole === 'PROVIDER' ? user.name ?? '' : ''), beneficiaryName: beneficiary.name ?? '', beneficiaryReference: beneficiary.reference,
      tranches: tranches.map((t, i) => mkTranche(i + 1, t.label.trim(), t.amountMinor,
        { vertical, dueDate: t.dueDate, releaseMode: module.releaseMode, contestHours: module.contestHours })),
      createdAt: previous?.createdAt ?? now, submittedAt: now, planType: draft.planType, documentCount: uploaded.length,
      ownerId: user.id, rejectionReason: undefined, payerName: creatorRole === 'PAYER' ? user.name : undefined,
    } satisfies Partial<Transaction>);
    if (!previous) this.txs.push(tx);
    this.submitted.set(tx.id, { ...draft, correctionOf: undefined, rejectionReason: undefined });
    await this.drafts.remove(draft.id);
    this.creators[tx.id] = creatorRole;
    this.record(tx.id, previous ? 'NEED_RESUBMITTED' : 'NEED_SUBMITTED');
    // Lot X (X6) : le module décide de la revue (miroir de _platform_review). Sans revue : validation automatique.
    const decision = platformReviewDecision(module, {
      requiredValidations: requiredValidationsFor(module, tx.amount.currency, tx.amount.amountMinor),
      firstRequest: !this.txs.some((o) => o.id !== tx.id && o.ownerId === user.id && ['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(o.status)),
      duplicate: this.txs.some((o) => o.id !== tx.id && o.ownerId === user.id && !['DRAFT', 'CANCELLED'].includes(o.status)
        && o.amount.amountMinor === tx.amount.amountMinor && o.amount.currency === tx.amount.currency
        && o.providerName.trim().toLowerCase() === tx.providerName.trim().toLowerCase()
        && Math.abs(Date.parse(o.createdAt) - Date.parse(tx.createdAt)) <= 30 * 24 * HOUR),
    });
    if (!decision.review) {
      this.activate(tx, 'AUTO_ACTIVATED', 'system', false);
      return tx;
    }
    tx.status = 'PENDING_REVIEW';
    this.record(tx.id, 'REVIEW_STARTED');
    this.emit();
    return tx;
  }

  /** Lot X (X6) : types de besoin, dans l’ordre d’affichage. */
  async listModules(): Promise<RequestModule[]> { return sortModules(this.modules).map((m) => structuredClone(m)); }

  // ——— Lot X v2 (X4) : enrôlement (miroir de submit_enrolment et my_enrolment) ———

  private levelOf(user: MockUser): EnrolmentLevel { return this.enrolments[user.id]?.level ?? user.enrolmentLevel ?? 'N0'; }

  async getEnrolment(): Promise<EnrolmentView> {
    const user = this.requireUser();
    const last = this.enrolments[user.id]?.cases.at(-1);
    return { level: this.levelOf(user), ...(last ? { case: structuredClone(last) } : {}) };
  }

  async submitEnrolment(input: { level: EnrolmentLevel; documents: EnrolmentDocumentInput[]; data?: Record<string, string> }): Promise<EnrolmentCaseView> {
    const user = this.requireUser();
    const entry = (this.enrolments[user.id] ??= { cases: [] });
    checkEnrolmentSubmission({
      userId: user.id, current: this.levelOf(user), requested: input.level, documents: input.documents,
      hasOpenCase: entry.cases.some((c) => c.status === 'SUBMITTED' || c.status === 'IN_REVIEW'),
    });
    const c: EnrolmentCaseView = { id: newId('enr'), requestedLevel: input.level, status: 'SUBMITTED', route: enrolmentRoute(input.level), submittedAt: this.clock().toISOString() };
    entry.cases.push(c);
    if (c.route === 'KYC') {
      const r = await this.kyc.check({ caseId: c.id, userId: user.id, level: input.level as 'N1' | 'N2', documents: input.documents });
      c.kycResult = r.result;
      c.status = applyKycResult(c.status, r.result);
      if (c.status !== 'SUBMITTED') c.reviewedAt = this.clock().toISOString();
      if (c.status === 'REJECTED') c.rejectionReason = r.reason ?? 'Vérification d’identité refusée';
      if (c.status === 'APPROVED') entry.level = input.level;
    }
    this.emit();
    return structuredClone(c);
  }

  /**
   * Mode démonstration : le bureau de contrôle simulé décide d’une opération en revue (PENDING_REVIEW ou IN_REVIEW).
   * Approbation : ACTIVE, demandes dues soumises (TX_VALIDATED). Rejet : CANCELLED avec motif (TX_REJECTED).
   */
  async simulateReview(txId: string, decision: { approved: boolean; reason?: string }): Promise<Transaction> {
    const tx = await this.getTransaction(txId);
    const invalid = validatorDecisionError({ approved: decision.approved, amountChecked: true, reason: decision.reason });
    if (invalid) throw new ApiError(invalid, 'Décision incomplète');
    if (tx.status !== 'PENDING_REVIEW' && tx.status !== 'IN_REVIEW') throw new ApiError('NOT_IN_REVIEW', 'Le dossier n’est pas en validation');
    if (!decision.approved) {
      const reason = decision.reason?.trim() ?? '';
      tx.status = transitionOperation(tx.status, 'CANCELLED', VALIDATOR);
      tx.rejectionReason = reason;
      for (const tr of tx.tranches) if (tr.status === 'DRAFT') tr.status = 'CANCELLED';
      this.record(tx.id, 'NEED_REJECTED', undefined, reason, 'validator');
      this.notify({ type: 'TX_REJECTED', txId, reason });
      this.emit();
      return tx;
    }
    transitionOperation(tx.status, 'ACTIVE', VALIDATOR);
    this.activate(tx, 'NEED_VALIDATED', 'validator', true);
    return tx;
  }


  // ——— Lot X (X1) : révocation, réglage de l’image du QR ———

  private manageToken(trancheId: string): { tx: Transaction; tr: Tranche } {
    this.requireUser();
    const { tx, tr } = this.find(trancheId);
    if (!this.isParty(tx) && !this.isCreatorOf(tx)) throw new DomainError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
    const err = tokenRevocationError(tr.status, { isCreator: this.isCreatorOf(tx) });
    if (err) throw new DomainError(err, err === 'NOT_REVOCABLE' ? 'Tranche déjà payée' : 'Réservé à l’initiateur de la demande');
    return { tx, tr };
  }
  /** Retire le jeton actif (conservé comme révoqué) ; false s’il n’y en avait pas. */
  private withdrawToken(tx: Transaction, tr: Tranche, reason: string): boolean {
    // Lot X-C (T7) : tous modes ; rien à retirer pour une demande non soumise ou au statut final (NO_TOKEN), comme le serveur.
    const active = tr.status === 'DRAFT' || this.tokenSpent(tx, tr) ? null : this.ensureToken(tr);
    if (!active) return false;
    this.revoked.push({ ...active, revokedAt: this.clock().toISOString(), reason: reason.trim() });
    this.tokens.delete(tr.id);
    this.withdrawn.add(tr.id);
    tr.reference = undefined;
    this.record(tx.id, 'TOKEN_REVOKED', tr.id, reason.trim(), this.user?.role.toLowerCase());
    return true;
  }
  async revokeToken(trancheId: string, reason: string): Promise<void> {
    const { tx, tr } = this.manageToken(trancheId);
    if (messageError(reason) === 'REASON_REQUIRED') throw new DomainError('REASON_REQUIRED', 'Motif de révocation obligatoire');
    if (!this.withdrawToken(tx, tr, reason)) throw new DomainError('NO_TOKEN', 'Aucun jeton actif pour cette tranche');
    this.emit();
  }
  async reissueToken(trancheId: string, reason = 'Réémission du jeton'): Promise<void> {
    const { tx, tr } = this.manageToken(trancheId);
    if (tr.status === 'DRAFT') throw new DomainError('NO_TOKEN', 'Demande pas encore soumise : aucun jeton');
    if (messageError(reason) === 'REASON_REQUIRED') throw new DomainError('REASON_REQUIRED', 'Motif de réémission obligatoire');
    this.withdrawToken(tx, tr, reason);
    this.withdrawn.delete(tr.id);
    // Nouvelle référence : jamais celle d’un jeton révoqué ni d’une autre tranche.
    let n = 0;
    do {
      tr.reference = hexDigest(`${tr.id}:reissue:${this.revoked.length}:${n++}`, 18);
    } while (this.revoked.some((k) => k.reference === tr.reference)
      || this.txs.some((x) => x.tranches.some((r) => r !== tr && r.reference === tr.reference)));
    this.ensureToken(tr);
    this.record(tx.id, 'TOKEN_REISSUED', tr.id, undefined, this.user?.role.toLowerCase());
    this.emit();
  }
  async eqrImageEnabled(): Promise<boolean> { return this.eqrImage; }

  // ——— Lot X (X2) : décisions du payeur ———

  /** Tranche d’une demande en cours pour une partie (miroir de _request_tranche). */
  private requestTranche(trancheId: string): { tx: Transaction; tr: Tranche; who: { isPayer: boolean; isCreator: boolean; onHold: boolean } } {
    this.requireUser();
    const { tx, tr } = this.find(trancheId);
    if (!this.isParty(tx) && !this.isCreatorOf(tx)) throw new DomainError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
    if (tr.onHold) throw new DomainError('REQUEST_ON_HOLD', 'Demande suspendue par un litige');   // comme 0018
    if (tx.status !== 'ACTIVE') throw new DomainError('TX_NOT_ACTIVE', 'L’opération n’est pas active');
    return { tx, tr, who: { isPayer: this.rolesFor(tx).includes('PAYER'), isCreator: this.isCreatorOf(tx), onHold: tr.onHold } };
  }
  private addMessage(tx: Transaction, tr: Tranche, kind: RequestMessageKind, body: string): void {
    this.messages.push({ id: newId('msg'), txId: tx.id, trancheId: tr.id, kind, body: body.trim(), at: this.clock().toISOString(), authorId: this.user?.id ?? '' });
  }
  async markReceived(trancheId: string): Promise<void> {
    this.requireUser();
    const { tx, tr } = this.find(trancheId);
    if (!this.isParty(tx) && !this.isCreatorOf(tx)) throw new DomainError('TRANCHE_NOT_FOUND', 'Tranche introuvable');
    if (!this.rolesFor(tx).includes('PAYER')) throw new DomainError('PAYER_ONLY', 'Réservé au payeur');
    if (this.viewed[tr.id]) return;
    this.viewed[tr.id] = this.clock().toISOString();
    this.record(tx.id, 'REQUEST_VIEWED', tr.id, undefined, 'payer');
    this.emit();
  }
  async requestInfo(trancheId: string, message: string): Promise<Transaction> {
    const { tx, tr, who } = this.requestTranche(trancheId);
    tr.status = requestInfoDecision(tr.status, who, message);
    this.addMessage(tx, tr, 'INFO_REQUEST', message);
    this.record(tx.id, 'INFO_REQUESTED', tr.id, undefined, 'payer');
    this.notify({ type: 'INFO_REQUESTED', txId: tx.id, trancheId: tr.id });
    this.emit();
    return tx;
  }
  async answerInfo(trancheId: string, message: string): Promise<Transaction> {
    const { tx, tr, who } = this.requestTranche(trancheId);
    tr.status = answerInfoDecision(tr.status, who, message);
    this.addMessage(tx, tr, 'INFO_ANSWER', message);
    this.record(tx.id, 'INFO_ANSWERED', tr.id, undefined, this.user?.role.toLowerCase());
    this.notify({ type: 'INFO_ANSWERED', txId: tx.id, trancheId: tr.id });
    this.emit();
    return tx;
  }
  async rejectRequest(trancheId: string, reason: string): Promise<Transaction> {
    const { tx, tr, who } = this.requestTranche(trancheId);
    const to = rejectRequestDecision(tr.status, who, reason);
    this.addMessage(tx, tr, 'NOTE', reason);
    this.withdrawToken(tx, tr, 'Demande rejetée par le payeur');
    tr.status = to;
    this.record(tx.id, 'REQUEST_REJECTED', tr.id, reason.trim(), 'payer');
    this.notify({ type: 'REQUEST_REJECTED', txId: tx.id, trancheId: tr.id });
    this.closeIfDone(tx);
    this.emit();
    return tx;
  }
  async listMessages(trancheId: string): Promise<RequestMessage[]> {
    const { tx } = this.find(trancheId);
    if (!this.isParty(tx) && !this.isCreatorOf(tx)) return [];
    return this.messages.filter((m) => m.trancheId === trancheId)
      .map((m) => ({ id: m.id, txId: m.txId, trancheId: m.trancheId, kind: m.kind, body: m.body, at: m.at, mine: m.authorId === this.user?.id }));
  }

  // ——— Lot X (X3) ———

  /** Payeur : accepte le principe du plan, une fois (idempotent) ; n’autorise aucun paiement à l’avance (K6). */
  async acceptPlan(txId: string): Promise<Transaction> {
    this.requireUser();
    const tx = await this.getTransaction(txId);
    if (!this.isParty(tx) && !this.isCreatorOf(tx)) throw new DomainError('TX_NOT_FOUND', 'Transaction introuvable');
    if (!this.rolesFor(tx).includes('PAYER')) throw new DomainError('PAYER_ONLY', 'Réservé au payeur');
    if (tx.status !== 'ACTIVE' && tx.status !== 'SUSPENDED') throw new DomainError('TX_NOT_ACTIVE', 'L’opération n’est pas active');
    if (tx.acceptedAt) return tx;
    tx.acceptedAt = this.clock().toISOString();
    this.record(tx.id, 'PLAN_ACCEPTED', undefined, undefined, 'payer');
    this.notify({ type: 'PLAN_ACCEPTED', txId: tx.id });
    this.emit();
    return tx;
  }

  // ——— Lot X (X4) : TrustVault ———

  /** Pièces des dossiers soumis (le simulateur les garde dans l’instantané du brouillon soumis). */
  private submittedDocuments(): Array<{ tx: Transaction; doc: DraftDocument }> {
    const out: Array<{ tx: Transaction; doc: DraftDocument }> = [];
    for (const [txId, d] of this.submitted) {
      const tx = this.txs.find((t) => t.id === txId);
      if (tx) for (const doc of d.documents) if (doc.status === 'UPLOADED') out.push({ tx, doc });
    }
    return out;
  }

  /**
   * Consultation d’une pièce (miroir de get_document_access) : DOCUMENT_VIEWED au journal du dossier, sauf pour le brouillon
   * jamais soumis de son créateur. Pièce inconnue ou inaccessible : NOT_FOUND.
   */
  async getDocumentAccess(documentId: string): Promise<DocumentAccess> {
    const user = this.requireUser();
    const access = (doc: DraftDocument): DocumentAccess =>
      ({ id: doc.id, url: doc.uri ?? '', name: doc.name, mimeType: doc.mimeType, contentHash: doc.contentHash });
    for (const d of await this.drafts.list()) {
      const doc = d.ownerId === user.id ? d.documents.find((x) => x.id === documentId && x.status === 'UPLOADED') : undefined;
      if (!doc) continue;
      if (d.correctionOf) { this.record(d.correctionOf, 'DOCUMENT_VIEWED', undefined, doc.kind, 'creator'); this.emit(); }
      return access(doc);
    }
    const hit = this.submittedDocuments().find((x) => x.doc.id === documentId);
    if (!hit || !(this.isParty(hit.tx) || this.isCreatorOf(hit.tx))) throw new DomainError('NOT_FOUND', 'Pièce introuvable');
    this.record(hit.tx.id, 'DOCUMENT_VIEWED', undefined, hit.doc.kind, (this.rolesFor(hit.tx)[0] ?? 'creator').toLowerCase());
    this.emit();
    return access(hit.doc);
  }

  /** Réutilisation d’un justificatif (miroir de document_reuse) : un nombre seulement ; empreinte d’une pièce visible, sinon NOT_FOUND. */
  async documentReuse(contentHash: string, txId?: string): Promise<DocumentReuse> {
    const user = this.requireUser();
    const h = checkContentHash(contentHash);
    if (!h) throw new DomainError('HASH_INVALID', 'Empreinte invalide (SHA-256 hexadécimal attendu)');
    const mine = (await this.drafts.list()).filter((d) => d.ownerId === user.id).flatMap((d) => d.documents.map((doc) => ({ txId: d.correctionOf ?? d.id, doc })));
    const visible = [...mine, ...this.submittedDocuments().filter((x) => this.isParty(x.tx) || this.isCreatorOf(x.tx)).map((x) => ({ txId: x.tx.id, doc: x.doc }))];
    if (!visible.some((x) => x.doc.contentHash === h && (txId === undefined || x.txId === txId))) throw new DomainError('NOT_FOUND', 'Pièce introuvable');
    const others = otherDossiersWithHash(h, this.submittedDocuments().map((x) => ({ txId: x.tx.id, contentHash: x.doc.contentHash, txStatus: x.tx.status })), txId);
    return { reused: others.length > 0, count: others.length };
  }

  async createDraft(input: { vertical: ModuleCode; creatorRole: CreatorRole }): Promise<NeedDraft> {
    return this.saveDraft({ ...emptyDraft(newId('need'), this.clock()), vertical: input.vertical, creatorRole: input.creatorRole });
  }

  /** Équivalent de release_due_tranches() côté serveur. Retourne le nombre de tranches débloquées. */
  runTimers(): number {
    const now = this.clock();
    let n = 0;
    for (const tx of this.txs) {
      for (const tr of tx.tranches) {
        if (isAutoReleasable(this.conditionalState(tx, tr), now)) { this.setFunds(tx, tr, 'RELEASED', 'FUNDS_RELEASED'); n++; }
      }
    }
    return n;
  }
}

/** Devis du moteur vu par le payeur (sans le payeur ni la consommation). */
function toPaymentQuote(q: FxQuote): PaymentQuote {
  const { payerId: _p, usedAt: _u, attemptId: _a, ...rest } = q;
  return { ...rest, fees: { ...q.fees } };
}
