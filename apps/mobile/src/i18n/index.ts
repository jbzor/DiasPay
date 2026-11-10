import { useSyncExternalStore } from 'react';
import { formatMoney } from '@diaspay/domain';
import type { Money, TrancheStatus, TxStatus } from '@diaspay/domain';

import { en, fr } from './messages';
import type { Key, Locale } from './messages';
import { saveLocale } from '../state/storage';

export type { Key, Locale };

/** Une date seule (AAAA-MM-JJ) est un jour du calendrier local : `new Date('2026-11-15')` la lirait en UTC et décalerait d’un jour à l’ouest de Greenwich. */
export function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}
const dicts: Record<Locale, Record<Key, string>> = { fr, en };

let locale: Locale = 'fr';
const listeners = new Set<() => void>();
/** Applique la langue et la persiste sur l’appareil. */
export const setLocale = (l: Locale) => { applyLocale(l); void saveLocale(l); };
/** Applique la langue sans la persister (restauration au démarrage). */
export const applyLocale = (l: Locale) => { if (l === locale) return; locale = l; listeners.forEach((f) => f()); };
export const getLocale = (): Locale => locale;
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function useI18n() {
  const loc = useSyncExternalStore(subscribe, () => locale);
  const t: T = (key, params) => {
    let s: string = dicts[loc][key];
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  const tag = loc === 'fr' ? 'fr-FR' : 'en-GB';
  const date = (iso: string) => new Intl.DateTimeFormat(loc === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseLocalDate(iso));
  const dateTime = (iso: string) => new Intl.DateTimeFormat(loc === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const money = (m: Money) => formatMoney(m, loc === 'fr' ? 'fr-FR' : 'en-GB');
  const errorText = (e: unknown): string => {
    const code = (e as { code?: string })?.code;
    const k = `err_${code}` as Key;
    const d = (e as { details?: { remaining?: number; lockedUntil?: string } })?.details ?? {};
    const time = d.lockedUntil ? new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(new Date(d.lockedUntil)) : '';
    return code && k in fr ? t(k, { remaining: d.remaining ?? '', time }) : t('err_generic');
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
