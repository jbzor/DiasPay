import type { Money, TrancheStatus } from '@diaspay/domain';
import type { Tranche, Transaction } from './types';

const LOCKED: readonly TrancheStatus[] = ['PAID_LOCKED', 'EVIDENCE_SUBMITTED', 'CONFIRMED', 'DISPUTED'];

/** Total des fonds affectés et verrouillés, par devise. */
export function lockedFunds(txs: readonly Transaction[]): Money[] {
  const byCurrency = new Map<Money['currency'], number>();
  for (const tx of txs) {
    for (const tr of tx.tranches) {
      if (LOCKED.includes(tr.status)) {
        byCurrency.set(tx.amount.currency, (byCurrency.get(tx.amount.currency) ?? 0) + tr.amountMinor);
      }
    }
  }
  return [...byCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

export interface PendingPayment { tx: Transaction; tranche: Tranche }

/** Prochaine tranche à payer (échéance la plus proche). */
export function nextPayment(txs: readonly Transaction[]): PendingPayment | undefined {
  const all: PendingPayment[] = [];
  for (const tx of txs) {
    for (const tranche of tx.tranches) if (tranche.status === 'AWAITING_PAYMENT') all.push({ tx, tranche });
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
    case 'ACTIVE': return txs.filter((t) => t.status === 'IN_PROGRESS');
    case 'REVIEW': return txs.filter((t) => ['SUBMITTED', 'IN_REVIEW'].includes(t.status) || t.tranches.some((r) => r.status === 'EVIDENCE_SUBMITTED'));
    case 'CLOSED': return txs.filter((t) => t.status === 'CLOSED');
    default: return [...txs];
  }
}

/** Position de la tranche en cours (1-based) : première tranche non terminée. */
export function currentTrancheIndex(tx: Transaction): number {
  const i = tx.tranches.findIndex((t) => !['RELEASED', 'CANCELLED', 'EXPIRED'].includes(t.status));
  return i === -1 ? tx.tranches.length : i + 1;
}
