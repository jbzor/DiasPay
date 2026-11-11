import type { NeedDraft } from '@diaspay/domain';

/** Fusion : par identifiant, la version la plus récente gagne (le tampon local n’efface jamais une version serveur plus neuve). */
export function mergeDrafts(remote: NeedDraft[], local: NeedDraft[]): NeedDraft[] {
  const byId = new Map(remote.map((d) => [d.id, d]));
  for (const d of local) {
    const r = byId.get(d.id);
    if (!r) { if (!d.correctionOf) byId.set(d.id, d); continue; }
    if (d.updatedAt > r.updatedAt) byId.set(d.id, { ...d, documents: r.documents });
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
