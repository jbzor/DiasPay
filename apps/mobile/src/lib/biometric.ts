import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Demande la biométrie si elle est disponible. Sans matériel ou sans empreinte/visage enregistré
 * (web, simulateur), l’opération est autorisée : mode démonstration.
 */
export async function biometric(reason: string): Promise<boolean> {
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return true;
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason });
    return r.success;
  } catch {
    return true;
  }
}
