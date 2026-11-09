import { describe, expect, it } from 'vitest';
import { en, fr } from '../src/i18n/messages';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('parité i18n', () => {
  const frKeys = Object.keys(fr).sort();
  const enKeys = Object.keys(en).sort();

  it('mêmes clés en français et en anglais', () => {
    expect(enKeys).toEqual(frKeys);
  });

  it.each([['fr', fr], ['en', en]] as const)('%s : aucune valeur vide', (_l, dict) => {
    const empty = Object.entries(dict).filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it.each([['fr', fr], ['en', en]] as const)('%s : apostrophe typographique uniquement, aucune apostrophe droite', (_l, dict) => {
    const straight = Object.entries(dict).filter(([, v]) => v.includes("'")).map(([k]) => k);
    expect(straight).toEqual([]);
  });

  it('mêmes paramètres {…} dans les deux langues', () => {
    const diff = frKeys.filter((k) => placeholders(fr[k as keyof typeof fr]).join() !== placeholders(en[k as keyof typeof en]).join());
    expect(diff).toEqual([]);
  });
});
