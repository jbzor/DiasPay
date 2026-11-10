import { DomainError } from './types';
import type { Currency, Money } from './types';

const DECIMALS: Record<Currency, number> = { EUR: 2, USD: 2, XAF: 0 };

export function toMinor(amount: number, currency: Currency): number {
  return Math.round(amount * 10 ** DECIMALS[currency]);
}

export function formatMoney(m: Money, locale = 'fr-FR'): string {
  const d = DECIMALS[m.currency];
  const value = m.amountMinor / 10 ** d;
  const num = new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
  const label = m.currency === 'XAF' ? 'FCFA' : m.currency === 'EUR' ? '€' : '$';
  return `${num} ${label}`;
}

export const currencyDecimals = (c: Currency): number => DECIMALS[c];

/**
 * Lit un montant saisi (« 180 000 », « 1 250,50 », « 1,250.50 ») et renvoie des unités mineures.
 * Séparateur décimal : virgule en français, point en anglais ; espaces et séparateurs de milliers ignorés.
 * Erreurs : AMOUNT_INVALID (vide, non numérique, nul ou négatif), AMOUNT_DECIMALS (trop de décimales pour la devise).
 */
export function parseAmountInput(text: string, currency: Currency, locale: 'fr' | 'en' = 'fr'): number {
  const dec = locale === 'fr' ? ',' : '.';
  const group = locale === 'fr' ? '.' : ',';
  let s = text.replace(/[\s  ']/g, '');
  // En français on accepte aussi le point comme décimale s’il n’y a pas de virgule et qu’il n’y a qu’un point suivi de 1 ou 2 chiffres.
  if (locale === 'fr' && !s.includes(',') && /^\d+\.\d{1,2}$/.test(s)) s = s.replace('.', ',');
  s = s.split(group).join('');
  const [intPart = '', fracPart, extra] = s.split(dec);
  if (extra !== undefined || !/^\d+$/.test(intPart) || (fracPart !== undefined && !/^\d*$/.test(fracPart))) {
    throw new DomainError('AMOUNT_INVALID', 'Montant invalide');
  }
  const d = DECIMALS[currency];
  const frac = (fracPart ?? '').replace(/0+$/, '');
  if (frac.length > d) throw new DomainError('AMOUNT_DECIMALS', `Au plus ${d} décimale(s) pour cette devise`);
  const minor = Number(intPart) * 10 ** d + Number(frac.padEnd(d, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new DomainError('AMOUNT_INVALID', 'Montant invalide');
  return minor;
}

/** Montant pour un champ de saisie : séparateurs de milliers selon la langue, sans symbole de devise. */
export function formatAmountInput(amountMinor: number, currency: Currency, locale: 'fr' | 'en' = 'fr'): string {
  const d = DECIMALS[currency];
  const value = amountMinor / 10 ** d;
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: 0, maximumFractionDigits: d }).format(value);
}
