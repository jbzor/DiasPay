// Charte DiasPayQR validée par le client (maquettes v1).
export const palette = {
  green: '#0A7C3E',
  greenTint: '#DDF1E4',
  greenDark: '#075C2D',
  yellow: '#FCD116',
  yellowTint: '#FFF3B0',
  yellowDark: '#5C4A00',
  red: '#CE1126',
  ink: '#14231A',
  ivory: '#F7F4EA',
  card: '#FFFFFF',
  muted: '#56645B',
  line: '#DAD5C3',
  disabled: '#9AA39C',
} as const;

// Le rouge de marque ne sert pas aux erreurs courantes : teinte d'erreur distincte, à valider avec le client.
export const semantic = {
  background: palette.ivory,
  surface: palette.card,
  text: palette.ink,
  textMuted: palette.muted,
  border: palette.line,
  primary: palette.green,
  onPrimary: '#FFFFFF',
  accent: palette.yellow,
  onAccent: palette.ink,
  brandRed: palette.red,
  error: '#9B1C1C',
  errorTint: '#FBE4E4',
} as const;

export const chips = {
  active: { bg: palette.greenTint, fg: palette.greenDark },
  pending: { bg: palette.yellowTint, fg: palette.yellowDark },
  draft: { bg: '#ECE8D8', fg: '#4A4F4A' },
  error: { bg: semantic.errorTint, fg: semantic.error },
} as const;

/** Couleur du point des libellés de statut (décoratif : le texte porte l’information). */
export const statusDot = {
  active: palette.green,
  pending: '#E0AE00',
  draft: palette.disabled,
  error: semantic.error,
} as const;

/** Fond d’un choix indisponible (« Bientôt disponible »). */
export const disabledSurface = '#F1EEE3';

/** Fond du contrôle segmenté et des surfaces neutres. */
export const neutralTint = '#ECE8D8';

/**
 * Bureau de contrôle (web, lot 5). Mêmes principes que la maquette : listes à filets, ligne choisie sur fond blanc,
 * anneau de focus vert foncé, voile des fenêtres de confirmation.
 */
export const backoffice = {
  /** Ligne survolée ou choisie dans un tableau. */
  rowSelected: palette.card,
  /** Anneau de focus clavier (3:1 minimum sur l’ivoire et le blanc). */
  focusRing: palette.greenDark,
  /** Voile derrière une fenêtre de confirmation (encre à 45 %). */
  overlay: 'rgba(20, 35, 26, 0.45)',
  /** Fond du visionneur de pièces. */
  viewerBg: '#EFEBDD',
  /** Empreintes et références (police à chasse fixe). */
  hashText: '#3A4A40',
} as const;

export const spacing ={ xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const radius = { sm: 10, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const touchTarget = 44;
export const fontSize = { caption: 12, small: 13, body: 15, title: 18, headline: 22, amount: 30 } as const;

/** Rapport de contraste WCAG entre deux couleurs hexadécimales. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
