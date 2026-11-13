import { t, tMaybe } from '@/i18n';
import type { AuditRow } from './bo';

/**
 * Événements génériques : leur libellé vient de l’état d’arrivée (opération, demande via payload.tranche_to, ou fonds via
 * payload.funds_to). Les statuts du lot X v2 et les anciens (journal en ajout seul) ont chacun leur libellé.
 */
const GENERIC = new Set(['STATUS_CHANGE', 'SYSTEM_SIMULATED', 'TRANCHE_CHANGE', 'DEMO_REVIEW']);

/** Libellé lisible d’une ligne du journal (« Dossier soumis », « Jeton émis », « Pièce consultée : devis.pdf »). */
export function eventLabel(r: AuditRow): string {
  const p = r.payload;
  if (r.event === 'VALIDATION_DECISION') return t(p.approved ? 'event.VALIDATION_DECISION.approved' : 'event.VALIDATION_DECISION.rejected');
  if (r.event === 'DOCUMENT_VIEWED') return t('event.DOCUMENT_VIEWED.file', { name: String(p.file_name ?? p.kind ?? '') });
  if (!GENERIC.has(r.event)) {
    const specific = tMaybe(`event.${r.event}`);
    if (specific) return specific;
  }
  // Rejet par le bureau (lot X v2) : la revue annule l’opération (IN_REVIEW → CANCELLED, decide_tx ou demo_review).
  if (r.toStatus === 'CANCELLED' && (r.fromStatus === 'IN_REVIEW' || r.fromStatus === 'PENDING_REVIEW')) return t('event.STATUS_CHANGE.CANCELLED.review');
  if (r.toStatus) {
    const byStatus = tMaybe(`event.${r.event === 'SYSTEM_SIMULATED' ? 'SYSTEM_SIMULATED' : 'STATUS_CHANGE'}.${r.toStatus}`);
    if (byStatus) return byStatus;
  }
  if (typeof p.tranche_to === 'string') {
    const byTranche = tMaybe(`event.trancheTo.${p.tranche_to}`);
    if (byTranche) return byTranche;
  }
  if (typeof p.funds_to === 'string') {
    const byFunds = tMaybe(`event.fundsTo.${p.funds_to}`);
    if (byFunds) return byFunds;
  }
  return tMaybe(`event.${r.event}`) ?? t('event.unknown', { code: r.event });
}

/** Acteur affiché : « Marie N. (payeur) », « Validateur A (validateur) », « Système ». */
export function actorLabel(r: AuditRow): string {
  if (!r.actorId) return t('common.system');
  const name = r.actorName ?? t('common.none');
  return tMaybe(`actor.${r.actorRole ?? 'USER'}`, { name }) ?? name;
}

/** Tranche concernée : « Tranche 1 », « Toutes » (jeton du dossier, ancien parcours), « — ». */
export function trancheLabel(r: AuditRow): string {
  if (r.trancheSeq != null) return t('journal.trancheN', { n: r.trancheSeq });
  if (r.toStatus === 'TOKEN_ISSUED') return t('journal.allTranches');
  return t('common.none');
}
