// Lot X (X1.2) : liens internes. Le schéma diaspay:// ne sert plus qu’aux ouvertures internes (navigation depuis une
// notification de l’application) et ne porte qu’un identifiant de tranche, jamais une référence de jeton. Aucune adresse
// https n’ouvre l’application. Toute autre adresse est ignorée ; la navigation exige une session et passe par la RLS.

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Lien interne `diaspay://tranche/<identifiant>` (ou sa forme Expo Go `exp://…/--/tranche/<identifiant>` en développement).
 * Renvoie l’identifiant de tranche, ou null pour toute autre adresse (y compris une référence de jeton, `https://…`, `/t/…`).
 */
export function parseInternalLink(url: string): { trancheId: string } | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url.trim());
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  let rest = m[2]!;
  if (scheme === 'diaspay') {
    // diaspay://tranche/<id> : « tranche » est l’hôte de l’adresse.
  } else if (scheme === 'exp' || scheme.startsWith('exp+')) {
    const i = rest.indexOf('/--/');
    if (i < 0) return null;
    rest = rest.slice(i + 4);
  } else {
    return null;
  }
  const path = rest.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const segs = path.split('/');
  if (segs.length !== 2 || segs[0]!.toLowerCase() !== 'tranche') return null;
  let id: string;
  try { id = decodeURIComponent(segs[1]!); } catch { return null; }
  // Une référence de jeton (18 caractères hexadécimaux) n’est jamais acceptée comme identifiant.
  if (!ID_RE.test(id) || /^[0-9a-f]{18}$/i.test(id)) return null;
  return { trancheId: id };
}

/** Chemin de l’application pour un lien interne accepté. */
export const internalPath = (trancheId: string): string => `/tranche/${encodeURIComponent(trancheId)}`;
