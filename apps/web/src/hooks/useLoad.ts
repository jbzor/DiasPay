'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> { data: T | undefined; error: unknown; loading: boolean; reload: (quiet?: boolean) => Promise<void> }

/**
 * Chargement asynchrone simple : dernière réponse seulement (les réponses périmées sont ignorées), rechargement
 * silencieux (temps réel) sans effacer les données affichées.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async (quiet = false) => {
    const n = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await run();
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ data: quiet ? s.data : undefined, error, loading: false }));
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}
