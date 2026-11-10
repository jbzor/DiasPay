import { DomainError } from '@diaspay/domain';
import type { NeedDraft, Vertical } from '@diaspay/domain';

export interface ProviderSummary { id: string; name: string; city: string; verticals: Vertical[]; verified: boolean }

/** Erreur d’API à code stable, avec des détails exploitables par l’écran (pièce manquante, liste des problèmes…). */
export class ApiError extends DomainError {
  constructor(code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(code, message);
  }
}

/** Persistance des brouillons. MemoryDraftStore pour les tests ; l’application fournit une implémentation sur l’appareil. */
export interface DraftStore {
  list(): Promise<NeedDraft[]>;
  get(id: string): Promise<NeedDraft | undefined>;
  put(draft: NeedDraft): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryDraftStore implements DraftStore {
  private readonly items = new Map<string, NeedDraft>();
  async list() { return [...this.items.values()].map((d) => structuredClone(d)); }
  async get(id: string) { const d = this.items.get(id); return d ? structuredClone(d) : undefined; }
  async put(draft: NeedDraft) { this.items.set(draft.id, structuredClone(draft)); }
  async remove(id: string) { this.items.delete(id); }
}

/** Identifiant unique côté client (brouillons, pièces) : stable après rechargement. */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Comparaison insensible à la casse et aux accents. */
export const foldText = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Annuaire simulé de prestataires vérifiés (vague 1 : écoles, hôpitaux, bailleurs). */
export const SEED_PROVIDERS: ProviderSummary[] = [
  { id: 'pv-hopital-central', name: 'Hôpital Central', city: 'Yaoundé', verticals: ['HEALTH'], verified: true },
  { id: 'pv-saint-luc', name: 'Hôpital Saint-Luc', city: 'Douala', verticals: ['HEALTH'], verified: true },
  { id: 'pv-espoir', name: 'Clinique de l’Espoir', city: 'Douala', verticals: ['HEALTH'], verified: true },
  { id: 'pv-palmiers', name: 'École Les Palmiers', city: 'Yaoundé', verticals: ['EDUCATION'], verified: true },
  { id: 'pv-reussite', name: 'Collège La Réussite', city: 'Douala', verticals: ['EDUCATION'], verified: true },
  { id: 'pv-bambous', name: 'Institut Les Bambous', city: 'Bafoussam', verticals: ['EDUCATION'], verified: true },
  { id: 'pv-bastos', name: 'Studio Bastos', city: 'Yaoundé', verticals: ['RENT'], verified: true },
  { id: 'pv-akwa', name: 'Résidence Akwa', city: 'Douala', verticals: ['RENT', 'REAL_ESTATE'], verified: true },
  { id: 'pv-agriplus', name: 'Coopérative Agri-Plus', city: 'Bafoussam', verticals: ['AGRO'], verified: true },
  { id: 'pv-mbarga', name: 'Étude notariale Mbarga', city: 'Yaoundé', verticals: ['LAND', 'REAL_ESTATE'], verified: true },
];

/** Événement préparé pour les alertes (lot suivant). */
export interface AppEvent { id: string; at: string; kind: 'NEED_VALIDATED' | 'NEED_REJECTED'; txId: string; reason?: string }
