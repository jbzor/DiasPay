/**
 * Table unique des codes d’erreur stables (lot 4). Le serveur les renvoie dans le champ « hint »
 * (errcode P0001), le simulateur et le domaine dans DomainError.code ; l’application les traduit
 * (clé err_<CODE>). Toute erreur sans code connu devient UNEXPECTED, journalisée, jamais affichée brute.
 *
 * Origine : D = règle du domaine (@diaspay/domain), S = fonction SQL, C = client (application, simulateur, authentification).
 * Documentation : docs/error-codes.md (vérifiée par test : chaque code y figure).
 */
export const ERROR_CODES = {
  // Session et accès
  NOT_AUTHENTICATED: 'S C — aucune session ou session expirée',
  NOT_FOUND: 'S C — élément introuvable (alerte, pièce)',
  TX_NOT_FOUND: 'S C — transaction ou brouillon introuvable, ou inaccessible (RLS)',
  TRANCHE_NOT_FOUND: 'S C — tranche introuvable, ou inaccessible',
  NOT_A_PARTY: 'D S — l’utilisateur n’est pas partie au dossier',
  PROVIDER_ONLY: 'D S — réservé au prestataire',
  PAYER_ONLY: 'D S — réservé au payeur (déblocage anticipé ; lot X : demande reçue, informations, rejet)',
  INITIATOR_ONLY: 'D S — réservé à l’initiateur de la demande (réponse, révocation du jeton ; lot X)',
  ENROLMENT_REQUIRED: 'D S — niveau d’enrôlement insuffisant (N1 pour initier en demandeur, N2 en prestataire ; detail : required, current ; X4 v2)',
  VALIDATOR_ONLY: 'D S — réservé aux validateurs',
  VALIDATOR_IS_PARTY: 'D S — un validateur ou administrateur partie au dossier ne peut pas décider',
  ADMIN_ONLY: 'D S — réservé aux administrateurs (litiges, RG-09)',
  // Machine d’états
  TRANSITION_UNKNOWN: 'D S — transition inexistante depuis l’état courant',
  TRANSITION_FORBIDDEN: 'D S — transition interdite pour ce rôle',
  TX_NOT_ACTIVE: 'D S — la transaction n’est pas en cours (IN_PROGRESS)',
  TX_CONTEXT_REQUIRED: 'D — contexte de soumission manquant (erreur de programmation)',
  NOT_IN_REVIEW: 'S — le dossier n’est pas en validation',
  ALREADY_DECIDED: 'S — ce validateur a déjà décidé',
  NOT_EDITABLE: 'S — seul un brouillon (ou un dossier rejeté) se modifie',
  NOT_REJECTED: 'C — seul un dossier rejeté se corrige',
  VERTICAL_UNAVAILABLE: 'S — type de besoin non ouvert (vague 2)',
  // Saisie
  VALIDATION: 'D S C — dossier incomplet ou saisie invalide',
  AMOUNT_INVALID: 'D — montant invalide',
  AMOUNT_DECIMALS: 'D — trop de décimales pour la devise',
  AMOUNT_NOT_CHECKED: 'S — approbation sans la case « montant vérifié » (décision D6, lot 5)',
  BAD_DATE: 'D — date invalide',
  PHONE_INVALID: 'D S — numéro de téléphone invalide',
  SELF_PAYER: 'D S — un prestataire initiateur ne se désigne pas payeur (lot X)',
  REASON_REQUIRED: 'S C — motif obligatoire (rejet, décision de litige)',
  REASON_TOO_SHORT: 'D S — description de litige trop courte (10 caractères)',
  PROFILE_INVALID: 'C — nom ou pays de résidence manquant',
  // Plan de paiement
  PLAN_EMPTY: 'D S — aucune tranche',
  PLAN_SUM_MISMATCH: 'D S — la somme des tranches diffère du total (detail : sum, total, gap)',
  PLAN_BAD_AMOUNT: 'D S — tranche de montant nul ou négatif',
  PLAN_BAD_COUNT: 'D S — nombre d’échéances hors de 2 à 60',
  PLAN_TOO_SMALL: 'D S — montant trop faible pour ce nombre d’échéances',
  // Pièces
  TX_NO_DOCUMENT: 'D S — aucune pièce justificative',
  DOCUMENT_REQUIRED: 'D S C — pièce obligatoire manquante (detail : type de pièce)',
  TOO_MANY_FILES: 'D S — plus de 3 fichiers pour un type de pièce',
  FILE_TOO_LARGE: 'D S — fichier vide ou de plus de 10 Mo',
  FILE_TYPE: 'D S — format autre que JPEG, PNG ou PDF',
  UPLOAD_FAILED: 'C — envoi du fichier interrompu',
  AUDITED_FILE: 'S C — dossier audité : ni suppression ni effacement de fichier',
  HASH_INVALID: 'D S — empreinte de pièce mal formée (SHA-256 hexadécimal attendu ; lot X)',
  HASH_REQUIRED: 'D S — empreinte de pièce obligatoire (réglage require_content_hash ; lot X)',
  HASH_IMMUTABLE: 'S — l’empreinte d’une pièce ne se modifie pas (lot X)',
  DOCUMENT_LOCKED: 'D S — pièce d’un dossier soumis : ni modification ni suppression (lot X)',
  // Jetons et confirmation
  NO_TOKEN: 'C — jeton pas encore émis pour cette tranche',
  EQR_MALFORMED: 'D — QR illisible ou étranger à DiasPay',
  UNKNOWN_REFERENCE: 'D S — référence d’eQR inconnue, ou d’un dossier étranger (même réponse, lot X)',
  TOKEN_REVOKED: 'D S — eQR révoqué (lot X)',
  NOT_REVOCABLE: 'D S — tranche déjà payée : seul un administrateur révoque son jeton (lot X)',
  TOO_MANY_ATTEMPTS: 'D S — plus de 10 résolutions échouées en une heure (lot X)',
  TOKEN_USED: 'D S — eQR déjà utilisé',
  TOKEN_EXPIRED: 'D S — eQR expiré',
  DEVICE_TIME_INVALID: 'D S — heure de l’appareil incohérente',
  NOT_PAID: 'D S — tranche non payée ou déjà traitée',
  NOT_PAYABLE: 'D S — tranche non ouverte au paiement',
  WRONG_MODE: 'D S — la tranche ne se confirme pas par scan',
  WRONG_CONFIRMER: 'D S — ce rôle ne confirme pas cette tranche',
  NO_EVIDENCE_NEEDED: 'D S — la tranche ne requiert pas de preuve',
  EVIDENCE_MISSING: 'D S — aucune pièce probante déposée',
  NO_EVIDENCE_PENDING: 'S — aucune preuve en attente de décision',
  NOT_RELEASED: 'S C — reçu demandé pour une tranche non débloquée',
  // Paiements et journal financier (lot X, X5)
  IDEMPOTENCY_CONFLICT: 'D S — clé d’idempotence déjà utilisée pour un autre paiement ou remboursement',
  PAYMENT_IN_PROGRESS: 'D S — un paiement est déjà en cours pour cette tranche',
  PAYMENT_NOT_FOUND: 'D S — paiement introuvable (tentative, référence du partenaire)',
  NOT_REFUNDABLE: 'D S — aucun paiement réussi à rembourser, ou tranche déjà débloquée',
  REFUND_EXCEEDS_PAID: 'D S — remboursement au-delà du montant payé',
  LEDGER_UNBALANCED: 'D S — journal financier déséquilibré (par devise) ou incomplet',
  QUOTE_UNAVAILABLE: 'D S — aucune cotation pour ces devises (partenaire sans devis, taux simulé absent ; point ouvert 7)',
  QUOTE_INVALID: 'D S — devis inconnu, d’un autre payeur, d’une autre demande ou d’un autre montant',
  QUOTE_USED: 'D S — devis déjà utilisé pour un paiement',
  QUOTE_EXPIRED: 'D S — devis expiré : en demander un nouveau',
  QUOTE_FROZEN: 'S — un devis ne se modifie ni ne se supprime (conservé avec le paiement)',
  REFUND_NOT_PENDING: 'D S — remboursement déjà exécuté ou refusé',
  LEDGER_IMMUTABLE: 'S — journal financier et événements reçus en ajout seul (correction par contrepassation)',
  // Plusieurs payeurs (lot X, X7)
  MULTIPLE_PAYERS_NOT_ALLOWED: 'D S — un seul payeur pour ce type de besoin (request_modules.multiple_payers)',
  // Lot X version 2 : noyau (X2), jeton de présentation (X3)
  REQUEST_ON_HOLD: 'D S — demande suspendue par un litige ouvert avant paiement',
  DISPUTE_OPEN: 'D S — un litige est en cours : la libération des fonds attend son issue',
  ALREADY_CONFIRMED: 'D S — prestation déjà confirmée (CONDITIONAL)',
  NOT_CONFIRMED: 'D S — prestation pas encore confirmée : libération anticipée impossible (CONDITIONAL)',
  NOT_CONFIGURED: 'S — réglage non configuré (point ouvert, docs/open-parameters.md) : refus prudent',
  // Lot X version 2 : enrôlement et plafonds (X4)
  PROFILE_PROTECTED: 'S — rôle de plateforme, statut KYC ou niveau d’enrôlement non modifiables par l’utilisateur',
  ENROLMENT_PENDING: 'D S — un dossier d’enrôlement est déjà en cours',
  ALREADY_ENROLLED: 'D S — niveau d’enrôlement déjà atteint',
  SELF_REVIEW: 'S — le personnel n’examine pas son propre dossier d’enrôlement',
  CASE_CLOSED: 'S — dossier d’enrôlement déjà tranché',
  NOT_CLAIMED: 'S — dossier d’enrôlement non pris en charge par le relecteur',
  ALREADY_CLAIMED: 'S — dossier d’enrôlement pris en charge par un autre relecteur',
  AUDIT_IMMUTABLE: 'S — journal d’enrôlement en ajout seul',
  KYC_PENDING: 'S — résultat de la vérification automatique d’identité attendu',
  LIMITS_NOT_CONFIGURED: 'D S — plafonds du niveau non configurés : paiement refusé par prudence (point ouvert 1)',
  LIMIT_EXCEEDED: 'D S — plafond du niveau dépassé (detail : window OPERATION, DAY ou MONTH, limit, used)',
  // Litiges
  DISPUTE_NOT_ALLOWED: 'D S — litige impossible dans cet état ou après le délai',
  NO_OPEN_DISPUTE: 'D S C — aucun litige en cours',
  INVALID_OUTCOME: 'S — issue de litige inconnue',
  NOT_RESPONDENT: 'S — seule la partie adverse répond à un litige (lot 5)',
  ALREADY_ANSWERED: 'S — le litige a déjà une réponse (lot 5)',
  // Démonstration
  DEMO_DISABLED: 'S — simulation refusée : le serveur n’est pas en mock_mode',
  DEMO_NO_VALIDATOR: 'S — aucun validateur de démonstration (seed non exécuté)',
  // Authentification (décision D5 pour le verrouillage)
  OTP_FORMAT: 'C — le code comporte 6 chiffres',
  OTP_NOT_REQUESTED: 'C — aucun code en cours',
  OTP_WRONG: 'C — code incorrect',
  OTP_EXPIRED: 'C — code expiré (ou erroné, côté Supabase : voir D5)',
  OTP_LOCKED: 'C — trop de tentatives (limite de débit Supabase)',
  OTP_RESEND_TOO_SOON: 'C — nouvelle demande de code trop tôt',
  // Transport
  OFFLINE: 'C — hors connexion : action impossible',
  UNEXPECTED: 'C — erreur sans code (journalisée, message générique)',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}
