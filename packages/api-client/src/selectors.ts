import { isRequestFinal } from '@diaspay/domain';
import type { Money } from '@diaspay/domain';
import type { Tranche, Transaction } from './types';

/** Total des fonds bloqués (CONDITIONAL : demandes payées dont les fonds ne sont pas libérés), par devise. En DIRECT : rien. */
export function lockedFunds(txs: readonly Transaction[]): Money[] {
  const byCurrency = new Map<Money['currency'], number>();
  for (const tx of txs) {
    for (const tr of tx.tranches) {
      if (tr.status === 'PAID' && tr.fundsState === 'HELD') {
        byCurrency.set(tx.amount.currency, (byCurrency.get(tx.amount.currency) ?? 0) + tr.amountMinor);
      }
    }
  }
  return [...byCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

export interface PendingPayment { tx: Transaction; tranche: Tranche }

/** Prochaine demande à payer (soumise au payeur, non suspendue ; échéance la plus proche). */
export function nextPayment(txs: readonly Transaction[]): PendingPayment | undefined {
  const all: PendingPayment[] = [];
  for (const tx of txs) {
    if (tx.status !== 'ACTIVE') continue;
    for (const tranche of tx.tranches) if (tranche.status === 'SUBMITTED' && !tranche.onHold) all.push({ tx, tranche });
  }
  all.sort((a, b) => (a.tranche.dueDate ?? '9999').localeCompare(b.tranche.dueDate ?? '9999'));
  return all[0];
}

export function trancheCount(txs: readonly Transaction[]): number {
  return txs.reduce((n, t) => n + t.tranches.length, 0);
}

/**
 * Lot A (T5) : place de l’utilisateur dans une opération, lue depuis les parties du dossier (myRoles) et l’initiateur,
 * jamais depuis le rôle principal du profil. Un payeur qui a lui-même créé son besoin est à la fois payeur et initiateur.
 */
export interface OperationPlace { payer: boolean; initiator: boolean; provider: boolean }
export function placeIn(tx: Transaction, userId: string | undefined): OperationPlace {
  const roles = tx.myRoles ?? [];
  return {
    payer: roles.includes('PAYER'),
    provider: roles.includes('PROVIDER'),
    initiator: !!userId && (tx.initiatorId ?? tx.ownerId) === userId,
  };
}
/** Demande que l’utilisateur doit payer : il est payeur de l’opération. */
export const isToPay = (tx: Transaction, userId: string | undefined) => placeIn(tx, userId).payer;
/** Demande envoyée : l’utilisateur l’a initiée pour qu’un autre la paie. */
export const isSent = (tx: Transaction, userId: string | undefined) => { const p = placeIn(tx, userId); return p.initiator && !p.payer; };

export type TxFilter = 'ALL' | 'TO_PAY' | 'SENT' | 'ACTIVE' | 'REVIEW' | 'CLOSED';

export function filterTransactions(txs: readonly Transaction[], f: TxFilter, userId?: string): Transaction[] {
  switch (f) {
    case 'TO_PAY': return txs.filter((t) => isToPay(t, userId));
    case 'SENT': return txs.filter((t) => isSent(t, userId));
    case 'ACTIVE': return txs.filter((t) => t.status === 'ACTIVE' || t.status === 'SUSPENDED');
    // En vérification : revue du bureau (opération), ou demande en attente d’informations.
    case 'REVIEW': return txs.filter((t) => ['PENDING_REVIEW', 'IN_REVIEW'].includes(t.status) || t.tranches.some((r) => r.status === 'INFO_REQUESTED'));
    // Clôturées : terminées ou annulées.
    case 'CLOSED': return txs.filter((t) => t.status === 'CLOSED' || t.status === 'CANCELLED');
    default: return [...txs];
  }
}

/** Position de la demande en cours (1-based) : première demande non finale. */
export function currentTrancheIndex(tx: Transaction): number {
  const i = tx.tranches.findIndex((t) => !isRequestFinal(t.status, t.fundsState));
  return i === -1 ? tx.tranches.length : i + 1;
}
