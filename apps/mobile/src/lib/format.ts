// Logique pure des écrans (sans React Native) : testée par vitest.
export { composePhone, isValidPhone, normalizePhone } from '@diaspay/api-client';

/** Initiales (2 lettres max) : première lettre du premier et du dernier mot. « Marie Ngo Ndjock » → « MN ». */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/[\s\-’']+/u).filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1] ?? '')[0] ?? '' : '';
  return (first + last).toLocaleUpperCase('fr-FR');
}

/** Durée restante au format m:ss (arrondie à la seconde supérieure, jamais négative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Heure locale hh:mm (fin de verrouillage OTP). */
export function formatClock(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export const COUNTRIES = ['FR', 'BE', 'CA', 'US', 'GB', 'DE', 'CM', 'OTHER'] as const;
export type CountryCode = (typeof COUNTRIES)[number];

/** Indicatifs proposés sur l’écran de connexion. */
export const DIAL_CODES = ['+33', '+32', '+1', '+44', '+49', '+237'] as const;

/** Clé de traduction d’un pays ; un code inconnu retombe sur « Autre ». */
export const countryKey = (code: string): `country_${CountryCode}` =>
  `country_${(COUNTRIES as readonly string[]).includes(code) ? (code as CountryCode) : 'OTHER'}`;

/**
 * Saisie dans une case du code : un chiffre avance d’une case, un code complet (collage, saisie SMS)
 * remplit toutes les cases, un effacement vide la case. Renvoie les chiffres et la case à activer.
 */
export function fillDigits(current: readonly string[], index: number, text: string): { digits: string[]; focus: number } {
  const n = current.length;
  const next = [...current];
  let d = text.replace(/\D/g, '');
  if (d === '') {
    next[index] = '';
    return { digits: next, focus: index };
  }
  if (d.length >= n) return { digits: d.slice(0, n).split(''), focus: n - 1 };
  const prev = current[index];
  // La case contenait déjà un chiffre (sélection non remplacée) : on garde le nouveau.
  if (prev && d.length === 2) d = d.startsWith(prev) ? d.slice(1) : d.slice(0, 1);
  for (let k = 0; k < d.length && index + k < n; k++) next[index + k] = d.charAt(k);
  return { digits: next, focus: Math.min(n - 1, index + d.length) };
}
