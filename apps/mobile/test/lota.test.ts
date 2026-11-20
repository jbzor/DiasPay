import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingConfig } from '../src/lib/config';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('lot A (T4) : choix du serveur', () => {
  it('sans EXPO_PUBLIC_API : configuration manquante (jamais de repli silencieux sur le simulateur)', () => {
    expect(missingConfig({})).toEqual(['EXPO_PUBLIC_API', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
    expect(missingConfig({ url: 'https://x.supabase.co', key: 'k' })).toEqual(['EXPO_PUBLIC_API']);
    expect(missingConfig({ api: 'autre', url: 'https://x.supabase.co', key: 'k' })).toEqual(['EXPO_PUBLIC_API']);
  });
  it('supabase : URL et clé publique requises', () => {
    expect(missingConfig({ api: 'supabase', url: 'https://x.supabase.co', key: 'k' })).toEqual([]);
    expect(missingConfig({ api: 'supabase', url: ' ', key: 'k' })).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
    expect(missingConfig({ api: 'supabase', url: 'https://x.supabase.co' })).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY']);
  });
  it('mock seulement s’il est écrit explicitement', () => {
    expect(missingConfig({ api: 'mock' })).toEqual([]);
    expect(src('state/backend.ts')).toMatch(/process\.env\.EXPO_PUBLIC_API === 'mock' \? 'mock' : 'supabase'/);
  });
  it('le simulateur (et son jeu de démonstration) n’est créé qu’en mode mock', () => {
    expect(src('state/api.ts')).toMatch(/mockApi: MockApi \| null = API_MODE === 'mock' \? new MockApi/);
    // Aucune autre création du simulateur ni de l’authentification simulée dans l’application.
    const files = ['state/auth.ts', 'state/queries.ts', 'app/_layout.tsx', 'state/needWizard.ts'];
    for (const f of files) expect(src(f), f).not.toMatch(/new Mock(Api|Auth)\(/);
    expect(src('state/auth.ts')).toMatch(/mockApi\?\.hydrate\(\)/);
  });
});
