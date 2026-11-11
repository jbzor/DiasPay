import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aucune clé secrète dans le code envoyé au navigateur (après `next build`) : ni clé « sb_secret_ », ni jeton JWT
 * dont le rôle est service_role. Ignoré si l’application n’a pas été construite.
 */
const dir = join(__dirname, '..', '.next', 'static');
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

describe.skipIf(!existsSync(dir))('construction web : aucune clé secrète', () => {
  it('ni sb_secret_ ni JWT service_role dans .next/static', () => {
    const offenders: string[] = [];
    for (const f of walk(dir).filter((x) => x.endsWith('.js'))) {
      const code = readFileSync(f, 'utf8');
      if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(code)) offenders.push(`${f} : sb_secret_`);
      for (const m of code.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
        try {
          const payload = JSON.parse(Buffer.from(m[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { role?: string };
          if (payload.role === 'service_role') offenders.push(`${f} : JWT service_role`);
        } catch { /* pas un JWT */ }
      }
    }
    expect(offenders).toEqual([]);
  });
});
