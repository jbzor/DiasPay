import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { verifyDeviceOwner } from './deviceAuth';
import type { DeviceAuthResult, LocalAuth } from './deviceAuth';

/**
 * Navigateur (export web de l’application) : aucune vérification possible, l’action est refusée. Seules exceptions :
 * le développement local et l’export web des tests de bout en bout, qui le déclare (EXPO_PUBLIC_WEB_SKIP_DEVICE_AUTH=1).
 * Sans effet sur iOS et Android : un build de boutique vérifie toujours.
 */
const WEB_BYPASS = __DEV__ || process.env.EXPO_PUBLIC_WEB_SKIP_DEVICE_AUTH === '1';

/** Biométrie, sinon code de l’appareil ; aucun verrouillage : refusé (voir deviceAuth.ts). */
export function verifyOwner(reason: string): Promise<DeviceAuthResult> {
  return verifyDeviceOwner(LocalAuthentication as unknown as LocalAuth, { reason, platform: Platform.OS, webBypass: WEB_BYPASS });
}
