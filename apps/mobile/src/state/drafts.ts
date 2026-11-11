import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import type { DraftStore } from '@diaspay/api-client';
import type { NeedDraft } from '@diaspay/domain';
import { reviveDocuments } from '@/features/need/documents';

export type { DraftStore };

// Brouillons de la simulation, persistés sur l’appareil (AsyncStorage gère aussi le web via localStorage).
// Le filtrage par utilisateur connecté est fait par l’API (ownerId) : un brouillon n’est jamais montré à un autre compte.
const KEY = 'diaspay.drafts.v1';

/** Le fichier local existe-t-il encore ? Sur le web, une URL blob: ne survit pas au rechargement. */
function fileExists(uri: string): boolean {
  if (Platform.OS === 'web') return !uri.startsWith('blob:');
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

async function readAll(): Promise<Record<string, NeedDraft>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, NeedDraft>) : {};
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();
/** Écritures sérialisées : deux sauvegardes rapprochées ne s’écrasent pas. */
function mutate(fn: (all: Record<string, NeedDraft>) => void): Promise<void> {
  const run = queue.then(async () => {
    const all = await readAll();
    fn(all);
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  });
  queue = run.catch(() => undefined);
  return run;
}

export const asyncDraftStore: DraftStore = {
  async list() {
    await queue;
    return Object.values(await readAll()).map((d) => ({ ...d, documents: reviveDocuments(d.documents, fileExists) }));
  },
  async get(id) {
    await queue;
    const d = (await readAll())[id];
    return d ? { ...d, documents: reviveDocuments(d.documents, fileExists) } : undefined;
  },
  put: (draft) => mutate((all) => { all[draft.id] = draft; }),
  remove: (id) => mutate((all) => { delete all[id]; }),
};
