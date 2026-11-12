import { internalPath, parseInternalLink } from '@diaspay/domain';

/**
 * Lot X (X1.2) : filtre de toute adresse qui ouvre l’application de l’extérieur (iOS, Android).
 * Seul le lien interne `diaspay://tranche/<identifiant>` (navigation depuis une notification) est accepté ; il ne porte
 * jamais de référence de jeton. Toute autre adresse (lien https, ancienne adresse /t/<référence>, autre écran) est ignorée :
 * au démarrage, l’application s’ouvre sur l’accueil ; ensuite, elle reste où elle est.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    const link = parseInternalLink(path);
    if (link) return internalPath(link.trancheId);
  } catch {
    // Une exception ici ferait planter l’application : l’adresse est simplement ignorée.
  }
  return initial ? '/' : null;
}
