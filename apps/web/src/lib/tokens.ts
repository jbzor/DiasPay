import { backoffice, chips, fontSize, palette, radius, semantic, spacing, statusDot } from '@diaspay/ui-tokens';

/**
 * Variables CSS de la charte, générées depuis @diaspay/ui-tokens (seule source de vérité : aucune couleur n’est
 * recopiée dans les feuilles de style, qui n’utilisent que var(--…)). Injectées par la mise en page racine.
 */
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function tokenVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) vars[`--c-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(semantic)) vars[`--s-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(chips)) { vars[`--chip-${k}-bg`] = v.bg; vars[`--chip-${k}-fg`] = v.fg; }
  for (const [k, v] of Object.entries(statusDot)) vars[`--dot-${k}`] = v;
  for (const [k, v] of Object.entries(backoffice)) vars[`--bo-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(spacing)) vars[`--sp-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(radius)) vars[`--r-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(fontSize)) vars[`--fs-${k}`] = `${v}px`;
  return vars;
}

export function tokensCss(): string {
  const body = Object.entries(tokenVariables()).map(([k, v]) => `${k}:${v}`).join(';');
  return `:root{${body}}`;
}
