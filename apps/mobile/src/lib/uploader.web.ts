import { fetchUploader } from '@diaspay/api-client';
import type { FileUploader } from '@diaspay/api-client';

/** Web : envoi par fetch (le fichier choisi est une URL blob:). */
export const nativeUploader: FileUploader = fetchUploader;
