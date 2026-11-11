'use client';
import { useEffect } from 'react';

/** Message de résultat, annoncé par les lecteurs d’écran (role=status), effacé après 8 secondes. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, 8000);
    return () => clearTimeout(id);
  }, [message, onDone]);
  return <div role="status" aria-live="polite" className={message ? 'toast' : 'sr-only'}>{message ?? ''}</div>;
}
