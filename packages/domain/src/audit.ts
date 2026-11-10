import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Journal d’audit chaîné (une chaîne par transaction), utilisé par le reçu.
 *
 * Format de l’empreinte d’une ligne :
 *   hash = SHA-256( prevHash + "\n" + seq|at|actor|event|txId|trancheId|detail )  en hexadécimal minuscule
 * - `prevHash` vaut GENESIS_HASH (64 zéros) pour la première ligne ;
 * - les champs sont séparés par « | » ; dans chaque champ, « \ » devient « \\ » et « | » devient « \| » ;
 * - un champ absent est une chaîne vide ; `seq` commence à 1 et augmente de 1.
 *
 * Modifier, insérer ou supprimer une ligne au milieu casse la chaîne. La suppression des dernières lignes
 * ne se voit qu’en comparant à une ancre connue (`expected` : nombre de lignes ou dernière empreinte).
 * Le serveur Supabase (lot 4) aura sa propre vérification, verify_audit() ; ce format n’a pas à être identique.
 */

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntryInput {
  at: string;            // ISO
  actor: string;         // « payer », « provider », « system », « validator »…
  event: string;         // NEED_SUBMITTED, PAYMENT_SIMULATED…
  txId: string;
  trancheId?: string;
  detail?: string;
}

export interface ChainedAuditEntry extends AuditEntryInput {
  seq: number;
  prevHash: string;
  hash: string;
}

export interface ChainCheck {
  valid: boolean;
  /** Numéro de la première ligne incohérente (1-based), absent si valide. */
  brokenAt?: number;
  lastHash: string;
  count: number;
}

const esc = (v: string | number | undefined) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

function canonical(e: AuditEntryInput & { seq: number }): string {
  return [e.seq, e.at, e.actor, e.event, e.txId, e.trancheId, e.detail].map(esc).join('|');
}

export function computeEntryHash(prevHash: string, entry: AuditEntryInput & { seq: number }): string {
  return bytesToHex(sha256(utf8ToBytes(`${prevHash}\n${canonical(entry)}`)));
}

/** Ajoute une ligne à la chaîne (fonction pure : renvoie une nouvelle chaîne). */
export function appendEntry(chain: readonly ChainedAuditEntry[], input: AuditEntryInput): ChainedAuditEntry[] {
  const last = chain[chain.length - 1];
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const base = { ...input, seq };
  return [...chain, { ...base, prevHash, hash: computeEntryHash(prevHash, base) }];
}

/** Recalcule chaque empreinte et chaque lien. `expected` détecte en plus la suppression des dernières lignes. */
export function verifyChain(entries: readonly ChainedAuditEntry[], expected?: { count?: number; lastHash?: string }): ChainCheck {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as ChainedAuditEntry;
    const { seq, prevHash, hash, ...input } = e;
    if (seq !== i + 1 || prevHash !== prev || computeEntryHash(prev, { ...input, seq }) !== hash) {
      return { valid: false, brokenAt: i + 1, lastHash: entries[entries.length - 1]?.hash ?? GENESIS_HASH, count: entries.length };
    }
    prev = hash;
  }
  const result: ChainCheck = { valid: true, lastHash: prev, count: entries.length };
  if ((expected?.count !== undefined && expected.count !== entries.length) || (expected?.lastHash !== undefined && expected.lastHash !== prev)) {
    return { ...result, valid: false, brokenAt: entries.length + 1 };
  }
  return result;
}

/** Empreinte abrégée pour l’affichage : « a3f9…c71b ». */
export const shortHash = (h: string): string => (h.length > 8 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
