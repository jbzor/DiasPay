import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { palette } from '@diaspay/ui-tokens';
import { ERROR_CODES } from '@diaspay/domain';
import { tokenVariables, tokensCss } from '@/lib/tokens';
import { errorMessage, t } from '@/i18n';
import { fr, frErrors } from '@/i18n/fr';

const src = join(__dirname, '..', 'src');
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

describe('charte', () => {
  it('chaque couleur de la palette devient une variable CSS', () => {
    const vars = tokenVariables();
    for (const [k, v] of Object.entries(palette)) expect(Object.values(vars)).toContain(v), expect(Object.keys(vars).some((x) => x.includes(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)))).toBe(true);
    expect(tokensCss()).toMatch(/^:root\{--c-green:#0A7C3E;/);
  });

  it('aucune couleur recopiée dans les feuilles de style ni dans les composants', () => {
    const offenders = walk(src).filter((f) => /\.(css|tsx)$/.test(f)).filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('aucun attribut style en ligne (bloqué par la CSP stricte)', () => {
    const offenders = walk(src).filter((f) => f.endsWith('.tsx')).filter((f) => /\bstyle=\{\{/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('dictionnaire', () => {
  it('apostrophes typographiques uniquement', () => {
    const straight = Object.entries({ ...fr, ...frErrors }).filter(([, v]) => v.includes("'"));
    expect(straight).toEqual([]);
  });

  it('paramètres remplacés', () => {
    expect(t('rel.hours', { n: 2 })).toBe('il y a 2 h');
    expect(t('dossiers.validations', { got: 1, need: 2 })).toBe('1 sur 2');
  });

  it('table des erreurs affichées : un message par code stable, jamais le texte brut du serveur', () => {
    expect(Object.keys(frErrors).sort()).toEqual(Object.keys(ERROR_CODES).sort());
    expect(errorMessage({ code: 'AMOUNT_NOT_CHECKED', message: 'texte serveur' })).toContain('J’ai vérifié');
    expect(errorMessage({ code: 'INCONNU', message: 'détail interne' })).toBe(t('err.generic'));
    expect(errorMessage(new Error('boom'))).toBe(t('err.generic'));
  });

  it('aucun texte français en dur dans les composants (tout passe par le dictionnaire)', () => {
    const hits: string[] = [];
    for (const f of walk(src).filter((x) => x.endsWith('.tsx'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
      // Texte JSX littéral contenant une lettre accentuée ou un mot de plus de 3 lettres entre deux balises.
      for (const m of code.matchAll(/>\s*([A-Za-zÀ-ÿ’][^<>{}]{3,})\s*</g)) hits.push(`${f.replace(src, '')}: ${m[1]}`);
    }
    expect(hits).toEqual([]);
  });
});
