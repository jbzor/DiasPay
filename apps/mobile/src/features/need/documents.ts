import type { DraftDocument } from '@diaspay/domain';

/**
 * État des pièces au rechargement d’un brouillon (logique pure).
 * Une pièce envoyée reste acquise (elle est côté serveur simulé). Une pièce en cours ou en échec dépend
 * de son fichier local : présent → « échec, à renvoyer » ; disparu → « à rajouter » (MISSING), sans planter.
 */
export function reviveDocuments(docs: readonly DraftDocument[] | undefined, exists: (uri: string) => boolean): DraftDocument[] {
  return (docs ?? []).map((d) => {
    if (d.status === 'UPLOADED' || d.status === 'MISSING') return d;
    return { ...d, status: d.uri && exists(d.uri) ? 'FAILED' : 'MISSING' };
  });
}

/** Fichiers d’un type de pièce, dans l’ordre d’ajout. */
export function filesForKind(docs: readonly DraftDocument[], kind: string): DraftDocument[] {
  return docs.filter((d) => d.kind === kind);
}

/** Emplacements occupés pour un type de pièce (un fichier « à rajouter » ne compte pas : il sera remplacé). */
export function occupiedSlots(docs: readonly DraftDocument[], kind: string): number {
  return docs.filter((d) => d.kind === kind && d.status !== 'MISSING').length;
}
