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
