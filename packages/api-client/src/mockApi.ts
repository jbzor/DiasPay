import {
  DomainError, RELEASE_RULES, canOpenDispute, isAutoReleasable, shouldCloseTransaction, transitionTranche,
} from '@diaspay/domain';
import type { Actor, TrancheStatus, TxRole } from '@diaspay/domain';
import type { AuditEntry, Persona, Tranche, Transaction, TransactionApi } from './types';

type Listener = () => void;
const HOUR = 3_600_000;

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
      mkTranche(1, 'Inscription', 300_000, { vertical: 'EDUCATION', status: 'CONFIRMED', dueDate: '2026-10-15', contestEndsAt: iso(48 * HOUR), reference: '4F9A2C71B8E0' }),
      mkTranche(2, 'Scolarité T1', 300_000, { vertical: 'EDUCATION', status: 'AWAITING_PAYMENT', dueDate: '2026-11-15', reference: '7B31D0A9C5E2' }),
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
        reference: i === 3 ? 'A1C4E8F20B93' : undefined,
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

  constructor(private readonly clock: () => Date = () => new Date(), seed?: Transaction[]) {
    this.txs = seed ?? seedTransactions(clock());
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): readonly Transaction[] => this.txs;
  setPersona(p: Persona): void { this.persona = p; this.emit(); }
  private emit(): void { this.txs = [...this.txs]; this.listeners.forEach((l) => l()); }
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

  async listTransactions() { return this.txs; }
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
  async confirmByReference(reference: string) {
    const clean = reference.replace(/[\s-]/g, '').toUpperCase();
    const hit = this.txs.flatMap((tx) => tx.tranches.map((tr) => ({ tx, tr }))).find(({ tr }) => tr.reference === clean);
    if (!hit) throw new DomainError('UNKNOWN_REFERENCE', 'Référence inconnue');
    if (this.persona !== 'PROVIDER') throw new DomainError('PROVIDER_ONLY', 'Réservé au prestataire');
    if (hit.tr.status !== 'PAID_LOCKED') throw new DomainError('NOT_PAID', `Tranche non payée ou déjà traitée (${hit.tr.status})`);
    return this.apply(hit.tr.id, 'CONFIRMED', actorFor('PROVIDER'), 'PROVIDER_SCAN');
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
