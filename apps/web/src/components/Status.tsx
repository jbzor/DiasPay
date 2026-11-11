export type Tone = 'pending' | 'active' | 'error' | 'draft';

/** Statut : point coloré (décoratif) et mot (porteur de l’information). */
export function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`status ${tone}`}><span className={`dot ${tone}`} aria-hidden="true" />{children}</span>;
}
