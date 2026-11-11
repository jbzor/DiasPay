/** Texte sans accents ni majuscules (« Scolarité » ≈ « scolarite »), comme _fold() côté base. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Vrai si la recherche (sans accents ni casse) figure dans l’un des champs. */
export function includesFolded(fields: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const q = fold(query);
  return !q || fields.some((f) => !!f && fold(f).includes(q));
}
