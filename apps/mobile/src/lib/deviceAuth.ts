// Lot A (T8b) : vérification du propriétaire de l’appareil avant un paiement ou une confirmation (logique pure, testée).
//
// Règle (dossier institutionnel, cahier des charges §5.2) : biométrie, sinon code de l’appareil ; si l’appareil n’a
// aucun verrouillage, l’action est refusée avec une explication. Jamais de paiement sans vérification : toute erreur
// imprévue refuse (échec fermé). Le repli par code SMS relève de l’authentification selon le risque (lot C).

/** Valeurs de LocalAuthentication.SecurityLevel : 0 aucun verrouillage, 1 code seul, 2 et 3 biométrie. */
export const SECURITY_LEVEL_NONE = 0;

/** Ce que la vérification utilise d’expo-local-authentication (injecté pour les tests). */
export type LocalAuth = {
  getEnrolledLevelAsync(): Promise<number>;
  authenticateAsync(o: { promptMessage: string; disableDeviceFallback: boolean; cancelLabel?: string }):
    Promise<{ success: true } | { success: false; error: string }>;
};

/**
 * OK : propriétaire vérifié (biométrie ou code). DECLINED : vérification annulée ou échouée.
 * NO_LOCK : aucun verrouillage sur l’appareil (ni biométrie ni code) : l’action est refusée, il faut l’activer.
 * UNAVAILABLE : vérification impossible sur cette plateforme (navigateur) : l’action se fait depuis l’application.
 */
export type DeviceAuthResult = 'OK' | 'DECLINED' | 'NO_LOCK' | 'UNAVAILABLE';

/** Erreurs de authenticateAsync qui signifient « aucun verrouillage » (Android : isDeviceSecure faux ; iOS : pas de code). */
const NO_LOCK_ERRORS = new Set(['not_enrolled', 'passcode_not_set']);

export async function verifyDeviceOwner(
  la: LocalAuth,
  opts: { reason: string; cancelLabel?: string; platform: string; webBypass: boolean },
): Promise<DeviceAuthResult> {
  if (opts.platform === 'web') return opts.webBypass ? 'OK' : 'UNAVAILABLE';
  try {
    if ((await la.getEnrolledLevelAsync()) === SECURITY_LEVEL_NONE) return 'NO_LOCK';
    // disableDeviceFallback: false : sans biométrie enregistrée (ou après des échecs), le système demande le code.
    const r = await la.authenticateAsync({ promptMessage: opts.reason, disableDeviceFallback: false, cancelLabel: opts.cancelLabel });
    if (r.success) return 'OK';
    return NO_LOCK_ERRORS.has(r.error) ? 'NO_LOCK' : 'DECLINED';
  } catch {
    return 'DECLINED';
  }
}

/** Clé du message à afficher quand l’action est refusée. */
export function deviceAuthMessageKey(r: Exclude<DeviceAuthResult, 'OK'>): 'bioFailed' | 'noDeviceLock' | 'deviceAuthUnavailable' {
  return r === 'NO_LOCK' ? 'noDeviceLock' : r === 'UNAVAILABLE' ? 'deviceAuthUnavailable' : 'bioFailed';
}
