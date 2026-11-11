'use client';
import { useEffect, useRef } from 'react';

import { browserClient } from '@/lib/supabase/browser';

export type LiveTable = 'transactions' | 'tranches' | 'disputes';

/**
 * Mise à jour en direct : changements des tables publiées (RLS appliquée par Supabase Realtime : le personnel
 * reçoit les dossiers qu’il peut lire). Les rafales sont regroupées. En complément, rechargement au retour
 * sur l’onglet et toutes les 30 secondes : une validation partielle d’un autre validateur ne modifie aucune
 * table publiée (seulement validations et audit_log).
 */
export function useRealtime(tables: readonly LiveTable[], onChange: () => void, channelName: string): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',');
  useEffect(() => {
    const sb = browserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; cb.current(); }, 400);
    };
    // Le jeton de l’utilisateur doit être posé avant de rejoindre le canal : sinon le canal est rejoint avec la clé
    // publique (rôle anon) et la RLS ne laisse passer aucun changement.
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await sb.auth.getSession();
      await sb.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      let ch = sb.channel(`bo-${channelName}`);
      for (const table of key.split(',')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
      channel = ch.subscribe();
    })();
    const onVisible = () => { if (document.visibilityState === 'visible') fire(); };
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') fire(); }, 30_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
    };
  }, [key, channelName]);
}
