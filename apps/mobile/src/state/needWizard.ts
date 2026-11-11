import { useSyncExternalStore } from 'react';
import { newUuid } from '@diaspay/api-client';
import { emptyDraft, toIsoDate } from '@diaspay/domain';
import type { NeedContext, NeedDraft, NeedStep } from '@diaspay/domain';
import { createAutosaver } from '@/features/need/autosave';
import { resumeStep, wizardReducer } from '@/features/need/wizard';
import type { WizardAction, WizardState } from '@/features/need/wizard';
import { api } from './api';

// État de l’assistant en cours, partagé par les six écrans. Sauvegarde automatique : 500 ms après chaque
// modification, immédiate à chaque changement d’étape.

let state: WizardState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const autosaver = createAutosaver((d: NeedDraft) => api.saveDraft(d));

const STEP_ACTIONS = new Set<WizardAction['type']>(['goto', 'next', 'back']);

export function useWizard(): WizardState | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
export const getWizard = () => state;

export function needContext(): NeedContext {
  return { today: toIsoDate(new Date()), creatorRole: api.user?.role };
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
  if (STEP_ACTIONS.has(action.type)) void autosaver.flush();
}

/** Enregistre tout de suite (avant un envoi de pièce, à la sortie, sur « Enregistrer le brouillon »). */
export async function saveNow(): Promise<void> {
  if (!state) return;
  autosaver.schedule(state.draft);
  await autosaver.flush();
}

/** Ferme l’assistant sans rien perdre. */
export async function closeWizard(): Promise<void> {
  await saveNow();
  state = null;
  notify();
}

/** Après la soumission : le brouillon n’existe plus côté API, aucune sauvegarde ne doit le recréer. */
export function discardWizard(): void {
  autosaver.cancel();
  state = null;
  notify();
}
