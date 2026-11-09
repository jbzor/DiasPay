import { describe, expect, it } from 'vitest';
import { chips, contrastRatio, palette, semantic } from '../src';

describe('contraste WCAG AA (4,5 minimum pour le texte courant)', () => {
  const pairs: Array<[string, string, string]> = [
    ['texte sur fond', semantic.text, semantic.background],
    ['texte atténué sur fond', semantic.textMuted, semantic.background],
    ['texte atténué sur carte', semantic.textMuted, semantic.surface],
    ['blanc sur vert', semantic.onPrimary, semantic.primary],
    ['encre sur jaune', semantic.onAccent, semantic.accent],
    ['vert sur ivoire', palette.green, palette.ivory],
    ['rouge de marque sur ivoire', palette.red, palette.ivory],
    ['puce active', chips.active.fg, chips.active.bg],
    ['puce en attente', chips.pending.fg, chips.pending.bg],
    ['puce brouillon', chips.draft.fg, chips.draft.bg],
    ['puce erreur', chips.error.fg, chips.error.bg],
    ['ivoire sur encre (scan)', palette.ivory, palette.ink],
  ];
  it.each(pairs)('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
