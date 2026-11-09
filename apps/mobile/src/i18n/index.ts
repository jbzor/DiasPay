import { useSyncExternalStore } from 'react';
import { formatMoney } from '@diaspay/domain';
import type { Money, TrancheStatus, TxStatus } from '@diaspay/domain';

export type Locale = 'fr' | 'en';

const fr = {
  hello: 'Bonjour {name}', roleLine: '{city} · {role}', payer: 'Payeur', provider: 'Prestataire',
  lockedFunds: 'Fonds affectés en cours', counts: '{tx} transactions · {tr} tranches', todo: 'À faire',
  dueOn: 'Échéance le {date}', trancheOf: 'Tranche {n} sur {total}', payTranche: 'Payer la tranche', myTx: 'Mes transactions',
  newNeed: 'Nouveau besoin', soon: 'Bientôt disponible', tabHome: 'Accueil', tabTx: 'Transactions', tabScan: 'Scanner',
  tabAlerts: 'Alertes', tabProfile: 'Profil', all: 'Toutes', active: 'En cours', toReview: 'À valider', closed: 'Clôturées',
  back: 'Retour', beneficiary: 'Bénéficiaire', providerLabel: 'Prestataire', purpose: 'Objectif', total: 'Montant total',
  pay: 'Payer', openDispute: 'Ouvrir un litige', release: 'Débloquer', amountToPay: 'Montant à payer', fees: 'Frais',
  feesTbd: '[À DÉFINIR]', card: 'Carte bancaire', mobileMoney: 'Mobile money', sepa: 'Virement SEPA', payWithBio: 'Payer avec Face ID',
  simulated: 'Paiement simulé', lockedNote: 'Vos fonds restent verrouillés jusqu’à la confirmation du prestataire.',
  bioReason: 'Confirmez le paiement', bioFailed: 'Authentification refusée',
  releasedOn: 'Débloquée le {date}', plannedOn: 'Prévue le {date}', payBefore: 'À payer avant le {date}',
  confirmedAuto: 'Confirmée. Déblocage automatique le {date}.', awaitingProvider: 'Payée. En attente de confirmation du prestataire.',
  evidencePending: 'Preuve en cours de validation.', disputed: 'Litige en cours : tranche suspendue.',
  disputeBanner: 'La tranche est suspendue jusqu’à la décision d’un administrateur.', reason: 'Motif', describe: 'Décrivez le problème',
  min10: '10 caractères minimum', cancel: 'Annuler', reasonNone: 'Prestation non réalisée', reasonPartial: 'Prestation incomplète',
  reasonAmount: 'Montant incorrect', reasonOther: 'Autre', scanTitle: 'Confirmer une prestation', scanHint: 'Saisissez la référence de l’eQR. Le scan par caméra arrive à l’étape suivante.',
  reference: 'Référence', confirmService: 'Confirmer la prestation', providerOnly: 'Cet écran est réservé au prestataire. Changez de profil dans l’onglet Profil (démonstration).',
  scanOk: 'Prestation confirmée : {label}. Le payeur dispose de {hours} h pour contester.',
  noAlerts: 'Aucune alerte pour le moment.', demoProfile: 'Profil de démonstration', language: 'Langue',
  demoNote: 'Données simulées. Aucun paiement réel n’est effectué.', notFound: 'Introuvable',
  txReview: 'En validation', txActive: 'En cours', txDraft: 'Brouillon', txClosed: 'Clôturée', txRejected: 'Rejetée', txDisputed: 'Litige',
  txValidated: 'Validée', txToken: 'Jeton émis', txSubmitted: 'Soumise', evidenceToValidate: 'Preuve à valider',
  trPlanned: 'Prévue', trAwaiting: 'À payer', trPaid: 'Payée', trEvidence: 'Preuve soumise', trConfirmed: 'Confirmée', trReleased: 'Débloquée',
  trDisputed: 'Litige', trCancelled: 'Annulée', trExpired: 'Expirée', milestone: 'Jalon',
  err_REASON_TOO_SHORT: 'Décrivez le problème (10 caractères minimum)', err_UNKNOWN_REFERENCE: 'Référence inconnue',
  err_PROVIDER_ONLY: 'Réservé au prestataire', err_NOT_PAID: 'Tranche non payée ou déjà traitée', err_DISPUTE_NOT_ALLOWED: 'Litige impossible (état ou délai de contestation écoulé)',
  filter: 'Filtrer les transactions', noTx: 'Aucune transaction.', status: 'Statut', tranches: 'Tranches',
  trancheCount: '{n} tranche(s)', payMethod: 'Moyen de paiement', amount: 'Montant', contestEnds: 'Fin du délai de contestation',
  langFr: 'Français', langEn: 'English',
  err_generic: 'Une erreur est survenue. Réessayez.',
} as const;

type Key = keyof typeof fr;

const en: Record<Key, string> = {
  hello: 'Hello {name}', roleLine: '{city} · {role}', payer: 'Payer', provider: 'Provider',
  lockedFunds: 'Funds currently earmarked', counts: '{tx} transactions · {tr} installments', todo: 'To do',
  dueOn: 'Due {date}', trancheOf: 'Installment {n} of {total}', payTranche: 'Pay installment', myTx: 'My transactions',
  newNeed: 'New need', soon: 'Coming soon', tabHome: 'Home', tabTx: 'Transactions', tabScan: 'Scan',
  tabAlerts: 'Alerts', tabProfile: 'Profile', all: 'All', active: 'Active', toReview: 'To review', closed: 'Closed',
  back: 'Back', beneficiary: 'Beneficiary', providerLabel: 'Provider', purpose: 'Purpose', total: 'Total amount',
  pay: 'Pay', openDispute: 'Open a dispute', release: 'Release', amountToPay: 'Amount to pay', fees: 'Fees',
  feesTbd: '[TO BE DEFINED]', card: 'Bank card', mobileMoney: 'Mobile money', sepa: 'SEPA transfer', payWithBio: 'Pay with Face ID',
  simulated: 'Simulated payment', lockedNote: 'Your funds stay locked until the provider confirms.',
  bioReason: 'Confirm the payment', bioFailed: 'Authentication declined',
  releasedOn: 'Released on {date}', plannedOn: 'Planned for {date}', payBefore: 'Pay before {date}',
  confirmedAuto: 'Confirmed. Automatic release on {date}.', awaitingProvider: 'Paid. Waiting for the provider’s confirmation.',
  evidencePending: 'Evidence under review.', disputed: 'Dispute in progress: installment on hold.',
  disputeBanner: 'The installment is on hold until an administrator decides.', reason: 'Reason', describe: 'Describe the problem',
  min10: 'At least 10 characters', cancel: 'Cancel', reasonNone: 'Service not delivered', reasonPartial: 'Service incomplete',
  reasonAmount: 'Incorrect amount', reasonOther: 'Other', scanTitle: 'Confirm a service', scanHint: 'Enter the eQR reference. Camera scanning comes in the next step.',
  reference: 'Reference', confirmService: 'Confirm the service', providerOnly: 'This screen is for providers. Switch profile in the Profile tab (demo).',
  scanOk: 'Service confirmed: {label}. The payer has {hours} h to contest.',
  noAlerts: 'No alerts for now.', demoProfile: 'Demo profile', language: 'Language',
  demoNote: 'Simulated data. No real payment is made.', notFound: 'Not found',
  txReview: 'In review', txActive: 'Active', txDraft: 'Draft', txClosed: 'Closed', txRejected: 'Rejected', txDisputed: 'Dispute',
  txValidated: 'Validated', txToken: 'Token issued', txSubmitted: 'Submitted', evidenceToValidate: 'Evidence to review',
  trPlanned: 'Planned', trAwaiting: 'To pay', trPaid: 'Paid', trEvidence: 'Evidence sent', trConfirmed: 'Confirmed', trReleased: 'Released',
  trDisputed: 'Dispute', trCancelled: 'Cancelled', trExpired: 'Expired', milestone: 'Milestone',
  err_REASON_TOO_SHORT: 'Describe the problem (at least 10 characters)', err_UNKNOWN_REFERENCE: 'Unknown reference',
  err_PROVIDER_ONLY: 'Providers only', err_NOT_PAID: 'Installment not paid or already handled', err_DISPUTE_NOT_ALLOWED: 'Dispute not possible (state or contest period over)',
  filter: 'Filter transactions', noTx: 'No transactions.', status: 'Status', tranches: 'Installments',
  trancheCount: '{n} installment(s)', payMethod: 'Payment method', amount: 'Amount', contestEnds: 'End of contest period',
  langFr: 'Français', langEn: 'English',
  err_generic: 'Something went wrong. Please try again.',
};

const dicts: Record<Locale, Record<Key, string>> = { fr, en };

let locale: Locale = 'fr';
const listeners = new Set<() => void>();
export const setLocale = (l: Locale) => { locale = l; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function useI18n() {
  const loc = useSyncExternalStore(subscribe, () => locale);
  const t: T = (key, params) => {
    let s: string = dicts[loc][key];
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  const date = (iso: string) => new Intl.DateTimeFormat(loc === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  const dateTime = (iso: string) => new Intl.DateTimeFormat(loc === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const money = (m: Money) => formatMoney(m, loc === 'fr' ? 'fr-FR' : 'en-GB');
  const errorText = (e: unknown): string => {
    const code = (e as { code?: string })?.code;
    const k = `err_${code}` as Key;
    return code && k in fr ? t(k) : t('err_generic');
  };
  return { t, locale: loc, date, dateTime, money, errorText };
}

export const txStatusKey = (s: TxStatus): Key => ({
  DRAFT: 'txDraft', SUBMITTED: 'txSubmitted', IN_REVIEW: 'txReview', REJECTED: 'txRejected', VALIDATED: 'txValidated',
  TOKEN_ISSUED: 'txToken', IN_PROGRESS: 'txActive', CLOSED: 'txClosed', DISPUTED: 'txDisputed',
} as const)[s];

export const trancheStatusKey = (s: TrancheStatus): Key => ({
  PLANNED: 'trPlanned', AWAITING_PAYMENT: 'trAwaiting', PAID_LOCKED: 'trPaid', EVIDENCE_SUBMITTED: 'trEvidence',
  CONFIRMED: 'trConfirmed', RELEASED: 'trReleased', DISPUTED: 'trDisputed', CANCELLED: 'trCancelled', EXPIRED: 'trExpired',
} as const)[s];

import type { Vertical } from '@diaspay/domain';
const VERTICALS: Record<Vertical, { fr: string; en: string }> = {
  EDUCATION: { fr: 'Scolarité', en: 'Education' }, HEALTH: { fr: 'Santé', en: 'Health' }, RENT: { fr: 'Loyer', en: 'Rent' },
  AGRO: { fr: 'Agro', en: 'Agri' }, REAL_ESTATE: { fr: 'Immobilier', en: 'Real estate' }, LAND: { fr: 'Terrain', en: 'Land' },
};
export const verticalLabel = (v: Vertical, l: Locale) => VERTICALS[v][l];
