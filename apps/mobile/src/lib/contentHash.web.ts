import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { bufferToHex } from '@diaspay/domain';
import type { FileHasher } from '@diaspay/api-client';

/** Version web : le fichier choisi est lu par son URL (blob:, data:), puis haché par expo-crypto (WebCrypto). */
export const contentHasher: FileHasher = async (file) => {
  const bytes = await (await fetch(file.uri)).arrayBuffer();
  return bufferToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
};
