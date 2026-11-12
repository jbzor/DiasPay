import { useSyncExternalStore } from 'react';
import { MockApi } from '@diaspay/api-client';
import type { Persona, Transaction, TransactionApi } from '@diaspay/api-client';
import type { DisputeOutcome } from '@diaspay/domain';

import { contentHasher } from '@/lib/contentHash';
import { API_MODE, getSupabaseApi } from './backend';
import { asyncDraftStore } from './drafts';
import { asyncStateStore } from './simState';

/** Opérations de démonstration, communes au simulateur et au serveur en mock_mode (voir demoAvailable). */
export interface DemoOps {
  simulateReview(txId: string, decision: { approved: boolean; reason?: string }): Promise<Transaction>;
  simulateDisputeResolution(trancheId: string, decision: { outcome: DisputeOutcome; note: string }): Promise<Transaction>;
  resetDemoData(): Promise<void>;
}
export type AppApi = TransactionApi & DemoOps;

// Simulateur sur l’appareil (mode « mock », défaut). Échec d’envoi simulé désactivé par défaut ;
// EXPO_PUBLIC_UPLOAD_FAILURE_RATE (0 à 1) l’active pour tester la reprise.
const failureRate = Number(process.env.EXPO_PUBLIC_UPLOAD_FAILURE_RATE ?? '0');
export const mockApi = new MockApi(undefined, undefined, {
  drafts: asyncDraftStore,
  state: asyncStateStore,
  uploadDelayMs: 250,
  uploadFailureRate: Number.isFinite(failureRate) ? Math.min(1, Math.max(0, failureRate)) : 0,
  hashFile: contentHasher,   // lot X (X4) : même empreinte que le serveur
});

/** Après chaque écriture, les requêtes sont invalidées (branché par queries.ts, sans dépendance circulaire). */
let afterWrite: () => void = () => undefined;
export function onApiWrite(f: () => void): void { afterWrite = f; }

const READS = /^(get|list|search|resolve|timeline|serverMockMode|documentUrl|subscribe)/;
function withInvalidation<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const v = Reflect.get(obj, prop, obj) as unknown;
      if (typeof v !== 'function') return v;
      if (typeof prop !== 'string' || READS.test(prop)) return (v as (...a: unknown[]) => unknown).bind(obj);
      return async (...args: unknown[]) => {
        try { return await (v as (...a: unknown[]) => Promise<unknown>).apply(obj, args); } finally { afterWrite(); }
      };
    },
  });
}

/** L’API de l’application : simulateur ou Supabase, choisie à la racine par EXPO_PUBLIC_API. */
export const api: AppApi = withInvalidation<AppApi>(API_MODE === 'supabase' ? getSupabaseApi() : mockApi);

// ——— Utilisateur courant et profil de démonstration ———

export interface CurrentUser { id: string; role: 'PAYER' | 'REQUESTER' | 'PROVIDER'; name?: string }
let currentUser: CurrentUser | null = null;
export const getCurrentUser = () => currentUser;
export function setCurrentUser(u: CurrentUser | null): void {
  currentUser = u;
  mockApi.setUser(u);
}

let persona: Persona = 'PAYER';
let personaVersion = 0;
const pl = new Set<() => void>();
export function setPersona(p: Persona) { persona = p; mockApi.setPersona(p); personaVersion++; pl.forEach((f) => f()); }
export function usePersona(): Persona {
  useSyncExternalStore((f) => { pl.add(f); return () => pl.delete(f); }, () => personaVersion);
  return persona;
}
