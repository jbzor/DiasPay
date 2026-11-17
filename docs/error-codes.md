# Codes d’erreur

Table unique des codes d’erreur stables (lot 4). La source de vérité est `packages/domain/src/errors.ts` ; un test (`packages/domain/test/errors.test.ts`) vérifie que chaque code levé par les fonctions SQL et par le code TypeScript y figure, et que ce document les liste tous.

## Transport

- **Serveur** : `raise exception using errcode = 'P0001', message = <texte>, hint = <CODE>, detail = <précision>` (fonction `_err`, migration 0005). Le client lit **uniquement `hint`** ; le message est destiné aux journaux.
- **Client** : `SupabaseApi` convertit toute erreur PostgREST en `DomainError(code)` à partir de `hint`. Une erreur sans `hint` reconnu devient `UNEXPECTED` : elle est journalisée, et l’utilisateur voit le message générique (`err_generic`), jamais le texte brut.
- **Application** : `errorText(e)` affiche `err_<CODE>` (français et anglais) ; un test vérifie qu’il existe une traduction pour chaque code.
- `detail` porte une précision exploitable : le type de pièce manquant pour `DOCUMENT_REQUIRED`, `{sum,total,gap}` (JSON) pour `PLAN_SUM_MISMATCH`.

Origine : **D** règle du domaine (`@diaspay/domain`, appliquée aussi par le simulateur), **S** fonction SQL, **C** client (application, simulateur, authentification). Une règle marquée D et S est implémentée et testée des deux côtés (`packages/domain/test`, `supabase/tests/01_lot4.sql`).


## Session et accès

| Code | Origine | Signification |
|---|---|---|
| `NOT_AUTHENTICATED` | S, C | Aucune session ou session expirée |
| `NOT_FOUND` | S, C | Élément introuvable (alerte, pièce) |
| `TX_NOT_FOUND` | S, C | Transaction ou brouillon introuvable, ou inaccessible (RLS) |
| `TRANCHE_NOT_FOUND` | S, C | Tranche introuvable, ou inaccessible |
| `NOT_A_PARTY` | D, S | L’utilisateur n’est pas partie au dossier |
| `PROVIDER_ONLY` | D, S | Réservé au prestataire |
| `PAYER_ONLY` | D, S | Réservé au payeur : déblocage anticipé ; lot X : demande reçue (`mark_received`), demande d’informations, rejet |
| `INITIATOR_ONLY` | D, S | Réservé à l’initiateur de la demande : réponse à une demande d’informations, révocation ou réémission du jeton (lot X) |
| `INITIATOR_MISMATCH` | S | Soumission d’un brouillon dont `initiator_id` ne coïncide pas avec le créateur : falsification (aucun flux ne les distingue, 0014) — lot X-C, T3 |
| `ENROLMENT_REQUIRED` | D, S | Niveau d’enrôlement insuffisant : N1 pour initier une demande en demandeur, N2 en prestataire, N1 avant N2 ou N3 (detail : `required`, `current` ; lot X v2, X4). Remplace `INITIATION_NOT_ALLOWED` (`can_initiate_requests`, supprimée par 0020) |
| `VALIDATOR_ONLY` | D, S | Réservé aux validateurs |
| `VALIDATOR_IS_PARTY` | D, S | Un validateur ou administrateur partie au dossier ne peut pas décider |
| `ADMIN_ONLY` | D, S | Réservé aux administrateurs (litiges, RG-09) |

## Machine d’états

| Code | Origine | Signification |
|---|---|---|
| `TRANSITION_UNKNOWN` | D, S | Transition inexistante depuis l’état courant |
| `TRANSITION_FORBIDDEN` | D, S | Transition interdite pour ce rôle |
| `TX_NOT_ACTIVE` | D, S | La transaction n’est pas en cours (IN_PROGRESS) |
| `TX_CONTEXT_REQUIRED` | D | Contexte de soumission manquant (erreur de programmation) |
| `NOT_IN_REVIEW` | S | Le dossier n’est pas en validation |
| `ALREADY_DECIDED` | S | Ce validateur a déjà décidé |
| `NOT_EDITABLE` | S | Seul un brouillon (ou un dossier rejeté) se modifie |
| `NOT_REJECTED` | C | Seul un dossier rejeté se corrige |
| `VERTICAL_UNAVAILABLE` | S | Type de besoin non ouvert (vague 2) |

## Saisie

| Code | Origine | Signification |
|---|---|---|
| `VALIDATION` | D, S, C | Dossier incomplet ou saisie invalide |
| `AMOUNT_INVALID` | D | Montant invalide |
| `AMOUNT_DECIMALS` | D | Trop de décimales pour la devise |
| `AMOUNT_NOT_CHECKED` | S | Approbation sans la case « J’ai vérifié que le montant correspond aux pièces » (D6, lot 5 : `decide_tx`) |
| `BAD_DATE` | D | Date invalide |
| `PHONE_INVALID` | D, S | Numéro de téléphone invalide |
| `SELF_PAYER` | D, S | Un prestataire initiateur ne se désigne pas lui-même payeur (lot X) |
| `REASON_REQUIRED` | S, C | Motif obligatoire (rejet, décision de litige) |
| `REASON_TOO_SHORT` | D, S | Description de litige trop courte (10 caractères) |
| `PROFILE_INVALID` | C | Nom ou pays de résidence manquant |

## Plan de paiement

| Code | Origine | Signification |
|---|---|---|
| `PLAN_EMPTY` | D, S | Aucune tranche |
| `PLAN_SUM_MISMATCH` | D, S | La somme des tranches diffère du total (detail : sum, total, gap) |
| `PLAN_BAD_AMOUNT` | D, S | Tranche de montant nul ou négatif |
| `PLAN_BAD_COUNT` | D, S | Nombre d’échéances hors de 2 à 60 |
| `PLAN_TOO_SMALL` | D, S | Montant trop faible pour ce nombre d’échéances |

## Pièces

| Code | Origine | Signification |
|---|---|---|
| `TX_NO_DOCUMENT` | D, S | Aucune pièce justificative |
| `DOCUMENT_REQUIRED` | D, S, C | Pièce obligatoire manquante (detail : type de pièce) |
| `TOO_MANY_FILES` | D, S | Plus de 3 fichiers pour un type de pièce |
| `FILE_TOO_LARGE` | D, S | Fichier vide ou de plus de 10 Mo |
| `FILE_TYPE` | D, S | Format autre que JPEG, PNG ou PDF |
| `UPLOAD_FAILED` | C | Envoi du fichier interrompu |
| `AUDITED_FILE` | S, C | Dossier audité : ni suppression ni effacement de fichier |
| `HASH_INVALID` | D, S | Empreinte de pièce mal formée : SHA-256 en hexadécimal (64 caractères) attendu (lot X, X4) |
| `HASH_REQUIRED` | D, S | Empreinte de pièce obligatoire quand le réglage `require_content_hash` vaut `true` (lot X, X4) |
| `HASH_IMMUTABLE` | S | L’empreinte d’une pièce ne se modifie pas, ni ne s’ajoute après coup (lot X, X4) |
| `DOCUMENT_LOCKED` | D, S | Pièce d’un dossier soumis : ni modification ni suppression (sauf pièce de réponse pendant `INFO_REQUESTED` ; lot X, X4) |

## Jetons et confirmation

| Code | Origine | Signification |
|---|---|---|
| `NO_TOKEN` | C | Jeton pas encore émis pour cette tranche |
| `EQR_MALFORMED` | D | QR illisible ou étranger à DiasPay |
| `UNKNOWN_REFERENCE` | D, S | Référence d’eQR inconnue, ou d’un dossier dont l’utilisateur n’est pas partie : même réponse, pour ne pas révéler l’existence de la référence (lot X). `resolve_reference_info` renvoie `null` dans ces deux cas, que le client traduit par ce code |
| `TOKEN_REVOKED` | D, S | eQR révoqué par l’initiateur ou un administrateur, ou après rejet de la demande (lot X) |
| `NOT_REVOCABLE` | D, S | Tranche déjà payée : seul un administrateur non partie révoque ou réémet son jeton (lot X) |
| `TOO_MANY_ATTEMPTS` | D, S | Plus de 10 résolutions de référence échouées par l’utilisateur dans l’heure ; événement `SUSPICIOUS_ACTIVITY` dans `security_events` (lot X) |
| `TOKEN_USED` | D, S | EQR déjà utilisé |
| `TOKEN_EXPIRED` | D, S | EQR expiré |
| `DEVICE_TIME_INVALID` | D, S | Heure de l’appareil incohérente |
| `NOT_PAID` | D, S | Tranche non payée ou déjà traitée |
| `NOT_PAYABLE` | D, S | Tranche non ouverte au paiement |
| `WRONG_MODE` | D, S | La tranche ne se confirme pas par scan |
| `WRONG_CONFIRMER` | D, S | Ce rôle ne confirme pas cette tranche |
| `NO_EVIDENCE_NEEDED` | D, S | La tranche ne requiert pas de preuve |
| `EVIDENCE_MISSING` | D, S | Aucune pièce probante déposée |
| `NO_EVIDENCE_PENDING` | S | Aucune preuve en attente de décision |
| `NOT_RELEASED` | S, C | Reçu demandé pour une tranche non débloquée |

## Paiements et journal financier (lot X, X5)

| Code | Origine | Signification |
|---|---|---|
| `IDEMPOTENCY_CONFLICT` | D, S | Clé d’idempotence déjà utilisée pour un autre paiement (autre tranche, autre payeur) ou un autre remboursement (autre montant) |
| `PAYMENT_IN_PROGRESS` | D, S | Un paiement est déjà en cours pour cette tranche (une seule tentative en cours ou réussie par tranche) |
| `PAYMENT_NOT_FOUND` | D, S | Tentative de paiement ou référence du partenaire introuvable |
| `NOT_REFUNDABLE` | D, S | Aucun paiement réussi à rembourser, ou tranche déjà débloquée (fonds versés au prestataire) |
| `REFUND_EXCEEDS_PAID` | D, S | Remboursement au-delà du montant payé (`detail` : `{refunded, paid}`) |
| `LEDGER_UNBALANCED` | D, S | Journal financier déséquilibré pour une devise, ou de moins de deux lignes |
| `QUOTE_UNAVAILABLE` | D, S | Aucune cotation pour ces devises : le partenaire n’en fournit pas encore et aucun taux simulé n’est configuré (point ouvert 7) ; jamais de taux inventé |
| `QUOTE_INVALID` | D, S | Devis inconnu, d’un autre payeur, d’une autre demande, ou montant de la demande changé depuis |
| `QUOTE_USED` | D, S | Devis déjà utilisé pour un paiement (un devis ne sert qu’une fois) |
| `QUOTE_EXPIRED` | D, S | Devis expiré (réglage `fx_quote_ttl_seconds`, point ouvert 8) : en demander un nouveau |
| `REQUEST_EXPIRED` | D, S | Demande échue (`expires_at` passée, durée par module : point ouvert 3) : `get_quote` et `accept_and_pay` la refusent même avant le passage horaire d’`expire_due_requests` ; après ce passage (statut `EXPIRED`), le code reste `NOT_PAYABLE`. Même nom que l’événement de journal — lot X-C, T6 |
| `QUOTE_FROZEN` | S | Un devis ne se modifie ni ne se supprime : il est conservé avec le paiement |
| `REFUND_NOT_PENDING` | D, S | Remboursement déjà exécuté ou refusé (`mark_refund_executed` avec une autre référence) |
| `LEDGER_IMMUTABLE` | S | Journal financier et événements reçus en ajout seul : une correction est une contrepassation |

Les résultats de `apply_payment_event` (`APPLIED`, `IGNORED`, `REJECTED`, `INVALID_SIGNATURE`, `DUPLICATE`) et leurs précisions (`UNKNOWN_ATTEMPT`, `AMOUNT_MISMATCH`, `CONTRADICTS_FINAL_STATE`, `STALE_EVENT`, `ALREADY_APPLIED`, `TRANCHE_NOT_AWAITING`…) ne sont pas des erreurs : la fonction répond toujours, pour que l’événement reçu reste enregistré. Voir `docs/specs/ledger.md`.

## Plusieurs payeurs (lot X, X7)

| Code | Origine | Signification |
|---|---|---|
| `MULTIPLE_PAYERS_NOT_ALLOWED` | D, S | Un second payeur n’est accepté que si le type de besoin l’autorise (`request_modules.multiple_payers`, faux partout) |

## Noyau v2 (lot X version 2)

| Code | Origine | Signification |
|---|---|---|
| `REQUEST_ON_HOLD` | D, S | Demande suspendue par un litige ouvert avant paiement : ni demande d’informations ni paiement |
| `DISPUTE_OPEN` | D, S | Un litige est en cours : confirmation et libération des fonds attendent son issue (CONDITIONAL) |
| `ALREADY_CONFIRMED` | D, S | Prestation déjà confirmée (CONDITIONAL) |
| `NOT_CONFIRMED` | D, S | Prestation pas encore confirmée : libération anticipée impossible (CONDITIONAL) |
| `NOT_CONFIGURED` | S | Réglage non configuré (point ouvert, voir `docs/open-parameters.md`) : la fonction refuse par prudence |

## Types de besoin et données minimales (lot X version 2, X6)

| Code | Origine | Sens |
|---|---|---|
| `BENEFICIARY_NAME_NOT_ALLOWED` | D, S | Nom du bénéficiaire envoyé pour un type de besoin qui ne l’enregistre pas (`beneficiary_mode` REFERENCE_ONLY ou NONE ; santé, K13) |
| `BENEFICIARY_REFERENCE_INVALID` | D, S | Référence du bénéficiaire : code ou initiales, sans espace, 16 caractères au plus (jamais un nom complet) |
| `BENEFICIARY_REFERENCE_REQUIRED` | D, S | Soumission d’un dossier REFERENCE_ONLY sans référence du bénéficiaire |
| `DOCUMENT_KIND_NOT_ALLOWED` | D, S | Type de pièce non prévu par le type de besoin (detail : type de pièce) ; la santé n’accepte plus ni pièce d’identité ni certificat médical |

## Enrôlement et plafonds (lot X version 2, X4)

| Code | Origine | Sens |
|---|---|---|
| `PROFILE_PROTECTED` | S | Rôle de plateforme, statut KYC ou niveau d’enrôlement modifiés par l’utilisateur lui-même (déclencheur `guard_profile`) |
| `ENROLMENT_PENDING` | D, S | Un dossier d’enrôlement est déjà en cours (SUBMITTED ou IN_REVIEW) |
| `ALREADY_ENROLLED` | D, S | Niveau demandé déjà atteint |
| `SELF_REVIEW` | S | Le personnel n’examine pas son propre dossier d’enrôlement |
| `CASE_CLOSED` | S | Dossier d’enrôlement déjà tranché (APPROVED ou REJECTED) |
| `NOT_CLAIMED` | S | Décision sans prise en charge préalable du dossier |
| `ALREADY_CLAIMED` | S | Dossier pris en charge par un autre relecteur |
| `KYC_PENDING` | S | Prise en charge d’un dossier N1 ou N2 avant le résultat de l’adaptateur KYC (seul REVIEW passe au bureau) |
| `AUDIT_IMMUTABLE` | S | Journal d’enrôlement (`enrolment_events`) en ajout seul |
| `LIMITS_NOT_CONFIGURED` | D, S | Aucune ligne de plafonds pour le niveau du payeur et la devise : paiement refusé par prudence (réglage `limits_when_missing`, point ouvert 1) |
| `LIMIT_EXCEEDED` | D, S | Plafond du niveau dépassé (detail : `window` OPERATION, DAY ou MONTH, `limit`, `used`) |

## Litiges

| Code | Origine | Signification |
|---|---|---|
| `DISPUTE_NOT_ALLOWED` | D, S | Litige impossible dans cet état ou après le délai |
| `NO_OPEN_DISPUTE` | D, S, C | Aucun litige en cours |
| `INVALID_OUTCOME` | S | Issue de litige inconnue |
| `NOT_RESPONDENT` | S | Seule la partie adverse (celle qui n’a pas ouvert le litige) répond (lot 5 : `respond_dispute`) |
| `ALREADY_ANSWERED` | S | Le litige a déjà une réponse (lot 5) |

## Démonstration

| Code | Origine | Signification |
|---|---|---|
| `DEMO_DISABLED` | S | Simulation refusée : le serveur n’est pas en mock_mode |
| `DEMO_NO_VALIDATOR` | S | Aucun validateur de démonstration (seed non exécuté) |

## Authentification (décision D5 pour le verrouillage)

| Code | Origine | Signification |
|---|---|---|
| `OTP_FORMAT` | C | Le code comporte 6 chiffres |
| `OTP_NOT_REQUESTED` | C | Aucun code en cours |
| `OTP_WRONG` | C | Code incorrect |
| `OTP_EXPIRED` | C | Code expiré (ou erroné, côté Supabase : voir D5) |
| `OTP_LOCKED` | C | Trop de tentatives (limite de débit Supabase) |
| `OTP_RESEND_TOO_SOON` | C | Nouvelle demande de code trop tôt |

## Transport

| Code | Origine | Signification |
|---|---|---|
| `OFFLINE` | C | Hors connexion : action impossible |
| `UNEXPECTED` | C | Erreur sans code (journalisée, message générique) |

## Codes renommés au lot 4

| Ancien code | Nouveau code |
|---|---|
| `TX_TRANSITION_FORBIDDEN`, `TR_TRANSITION_FORBIDDEN` | `TRANSITION_FORBIDDEN` |
| `TX_TRANSITION_UNKNOWN`, `TR_TRANSITION_UNKNOWN` | `TRANSITION_UNKNOWN` |
| `TR_WRONG_CONFIRMER` | `WRONG_CONFIRMER` |
| `TR_NO_EVIDENCE_NEEDED` | `NO_EVIDENCE_NEEDED` |
| `TR_EVIDENCE_MISSING` | `EVIDENCE_MISSING` |
| `TR_NOT_DISPUTED` | `NO_OPEN_DISPUTE` |
| `NOT_FOUND` (transaction, brouillon, tranche) | `TX_NOT_FOUND`, `TRANCHE_NOT_FOUND` |

Un validateur qui tente une transition réservée reçoit désormais `VALIDATOR_ONLY` (non validateur) ou `VALIDATOR_IS_PARTY` (partie au dossier), comme `transition_tx()`, au lieu de `TRANSITION_FORBIDDEN`. Le règlement d’un litige exige un administrateur (`ADMIN_ONLY`), comme `resolve_dispute()` depuis 0003.

## Codes renommés au lot X version 2

| Ancien code | Nouveau code |
|---|---|
| `INITIATION_NOT_ALLOWED` | `ENROLMENT_REQUIRED` (X4, 0020 : le niveau d’enrôlement remplace `can_initiate_requests` ; l’ancien code reste écrit dans 0008 et 0011, déjà appliquées, mais plus aucune fonction en vigueur ne le lève) |
