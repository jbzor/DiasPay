import { isErrorCode } from '@diaspay/domain';
import { fr, frErrors } from './fr';
import type { Key } from './fr';

export type { Key };
export type Params = Record<string, string | number>;

/** Langue unique pour l’instant (fr) ; une autre langue ajoutera un dictionnaire de même forme. */
export const locale = 'fr-FR';

/** Texte du dictionnaire, paramètres {nom} remplacés. */
export function t(key: Key, params?: Params): string {
  let s: string = fr[key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Clé dynamique (verticale, statut, événement…) ; null si elle n’existe pas. */
export function tMaybe(key: string, params?: Params): string | null {
  return key in fr ? t(key as Key, params) : null;
}

/** Message affiché pour une erreur : code stable connu, sinon message générique (jamais le texte brut du serveur). */
export function errorMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return isErrorCode(code) ? frErrors[code] : t('err.generic');
}
