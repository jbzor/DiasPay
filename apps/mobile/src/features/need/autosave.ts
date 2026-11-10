/** Sauvegarde différée : regroupe les modifications rapprochées (anti-rebond), avec envoi immédiat à la demande. */
export interface Autosaver<T> {
  schedule(value: T): void;
  /** Enregistre tout de suite la dernière valeur en attente (changement d’étape, sortie). */
  flush(): Promise<void>;
  cancel(): void;
  pending(): boolean;
}

export const AUTOSAVE_DELAY_MS = 500;

export function createAutosaver<T>(save: (value: T) => Promise<unknown>, delayMs = AUTOSAVE_DELAY_MS): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: { value: T } | null = null;
  const run = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const item = latest;
    latest = null;
    if (item) await save(item.value);
  };
  return {
    schedule(value) {
      latest = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void run(); }, delayMs);
    },
    flush: run,
    cancel() { if (timer) clearTimeout(timer); timer = null; latest = null; },
    pending: () => latest !== null,
  };
}
