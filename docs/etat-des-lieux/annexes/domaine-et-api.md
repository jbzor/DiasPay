# Annexe : packages `domain` et `api-client`

Audit en lecture seule, branche `lotX` (dernier commit b31f68e). Tout ce qui suit a été lu dans le code ; chaque affirmation cite un fichier et un nom exporté. Les tests n'ont pas été lancés et aucune connexion à Supabase n'a été faite.

## 1. Volumétrie

| Package | Source (hors tests et hors fichiers générés) | Tests | Généré |
|---|---|---|---|
| `packages/domain` | 2 507 lignes, 23 fichiers dans `src/` (dont `index.ts`) | 1 463 lignes, 12 fichiers | — |
| `packages/api-client` | 2 898 lignes (`src/` sans `database.types.ts`) | 1 852 lignes (dont `test/contract/`) | `src/supabase/database.types.ts` : 3 321 lignes |

## 2. `packages/domain`

### 2.1 Fichiers et exports publics

Le point d'entrée `src/index.ts` réexporte tous les modules (`export *`) : types, rules, money, plan, operationMachine, paymentRequestMachine, conditionalRelease, disputes, eqr, phone, documents, need, audit, errors, review, requests, notificationTemplates, links, trustvault, payments, modules, enrolment.

| Fichier | Exports principaux |
|---|---|
| `types.ts` | `TX_STATUSES`, `TxStatus`, `OperationStatus`, `PAYMENT_REQUEST_STATUSES`, `PaymentRequestStatus`, `TrancheStatus` (alias), `TRANCHE_STATUSES` (alias), `SettlementMode`, `FundsState`, `TxRole`, `Vertical`, `ReleaseMode`, `Currency`, `RecurrenceFreq`, `Money`, `Actor`, `TrancheDraft`, `DomainError` |
| `operationMachine.ts` | `OperationActor`, `OPERATION_TRANSITIONS`, `SubmitContext`, `canTransitionOperation`, `transitionOperation`, `submissionTarget` |
| `paymentRequestMachine.ts` | `RequestActor`, `PAYMENT_REQUEST_TRANSITIONS`, `RequestContext`, `canTransitionPaymentRequest`, `transitionPaymentRequest`, `isRequestFinal`, `shouldCloseOperation` |
| `conditionalRelease.ts` | `ConditionalState`, `paymentOutcome`, `confirmService`, `checkSubmitEvidence`, `checkApproveRelease`, `isAutoReleasable` |
| `disputes.ts` | `DISPUTE_STATUSES`, `DISPUTE_OUTCOMES`, `disputeOpening`, `canOpenDispute`, `resolveDisputeDecision` |
| `rules.ts` | `VERTICALS`, `WAVE1_VERTICALS`, `ReleaseRule`, `RELEASE_RULES`, `DUAL_THRESHOLDS`, `requiredValidations`, `evidenceOutcome` |
| `documents.ts` | `DocumentKind`, `REQUIRED_DOCUMENTS`, `ALLOWED_MIME_TYPES`, `MAX_FILE_BYTES`, `MAX_FILES_PER_KIND`, `checkFileCount`, `resolveMimeType`, `checkFile`, `missingRequiredDocuments` |
| `modules.ts` | `MODULE_CODE_RE`, `PLATFORM_REVIEWS`, `DOCUMENT_SENSITIVITIES`, `BENEFICIARY_MODES`, `BENEFICIARY_REFERENCE_RE`, `RequestModule`, `DOCUMENT_LABELS`, `DEFAULT_MODULES`, `checkBeneficiary`, `isAllowedKind`, `isSensitiveKind`, `findModule`, `sortModules`, `moduleLabel`, `missingModuleDocuments`, `maxFilesFor`, `requiredValidationsFor`, `platformReviewDecision`, `checkAddPayer`, `checkModule` |
| `enrolment.ts` | `ENROLMENT_LEVELS`, `ENROLMENT_REQUIREMENTS`, `ENROLMENT_DOCUMENT_KINDS`, `levelRank`, `requiredLevelToInitiate`, `checkInitiation`, `enrolmentRoute`, `checkEnrolmentSubmission`, `checkLimits`, `DEV_ENROLMENT_LIMITS`, `KycPort`, `SimulatedKycAdapter`, `applyKycResult` |
| `payments.ts` | `PAYMENT_METHODS`, `ATTEMPT_STATUSES`, `REFUND_STATUSES`, `LIVE_ATTEMPT`, `PaymentPort`, `SimulatedPaymentAdapter`, `SIMULATED_SIGNATURE_HEADER`, `LEDGER_ACCOUNTS`, `journalBalanced`, `convertMinor`, `computeFees`, `FxQuote`, `Contribution`, `PaymentAttempt`, `Refund`, `RECONCILIATION_ISSUES`, `reconcile`, `PaymentEngine` |
| `eqr.ts` | `EQR_PREFIX`, `REFERENCE_LENGTH`, `normalizeReference`, `encodeEqr`, `decodeEqr`, `formatReference` |
| `requests.ts` | `MESSAGE_MIN`, `MESSAGE_MAX`, `messageError`, `requestInfoDecision`, `answerInfoDecision`, `rejectRequestDecision`, `REVOCABLE_BY_INITIATOR`, `tokenRevocationError`, `REFERENCE_FAILURE_LIMIT`, `REFERENCE_FAILURE_WINDOW_MS`, `recentFailures`, `tooManyAttempts` |
| `need.ts` | `PLAN_TYPES`, `CURRENCIES`, `NEED_STEPS`, bornes (`PURPOSE_MIN/MAX`, `INSTALLMENTS_MIN/MAX`, `RECURRING_MIN/MAX`, `ACTIVATION_WINDOW_DAYS`), `CREATOR_ROLES`, `validateStep`, `validateNeed`, `build*Plan`, `shouldActivateTranche`, `describeRelease`, `emptyDraft`, etc. |
| `notificationTemplates.ts` | `EXTERNAL_CHANNELS`, `EXTERNAL_EVENTS`, `externalNotificationTemplates`, `externalEventFor`, `externalNotification` |
| `errors.ts` | `ERROR_CODES`, `ErrorCode`, `isErrorCode` |
| `audit.ts` | `GENESIS_HASH`, `computeEntryHash`, `appendEntry`, `verifyChain`, `shortHash` |
| `trustvault.ts` | `HASH_ALGO`, `normalizeContentHash`, `isContentHash`, `checkContentHash`, `documentLockError`, `otherDossiersWithHash`, `sha256Hex` |
| `review.ts` | `MIN_DECISION_TEXT`, `validatorDecisionError`, `evidenceDecisionError`, `disputeDecisionError`, `assertNoError` |
| `money.ts`, `plan.ts`, `phone.ts`, `links.ts` | `toMinor`, `formatMoney`, `parseAmountInput`… ; `validatePlan`, `addMonths`, `generateRecurringTranches` ; `normalizePhone`… ; `parseInternalLink`, `internalPath` |

### 2.2 Énumérations de statuts (`types.ts`)

- **Opération** (`TX_STATUSES`) : `DRAFT`, `PENDING_REVIEW`, `IN_REVIEW`, `ACTIVE`, `SUSPENDED`, `CLOSED`, `CANCELLED`.
- **Demande de paiement** (`PAYMENT_REQUEST_STATUSES`, alias `TRANCHE_STATUSES`) : `DRAFT`, `SUBMITTED`, `INFO_REQUESTED`, `ACCEPTED`, `PAID`, `REJECTED`, `CANCELLED`, `EXPIRED`, `REFUNDED`.
- `SettlementMode` = `DIRECT` | `CONDITIONAL` ; `FundsState` = `NONE` | `HELD` | `RELEASED` | `RETURNED`.
- `ReleaseMode` = `PROVIDER_CONFIRM` | `PAYER_CONFIRM` | `EVIDENCE_REVIEW` | `AUTO` ; `Currency` = `EUR` | `USD` | `XAF` ; `Vertical` = `EDUCATION` | `HEALTH` | `RENT` | `AGRO` | `REAL_ESTATE` | `LAND`.
- **Tentative de paiement** (`payments.ts`, `ATTEMPT_STATUSES`) : `INITIATED`, `PENDING`, `CONFIRMED`, `FAILED`. **Remboursement** (`REFUND_STATUSES`) : `REQUESTED`, `EXECUTED`, `FAILED`. **Contribution** : `PENDING`, `CONFIRMED`, `FAILED`, `REFUNDED`.
- **Litige** (`disputes.ts`) : statuts `OPEN`, `AWAITING_RESPONSE`, `IN_MEDIATION`, `RESOLVED` ; issues `NO_ACTION`, `REFUND_FULL`, `REFUND_PARTIAL`, `FUNDS_RELEASED`, `FUNDS_RETURNED`.

### 2.3 Machine d'états de l'opération (`operationMachine.ts`, `OPERATION_TRANSITIONS`)

Le rôle d'un acteur se calcule dans `whoOf` : `SYSTEM` pour un acteur `SYSTEM` ; `INITIATOR` si `isCreator` ; `STAFF` si `isValidator` **et** `roles.length === 0` (personnel non partie au dossier).

| De | Vers | Rôles autorisés | Commentaire du code |
|---|---|---|---|
| DRAFT | ACTIVE | INITIATOR | soumission, platform_review NEVER (ou sans risque) : AUTO_ACTIVATED |
| DRAFT | PENDING_REVIEW | INITIATOR | soumission, revue par le bureau |
| PENDING_REVIEW | IN_REVIEW | STAFF | prise en charge |
| PENDING_REVIEW | ACTIVE | STAFF | |
| IN_REVIEW | ACTIVE | STAFF | |
| PENDING_REVIEW | CANCELLED | STAFF | |
| IN_REVIEW | CANCELLED | STAFF | |
| ACTIVE | SUSPENDED | SYSTEM, STAFF | litige avant paiement, ou fraude |
| SUSPENDED | ACTIVE | SYSTEM, STAFF | litige résolu, ou levée par le personnel |
| ACTIVE | CLOSED | SYSTEM | |
| DRAFT | CANCELLED | INITIATOR | |
| ACTIVE | CANCELLED | INITIATOR | |

Gardes de `transitionOperation`, dans l'ordre :
1. Transition absente de la table : `TRANSITION_UNKNOWN`.
2. Transition réservée au personnel (STAFF sans INITIATOR) demandée par un acteur `USER` : `VALIDATOR_ONLY` s'il n'est pas validateur, `VALIDATOR_IS_PARTY` s'il a un rôle dans le dossier.
3. Rôle non autorisé : `TRANSITION_FORBIDDEN`.
4. Soumission (DRAFT vers ACTIVE ou PENDING_REVIEW) : le contexte est obligatoire (`TX_CONTEXT_REQUIRED`), puis `validatePlan` (`PLAN_EMPTY`, `PLAN_BAD_AMOUNT`, `PLAN_SUM_MISMATCH`), puis au moins une pièce (`TX_NO_DOCUMENT`).

`submissionTarget({review})` renvoie `PENDING_REVIEW` si une revue est nécessaire, sinon `ACTIVE`. La décision de revue vient de `platformReviewDecision` (`modules.ts`).

La table est identique à `allowed_transitions` insérée par `supabase/migrations/0014_lotx2_core.sql`. Côté SQL, STAFF correspond à `SYSTEM` avec `validator_only=true`.

### 2.4 Machine d'états de la demande de paiement (`paymentRequestMachine.ts`, `PAYMENT_REQUEST_TRANSITIONS`)

Le rôle d'un acteur se calcule dans `whoOf` : `SYSTEM` ; `INITIATOR` si `isCreator` ; `PAYER` si `roles` contient `PAYER`.

| De | Vers | Rôles autorisés |
|---|---|---|
| DRAFT | SUBMITTED | INITIATOR, SYSTEM |
| SUBMITTED | INFO_REQUESTED | PAYER |
| INFO_REQUESTED | SUBMITTED | INITIATOR |
| SUBMITTED | ACCEPTED | PAYER |
| ACCEPTED | PAID | SYSTEM |
| ACCEPTED | SUBMITTED | SYSTEM (toutes les tentatives ont échoué) |
| SUBMITTED | REJECTED | PAYER |
| INFO_REQUESTED | REJECTED | PAYER |
| DRAFT | CANCELLED | INITIATOR |
| SUBMITTED | CANCELLED | INITIATOR |
| INFO_REQUESTED | CANCELLED | INITIATOR |
| SUBMITTED | EXPIRED | SYSTEM |
| INFO_REQUESTED | EXPIRED | SYSTEM |
| PAID | REFUNDED | SYSTEM |

Gardes de `transitionPaymentRequest`, dans l'ordre :
1. Transition absente : `TRANSITION_UNKNOWN`.
2. INFO_REQUESTED vers SUBMITTED par un `USER` qui n'est pas l'initiateur : `INITIATOR_ONLY`.
3. Rôle non autorisé : `TRANSITION_FORBIDDEN`.
4. SUBMITTED vers INFO_REQUESTED par un payeur qui est aussi l'initiateur : `TRANSITION_FORBIDDEN`.
5. `ctx.onHold` (litige ouvert avant paiement) avec une cible INFO_REQUESTED ou ACCEPTED : `REQUEST_ON_HOLD`.

Une demande est finale (`isRequestFinal`) si son statut est REFUNDED, REJECTED, CANCELLED ou EXPIRED, ou si elle est PAID avec `fundsState` différent de `HELD`. `shouldCloseOperation` renvoie vrai quand il y a au moins une demande et qu'elles sont toutes finales. La table est identique à `tranche_transitions` de 0014.

Les décisions du payeur ont aussi des miroirs dédiés dans `requests.ts` : `requestInfoDecision`, `answerInfoDecision` et `rejectRequestDecision` (messages de 3 à 2 000 caractères, `REASON_REQUIRED` ou `VALIDATION`).

### 2.5 Libération conditionnelle et litiges

- `conditionalRelease.ts` : `paymentOutcome(mode)` renvoie PAID avec des fonds `HELD` en CONDITIONAL et `NONE` en DIRECT. `checkHeld` exige le mode CONDITIONAL (`WRONG_MODE`), une demande PAID avec des fonds HELD (`NOT_PAID`) et aucun litige ouvert (`DISPUTE_OPEN`). `confirmService` lève `WRONG_MODE`, `WRONG_CONFIRMER` ou `ALREADY_CONFIRMED`. `isAutoReleasable` ne libère jamais en mode EVIDENCE_REVIEW ni pendant un litige.
- `disputes.ts` : seuls le payeur et le prestataire ouvrent un litige (`NOT_A_PARTY`). Il est « avant paiement » pour SUBMITTED, INFO_REQUESTED et ACCEPTED, « après » pour PAID et REFUNDED ; tout autre statut lève `DISPUTE_NOT_ALLOWED`. `resolveDisputeDecision` exige un administrateur (`ADMIN_ONLY`) non partie au dossier (`VALIDATOR_IS_PARTY`) et refuse un remboursement supérieur au montant payé (`REFUND_EXCEEDS_PAID`).

### 2.6 Constantes de règles

| Constante | Valeur | Source |
|---|---|---|
| `RELEASE_RULES` | EDUCATION : PROVIDER_CONFIRM, 72 h ; HEALTH : PROVIDER_CONFIRM, 48 h ; RENT : PROVIDER_CONFIRM, 72 h ; AGRO : PAYER_CONFIRM, 72 h ; REAL_ESTATE et LAND : EVIDENCE_REVIEW, 0 h, double validation | `rules.ts` |
| `DUAL_THRESHOLDS` (unités mineures) | EUR 500 000 ; USD 550 000 ; XAF 3 000 000 | `rules.ts` |
| `WAVE1_VERTICALS` | EDUCATION, HEALTH, RENT | `rules.ts` |
| `MAX_FILES_PER_KIND` | 3 (décision D2) | `documents.ts` |
| `MAX_FILE_BYTES` | 10 Mo | `documents.ts` |
| `ALLOWED_MIME_TYPES` | image/jpeg, image/png, application/pdf | `documents.ts` |
| `REQUIRED_DOCUMENTS` | HEALTH : QUOTE obligatoire ; EDUCATION : ENROLMENT_CERTIFICATE obligatoire, SCHOOL_SCHEDULE facultatif ; RENT : LEASE obligatoire, LAST_RECEIPT facultatif ; AGRO, REAL_ESTATE, LAND : SUPPORTING_DOCUMENT (« À CONFIRMER ») | `documents.ts` |
| `MESSAGE_MIN` / `MESSAGE_MAX` | 3 / 2 000 | `requests.ts` |
| `REFERENCE_FAILURE_LIMIT` / `REFERENCE_FAILURE_WINDOW_MS` | 10 échecs par heure | `requests.ts` |
| `REVOCABLE_BY_INITIATOR` | DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED | `requests.ts` |
| `PURPOSE_MIN/MAX`, `INSTALLMENTS_MIN/MAX`, `RECURRING_MIN/MAX`, `ACTIVATION_WINDOW_DAYS` | 3/500, 2/12, 2/60, 7 jours | `need.ts` |
| `generateRecurringTranches` | 2 à 60 échéances (`PLAN_BAD_COUNT`) | `plan.ts` |
| `MIN_DECISION_TEXT` | 3 | `review.ts` |
| `TOKEN_VALIDITY_HOURS`, `MAX_DEVICE_SKEW_MS` | 168 h, 5 min (simulateur) | `api-client/src/mockApi.ts` |
| `BENEFICIARY_REFERENCE_RE` | `^[A-Z0-9][A-Z0-9./-]{0,15}$` | `modules.ts` |

### 2.7 `DEFAULT_MODULES` (`modules.ts`)

`DEFAULT_MODULES` est calculé à partir de `VERTICALS`, `RELEASE_RULES` et `REQUIRED_DOCUMENTS`. Pour chaque module : `platformReview: 'NEVER'`, `multiplePayers: false`, `maxFiles = 3` par pièce, `requestExpiryDays` et `retentionDays` absents.

| Code | Activé, vague | settlementMode | releaseMode / délai | Pièces (obligatoire ?) | Sensibilité | beneficiaryMode |
|---|---|---|---|---|---|---|
| EDUCATION | oui, 1 | DIRECT | PROVIDER_CONFIRM / 72 h | ENROLMENT_CERTIFICATE (oui), SCHOOL_SCHEDULE (non) | STANDARD | NAME |
| HEALTH | oui, 1 | DIRECT | PROVIDER_CONFIRM / 48 h | QUOTE (oui) | **SENSITIVE** | **REFERENCE_ONLY** |
| RENT | oui, 1 | DIRECT | PROVIDER_CONFIRM / 72 h | LEASE (oui), LAST_RECEIPT (non) | STANDARD | NAME |
| AGRO | non, 2 | CONDITIONAL | PAYER_CONFIRM / 72 h | SUPPORTING_DOCUMENT (oui) | STANDARD | NAME |
| REAL_ESTATE | non, 2 | CONDITIONAL | EVIDENCE_REVIEW / 0 h, double validation | SUPPORTING_DOCUMENT (oui) | STANDARD | NAME |
| LAND | non, 2 | CONDITIONAL | EVIDENCE_REVIEW / 0 h, double validation | SUPPORTING_DOCUMENT (oui) | STANDARD | NAME |

Fonctions de contrôle associées :
- `checkBeneficiary` : en NAME, garde le nom ; en REFERENCE_ONLY, refuse un nom (`BENEFICIARY_NAME_NOT_ALLOWED`) et vérifie la référence (`BENEFICIARY_REFERENCE_INVALID`) ; en NONE, refuse un nom et ignore la référence.
- `isAllowedKind` : EVIDENCE est toujours accepté ; un module sans liste de pièces accepte tout type.
- `platformReviewDecision` : motifs ALWAYS, DUAL_VALIDATION, THRESHOLD_NOT_CONFIGURED, AMOUNT_THRESHOLD, FIRST_REQUEST et DUPLICATE.

`packages/domain/test/lotx_p2.test.ts` compare `DEFAULT_MODULES` à l'amorçage SQL.

### 2.8 Paiements (`payments.ts`)

- **`PaymentPort`** déclare `provider`, `createPayment`, `getPaymentStatus`, `refund`, `getQuote` (renvoie `ProviderQuote | null`), `verifyWebhook` et `parseWebhook`. Seule implémentation : `SimulatedPaymentAdapter`, qui signe ses événements en HMAC-SHA256 (en-tête `x-diaspay-simulated-signature`) et dont `getQuote` renvoie `null`. Aucun adaptateur TrustPayWay n'existe.
- **`convertMinor(amountMinor, from, to, rates)`** : conversion exacte en `bigint`, arrondie au supérieur. Il cherche d'abord le taux inverse `to/from`, puis le taux direct `from/to`. Il renvoie `null` si aucun taux n'existe, et taux `'1'` pour une même devise. Décimales : EUR et USD 2, XAF 0.
- **`computeFees(debitMinor, schedule, method, crossCurrency)`** : trois postes en points de base, arrondis au supérieur (`serviceMinor`, `fxMinor` seulement en cas de change, `methodMinor`). Sans barème, aucun frais.
- **`PaymentEngine`** :
  - `createQuote` lève `NOT_CONFIGURED` sans durée de vie et `QUOTE_UNAVAILABLE` sans taux ; un devis sans taux partenaire est marqué `simulated`.
  - `startPayment` exige une clé d'idempotence de 8 à 200 caractères. Il lève `IDEMPOTENCY_CONFLICT`, `PAYMENT_IN_PROGRESS`, `NOT_PAYABLE` si la demande n'est pas SUBMITTED, puis `QUOTE_INVALID`, `QUOTE_USED` ou `QUOTE_EXPIRED`. Il crée une contribution PENDING et une tentative INITIATED.
  - `applyEvent` déduplique les événements, n'applique jamais un événement mal signé et rejette un changement de statut final (`CONTRADICTS_FINAL_STATE`). Il passe en `onPaid` quand la somme des contributions confirmées atteint la cible.
  - Autres méthodes : `requestRefund`, `markRefundExecuted`, `release`, `balances`, `reconciliation`.
  - Le journal tient en double entrée sur quatre comptes : `PARTNER_CASH`, `DUE_TO_PROVIDER`, `REFUNDS_PAYABLE`, `FEES`.

### 2.9 Enrôlement (`enrolment.ts`)

- Niveaux `N0` à `N3`. `requiredLevelToInitiate` : PROVIDER N2, REQUESTER N1, PAYER N0. `checkInitiation` lève `ENROLMENT_REQUIRED`.
- `ENROLMENT_REQUIREMENTS` : N1 = ID_DOCUMENT + SELFIE ; N2 = BUSINESS_REGISTRATION + ACTIVITY_PROOF ; N3 = LEGAL_DOCUMENTS + REPRESENTATIVE_MANDATE.
- `enrolmentRoute` : N3 passe en revue `MANUAL`, les autres niveaux en `KYC`.
- `checkEnrolmentSubmission`, dans l'ordre : niveau valide, `ALREADY_ENROLLED`, N1 requis avant N2 ou N3, `ENROLMENT_PENDING`, 1 à 10 pièces, chemins sous `<userId>/`, `HASH_INVALID`, `DOCUMENT_REQUIRED`.
- `checkLimits` : sans ligne de plafond, `LIMITS_NOT_CONFIGURED`, sauf `whenMissing: 'ALLOW'` ; sinon `LIMIT_EXCEEDED` par opération, par jour ou par mois. `DEV_ENROLMENT_LIMITS` contient tous les niveaux et devises sans plafond (`devOnly`).
- `KycPort` (`provider`, `check`) a une seule implémentation, `SimulatedKycAdapter`. `applyKycResult` ne modifie jamais un dossier déjà tranché.

### 2.10 eQR et jeton de présentation

- `eqr.ts` : le format est `DPQ1:<référence 18 hex>:<kid>:<signature>`. `encodeEqr` et `decodeEqr` lèvent `EQR_MALFORMED`. `formatReference` affiche la référence par groupes de 4 caractères en majuscules.
- **Jeton de présentation (X3, migration 0016)** : il n'existe **aucun utilitaire** dans `domain` ni dans `api-client`. La recherche de `presentation` / `PresentationToken` ne trouve que `database.types.ts` (table `presentation_tokens`, fonctions `issue_presentation_token`, `claim_presentation_token`, `revoke_presentation_tokens`) et les fichiers SQL `0016_lotx2_x3.sql`, `tests/05_lotx2_p1*.sql`.

### 2.11 `externalNotificationTemplates` (`notificationTemplates.ts`)

Le module existe. Il couvre 3 canaux (SMS, EMAIL, WHATSAPP), 3 événements (`PAYMENT_REQUEST_RECEIVED`, `REQUEST_UPDATED`, `PAYMENT_UPDATED`) et 2 langues. Les textes sont fixes et n'interpolent aucune donnée. E-mail et WhatsApp ajoutent un rappel anti-hameçonnage.

Le test d'architecture se trouve dans **`packages/domain/test/lotx.test.ts`**, bloc « X1.4 : gabarits des notifications externes (test d'architecture) ». Il vérifie l'absence de :
- `https?:`, `www.` et `://` ;
- tout motif de domaine ;
- référence à 18 caractères hexadécimaux ;
- **tout chiffre**, donc aucun montant ;
- `{}<>$%`, donc aucun paramètre.

Il vérifie aussi que le fichier source ne contient aucune URL. L'absence de **nom** n'est pas testée explicitement : elle découle seulement de l'absence d'interpolation.

Écart : le commentaire du module renvoie à `packages/domain/test/notificationTemplates.test.ts`, **fichier inexistant**.

### 2.12 Restes de l'ancien modèle

- `txMachine` et `trancheMachine` (ainsi que `TX_TRANSITIONS`, `canTransitionTx`) **n'existent plus** : aucune occurrence dans `packages/` ni `apps/`, hors `dist`. Ils ont été retirés par le commit de85dfc (X2). `docs/decisions.md` (ligne 59, D4) cite encore `packages/domain/src/txMachine.ts`.
- **Restes encore exportés** :

| Symbole | Fichier | Importateurs hors domaine |
|---|---|---|
| `RELEASE_RULES` | `rules.ts` | `packages/api-client/src/mockApi.ts` (`mkTranche`, jeu de démonstration) ; à l'intérieur du domaine, `modules.ts` (`DEFAULT_MODULES`) |
| `REQUIRED_DOCUMENTS`, `missingRequiredDocuments` | `documents.ts` | aucun hors tests (`lot3b.test.ts`, `need.test.ts`) ; à l'intérieur du domaine, `modules.ts` |
| `requiredValidations`, `evidenceOutcome` | `rules.ts` | aucun hors tests (`domain.test.ts`) ; le simulateur utilise `requiredValidationsFor` (modules.ts) |
| `DUAL_THRESHOLDS`, `VERTICALS`, `WAVE1_VERTICALS` | `rules.ts` | à l'intérieur du domaine (`modules.ts`) ; `apps/web/src/features/dossiers/DossiersScreen.tsx` et `apps/mobile/src/i18n/index.ts` déclarent **leur propre** constante `VERTICALS` locale |
| `TrancheStatus`, `TRANCHE_STATUSES` (alias v2) | `types.ts` | `apps/mobile/src/i18n/index.ts`, `api-client/src/types.ts`, `mockApi.ts`, `supabase/convert.ts` |
| `describeRelease` | `need.ts` | `apps/mobile/src/app/need/recap.tsx` |

Le libellé de `ERROR_CODES.TX_NOT_ACTIVE` mentionne encore « (IN_PROGRESS) », un statut v1. Les énumérations SQL `tx_status`, `tranche_status`, `payment_status` et `release_mode` de `database.types.ts` gardent les valeurs v1 (`AWAITING_PAYMENT`, `PAID_LOCKED`, `DISPUTED`, `SUCCEEDED`, `IMMEDIATE`…), et la table `_release_rules_0003` y figure toujours.

## 3. `packages/api-client`

### 3.1 Interfaces

**`TransactionApi`** (`src/types.ts`, 42 méthodes) :

- Lecture et paiement : `listTransactions()`, `getTransaction(id)`, `payTranche(trancheId, idempotencyKey?)`, `getQuote(trancheId, debitCurrency?, method?) → PaymentQuote`, `acceptAndPay(trancheId, quoteId, idempotencyKey?)`, `getTranche`, `getToken`, `resolveReference`, `confirmByReference(reference, deviceTime?)`, `approveRelease`, `confirmService`, `openDispute(trancheId, reason, description?)`, `timeline(txId)`.
- Brouillons : `searchProviders(query, vertical)`, `listDrafts`, `getDraft`, `saveDraft`, `deleteDraft`, `attachDocument(draftId, file, onProgress?)`, `removeDocument`, `submitNeed`.
- Alertes, litiges, reçus : `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getDispute`, `getReceipt`, `cancelOperation(txId, reason?)`.
- Jetons : `revokeToken(trancheId, reason)`, `reissueToken(trancheId, reason?)`, `eqrImageEnabled()`.
- Décisions du payeur : `markReceived`, `requestInfo(trancheId, message)`, `answerInfo`, `rejectRequest(trancheId, reason)`, `acceptPlan(txId)`, `listMessages`.
- Divers : `createDraft({vertical, creatorRole})`, `getDocumentAccess(documentId)`, `documentReuse(contentHash, txId?)`, `listModules()`, `getEnrolment() → EnrolmentView`, `submitEnrolment({level, documents, data?}) → EnrolmentCaseView`.

**`AuthApi`** (`src/auth.ts`) : `requestOtp(phone)`, `verifyOtp(phone, code)`, `saveProfile`, `setBiometric`, `getSession`, `signOut`, `setPreferences`.

**Ports** : `PaymentPort` et `KycPort` sont dans `@diaspay/domain` (§2.8 et §2.9), pas dans `api-client`.

### 3.2 MockApi contre SupabaseApi

Les 42 méthodes de `TransactionApi` sont présentes **des deux côtés** (`class MockApi implements TransactionApi` dans `mockApi.ts`, `class SupabaseApi implements TransactionApi` dans `supabase/api.ts`). C'est le cas notamment de `getDocumentAccess`, `markReceived`, `acceptPlan`, `requestInfo`, `answerInfo`, `rejectRequest`, `getQuote`, `acceptAndPay`, `getEnrolment` et `submitEnrolment`.

- **`issuePresentationToken` est absent des deux côtés et de l'interface.**
- Méthodes propres au Mock : `flushState`, `hydrate`, `paymentLedger`, `resetDemoData`, `runTimers`, `setPersona`, `setUser`, `simulateDisputeResolution`, `simulateReview`, `tamperAuditForTest`.
- Méthodes propres à Supabase : `documentUrl`, `resetDemoData`, `serverMockMode`, `simulateDisputeResolution`, `simulateReview`, `subscribeChanges`.
- Aucune méthode ne lève « not implemented ». Les seuls `throw new Error` sont dans `supabase/client.ts` : refus des clés `sb_secret_` et `service_role`, et URL ou clé publique manquante.
- Toutes les fonctions SQL appelées par `SupabaseApi` (35 `rpc(...)`, dont `my_enrolment` pour `getEnrolment`) existent dans `database.types.ts`.

Écarts de comportement notables :
- `MockApi.payTranche` passe par `getQuote` puis `acceptAndPay`, alors que `SupabaseApi.payTranche` appelle `start_payment`.
- Les deux appellent `settleDemo`, donc `demo_settle_payment`, qui répond DEMO_DISABLED hors mock_mode (voir §4).

### 3.3 `SupabaseAuth` et la décision D5

`supabase/auth.ts` (`SupabaseAuth`) **ne verrouille pas** un numéro après 3 codes erronés : il ne tient aucun compteur d'essais, conformément à D5 (`docs/decisions.md`).

Les erreurs sont traduites par `toAuthError` (`supabase/errors.ts`) :
- `otp_expired` ou `invalid_credentials` donnent `OTP_WRONG` avant l'expiration locale et `OTP_EXPIRED` après ;
- `over_sms_send_rate_limit` donne `OTP_RESEND_TOO_SOON` ;
- `over_request_rate_limit` ou HTTP 429 donnent `OTP_LOCKED`, sans heure de déblocage ;
- `validation_failed` ou `phone_provider_disabled` donnent `PHONE_INVALID` ;
- `session_not_found`, `refresh_token_not_found` ou `bad_jwt` donnent `NOT_AUTHENTICATED` ;
- une erreur réseau donne `OFFLINE`, tout le reste `UNEXPECTED` (journalisé).

Ces conversions sont testées dans `test/supabaseConvert.test.ts`.

Écart avec le simulateur : **`MockAuth` verrouille**, lui (`OTP_MAX_ATTEMPTS = 3`, `OTP_LOCK_MS = 15 min`, testé dans `auth.test.ts`). Le comportement de démonstration diffère donc de celui en production.

Les erreurs de l'API passent par `toDomainError` : le code est lu dans `hint` s'il est connu ; le code SQL 42501 donne `NOT_FOUND` ; une erreur réseau donne `OFFLINE` ; le reste donne `UNEXPECTED`.

### 3.4 Codes d'erreur : source et documentation

`ERROR_CODES` (`domain/src/errors.ts`) contient 113 codes, tous présents comme lignes de tableau dans `docs/error-codes.md`. Aucun code levé par `DomainError(...)` dans `domain/src` ou `api-client/src` ne manque à la table.

Les lignes de `docs/error-codes.md` absentes de la source sont uniquement des **codes retirés**, listés dans les tableaux « Codes renommés » : `TX_TRANSITION_FORBIDDEN`, `TX_TRANSITION_UNKNOWN`, `TR_*` (5 codes), `INITIATION_NOT_ALLOWED`. `NOT_FOUND` apparaît deux fois (une fois comme code actuel, une fois comme ancien code). Les codes de résultat d'événement (`STALE_EVENT`, `ALREADY_APPLIED`, `UNKNOWN_ATTEMPT`…) sont cités dans le texte mais ne sont pas des codes d'erreur.

**Conclusion : pas d'écart réel.** Le test `domain/test/errors.test.ts` vérifie cette cohérence.

### 3.5 Suite de contrat (`test/contract/contract.ts`)

Elle est exécutée contre le simulateur (`mock.contract.test.ts`) et contre Supabase (`supabase.contract.test.ts`), mais seulement si `SUPABASE_TEST_URL` et `SUPABASE_TEST_ANON_KEY` sont définis : sinon le test est marqué `it.skip`.

Écarts assumés, déclarés dans le harnais :
- `refundSettlement` : `IMMEDIATE` pour le Mock, `AWAITING_PARTNER_EVENT` pour Supabase ;
- `partyIsolation` : faux pour le Mock, vrai pour Supabase.

Scénarios couverts :
1. Recherche de prestataires sans accents ni casse.
2. Brouillon partiel : enregistré, relu, supprimé.
3. Isolation des brouillons entre utilisateurs.
4. Soumission santé (K13) : référence et pièces, puis activation directe.
5. `PLAN_SUM_MISMATCH` avec l'écart.
6. Annulation par l'initiateur : CANCELLED, ou CLOSED après un paiement.
7. Alertes marquées lues.
8. X1 : règlement direct, aucun jeton.
9. X2 : informations demandées, réponse, rejet, clôture.
10. X3 : prestataire N2 accepté, refusé sans le niveau.
11. X4 : empreinte, réutilisation, consultation journalisée.
12. X5 : paiement idempotent par le chemin des événements.
13. X6 : modules lus, vague 2 refusée.
14. Références et tranches inconnues : codes stables.
15. Parcours direct complet : reçu, informations, plan accepté, paiement, reçu.
16. Litige avant paiement : demande suspendue, opération SUSPENDED, levée.
17. Litige après paiement : remboursement complet.
18. Enrôlement N1 par KYC simulé, pièces hors dossier refusées.
19. Devis EUR figé, devis inconnu refusé, paiement avec le devis, rejeu de la clé.

**Non couverts** : jeton de présentation, CONDITIONAL (confirmation, libération), `markRefundExecuted`, plafonds (`LIMIT_EXCEEDED`), revue N3. `AuthApi` n'a pas de suite de contrat.

### 3.6 Cohérence de `database.types.ts`

Le fichier est généré (`pnpm db:types`) ; sa mise en forme compacte est celle du générateur. Contrôles ponctuels :
- **Présents** : table `fx_quotes` ; fonctions `accept_and_pay`, `get_quote`, `mark_refund_executed`, `submit_enrolment`, `apply_kyc_result`, `mark_received`, `accept_plan`, `my_enrolment` ; tables `contributions`, `enrolment_cases`, `enrolment_limits`, `presentation_tokens` ; colonnes `request_modules.beneficiary_mode` et `retention_days`, `transactions.beneficiary_reference`, `profiles.enrolment_level` (typée `string`).
- **Absent** : `can_initiate_requests`, conforme à sa suppression par 0020.
- Fonction `get_enrolment` : absente, mais le code appelle `my_enrolment`, qui existe.
- `convert.ts` (`toModule`, `toTransaction`) lit bien `beneficiary_mode`, `retention_days`, `sensitivity` et `beneficiary_reference`.

## 4. Risques relevés, avec preuves

1. **Paiement hors mode démonstration** : `SupabaseApi.payTranche` et `acceptAndPay` appellent `settleDemo`, donc `demo_settle_payment`, dès que la tentative est INITIATED ou PENDING. D'après le commentaire de `supabase/api.ts`, cette fonction répond `DEMO_DISABLED` hors mock_mode. Résultat : sans partenaire branché, l'appel échoue après la création de la tentative.
2. **Jeton de présentation (X3)** : il existe en SQL mais n'est exposé ni dans `TransactionApi` ni dans le domaine. Il est donc inutilisable depuis les applications et n'est pas couvert par la suite de contrat.
3. **D5** : `MockAuth` verrouille après 3 codes erronés, `SupabaseAuth` non. Une démonstration montrera un comportement absent en production. De plus, l'expiration locale du code (`expiries`) est gardée en mémoire : après un redémarrage de l'application, un code expiré est signalé `OTP_WRONG`.
4. **Le simulateur s'appuie encore sur `RELEASE_RULES`** (`mockApi.ts`, `mkTranche`) au lieu des modules pour le jeu de démonstration.
5. **Documentation périmée** :
   - `docs/decisions.md` cite `txMachine.ts`, qui n'existe plus ;
   - `notificationTemplates.ts` renvoie à un test inexistant ;
   - `TX_NOT_ACTIVE` mentionne IN_PROGRESS ;
   - `describeRelease` annonce `VERTICAL_REQUIRED` mais lève `VALIDATION` (`need.ts`) ;
   - le harnais de contrat parle d'un remboursement « PENDING », alors que le statut v2 est REQUESTED.
6. **Énumérations SQL v1 encore présentes** dans `database.types.ts` (`tranche_status` contient PAID_LOCKED, DISPUTED… ; `payment_status` contient SUCCEEDED). Le typage TypeScript accepte donc des valeurs que le domaine v2 rejette. `convert.ts` les filtre avec `oneOf` contre `TRANCHE_STATUSES` et `TX_STATUSES`.
