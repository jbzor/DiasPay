import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { DomainError } from '@diaspay/domain';
import type { NeedDraft } from '@diaspay/domain';
import type { AppNotification, Transaction } from '@diaspay/api-client';

import { api, mockApi, onApiWrite } from './api';
import { API_MODE, demoAvailable, getSupabaseApi } from './backend';
import { asyncDraftStore } from './drafts';
import { mergeDrafts } from '@/features/need/mergeDrafts';
import { useSession } from './auth';
import { setModules } from './modules';

/**
 * Données serveur de l’application : une seule source (react-query), mêmes crochets pour le simulateur et
 * pour Supabase. Les clés sont centralisées ici ; chaque écriture et chaque événement temps réel invalident.
 */
const RETRYABLE = new Set(['OFFLINE', 'UNEXPECTED']);
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Hors connexion : on tente une fois, puis on garde la dernière donnée connue (bandeau « Hors connexion »).
      networkMode: 'offlineFirst',
      staleTime: 30_000,
      gcTime: 7 * 24 * 3_600_000,
      retry: (count, e) => count < 2 && (!(e instanceof DomainError) || RETRYABLE.has(e.code)),
    },
    // Une écriture n’est jamais mise en attente silencieusement : hors connexion, l’erreur est affichée.
    mutations: { networkMode: 'always' },
  },
});

/** Clés de requête. La racine contient l’utilisateur : un compte ne voit jamais le cache d’un autre. */
export const qk = {
  root: (uid: string | undefined) => ['diaspay', uid ?? 'anon'] as const,
  transactions: (uid: string | undefined) => [...qk.root(uid), 'transactions'] as const,
  notifications: (uid: string | undefined) => [...qk.root(uid), 'notifications'] as const,
  drafts: (uid: string | undefined) => [...qk.root(uid), 'drafts'] as const,
  token: (uid: string | undefined, trancheId: string) => [...qk.root(uid), 'token', trancheId] as const,
  receipt: (uid: string | undefined, trancheId: string) => [...qk.root(uid), 'receipt', trancheId] as const,
  dispute: (uid: string | undefined, trancheId: string) => [...qk.root(uid), 'dispute', trancheId] as const,
  modules: (uid: string | undefined) => [...qk.root(uid), 'modules'] as const,
};

/** Invalide toutes les données (après une écriture, un événement temps réel, un retour au premier plan). */
export function invalidateAll(): void { void queryClient.invalidateQueries({ queryKey: ['diaspay'] }); }
onApiWrite(invalidateAll);
// Le simulateur notifie ses changements (minuteries, actions) : il passe par les mêmes crochets.
mockApi?.subscribe(() => invalidateAll());

// ——— Connexion et premier plan ———

onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)));
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
    return () => sub.remove();
  });
}

export function useOnline(): boolean {
  return useSyncExternalStore((f) => onlineManager.subscribe(f), () => onlineManager.isOnline(), () => true);
}

/** Erreur à lever avant une action qui exige le réseau. */
export function assertOnline(): void {
  if (!onlineManager.isOnline()) throw new DomainError('OFFLINE', 'Hors connexion');
}

// ——— Crochets ———

const useUid = () => useSession().session?.userId;

/** Lot X (X6) : types de besoin du serveur, recopiés dans state/modules (libellés, validation de l’assistant). */
export function useModulesQuery(): void {
  const uid = useUid();
  const q = useQuery({ queryKey: qk.modules(uid), queryFn: () => api.listModules(), enabled: !!uid, staleTime: 10 * 60_000 });
  useEffect(() => { if (q.data) setModules(q.data); }, [q.data]);
}

export function useTransactionsQuery(): UseQueryResult<Transaction[]> {
  const uid = useUid();
  return useQuery({ queryKey: qk.transactions(uid), queryFn: () => api.listTransactions(), enabled: !!uid });
}
/** Liste des transactions (vide pendant le chargement). */
export function useTransactions(): readonly Transaction[] {
  return useTransactionsQuery().data ?? EMPTY;
}
const EMPTY: readonly Transaction[] = [];

export function useNotificationsQuery(): UseQueryResult<AppNotification[]> {
  const uid = useUid();
  return useQuery({ queryKey: qk.notifications(uid), queryFn: () => api.listNotifications(), enabled: !!uid });
}
/** Alertes ; null pendant le premier chargement. */
export function useNotifications(): AppNotification[] | null {
  return useNotificationsQuery().data ?? null;
}

/**
 * Brouillons. Mode Supabase : ceux du serveur, complétés par le tampon local (saisies non encore synchronisées,
 * plus récentes) ; mode simulateur : ceux du simulateur.
 */
export function useDraftsQuery(): UseQueryResult<NeedDraft[]> {
  const uid = useUid();
  return useQuery({ queryKey: qk.drafts(uid), queryFn: () => listDrafts(uid), enabled: !!uid });
}
export function useDrafts(): NeedDraft[] {
  return useDraftsQuery().data ?? [];
}

export async function listDrafts(uid: string | undefined): Promise<NeedDraft[]> {
  if (API_MODE !== 'supabase') return api.listDrafts();
  const local = (await asyncDraftStore.list()).filter((d) => d.ownerId === uid);
  let remote: NeedDraft[] = [];
  try { remote = await api.listDrafts(); } catch (e) { if (!local.length) throw e; }
  return mergeDrafts(remote, local);
}

export function useTokenQuery(trancheId: string | undefined) {
  const uid = useUid();
  return useQuery({ queryKey: qk.token(uid, trancheId ?? ''), queryFn: () => api.getToken(trancheId!), enabled: !!uid && !!trancheId });
}
export function useReceiptQuery(trancheId: string | undefined) {
  const uid = useUid();
  return useQuery({ queryKey: qk.receipt(uid, trancheId ?? ''), queryFn: () => api.getReceipt(trancheId!), enabled: !!uid && !!trancheId });
}
export function useDisputeQuery(trancheId: string | undefined) {
  const uid = useUid();
  return useQuery({ queryKey: qk.dispute(uid, trancheId ?? ''), queryFn: () => api.getDispute(trancheId!), enabled: !!uid && !!trancheId });
}

/**
 * Fonctions de démonstration visibles ? Simulateur : EXPO_PUBLIC_DEMO=1. Supabase : EXPO_PUBLIC_DEMO=1 et serveur en mock_mode.
 */
export function useDemo(): boolean {
  const uid = useUid();
  return useQuery({ queryKey: [...qk.root(uid), 'demo'], queryFn: demoAvailable, enabled: !!uid, staleTime: Infinity }).data ?? false;
}

// ——— Temps réel (mode Supabase) ———

/**
 * Abonnement aux changements tant que l’utilisateur est connecté et l’application au premier plan ;
 * désabonnement à la déconnexion et en arrière-plan, nouvel abonnement et rechargement au retour.
 */
export function useRealtime(): void {
  const uid = useUid();
  useEffect(() => {
    if (API_MODE !== 'supabase' || !uid) return;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; invalidateAll(); }, 300); // regroupe une rafale (tranche + transaction + alerte)
    };
    const start = () => { if (!unsubscribe) { unsubscribe = getSupabaseApi().subscribeChanges(onChange); invalidateAll(); } };
    const stop = () => { unsubscribe?.(); unsubscribe = null; };
    start();
    const sub = Platform.OS === 'web' ? null : AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => { sub?.remove(); stop(); if (timer) clearTimeout(timer); };
  }, [uid]);
}
