// Choix du libellé biométrique selon la plateforme (logique pure, testée).
// Valeurs de LocalAuthentication.AuthenticationType : 1 empreinte, 2 visage, 3 iris.
export type BioKind = 'faceid' | 'touchid' | 'face' | 'fingerprint' | 'iris' | 'generic';

export function bioKind(os: string, types: readonly number[]): BioKind {
  const ios = os === 'ios';
  if (types.includes(2)) return ios ? 'faceid' : 'face';
  if (types.includes(1)) return ios ? 'touchid' : 'fingerprint';
  if (types.includes(3)) return 'iris';
  return ios ? 'faceid' : 'generic';
}

/** Icône associée : visage ou empreinte. */
export const bioIcon = (k: BioKind): 'face' | 'fingerprint' => (k === 'touchid' || k === 'fingerprint' ? 'fingerprint' : 'face');

/** Première lettre en capitale (le nom du moyen ouvre la phrase). */
export const capitalize = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase('fr-FR') + s.slice(1) : s);
