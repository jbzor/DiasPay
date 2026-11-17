import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';
import { bufferToHex } from '@diaspay/domain';
import type { FileHasher } from '@diaspay/api-client';

/**
 * Lot X (X4) : empreinte SHA-256 d’une pièce, calculée sur l’appareil avant l’envoi (expo-crypto 58 : digest sur les
 * octets lus par expo-file-system). Le simulateur et le serveur reçoivent la même fonction : même empreinte.
 */
export const contentHasher: FileHasher = async (file) => {
  const bytes = await new File(file.uri).arrayBuffer();
  return bufferToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
};
