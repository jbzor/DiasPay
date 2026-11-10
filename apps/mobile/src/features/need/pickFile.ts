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

/** Compression avant envoi : côté long 2000 px, JPEG qualité 0,8. */
async function compress(asset: { uri: string; width: number; height: number; fileName?: string | null }): Promise<PickedFile> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const size = compressedSize(asset.width, asset.height);
  if (size) ctx.resize(size);
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  const base = (asset.fileName ?? 'photo').replace(/\.[^.]+$/, '');
  return { uri: out.uri, name: `${base}.jpg`, mimeType: 'image/jpeg', sizeBytes: await sizeOf(out.uri) };
}

/** Choisit une pièce. Les permissions sont demandées au moment de l’action ; un refus est signalé. */
export async function pickFile(source: PickSource): Promise<PickResult> {
  if (source === 'document') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return { kind: 'cancelled' };
    const a = r.assets[0];
    if (a.mimeType?.startsWith('image/') && a.mimeType !== 'image/png') {
      // Une photo choisie comme document est aussi compressée (dimensions inconnues : on lit l’image).
      const ref = await ImageManipulator.manipulate(a.uri).renderAsync();
      return { kind: 'file', file: await compress({ uri: a.uri, width: ref.width, height: ref.height, fileName: a.name }) };
    }
    return { kind: 'file', file: { uri: a.uri, name: a.name, mimeType: a.mimeType, sizeBytes: await sizeOf(a.uri, a.size) } };
  }
  if (Platform.OS !== 'web') {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { kind: 'denied' };
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]) return { kind: 'cancelled' };
  const a = r.assets[0];
  if (a.mimeType === 'image/png' && !compressedSize(a.width, a.height)) {
    return { kind: 'file', file: { uri: a.uri, name: a.fileName ?? 'image.png', mimeType: 'image/png', sizeBytes: await sizeOf(a.uri, a.fileSize) } };
  }
  return { kind: 'file', file: await compress(a) };
}
