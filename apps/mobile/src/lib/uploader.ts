import { File, UploadType } from 'expo-file-system';
import type { FileUploader } from '@diaspay/api-client';

/**
 * Envoi natif d’une pièce vers l’URL signée (PUT binaire) avec progression (expo-file-system).
 * Une reprise réutilise la même URL et le même chemin (upsert) : jamais de doublon dans le bucket.
 */
export const nativeUploader: FileUploader = async (target, file, onProgress) => {
  const result = await new File(file.uri).upload(target.url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: target.headers,
    mimeType: file.mimeType,
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(Math.min(0.99, bytesSent / totalBytes));
    },
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`Envoi refusé (${result.status})`);
};
