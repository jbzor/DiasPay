import { useSyncExternalStore } from 'react';
import { MockApi } from '@diaspay/api-client';
import type { Persona, Transaction } from '@diaspay/api-client';

// Une seule instance simulée. Le TrustEngine la remplacera derrière la même interface TransactionApi.
export const api = new MockApi();

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
