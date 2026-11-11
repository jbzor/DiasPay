'use client';
import { createContext, useContext, useEffect } from 'react';

import { browserClient } from '@/lib/supabase/browser';

export interface StaffInfo { id: string; name: string; role: 'VALIDATOR' | 'ADMIN' }
const Ctx = createContext<StaffInfo | null>(null);

/** Membre du personnel connecté, pour les composants du navigateur ; surveille la fin de session. */
export function StaffProvider({ staff, children }: { staff: StaffInfo; children: React.ReactNode }) {
  useEffect(() => {
    const { data } = browserClient().auth.onAuthStateChange((event) => {
      // Session expirée ou révoquée (rafraîchissement impossible), ou déconnexion depuis un autre onglet.
      if (event === 'SIGNED_OUT') window.location.assign('/connexion?motif=expiree');
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={staff}>{children}</Ctx.Provider>;
}

export function useStaff(): StaffInfo {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStaff hors de StaffProvider');
  return s;
}
