// Lien profond reçu avant l’authentification : conservé en mémoire puis rejoué une fois connecté.
let pending: string | null = null;
export const setPendingReference = (ref: string | null) => { pending = ref; };
export function takePendingReference(): string | null {
  const ref = pending;
  pending = null;
  return ref;
}
