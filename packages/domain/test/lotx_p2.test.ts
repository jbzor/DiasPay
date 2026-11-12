import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DomainError, HASH_ALGO, bufferToHex, checkContentHash, documentLockError, isContentHash, normalizeContentHash, otherDossiersWithHash, sha256Hex,
} from '../src';

const root = join(__dirname, '..', '..', '..');
const sql = (f: string) => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8');
const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof DomainError ? e.code : 'OTHER'; } };

describe('X4 — empreintes des pièces', () => {
  it('SHA-256 : valeurs de référence (FIPS 180-4)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('SHA-256 : même résultat que la bibliothèque de référence sur des octets quelconques (dont plusieurs blocs)', () => {
    for (const n of [1, 55, 56, 64, 65, 1000, 100_000]) {
      const b = randomBytes(n);
      expect(sha256Hex(new Uint8Array(b))).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });

  it('bufferToHex : résultat d’expo-crypto ou de WebCrypto (ArrayBuffer) en hexadécimal', async () => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    expect(bufferToHex(buf)).toBe(sha256Hex('abc'));
  });

  it('format : 64 caractères hexadécimaux, normalisé en minuscules (miroir de _norm_hash et _documents_guard)', () => {
    expect(HASH_ALGO).toBe('SHA-256');
    expect(normalizeContentHash(' ' + 'A'.repeat(64) + ' ')).toBe('a'.repeat(64));
    expect(normalizeContentHash('')).toBeUndefined();
    expect(isContentHash('a'.repeat(64))).toBe(true);
    expect(isContentHash('a'.repeat(63))).toBe(false);
    expect(isContentHash('g'.repeat(64))).toBe(false);
    expect(code(() => checkContentHash('abc'))).toBe('HASH_INVALID');
    expect(code(() => checkContentHash(undefined, true))).toBe('HASH_REQUIRED');
    expect(checkContentHash(undefined)).toBeUndefined();
    expect(checkContentHash('B'.repeat(64))).toBe('b'.repeat(64));
  });

  it('immuabilité : modifiable en brouillon ou dossier rejeté, pièce de réponse pendant INFO_REQUESTED (miroir de _documents_immutable)', () => {
    expect(documentLockError('DRAFT')).toBeNull();
    expect(documentLockError('REJECTED')).toBeNull();
    expect(documentLockError('SUBMITTED')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('IN_PROGRESS')).toBe('DOCUMENT_LOCKED');
    expect(documentLockError('IN_PROGRESS', 'INFO_REQUESTED')).toBeNull();
    expect(documentLockError('IN_PROGRESS', 'PAID_LOCKED')).toBe('DOCUMENT_LOCKED');
    const fn = sql('0009_lotx_x4.sql');
    expect(fn).toMatch(/v_status in \('DRAFT','REJECTED'\)/);
    expect(fn).toMatch(/v_tr = 'INFO_REQUESTED'/);
  });

  it('réutilisation : autres dossiers seulement, brouillons et pièces archivées exclus (miroir de _hash_reuse)', () => {
    const h = 'c'.repeat(64);
    const docs = [
      { txId: 'A', contentHash: h, txStatus: 'SUBMITTED' as const },
      { txId: 'B', contentHash: h.toUpperCase(), txStatus: 'IN_PROGRESS' as const },
      { txId: 'B', contentHash: h, txStatus: 'IN_PROGRESS' as const },
      { txId: 'C', contentHash: h, txStatus: 'DRAFT' as const },
      { txId: 'D', contentHash: h, txStatus: 'CLOSED' as const, deleted: true },
      { txId: 'E', contentHash: 'd'.repeat(64), txStatus: 'SUBMITTED' as const },
    ];
    expect(otherDossiersWithHash(h, docs, 'A')).toEqual(['B']);
    expect(otherDossiersWithHash(h, docs, 'C')).toEqual(['A', 'B']);
    expect(otherDossiersWithHash('f'.repeat(64), docs)).toEqual([]);
    expect(sql('0009_lotx_x4.sql')).toMatch(/d\.tx_id is distinct from p_tx and o\.status <> 'DRAFT'/);
  });
});
