import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { compressedSize } from './wizard';

export type PickSource = 'camera' | 'library' | 'document';
export interface PickedFile { uri: string; name: string; mimeType?: string; sizeBytes: number }
export type PickResult = { kind: 'file'; file: PickedFile } | { kind: 'cancelled' } | { kind: 'denied' };

async function sizeOf(uri: string, fallback?: number | null): Promise<number> {
  if (fallback) return fallback;
  try {
    if (Platform.OS === 'web') return (await (await fetch(uri)).blob()).size;
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Toute image est réencodée avant l’envoi : l’image est redessinée puis enregistrée dans un nouveau fichier,
 * ce qui retire les métadonnées (EXIF, dont les coordonnées GPS) du fichier d’origine.
 * JPEG : côté long ramené à 2000 px, qualité 0,8. PNG : dimensions conservées (sous 2000 px), format PNG.
 */
async function reencode(asset: { uri: string; width: number; height: number; fileName?: string | null }, keepPng: boolean): Promise<PickedFile> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const size = compressedSize(asset.width, asset.height);
  if (size) ctx.resize(size);
  const ref = await ctx.renderAsync();
  const png = keepPng && !size;
  const out = await ref.saveAsync(png ? { format: SaveFormat.PNG } : { compress: 0.8, format: SaveFormat.JPEG });
  const base = (asset.fileName ?? 'photo').replace(/\.[^.]+$/, '');
  return { uri: out.uri, name: `${base}.${png ? 'png' : 'jpg'}`, mimeType: png ? 'image/png' : 'image/jpeg', sizeBytes: await sizeOf(out.uri) };
}

/** Choisit une pièce. Les permissions sont demandées au moment de l’action ; un refus est signalé. */
export async function pickFile(source: PickSource): Promise<PickResult> {
  if (source === 'document') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return { kind: 'cancelled' };
    const a = r.assets[0];
    if (a.mimeType?.startsWith('image/')) {
      // Une image choisie comme document est aussi réencodée (métadonnées retirées) ; dimensions lues sur l’image.
      const ref = await ImageManipulator.manipulate(a.uri).renderAsync();
      return { kind: 'file', file: await reencode({ uri: a.uri, width: ref.width, height: ref.height, fileName: a.name }, a.mimeType === 'image/png') };
    }
    return { kind: 'file', file: { uri: a.uri, name: a.name, mimeType: a.mimeType, sizeBytes: await sizeOf(a.uri, a.size) } };
  }
  if (Platform.OS !== 'web') {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { kind: 'denied' };
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]) return { kind: 'cancelled' };
  const a = r.assets[0];
  return { kind: 'file', file: await reencode(a, a.mimeType === 'image/png') };
}
