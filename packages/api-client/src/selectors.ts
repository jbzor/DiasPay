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

export type TxFilter = 'ALL' | 'ACTIVE' | 'REVIEW' | 'CLOSED';

export function filterTransactions(txs: readonly Transaction[], f: TxFilter): Transaction[] {
  switch (f) {
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
