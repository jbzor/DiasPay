import { DomainError } from './types';
import type { Vertical } from './types';

/** Types de pièces justificatives. Les libellés affichés sont traduits côté application (`doc_<kind>`). */
export type DocumentKind =
  | 'QUOTE'                  // devis ou facture proforma
  | 'BENEFICIARY_ID'         // pièce d’identité du bénéficiaire
  | 'MEDICAL_CERTIFICATE'    // certificat médical
  | 'ENROLMENT_CERTIFICATE'  // attestation d’inscription
  | 'SCHOOL_SCHEDULE'        // échéancier de l’école
  | 'LEASE'                  // bail
  | 'LAST_RECEIPT'           // dernière quittance
  | 'SUPPORTING_DOCUMENT';   // pièce justificative générique (vague 2, provisoire)

/** Type de pièce d’un module : les types connus du code, ou tout type déclaré par un module (lot X, X6). */
export type ModuleDocumentKind = DocumentKind | (string & {});

export interface RequiredDocument { kind: DocumentKind; required: boolean }

// Vague 1 (Santé, Scolarité, Loyer) : Décision D2, 10/11/2026 (docs/decisions.md).
// Agro, Immobilier et Terrain : À CONFIRMER, valeurs provisoires à définir en vague 2 (jalons et preuves).
export const REQUIRED_DOCUMENTS: Record<Vertical, RequiredDocument[]> = {
  HEALTH: [
    { kind: 'QUOTE', required: true }, // Décision D2, 10/11/2026
    { kind: 'BENEFICIARY_ID', required: true }, // Décision D2, 10/11/2026
    { kind: 'MEDICAL_CERTIFICATE', required: false }, // Décision D2, 10/11/2026
  ],
  EDUCATION: [
    { kind: 'ENROLMENT_CERTIFICATE', required: true }, // Décision D2, 10/11/2026
    { kind: 'SCHOOL_SCHEDULE', required: false }, // Décision D2, 10/11/2026
  ],
  RENT: [
    { kind: 'LEASE', required: true }, // Décision D2, 10/11/2026
    { kind: 'LAST_RECEIPT', required: false }, // Décision D2, 10/11/2026
  ],
  AGRO: [{ kind: 'SUPPORTING_DOCUMENT', required: true }],        // À CONFIRMER (provisoire, vague 2)
  REAL_ESTATE: [{ kind: 'SUPPORTING_DOCUMENT', required: true }], // À CONFIRMER (provisoire, vague 2)
  LAND: [{ kind: 'SUPPORTING_DOCUMENT', required: true }],        // À CONFIRMER (provisoire, vague 2)
};

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Décision D2 : jusqu’à 3 fichiers par type de pièce (recto et verso d’une pièce d’identité, par exemple). */
export const MAX_FILES_PER_KIND = 3;

/** Refuse un fichier de plus pour ce type de pièce (TOO_MANY_FILES au-delà de 3). */
export function checkFileCount(existingForKind: number, max: number = MAX_FILES_PER_KIND): void {
  // Lot X (X6) : le maximum peut venir du module (maxFiles) ; 3 par défaut (décision D2).
  if (existingForKind >= max) throw new DomainError('TOO_MANY_FILES', `Au plus ${max} fichiers par pièce`);
}

const BY_EXTENSION: Record<string, AllowedMimeType> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

/** Type MIME effectif : celui fourni s’il est connu, sinon déduit de l’extension. */
export function resolveMimeType(name: string, mimeType?: string): string {
  const m = (mimeType ?? '').toLowerCase();
  if (m === 'image/jpg') return 'image/jpeg';
  if (m && m !== 'application/octet-stream') return m;
  return BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? m;
}

/** Contrôle d’un fichier avant envoi : JPEG, PNG ou PDF, 10 Mo maximum. Lève FILE_TYPE ou FILE_TOO_LARGE. */
export function checkFile(file: { name: string; mimeType?: string; sizeBytes: number }): AllowedMimeType {
  const mime = resolveMimeType(file.name, file.mimeType);
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) throw new DomainError('FILE_TYPE', 'Format accepté : JPEG, PNG ou PDF');
  if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > MAX_FILE_BYTES) {
    throw new DomainError('FILE_TOO_LARGE', 'Fichier vide ou de plus de 10 Mo');
  }
  return mime as AllowedMimeType;
}

/** Pièces obligatoires de la verticale sans aucun fichier envoyé (une pièce est « fournie » dès le premier fichier ; le validateur juge de la suffisance). */
export function missingRequiredDocuments(vertical: Vertical, documents: ReadonlyArray<{ kind: string; status: string }>): DocumentKind[] {
  return REQUIRED_DOCUMENTS[vertical]
    .filter((d) => d.required && !documents.some((x) => x.kind === d.kind && x.status === 'UPLOADED'))
    .map((d) => d.kind);
}
