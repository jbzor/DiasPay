import { DomainError } from './types';

// Format de l'eQR : DPQ1:<référence>:<kid>:<signature>
// Le QR ne porte ni montant, ni nom, ni objectif : seulement une référence courte et sa signature.
export const EQR_PREFIX = 'DPQ1';
export const REFERENCE_LENGTH = 18;
const REFERENCE_RE = /^[0-9a-fA-F]{18}$/;

export interface Eqr {
  reference: string; // 18 hex, minuscules
  kid: string;
  signature: string;
}

const malformed = (why: string) => new DomainError('EQR_MALFORMED', `eQR illisible : ${why}`);

/** Référence : 18 caractères hexadécimaux, insensibles à la casse. Renvoie la forme canonique (minuscules). */
export function normalizeReference(text: string): string {
  const clean = text.replace(/[\s-]/g, '').toLowerCase();
  if (!REFERENCE_RE.test(clean)) throw malformed('référence invalide');
  return clean;
}

export function encodeEqr({ reference, kid, signature }: Eqr): string {
  const ref = normalizeReference(reference);
  if (!kid || kid.includes(':')) throw malformed('identifiant de clé invalide');
  if (!signature || signature.includes(':')) throw malformed('signature invalide');
  return `${EQR_PREFIX}:${ref}:${kid}:${signature}`;
}

export function decodeEqr(text: string): Eqr {
  const parts = text.trim().split(':');
  if (parts.length !== 4) throw malformed('nombre de champs');
  const [version, reference, kid, signature] = parts as [string, string, string, string];
  if (version !== EQR_PREFIX) throw malformed('version inconnue');
  if (!kid) throw malformed('identifiant de clé vide');
  if (!signature) throw malformed('signature vide');
  if (!REFERENCE_RE.test(reference)) throw malformed('référence invalide');
  return { reference: reference.toLowerCase(), kid, signature };
}

/** `4F9A-2C71-B8E0-1D3C-A9` : majuscules groupées par 4. */
export function formatReference(ref: string): string {
  const clean = normalizeReference(ref).toUpperCase();
  return clean.match(/.{1,4}/g)!.join('-');
}

// Lot X (X1.2) : plus de lien partageable ni de lien profond portant une référence de jeton (buildLink et
// parseDeepLink retirés). La référence ne circule que dans l’eQR présenté par le payeur connecté. Voir links.ts.
