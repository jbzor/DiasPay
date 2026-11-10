import { DomainError } from './types';

// Normalisation des numéros (lot 1), partagée par l’authentification et la création d’un besoin.

/**
 * Normalise un numéro au format international E.164 (+ suivi de 8 à 15 chiffres).
 * Accepte espaces, points, tirets, parenthèses et le préfixe 00. Un numéro sans indicatif est refusé.
 */
export function normalizePhone(raw: string): string {
  const compact = raw.trim().replace(/[\s.\-()]/g, '');
  const intl = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(intl)) throw new DomainError('PHONE_INVALID', 'Numéro de téléphone invalide');
  return intl;
}

/** Assemble indicatif et numéro local (le 0 de tête du numéro national est retiré : +33 06… → +336…). */
export function composePhone(dialCode: string, local: string): string {
  const dial = dialCode.trim().replace(/^00/, '+');
  if (!/^\+?[1-9]\d{0,3}$/.test(dial)) throw new DomainError('PHONE_INVALID', 'Indicatif invalide');
  const national = local.replace(/[\s.\-()]/g, '').replace(/^0+/, '');
  return normalizePhone(`${dial.startsWith('+') ? dial : `+${dial}`}${national}`);
}

export function isValidPhone(dialCode: string, local: string): boolean {
  try {
    composePhone(dialCode, local);
    return local.replace(/\D/g, '').length >= 6;
  } catch {
    return false;
  }
}

/** Vrai si le numéro (avec indicatif) se normalise. */
export function isNormalizablePhone(raw: string): boolean {
  try { normalizePhone(raw); return true; } catch { return false; }
}
