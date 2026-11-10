import { useEffect, useState } from 'react';
import type { AppNotification } from '@diaspay/api-client';
import { api } from './api';

/** Alertes de l’utilisateur, rechargées à chaque changement de la simulation. */
export function useNotifications(): AppNotification[] | null {
  const [list, setList] = useState<AppNotification[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { void api.listNotifications().then((l) => { if (alive) setList(l); }); };
    load();
    const unsub = api.subscribe(load);
    return () => { alive = false; unsub(); };
  }, []);
  return list;
}
