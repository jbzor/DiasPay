import { useSyncExternalStore } from 'react';
import { MockApi } from '@diaspay/api-client';
import { DomainError } from '@diaspay/domain';
import type { Persona, Transaction, TransactionApi } from '@diaspay/api-client';
import type { DisputeOutcome } from '@diaspay/domain';

import { contentHasher } from '@/lib/contentHash';
import { API_MODE, CONFIGURED, getSupabaseApi } from './backend';
import { asyncDraftStore } from './drafts';
import { asyncStateStore } from './simState';

/** Opérations de démonstration, communes au simulateur et au serveur en mock_mode (voir demoAvailable). */
export interface DemoOps {
  simulateReview(txId: string, decision: { approved: boolean; reason?: string }): Promise<Transaction>;
  simulateDisputeResolution(trancheId: string, decision: { outcome: DisputeOutcome; note: string }): Promise<Transaction>;
  resetDemoData(): Promise<void>;
}
export type AppApi = TransactionApi & DemoOps;

// Simulateur sur l’appareil : créé seulement avec EXPO_PUBLIC_API=mock (lot A, T4). En usage normal (Supabase), il
// n’existe pas : aucun jeu de démonstration n’est chargé ni persisté. Échec d’envoi simulé désactivé par défaut ;
// EXPO_PUBLIC_UPLOAD_FAILURE_RATE (0 à 1) l’active pour tester la reprise.
const failureRate = Number(process.env.EXPO_PUBLIC_UPLOAD_FAILURE_RATE ?? '0');
export const mockApi: MockApi | null = API_MODE === 'mock' ? new MockApi(undefined, undefined, {
  drafts: asyncDraftStore,
  state: asyncStateStore,
  uploadDelayMs: 250,
  uploadFailureRate: Number.isFinite(failureRate) ? Math.min(1, Math.max(0, failureRate)) : 0,
  hashFile: contentHasher,   // lot X (X4) : même empreinte que le serveur
}) : null;

/** Configuration incomplète : toute opération échoue (CONFIG_MISSING) ; l’écran « Configuration manquante » s’affiche. */
const unconfigured = new Proxy({} as AppApi, {
  get: () => () => Promise.reject(new DomainError('CONFIG_MISSING', 'Configuration du serveur manquante')),
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
export const api: AppApi = withInvalidation<AppApi>(mockApi ?? (CONFIGURED ? getSupabaseApi() : unconfigured));

// ——— Utilisateur courant et profil de démonstration ———

export interface CurrentUser { id: string; role: 'PAYER' | 'REQUESTER' | 'PROVIDER'; name?: string }
let currentUser: CurrentUser | null = null;
export const getCurrentUser = () => currentUser;
export function setCurrentUser(u: CurrentUser | null): void {
  currentUser = u;
  // Simulateur : le compte de démonstration est déjà enrôlé (N2 : il peut aussi initier en prestataire). Sur Supabase, le
  // niveau vient du serveur (profiles.enrolment_level, X4 v2).
  mockApi?.setUser(u && { ...u, enrolmentLevel: 'N2' });
}

let persona: Persona = 'PAYER';
let personaVersion = 0;
const pl = new Set<() => void>();
export function setPersona(p: Persona) { persona = p; mockApi?.setPersona(p); personaVersion++; pl.forEach((f) => f()); }
export function usePersona(): Persona {
  useSyncExternalStore((f) => { pl.add(f); return () => pl.delete(f); }, () => personaVersion);
  return persona;
}
