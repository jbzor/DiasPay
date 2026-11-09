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
