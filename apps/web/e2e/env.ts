import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Variables des fichiers .env.local (application web, puis racine) sans les afficher. */
function load(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
const vars = { ...load(join(here, '..', '..', '..', '.env.local')), ...load(join(here, '..', '.env.local')), ...process.env } as Record<string, string | undefined>;

export const SUPABASE_URL = vars.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = vars.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const STAFF_PASSWORD = vars.E2E_STAFF_PASSWORD ?? '';

/** Comptes du personnel de test (supabase/seed-staff.sql). */
export const STAFF = {
  A: { email: 'validateur.a@diaspay.test', name: 'Validateur A (test)' },
  B: { email: 'validateur.b@diaspay.test', name: 'Validateur B (test)' },
  ADMIN: { email: 'administrateur@diaspay.test', name: 'Administratrice (test)' },
  PARTY: { email: 'validateur.partie@diaspay.test', name: 'Validateur partie (test)', phone: '+33639980014' },
  USER: { email: 'utilisateur@diaspay.test', name: 'Utilisateur ordinaire (test)' },
} as const;
