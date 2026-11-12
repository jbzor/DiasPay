import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, isErrorCode } from '../src';

const root = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'database.types.ts' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const sqlCodes = (sql: string) => [...sql.matchAll(/_err\('([A-Z_]+)'/g)].map((m) => m[1] ?? '');

describe('table des codes d’erreur', () => {
  it('chaque code levé par les fonctions SQL (0005 et suivantes) est dans la table', () => {
    const migrations = readdirSync(join(root, 'supabase', 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f >= '0005');
    expect(migrations).toContain('0009_lotx_x4.sql');
    const codes = [...new Set(migrations.flatMap((f) => sqlCodes(read('supabase', 'migrations', f))))];
    expect(codes.length).toBeGreaterThan(40);
    expect(codes.filter((c) => !isErrorCode(c))).toEqual([]);
  });

  it('chaque code levé en TypeScript (domaine, client, application) est dans la table', () => {
    const files = ['packages/domain/src', 'packages/api-client/src', 'apps/mobile/src', 'apps/web/src'].flatMap((d) => walk(join(root, d)));
    const codes = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:Domain|Api|Auth)Error\(\s*'([A-Z_]+)'/g)) codes.add(m[1] ?? '');
    }
    expect(codes.size).toBeGreaterThan(30);
    expect([...codes].filter((c) => !isErrorCode(c))).toEqual([]);
  });

  it('docs/error-codes.md documente chaque code, et aucun autre', () => {
    const doc = read('docs', 'error-codes.md').split('## Codes renommés')[0] ?? '';
    const documented = [...doc.matchAll(/^\| `([A-Z_]+)`/gm)].map((m) => m[1]);
    expect([...documented].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it('les anciens codes renommés au lot 4 ne sont plus utilisés', () => {
    const old = ['TX_TRANSITION_FORBIDDEN', 'TR_TRANSITION_FORBIDDEN', 'TX_TRANSITION_UNKNOWN', 'TR_TRANSITION_UNKNOWN',
      'TR_WRONG_CONFIRMER', 'TR_NO_EVIDENCE_NEEDED', 'TR_EVIDENCE_MISSING', 'TR_NOT_DISPUTED'];
    const files = ['packages/domain/src', 'packages/api-client/src', 'apps/mobile/src'].flatMap((d) => walk(join(root, d)));
    const hits = files.filter((f) => old.some((o) => readFileSync(f, 'utf8').includes(o)));
    expect(hits).toEqual([]);
  });
});
