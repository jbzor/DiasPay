/**
 * Export CSV pour Excel (réglages français) : UTF-8 avec BOM, séparateur « ; », fins de ligne CRLF, champs entre
 * guillemets si nécessaire. Une valeur commençant par = + - @ (ou tabulation, retour chariot) est préfixée d’une
 * apostrophe : Excel ne l’exécute pas comme une formule (injection de formules).
 */
export const BOM = '﻿';
const SEP = ';';

export function csvCell(value: unknown): string {
  let s = value == null ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(SEP)).join('\r\n') + '\r\n';
}
