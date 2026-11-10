import { useSyncExternalStore } from 'react';
import { MockApi } from '@diaspay/api-client';
import type { Persona, Transaction } from '@diaspay/api-client';

import { asyncDraftStore } from './drafts';

// Une seule instance simulée. Le TrustEngine la remplacera derrière la même interface TransactionApi.
// Échec d’envoi simulé désactivé par défaut ; EXPO_PUBLIC_UPLOAD_FAILURE_RATE (0 à 1) l’active pour tester la reprise.
const failureRate = Number(process.env.EXPO_PUBLIC_UPLOAD_FAILURE_RATE ?? '0');
export const api = new MockApi(undefined, undefined, {
  drafts: asyncDraftStore,
  uploadDelayMs: 250,
  uploadFailureRate: Number.isFinite(failureRate) ? Math.min(1, Math.max(0, failureRate)) : 0,
});

export function useTransactions(): readonly Transaction[] {
  return useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
}

let personaVersion = 0;
const pl = new Set<() => void>();
export function setPersona(p: Persona) { api.setPersona(p); personaVersion++; pl.forEach((f) => f()); }
export function usePersona(): Persona {
  useSyncExternalStore((f) => { pl.add(f); return () => pl.delete(f); }, () => personaVersion);
  return api.persona;
}
