import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redirectSystemPath } from '../src/app/+native-intent';

// Lot X (X1, exigence 5.1 du cahier) : aucun moyen de partager, copier ou enregistrer un lien ou un QR ;
// aucune adresse ouvrable de l’extérieur avec une référence de jeton.
const app = join(__dirname, '..');
const src = join(app, 'src');
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const files = walk(src);
const read = (f: string) => readFileSync(f, 'utf8');

describe('X1 : TrustLink jamais partagé', () => {
  it('l’écran du jeton ne partage, ne copie, n’enregistre ni n’affiche de lien', () => {
    const token = read(join(src, 'app', 'token', '[trancheId].tsx'));
    expect(token).not.toMatch(/Share\b|Clipboard|captureRef|Sharing|view-shot|buildLink|LINK_BASE|selectable/);
    expect(token).toMatch(/useNoScreenCapture/);
    // Lot X v2 : QR seulement en déblocage conditionnel, au payeur, pour une demande payée aux fonds bloqués, non confirmée.
    expect(token).toMatch(/tx\.settlementMode !== 'CONDITIONAL'/);
    // Lot A (T5) : payeur de cette opération (parties du dossier), et non rôle principal du profil.
    expect(token).toMatch(/!placeIn\(tx, getCurrentUser\(\)\?\.id\)\.payer \|\| tranche\.status !== 'PAID' \|\| tranche\.fundsState !== 'HELD'/);
    expect(token).not.toMatch(/usePersona|primaryRole/);
  });
  it('aucune route ni aucun code ne traite une adresse /t/<référence>', () => {
    expect(existsSync(join(src, 'app', 't'))).toBe(false);
    for (const f of files) expect(read(f), f).not.toMatch(/['"`]\/t\/|parseDeepLink|pendingLink|EXPO_PUBLIC_LINK_BASE/);
  });
  it('dépendances de copie et de capture d’écran retirées', () => {
    const pkg = JSON.parse(read(join(app, 'package.json'))) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['expo-clipboard']).toBeUndefined();
    expect(pkg.dependencies['react-native-view-shot']).toBeUndefined();
    expect(pkg.dependencies['expo-screen-capture']).toBeDefined();
  });
});

describe('X1.2 : adresses entrantes (+native-intent)', () => {
  it('seul diaspay://tranche/<identifiant> ouvre un écran', () => {
    expect(redirectSystemPath({ path: 'diaspay://tranche/tr-12', initial: false })).toBe('/tranche/tr-12');
  });
  it.each([
    'diaspay://t/4f9a2c71b8e01d3ca9',
    'https://links.diaspay.example/t/4f9a2c71b8e01d3ca9',
    'diaspay://pay/tr-12',
    'diaspay://token/tr-12',
    'n’importe quoi',
  ])('ignorée : %s', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/');
    expect(redirectSystemPath({ path, initial: false })).toBeNull();
  });
});
