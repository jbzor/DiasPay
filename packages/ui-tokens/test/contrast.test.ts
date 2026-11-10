import { describe, expect, it } from 'vitest';
import { chips, contrastRatio, disabledSurface, neutralTint, palette, semantic } from '../src';

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
    // Lot 1 : libellés de statut sans pastille (texte sur le fond de l’écran ou d’une ligne blanche).
    ['statut actif sur ivoire', chips.active.fg, palette.ivory],
    ['statut en attente sur ivoire', chips.pending.fg, palette.ivory],
    ['statut brouillon sur ivoire', chips.draft.fg, palette.ivory],
    ['statut erreur sur ivoire', chips.error.fg, palette.ivory],
    ['statut en attente sur blanc', chips.pending.fg, palette.card],
    // Lot 1 : contrôle segmenté, champs, lancement.
    ['segment inactif (encre sur beige)', semantic.text, neutralTint],
    ['segment actif (blanc sur vert)', '#FFFFFF', palette.green],
    ['saisie (encre sur blanc)', semantic.text, semantic.surface],
    ['message d’erreur de champ sur ivoire', semantic.error, palette.ivory],
    ['bouton désactivé (atténué sur beige)', palette.muted, neutralTint],
    // Lot 3 : création d’un besoin.
    ['choix indisponible (atténué sur beige clair)', palette.muted, disabledSurface],
    ['somme exacte (vert foncé sur ivoire)', palette.greenDark, palette.ivory],
    ['écart de somme (erreur sur ivoire)', semantic.error, palette.ivory],
    ['bandeau d’envoi (vert foncé sur vert pâle)', chips.active.fg, chips.active.bg],
    ['message bref (ivoire sur encre)', palette.ivory, palette.ink],
    ['retirer une pièce (rouge de marque sur ivoire)', palette.red, palette.ivory],
  ];
  it.each(pairs)('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contraste WCAG AA (3 minimum pour le texte de grande taille et les éléments graphiques)', () => {
  const pairs: Array<[string, string, string]> = [
    ['« QR » jaune sur vert (34 px gras, lancement)', palette.yellow, palette.green],
    ['icône biométrie verte sur vert pâle', palette.green, palette.greenTint],
    ['point actif du StepDots sur ivoire', palette.green, palette.ivory],
  ];
  it.each(pairs)('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
