import { useSyncExternalStore } from 'react';
import { DEFAULT_MODULES, sortModules } from '@diaspay/domain';
import type { RequestModule } from '@diaspay/domain';

/**
 * Lot X (X6) : types de besoin lus sur le serveur (listModules), gardés ici pour les libellés et la validation de l’assistant.
 * Avant la première lecture (ou hors connexion) : les valeurs du code (DEFAULT_MODULES), identiques à l’amorçage du serveur.
 */
let current: readonly RequestModule[] = DEFAULT_MODULES;
const listeners = new Set<() => void>();

export const getModules = (): readonly RequestModule[] => current;

export function setModules(modules: readonly RequestModule[]): void {
  if (modules.length === 0) return;
  current = sortModules(modules);
  listeners.forEach((l) => l());
}

export function useModuleList(): readonly RequestModule[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getModules, getModules);
}
