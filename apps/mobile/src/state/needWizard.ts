import { useSyncExternalStore } from 'react';
import { newUuid } from '@diaspay/api-client';
import { emptyDraft, toIsoDate } from '@diaspay/domain';
import type { NeedContext, NeedDraft, NeedStep } from '@diaspay/domain';
import { getModules } from './modules';
import { createAutosaver } from '@/features/need/autosave';
import { resumeStep, wizardReducer } from '@/features/need/wizard';
import type { WizardAction, WizardState } from '@/features/need/wizard';
import { api, getCurrentUser } from './api';
import { API_MODE } from './backend';
import { asyncDraftStore } from './drafts';

// État de l’assistant en cours, partagé par les six écrans. Sauvegarde automatique : 500 ms après chaque
// modification, immédiate à chaque changement d’étape.

let state: WizardState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
// Simulateur : chaque sauvegarde va à l’API (qui persiste sur l’appareil).
// Supabase : tampon local à chaque modification (rien n’est perdu hors connexion), synchronisation avec
// save_draft à chaque changement d’étape et avant un envoi de pièce ou la soumission.
const remote = createAutosaver((d: NeedDraft) => api.saveDraft(d).catch(() => undefined));
const local = createAutosaver((d: NeedDraft) => asyncDraftStore.put({ ...d, ownerId: getCurrentUser()?.id, updatedAt: new Date().toISOString() }));
const SERVER = API_MODE === 'supabase';
const autosaver = {
  schedule(d: NeedDraft) { (SERVER ? local : remote).schedule(d); },
  async flush() { await (SERVER ? local : remote).flush(); },
  cancel() { local.cancel(); remote.cancel(); },
};
/** Synchronisation serveur immédiate (mode Supabase) ; lève l’erreur (hors connexion…) pour l’appelant qui en a besoin. */
async function syncRemote(d: NeedDraft): Promise<void> {
  if (!SERVER) return;
  remote.cancel();
  await api.saveDraft(d);
}

/** Retire le tampon local d’un brouillon (après soumission ou suppression). */
export async function removeLocalDraft(id: string): Promise<void> {
  if (SERVER) await asyncDraftStore.remove(id);
}

const STEP_ACTIONS = new Set<WizardAction['type']>(['goto', 'next', 'back']);

export function useWizard(): WizardState | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
export const getWizard = () => state;

export function needContext(): NeedContext {
  return { today: toIsoDate(new Date()), creatorRole: getCurrentUser()?.role, modules: getModules() };
}

/** Démarre un nouveau besoin (le brouillon est enregistré à la première saisie). */
export function startNewNeed(): void {
  autosaver.cancel();
  state = { draft: emptyDraft(newUuid(), new Date()), step: 'type' };
  notify();
}

/** Rouvre un brouillon à sa dernière étape (sans dépasser la première étape incomplète). */
export function openDraft(draft: NeedDraft): NeedStep {
  autosaver.cancel();
  const step = resumeStep(draft, needContext());
  state = wizardReducer({ draft, step }, { type: 'load', draft, step });
  notify();
  return step;
}

export function dispatch(action: WizardAction): void {
  if (!state) return;
  const next = wizardReducer(state, action);
  if (next === state) return;
  state = next;
  notify();
  autosaver.schedule(state.draft);
  if (STEP_ACTIONS.has(action.type)) {
    void autosaver.flush();
    if (SERVER) void syncRemote(state.draft).catch(() => undefined); // hors connexion : le tampon local suffit
  }
}

/** Enregistre tout de suite (avant un envoi de pièce, à la sortie, sur « Enregistrer le brouillon »). */
export async function saveNow(): Promise<void> {
  if (!state) return;
  autosaver.schedule(state.draft);
  await autosaver.flush();
  await syncRemote(state.draft);
}

/** Ferme l’assistant sans rien perdre. */
export async function closeWizard(): Promise<void> {
  await saveNow().catch(() => undefined); // hors connexion : le brouillon reste dans le tampon local
  state = null;
  notify();
}

/** Après la soumission : le brouillon n’existe plus côté API, aucune sauvegarde ne doit le recréer. */
export function discardWizard(): void {
  autosaver.cancel();
  if (state) void removeLocalDraft(state.draft.id);
  state = null;
  notify();
}
