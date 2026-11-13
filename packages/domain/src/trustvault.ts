import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { DomainError } from './types';
import type { TrancheStatus, TxStatus } from './types';

// Lot X (X4) : TrustVault. Empreinte SHA-256 des pièces (calculée par l’application avant l’envoi), réutilisation d’un
// justificatif, immuabilité des pièces d’un dossier soumis. Miroirs de 0009_lotx_x4.sql (mêmes règles, mêmes codes).

export const HASH_ALGO = 'SHA-256' as const;
const HASH_RE = /^[0-9a-f]{64}$/;

/** Empreinte reçue : hexadécimal minuscule de 64 caractères (miroir de _norm_hash). Vide : undefined. */
export function normalizeContentHash(hash: string | null | undefined): string | undefined {
  const h = (hash ?? '').trim().toLowerCase();
  return h === '' ? undefined : h;
}

export function isContentHash(hash: string | null | undefined): boolean {
  return HASH_RE.test(normalizeContentHash(hash) ?? '');
}

/**
 * Contrôle d’une empreinte à l’enregistrement d’une pièce (miroir de _documents_guard) :
 * HASH_INVALID si elle est mal formée, HASH_REQUIRED si elle manque alors que le réglage require_content_hash l’impose.
 */
export function checkContentHash(hash: string | null | undefined, required = false): string | undefined {
  const h = normalizeContentHash(hash);
  if (h === undefined) {
    if (required) throw new DomainError('HASH_REQUIRED', 'Empreinte de la pièce obligatoire');
    return undefined;
  }
  if (!HASH_RE.test(h)) throw new DomainError('HASH_INVALID', 'Empreinte invalide (SHA-256 hexadécimal attendu)');
  return h;
}

/**
 * Une pièce ne change ni ne disparaît que si l’opération est un brouillon, ou, pour une pièce
 * de réponse (rattachée à une tranche), tant que la tranche attend des informations (miroir de _documents_immutable).
 */
export function documentLockError(txStatus: TxStatus, trancheStatus?: TrancheStatus): 'DOCUMENT_LOCKED' | null {
  if (txStatus === 'DRAFT') return null;   // lot X v2 : plus d’opération rejetée en correction
  if (trancheStatus === 'INFO_REQUESTED') return null;
  return 'DOCUMENT_LOCKED';
}

/** Pièce vue par le contrôle de réutilisation. */
export interface HashedDocument { txId: string; contentHash?: string; txStatus: TxStatus; deleted?: boolean }

/** Autres dossiers (hors `excludeTxId`, brouillons exclus) contenant une pièce de même empreinte (miroir de _hash_reuse). */
export function otherDossiersWithHash(hash: string, documents: readonly HashedDocument[], excludeTxId?: string): string[] {
  const h = normalizeContentHash(hash);
  const ids = new Set<string>();
  for (const d of documents) {
    if (d.deleted || d.txStatus === 'DRAFT' || d.txId === excludeTxId) continue;
    if (h !== undefined && normalizeContentHash(d.contentHash) === h) ids.add(d.txId);
  }
  return [...ids].sort();
}

// ——— SHA-256 ———
// Sert au simulateur et aux tests (@noble/hashes, déjà utilisé par le journal chaîné) ; l’application utilise expo-crypto
// (même résultat, vérifié par test sur des valeurs de référence).

/** Empreinte SHA-256 en hexadécimal minuscule (64 caractères). Une chaîne est encodée en UTF-8. */
export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

/** Octets d’un ArrayBuffer (résultat de expo-crypto ou de WebCrypto) en hexadécimal minuscule. */
export function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
