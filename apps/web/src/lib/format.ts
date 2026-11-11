import { formatMoney, shortHash as domainShortHash } from '@diaspay/domain';
import type { Currency } from '@diaspay/domain';

import { locale, t } from '@/i18n';

/** Montant affiché (règles et devises du domaine) : « 12 500 000 FCFA ». */
export function formatAmount(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor, currency: currency as Currency }, locale);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Durée relative de la maquette : « à l’instant », « il y a 12 min », « il y a 2 h », « hier », « il y a 3 j ».
 * « hier » désigne le jour calendaire précédent (heure locale), au-delà de 24 heures ou non.
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return t('common.none');
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('rel.now');
  if (min < 60) return t('rel.minutes', { n: min });
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return t('rel.hours', { n: Math.floor(min / 60) });
  if (days === 1) return t('rel.yesterday');
  return t('rel.days', { n: days });
}

/** « 10:12 » */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** « 9 nov. » */
export function formatDayMonth(iso: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

/** « 9 nov., 10:12 » (journal, chronologie) */
export function formatShortDateTime(iso: string): string {
  return `${formatDayMonth(iso)}, ${formatTime(iso)}`;
}

/** « 9 nov. 2026, 10:12 » */
export function formatDateTime(iso: string): string {
  const d = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  return `${d}, ${formatTime(iso)}`;
}

/** Date calendaire « 15 nov. 2026 » d’une date AAAA-MM-JJ (sans décalage de fuseau). */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** Empreinte abrégée « 3f9a…c71b » (règle du domaine, partagée avec le reçu mobile). */
export const shortHash = (hash: string): string => domainShortHash(hash);

/** Taille de fichier « 1,2 Mo ». */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024)} Ko`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} Mo`;
}
