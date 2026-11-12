import type { AppNotification, Transaction } from '@diaspay/api-client';

// Écran Alertes : logique pure (regroupement par jour, libellés par type d’événement). Testée.

/** Jour local AAAA-MM-JJ d’un instant ISO. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface AlertGroup {
  /** « today », « yesterday » ou le jour AAAA-MM-JJ. */
  key: string;
  day: string;
  items: AppNotification[];
}

/** Regroupe par jour local, du plus récent au plus ancien ; dans un jour, la plus récente d’abord. */
export function groupByDay(list: readonly AppNotification[], now: Date): AlertGroup[] {
  const today = localDay(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = localDay(y.toISOString());
  const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at));
  const groups: AlertGroup[] = [];
  for (const n of sorted) {
    const day = localDay(n.at);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { key: day === today ? 'today' : day === yesterday ? 'yesterday' : day, day, items: [] };
      groups.push(g);
    }
    g.items.push(n);
  }
  return groups;
}

export const unreadCount = (list: readonly AppNotification[]): number => list.filter((n) => !n.readAt).length;

/** Clés i18n du titre et du texte, et paramètres, d’une alerte. La langue courante fait le libellé. */
export interface AlertKeys { title: string; body: string; params: Record<string, string | number> }

export interface AlertFormat {
  vertical: (tx: Transaction) => string;
  date: (iso: string) => string;
  dateTime: (iso: string) => string;
  /** Libellé traduit de l’issue d’un litige. */
  outcome: (o: 'RELEASED' | 'REFUNDED') => string;
}

export function alertKeys(n: AppNotification, txs: readonly Transaction[], f: AlertFormat): AlertKeys {
  const e = n.event;
  const tx = txs.find((t) => t.id === e.txId);
  const tr = 'trancheId' in e ? tx?.tranches.find((x) => x.id === e.trancheId) : undefined;
  const base = {
    type: tx ? f.vertical(tx) : '',
    provider: tx?.providerName ?? '',
    n: tr?.seq ?? '',
  };
  switch (e.type) {
    case 'TX_VALIDATED': return { title: 'alert_TX_VALIDATED_title', body: 'alert_TX_VALIDATED_body', params: base };
    case 'TX_REJECTED': return { title: 'alert_TX_REJECTED_title', body: 'alert_TX_REJECTED_body', params: { ...base, reason: e.reason } };
    case 'PAYMENT_READY': return {
      title: 'alert_PAYMENT_READY_title', body: tr?.dueDate ? 'alert_PAYMENT_READY_body' : 'alert_PAYMENT_READY_body_nodate',
      params: { ...base, date: tr?.dueDate ? f.date(tr.dueDate) : '' },
    };
    case 'TRANCHE_CONFIRMED': return {
      title: 'alert_TRANCHE_CONFIRMED_title', body: e.releaseAt ? 'alert_TRANCHE_CONFIRMED_body' : 'alert_TRANCHE_CONFIRMED_body_noauto',
      params: { ...base, date: e.releaseAt ? f.dateTime(e.releaseAt) : '' },
    };
    case 'TRANCHE_RELEASED': return { title: 'alert_TRANCHE_RELEASED_title', body: 'alert_TRANCHE_RELEASED_body', params: base };
    case 'DISPUTE_OPENED': return { title: 'alert_DISPUTE_OPENED_title', body: 'alert_DISPUTE_OPENED_body', params: base };
    case 'DISPUTE_RESOLVED': return { title: 'alert_DISPUTE_RESOLVED_title', body: 'alert_DISPUTE_RESOLVED_body', params: { ...base, outcome: f.outcome(e.outcome) } };
    // Lot X : textes génériques, sans montant ni motif (le détail se lit dans le dossier).
    case 'PAYMENT_REQUEST_RECEIVED': return { title: 'alert_PAYMENT_REQUEST_RECEIVED_title', body: 'alert_PAYMENT_REQUEST_RECEIVED_body', params: base };
    case 'INFO_REQUESTED': return { title: 'alert_INFO_REQUESTED_title', body: 'alert_INFO_REQUESTED_body', params: base };
    case 'INFO_ANSWERED': return { title: 'alert_INFO_ANSWERED_title', body: 'alert_INFO_ANSWERED_body', params: base };
    case 'REQUEST_REJECTED': return { title: 'alert_REQUEST_REJECTED_title', body: 'alert_REQUEST_REJECTED_body', params: base };
  }
}

/** Tous les types d’événement (parité des libellés). */
export const ALERT_TYPES = [
  'TX_VALIDATED', 'TX_REJECTED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED',
  'PAYMENT_REQUEST_RECEIVED', 'INFO_REQUESTED', 'INFO_ANSWERED', 'REQUEST_REJECTED',
] as const;
