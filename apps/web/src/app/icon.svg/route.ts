import { palette } from '@diaspay/ui-tokens';

/** Icône d’onglet, générée depuis la charte (aucune couleur recopiée). */
export const dynamic = 'force-static';

export function GET(): Response {
  const mod = (x: number, y: number) => `<rect x="${x}" y="${y}" width="6" height="6" rx="1.2" fill="none" stroke="${palette.yellow}" stroke-width="1.8"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="${palette.green}"/>${mod(5.5, 5.5)}${mod(16.5, 5.5)}${mod(5.5, 16.5)}<circle cx="19.5" cy="19.5" r="4" fill="${palette.red}"/><path d="M17.6 19.6l1.3 1.3 2.4-2.6" fill="none" stroke="${palette.card}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
}
