# Annexe — Migrations 0014 à 0023 (lot X version 2)

Source : `supabase/migrations/`. Tout ce qui suit a été lu dans les fichiers SQL ; chaque affirmation cite le fichier et l’objet.
Les erreurs métier passent par `_err(code, message, detail)` (0005_lot4.sql), qui lève `P0001` avec **hint = code** : les « codes » ci-dessous sont ces hints.
Aucune valeur sensible n’est reproduite.

## Vue d’ensemble

| N° | Fichier | Octets | Ajout (commit) | Résumé |
|---|---|---|---|---|
| 0014 | 0014_lotx2_core.sql | 103 295 | 2026-11-12 de85dfc | Refonte du noyau v2 : nouveaux statuts d’opération et de demande, `settlement_mode` DIRECT/CONDITIONAL, `funds_state`, litige distinct, `platform_review` NEVER par défaut, vue `payment_requests`, tâche d’expiration. |
| 0015 | 0015_lotx2_x1.sql | 1 692 | 2026-11-12 888fcb4 | Image du QR désactivée par défaut et résolution d’une référence de jeton restreinte (payeur, initiateur, prestataire en CONDITIONAL seulement). |
| 0016 | 0016_lotx2_x3.sql | 9 123 | 2026-11-12 680471e | `accept_plan` (acceptation de l’échéancier) et jeton de présentation (`presentation_tokens`, empreinte SHA-256, usage unique). |
| 0017 | 0017_lotx2_fixes.sql | 3 607 | 2026-11-12 de85dfc | Correctif des alertes : plus de `TRANCHE_RELEASED` en double quand un litige libère les fonds. |
| 0018 | 0018_lotx2_fixes2.sql | 5 646 | 2026-11-12 de85dfc | `REQUEST_ON_HOLD` renvoyé avant `TX_NOT_ACTIVE` ; `reissue_token` refusé en DIRECT. |
| 0019 | 0019_lotx2_fixes3.sql | 4 334 | 2026-11-12 de85dfc | Litige tranché par `REFUND_FULL` sur des fonds bloqués : fonds passés à RETURNED. |
| 0020 | 0020_lotx2_x4.sql | 39 767 | 2026-11-12 ed0e2b0 | Enrôlement N0 à N3 (dossiers, pièces, journal immuable, KYC simulé ou réel, bucket `identity`), plafonds par niveau, initiation conditionnée au niveau. |
| 0021 | 0021_lotx2_x5.sql | 52 038 | 2026-11-12 309fdec | Paiements v2 : statuts de tentative et de remboursement, `contributions`, `fx_quotes` (devis), `accept_and_pay`, `start_payment` devenu raccourci, `mark_refund_executed`, frais au journal. |
| 0022 | 0022_lotx2_x6.sql | 22 293 | 2026-11-13 b31f68e | Types de besoin configurables : `beneficiary_mode`, `retention_days`, sensibilité des pièces, Santé réduite au devis, `beneficiary_reference`, journalisation sans chemin des pièces sensibles. |
| 0023 | 0023_lotx2_fixes4.sql | 3 228 | 2026-11-13 b31f68e | Correctif de 0022 : le type de pièce `EVIDENCE` reste accepté quel que soit le module. |

Rappel : 0013_lotx2_enums.sql (2 038 octets) ajoute les valeurs d’enum utilisées par 0014. PostgreSQL interdit d’utiliser dans la même transaction une valeur ajoutée à un enum, d’où ce fichier séparé.

---

## 0013 (contexte) — valeurs d’enum

- `tx_status` reçoit PENDING_REVIEW, ACTIVE et SUSPENDED.
- `tranche_status` reçoit DRAFT, SUBMITTED, ACCEPTED, PAID et REFUNDED.
- `tx_role` reçoit INITIATOR. Ce rôle sert uniquement dans les tables de transitions.
- Nouveau type `settlement_mode` (DIRECT, CONDITIONAL).
- Les anciennes valeurs ne peuvent pas être retirées d’un enum. Elles restent donc dans les types et sont refusées par des contraintes CHECK posées en 0014.

---

## 0014 — 0014_lotx2_core.sql (noyau v2)

### Tables et colonnes

**`request_modules`**
- Ajouts :
  - `settlement_mode settlement_mode NOT NULL DEFAULT 'DIRECT'` ;
  - `request_expiry_days int CHECK (1..365)`, sans valeur. Le point ouvert 3 n’est pas tranché : absence de valeur = pas d’expiration.
- `platform_review` : défaut passé à `'NEVER'`, et `UPDATE … SET platform_review='NEVER'` sur toutes les lignes.
- `settlement_mode` : EDUCATION, HEALTH et RENT passent en DIRECT ; AGRO, REAL_ESTATE et LAND en CONDITIONAL.
- `release_mode='IMMEDIATE'` est converti en DIRECT + PROVIDER_CONFIRM, et la contrainte `request_modules_no_immediate` l’interdit désormais.

**`transactions`**
- Ajouts : `settlement_mode` (défaut DIRECT), `initiator_id` (FK profiles, rempli à partir de `created_by`), `accepted_at`, `accepted_by` (FK profiles).
- Contrainte `transactions_status_v2` : `status IN (DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED)`.

**`tranches`** (= demandes de paiement)
- Ajouts :
  - `target_amount_minor`, générée à partir de `amount_minor` ;
  - `scheduled_for`, générée à partir de `due_date` ;
  - `currency` ;
  - `expires_at` ;
  - `on_hold bool` (défaut false) ;
  - `refunded_minor` (≥ 0) ;
  - `funds_state text` (défaut 'NONE') ;
  - `paid_at`, `confirmed_at`, `evidence_submitted_at`.
- Le statut prend le défaut `'DRAFT'`.
- CHECK :
  - `tranches_funds_state` : NONE, HELD, RELEASED, RETURNED ;
  - `tranches_status_v2` : DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED ;
  - `tranches_no_immediate`.

**`transaction_parties`**
- CHECK `transaction_parties_no_initiator_role` (`role <> 'INITIATOR'`).

**`disputes`**
- Ajouts : `outcome`, `before_payment` (défaut false), `refund_amount_minor`, `refund_id` (FK refunds).
- CHECK sur le statut : OPEN, AWAITING_RESPONSE, IN_MEDIATION, RESOLVED.
- CHECK `disputes_outcome_check` :
  - `outcome` est renseigné si et seulement si le statut vaut RESOLVED ;
  - valeurs possibles : NO_ACTION, REFUND_FULL, REFUND_PARTIAL, FUNDS_RELEASED, FUNDS_RETURNED.
- Index unique `one_open_dispute_per_tranche` (`tranche_id`) où `status <> 'RESOLVED'`.

**Nouvelle table `dispute_messages`**
- Colonnes : `id`, `dispute_id` (FK, cascade), `tx_id` (FK), `author_id`, `kind`, `body`, `created_at`.
- `kind` ∈ STATEMENT, RESPONSE, STAFF_REQUEST, STAFF_NOTE, DECISION ; `body` de 3 à 4000 caractères.
- Accès :
  - RLS `dispute_messages_read` : `is_party(tx_id) or is_validator()` ;
  - `SELECT` seul pour authenticated, rien pour anon.
- Ajout seul : le déclencheur `dispute_messages_immutable` bloque `UPDATE` et `DELETE`. Exception : `DELETE` pendant une remise à zéro de démonstration, en mock_mode.
- Ajoutée à la publication `supabase_realtime`.

### Conversion des données de développement (bloc `DO`)

**Demandes**

| Ancien statut | Nouveau statut |
|---|---|
| PLANNED | DRAFT |
| AWAITING_PAYMENT | SUBMITTED |
| PAID_LOCKED, EVIDENCE_SUBMITTED, CONFIRMED, RELEASED, DISPUTED | PAID |

Le `funds_state` vaut HELD ou RELEASED en CONDITIONAL.

**Opérations**

| Ancien statut | Nouveau statut |
|---|---|
| SUBMITTED | PENDING_REVIEW |
| VALIDATED, TOKEN_ISSUED, IN_PROGRESS, DISPUTED, PAID_LOCKED, SERVICE_CONFIRMED, RELEASED, AWAITING_PAYMENT | ACTIVE |
| REJECTED, EXPIRED | CANCELLED |

**Litiges**

| Ancien statut | Statut | Issue |
|---|---|---|
| RELEASED_TO_PROVIDER | RESOLVED | FUNDS_RELEASED |
| REFUNDED_TO_PAYER | RESOLVED | REFUND_FULL |

### Machines d’états (données)

`allowed_transitions` et `tranche_transitions` sont vidées puis rechargées.

**Opération**
- Initiateur :
  - DRAFT → ACTIVE ou PENDING_REVIEW ;
  - DRAFT → CANCELLED ;
  - ACTIVE → CANCELLED.
- Système, validateur seulement (`validator_only`) :
  - PENDING_REVIEW → IN_REVIEW, ACTIVE ou CANCELLED ;
  - IN_REVIEW → ACTIVE ou CANCELLED ;
  - ACTIVE → SUSPENDED (fraude) ;
  - SUSPENDED → ACTIVE (levée).
- Système, non réservé : ACTIVE ↔ SUSPENDED (litige avant paiement) et ACTIVE → CLOSED.

**Demande**

| Transition | Rôle |
|---|---|
| DRAFT → SUBMITTED | INITIATOR ou SYSTEM |
| SUBMITTED → INFO_REQUESTED, ACCEPTED ou REJECTED | PAYER |
| INFO_REQUESTED → REJECTED | PAYER |
| INFO_REQUESTED → SUBMITTED | INITIATOR |
| ACCEPTED → PAID | SYSTEM |
| ACCEPTED → SUBMITTED | SYSTEM |
| DRAFT, SUBMITTED ou INFO_REQUESTED → CANCELLED | INITIATOR |
| SUBMITTED ou INFO_REQUESTED → EXPIRED | SYSTEM |
| PAID → REFUNDED | SYSTEM |

### Vues

- **`payment_requests`**
  - Options : `security_invoker`, lecture seule.
  - Définition : `SELECT` sur `tranches`, avec `tx_id` renommé `operation_id`, plus `target_amount_minor`, `currency`, `status`, `scheduled_for`, `expires_at`, `on_hold`, `refunded_minor`, `funds_state`, `paid_at`.
  - Droits : `REVOKE` anon et public ; `GRANT SELECT` à authenticated.
  - **Dette de nommage** : la table s’appelle toujours `tranches`, et les fonctions, enums et tables liées (`tranche_status`, `tranche_tokens`, `tranche_transitions`) gardent ce vocabulaire. Seule cette vue applique le vocabulaire cible (commentaire de 0014 : « la table garde son nom, toutes les fonctions la lisent »). De même, une « opération » reste la table `transactions`.
- **`v_reconciliation`** : recréée avec les statuts v2 (`WHERE is_validator()`), redéfinie ensuite en 0021.
- **`bo_dossiers`, `bo_evidence_queue`, `bo_disputes`** : recréées.
  - `bo_dossiers` filtre sur `PENDING_REVIEW` et `IN_REVIEW`.
  - `bo_evidence_queue` filtre sur `PAID` + `HELD` + preuve déposée.
  - `bo_disputes` ajoute `outcome`, `before_payment`, `on_hold`, `settlement_mode`, `funds_state`, `refunded_minor` (`WHERE is_admin()`).
  - Droits : authenticated en `SELECT`, rien pour anon.

### Fonctions

Toutes les fonctions ci-dessous sont `SECURITY DEFINER`, avec `search_path = public`, sauf mention contraire.

**Internes** (`REVOKE` à public, anon et authenticated)

- `_transactions_defaults()`, `_tranches_defaults()` : fonctions de déclencheur.
- `_is_initiator(uuid)` : `GRANT` à authenticated, car elle est évaluée dans les politiques.
- `_request_final(tranches)` : SQL `immutable`, sans `SECURITY DEFINER`.
- Changements d’état :
  - `_set_tx_status(uuid, tx_status, uuid, text, jsonb)` ;
  - `_close_operation_if_done(uuid, uuid)` ;
  - `_set_tranche_status(uuid, tranche_status, uuid, text, jsonb)` ;
  - `_set_funds_state(uuid, text, uuid, text, jsonb)`.
- Soumission et activation : `_submit_request(uuid, uuid)`, `_activate_operation(uuid, uuid, text, jsonb)`.
- `_platform_review(uuid)` :
  - motifs : ALWAYS, DUAL_VALIDATION ;
  - en RISK_BASED : THRESHOLD_NOT_CONFIGURED, AMOUNT_THRESHOLD, FIRST_REQUEST, DUPLICATE ;
  - le seuil est lu dans `app_config.risk_review_threshold`, que les migrations ne posent pas.
- `_request_tranche(uuid)`, `_check_token_manager(uuid)`.
- Libération conditionnelle : `_conditional_tranche(uuid)`, `_confirm_service(tranches, uuid, text, jsonb)`.
- Paiements et litiges : `_create_refund(…)`, `_resolve_dispute_v2(…)`, `_process_payment_event(bigint)`.
- Déclencheurs : `_dispute_messages_immutable()`, `_draft_settlement()`, `_documents_immutable()`, `_notify_from_audit()`.
- Tâches planifiées : `release_due_tranches()`, `activate_due_tranches()`, `expire_due_requests()`.
- `_round_start(uuid)`, `_evidence_round_start(uuid)` : `GRANT` à authenticated.

**Publiques** (`REVOKE` public et anon ; `GRANT EXECUTE` à authenticated)

- Opération :
  - `submit_operation(uuid)` ;
  - `transition_tx(uuid, tx_status, text)` ;
  - `claim_dossier(uuid)` ;
  - `decide_tx(uuid, boolean, boolean, text)`.
- Demande :
  - `transition_tranche(uuid, tranche_status, text)` ;
  - `request_info(uuid, text)`, `answer_info(uuid, text)`, `reject_request(uuid, text)` ;
  - `reissue_token(uuid, text)`.
- Libération conditionnelle :
  - `confirm_service(uuid)`, `submit_evidence(uuid)`, `approve_release(uuid)` ;
  - `decide_tranche(uuid, boolean, text)` ;
  - `confirm_by_reference(text, timestamptz)`.
- Paiement :
  - `start_payment(uuid, text, text)` ;
  - `request_refund(uuid, bigint, text, text)` ;
  - `simulate_tranche_system(uuid, tranche_status)`.
- Litiges :
  - `open_dispute(uuid, text, text)`, `respond_dispute(uuid, text)` ;
  - `request_dispute_response(uuid, text)`, `add_dispute_message(uuid, text)` ;
  - `resolve_dispute(uuid, text, text, bigint)`. L’ancienne signature `(uuid, text, text)` est supprimée.
- Suspension : `lift_suspension(uuid, text)`, `suspend_operation(uuid, text)`.
- Consultation : `get_dispute(uuid)`, `get_receipt(uuid)`.

**Démonstration**
- `demo_resolve_dispute(uuid, text, text)` et `demo_review(uuid, boolean, text)`.
- Elles ne sont créées que si `_mock_mode()` est vrai au moment de la migration (`EXECUTE` dynamique).
- `GRANT` à authenticated.

### Déclencheurs

| Déclencheur | Table | Événement |
|---|---|---|
| `transactions_defaults` | transactions | `BEFORE INSERT` (`initiator_id`) |
| `tranches_defaults` | tranches | `BEFORE INSERT OR UPDATE OF tx_id, amount_minor` (devise de l’opération) |
| `dispute_messages_immutable` | dispute_messages | `BEFORE UPDATE OR DELETE` |
| `transactions_draft_settlement` | transactions | `BEFORE INSERT OR UPDATE OF vertical` (mode du module copié tant que le statut vaut DRAFT) |

### Politiques RLS

- `ttokens_read` (`tranche_tokens`) : le jeton n’est lisible que par le payeur, s’il n’est pas révoqué et si la demande n’est pas en DRAFT.
- `dispute_messages_read`.
- `docs_insert_evidence` (`documents`) : le prestataire peut insérer une pièce pour une demande `PAID` + `HELD`.

### pg_cron

`select cron.schedule('diaspay-expire-due-requests', '15 * * * *', 'select public.expire_due_requests()')`

### Codes d’erreur (hints)

- **Accès et droits** : TX_NOT_FOUND, TRANCHE_NOT_FOUND, INITIATOR_ONLY, PAYER_ONLY, PROVIDER_ONLY, VALIDATOR_ONLY, VALIDATOR_IS_PARTY, ADMIN_ONLY, NOT_A_PARTY.
- **Transitions et états** : TRANSITION_UNKNOWN, TRANSITION_FORBIDDEN, VERTICAL_UNAVAILABLE, TX_NOT_ACTIVE, NOT_IN_REVIEW, REQUEST_ON_HOLD, NOT_PAYABLE.
- **Contrôles de saisie** : VALIDATION, REASON_REQUIRED, REASON_TOO_SHORT, AMOUNT_NOT_CHECKED, ALREADY_DECIDED.
- **Dossier et pièces** : PLAN_EMPTY, PLAN_SUM_MISMATCH, TX_NO_DOCUMENT, DOCUMENT_REQUIRED, HASH_IMMUTABLE, DOCUMENT_LOCKED.
- **Jetons** : NOT_REVOCABLE, NO_TOKEN, UNKNOWN_REFERENCE, TOKEN_REVOKED, TOKEN_USED, DEVICE_TIME_INVALID, TOKEN_EXPIRED.
- **Libération conditionnelle** : WRONG_MODE, NOT_PAID, ALREADY_CONFIRMED, WRONG_CONFIRMER, NO_EVIDENCE_NEEDED, EVIDENCE_MISSING, NOT_CONFIRMED, NO_EVIDENCE_PENDING, NOT_RELEASED.
- **Paiements et remboursements** : IDEMPOTENCY_CONFLICT, PAYMENT_IN_PROGRESS, NOT_REFUNDABLE, AMOUNT_INVALID, REFUND_EXCEEDS_PAID.
- **Litiges** : DISPUTE_OPEN, DISPUTE_NOT_ALLOWED, NO_OPEN_DISPUTE, NOT_RESPONDENT, ALREADY_ANSWERED, INVALID_OUTCOME.
- **Démonstration** : DEMO_DISABLED, DEMO_NO_VALIDATOR.

Résultats de `webhook_events` (ce ne sont pas des hints) : UNKNOWN_ATTEMPT, STALE_EVENT, ALREADY_APPLIED, CONTRADICTS_FINAL_STATE, AMOUNT_MISMATCH, TRANCHE_NOT_AWAITING, UNKNOWN_REFUND, UNKNOWN_TYPE.

### Comportements clés

- **Paiement réussi** (`_process_payment_event`) :
  - en DIRECT, la demande passe à PAID et un `release_events` est inséré avec le déclencheur `DIRECT_PAYMENT` ;
  - en CONDITIONAL, la demande passe à PAID avec `funds_state` à HELD.
- **Litige avant paiement** : la demande est mise en `on_hold` et l’opération passe en SUSPENDED.
- **Litige après paiement** : le statut de la demande ne change pas.

---

## 0015 — 0015_lotx2_x1.sql

- **app_config** : `eqr_image_enabled` vaut désormais `'false'`. La valeur est mise à jour, et insérée si elle est absente.
- **`_party_token(text)`**
  - Fonction SQL `STABLE SECURITY DEFINER`.
  - Résout une référence pour le payeur, pour l’initiateur, et pour le prestataire seulement si l’opération est en CONDITIONAL.
  - `REVOKE` à public, anon et authenticated.

---

## 0016 — 0016_lotx2_x3.sql

### `accept_plan(p_operation uuid)`

- `SECURITY DEFINER`.
- Contrôles :
  - l’appelant doit être payeur, sinon `PAYER_ONLY` ;
  - l’opération doit être ACTIVE ou SUSPENDED, sinon `TX_NOT_ACTIVE`.
- Fonction idempotente : elle pose `accepted_at` et `accepted_by`, puis écrit l’événement d’audit `PLAN_ACCEPTED` (alerte aux autres parties).
- **N’autorise aucun paiement.** Ni `start_payment` ni `accept_and_pay` ne lisent `accepted_at`.

### Table `presentation_tokens`

- Colonnes : `id`, `tranche_id` (FK, cascade), `token_hash`, `expires_at`, `claimed_at`, `claimed_by`, `revoked_at`, `created_by`, `created_at`.
- `token_hash` : unique, CHECK `^[0-9a-f]{64}$`.
- CHECK : `(claimed_at is null) = (claimed_by is null)`.
- Accès :
  - RLS `presentation_tokens_staff_read` (`is_validator()`) ;
  - authenticated en `SELECT` seul, rien pour anon.

### app_config

- `presentation_token_ttl_seconds = '90'`, inséré **seulement si `_mock_mode()`**.
- En dehors de ce cas, la clé est absente et `issue_presentation_token` renvoie `NOT_CONFIGURED`.

### Fonctions

**`_token_hash(text)`**
- SHA-256 de la référence normalisée, via `extensions.digest`.
- `REVOKE` à tous.

**`issue_presentation_token(uuid)`**
- Réservée à l’initiateur, pour une demande `SUBMITTED`.
- Révoque les jetons précédents (rotation).
- Renvoie la référence en clair une seule fois. Seule l’empreinte est stockée.

**`revoke_presentation_tokens(uuid)`**

**`claim_presentation_token(text)`**
- Jeton à usage unique.
- Lie l’appelant comme PAYER s’il n’y a pas de payeur, ou si le payeur n’était connu que par téléphone (`user_id` nul).
- Renvoie `null` si la référence est inconnue, si l’appelant est l’initiateur, ou si un autre payeur est déjà lié. L’échec est compté par `_reference_failed`.
- Codes : `TOKEN_REVOKED`, `TOKEN_USED`, `TOKEN_EXPIRED`, `NOT_PAYABLE`.

**Droits** : `accept_plan`, `issue_presentation_token`, `revoke_presentation_tokens` et `claim_presentation_token` sont accordées à authenticated, rien pour anon.

---

## 0017 — 0017_lotx2_fixes.sql

- `_notify_from_audit()` est redéfinie (définition finale).
- Changement : `FUNDS_RELEASED` dont le `trigger` vaut `DISPUTE_RESOLUTION` ne produit plus `TRANCHE_RELEASED`.
- `REVOKE` à tous.

---

## 0018 — 0018_lotx2_fixes2.sql

- **`_request_tranche(uuid)`** : contrôle `on_hold` (`REQUEST_ON_HOLD`) avant `TX_NOT_ACTIVE`. `REVOKE` à tous.
- **`start_payment(uuid, text, text)`** : même inversion. Version intermédiaire, remplacée en 0021.
- **`reissue_token(uuid, text)`** (définition finale) : renvoie `NO_TOKEN` si l’opération n’est pas en CONDITIONAL.
- `GRANT` à authenticated pour `start_payment` et `reissue_token`.

---

## 0019 — 0019_lotx2_fixes3.sql

- `_resolve_dispute_v2(uuid, text, text, uuid, bigint)` : un `REFUND_FULL` sur des fonds HELD fait passer `funds_state` à RETURNED, via l’issue interne `FUNDS_RETURNED_BY_REFUND`, enregistrée ensuite comme `REFUND_FULL`.
- Redéfinie de nouveau en 0021 avec les statuts v2 des tentatives et des remboursements.
- `REVOKE` à tous.

---

## 0020 — 0020_lotx2_x4.sql (enrôlement, K3)

### Colonnes de `profiles`

**`enrolment_level`**
- `text NOT NULL DEFAULT 'N0'`, CHECK N0, N1, N2 ou N3.
- Conversion, en mock_mode seulement :
  - `can_initiate_requests` donne N2 ;
  - un demandeur donne N1.
- La colonne **`can_initiate_requests` est ensuite supprimée** (`DROP COLUMN`).

**Protection du niveau**
- `guard_profile()` est redéfinie. Pour anon et authenticated, `platform_role`, `kyc_status` et `enrolment_level` sont protégés (hint `PROFILE_PROTECTED`).
- Nouveau déclencheur `profile_insert_level_trg` (`BEFORE INSERT`, fonction `_profile_insert_level`) : il force N0 pour anon et authenticated.

### Tables

**`enrolment_cases`**
- Colonnes :
  - `profile_id` (FK, cascade) ;
  - `requested_level` (N1, N2 ou N3) ;
  - `status` (SUBMITTED, IN_REVIEW, APPROVED ou REJECTED ; défaut SUBMITTED) ;
  - `route` (KYC ou MANUAL) ;
  - `kyc_provider`, `kyc_reference`, `kyc_result` (APPROVED, REJECTED ou REVIEW) ;
  - `data jsonb` (objet) ;
  - `reviewer_id`, `rejection_reason`, `submitted_at`, `reviewed_at`.
- CHECK : un dossier REJECTED exige un motif d’au moins 3 caractères.
- Index unique `enrolment_cases_one_open` : un seul dossier ouvert par profil.

**`enrolment_documents`**
- `kind` ∈ ID_DOCUMENT, SELFIE, BUSINESS_REGISTRATION, ACTIVITY_PROOF, LEGAL_DOCUMENTS, REPRESENTATIVE_MANDATE.
- `storage_path` : unique.
- `content_hash` : 64 caractères hexadécimaux.

**`enrolment_events`**
- Colonnes : `id` (identity), `profile_id`, `case_id`, `actor_id`, `event`, `payload`, `created_at`.
- `event` ∈ CASE_SUBMITTED, KYC_RESULT, CASE_CLAIMED, CASE_APPROVED, CASE_REJECTED, DOCUMENT_VIEWED, LEVEL_CHANGED.
- Journal immuable :
  - déclencheur `enrolment_events_immutable` (hint `AUDIT_IMMUTABLE`) ;
  - suppression autorisée seulement en cascade, quand le profil est supprimé.

**Droits sur ces trois tables**
- RLS `*_read` : `profile_id = auth.uid() or is_validator()`.
- authenticated en `SELECT` seul, rien pour anon.

**`enrolment_limits`**
- Colonnes : `level`, `currency`, `per_operation_minor`, `per_day_minor`, `per_month_minor` (chacune > 0 ou NULL), `dev_only`, `updated_at`, `updated_by`.
- Clé primaire : (`level`, `currency`).
- RLS :
  - `enrolment_limits_read` : lecture pour tous les authentifiés ;
  - `enrolment_limits_admin_write` : écriture si `is_admin()`.
- Rien pour anon.

### Contenu initial de `enrolment_limits`

- **Vide hors mock_mode.**
- En mock_mode : 12 lignes (N0 à N3 × XAF, EUR, USD) avec **tous les plafonds NULL** et `dev_only = true`.

### Bucket `identity`

- Paramètres : privé, `file_size_limit` 10 485 760 octets (10 Mo), types MIME JPEG, PNG, HEIC et PDF.
- `ON CONFLICT` ne remet à jour que `public = false` : la limite de taille et les types MIME ne sont pas réappliqués si le bucket existait déjà.
- Politiques sur `storage.objects` :
  - `identity_insert` : authenticated, dans le dossier `<uid>/` ;
  - `identity_read` : lecture si `_identity_recently_opened(name)`, c’est-à-dire après un événement `DOCUMENT_VIEWED` de l’appelant de moins de 2 minutes.
- Aucune politique de mise à jour ni de suppression.

### app_config

- `kyc_simulated_result = 'APPROVED'` : mock_mode seulement.
- `limits_when_missing` : lue (défaut REFUSE), jamais insérée.

### Fonctions

**Internes** (`REVOKE` à tous)
- `_level_rank`, `_required_level`, `_enrolment_required_kinds` : SQL `immutable`.
- `_require_enrolment(profiles, text)` : code `ENROLMENT_REQUIRED`.
- `_identity_recently_opened(text)` : `GRANT` à authenticated pour la politique de stockage.
- `_check_payer_limits(uuid, currency, bigint)` : voir J1.
- `_enrolment_json`.
- `_approve_enrolment`, `_reject_enrolment`, `_apply_kyc` (code `INVALID_OUTCOME`).
- `_check_initiator_level(uuid)`.

**`apply_kyc_result(uuid, text, text, text, text)`**
- `REVOKE` à public, anon et authenticated ; **`GRANT` à service_role seulement**.

**Publiques** (`GRANT` à authenticated)

- **`submit_enrolment(text, jsonb, jsonb)`**
  - Codes : `VALIDATION`, `ALREADY_ENROLLED`, `ENROLMENT_REQUIRED` (N1 exigé avant N2 ou N3), `ENROLMENT_PENDING`, `HASH_INVALID`, `DOCUMENT_REQUIRED`.
  - Pièces exigées par niveau :
    - N1 : ID_DOCUMENT et SELFIE ;
    - N2 : BUSINESS_REGISTRATION et ACTIVITY_PROOF ;
    - N3 : LEGAL_DOCUMENTS et REPRESENTATIVE_MANDATE.
  - Route : N3 passe en revue manuelle (MANUAL), les autres niveaux en KYC.
  - En mock_mode, le résultat simulé est appliqué immédiatement.
- **`my_enrolment()`**.
- **`claim_enrolment_case(uuid)`** : codes `SELF_REVIEW`, `CASE_CLOSED`, `KYC_PENDING`, `ALREADY_CLAIMED`.
- **`decide_enrolment(uuid, boolean, text)`** : code `NOT_CLAIMED`, en plus des précédents.
- **`get_enrolment_document_access(uuid)`** : journalise `DOCUMENT_VIEWED` avant de rendre l’accès.
- **`save_draft(jsonb)`** :
  - N1 exigé pour initier en demandeur, N2 en prestataire (`ENROLMENT_REQUIRED`) ;
  - redéfinie de nouveau en 0022.
- **`submit_operation(uuid)`** : appelle `_check_initiator_level` ; redéfinie de nouveau en 0022.

---

## 0021 — 0021_lotx2_x5.sql (paiements, devises, remboursements)

### Statuts

**`payment_attempts.status`**
- CHECK : INITIATED, PENDING, CONFIRMED, FAILED. Défaut : INITIATED.
- L’ancienne valeur SUCCEEDED est convertie en CONFIRMED.
- Index unique `payment_attempts_one_live` (`tranche_id`) pour les statuts INITIATED, PENDING et CONFIRMED.

**`refunds.status`**
- CHECK : REQUESTED, EXECUTED, FAILED. Défaut : REQUESTED.
- Conversions : PENDING devient REQUESTED, SUCCEEDED devient EXECUTED.
- Nouvelle colonne `executed_by`.

**Table `payments`** : elle garde l’enum `payment_status` avec la valeur SUCCEEDED. Dette de nommage par rapport à CONFIRMED.

### Table `fx_quotes`

- Colonnes :
  - `tx_id`, `tranche_id`, `payer_id` ;
  - `request_currency`, `request_amount_minor` (> 0) ;
  - `debit_currency`, `rate` (> 0), `source`, `simulated` ;
  - `method` ∈ SIMULATED, MOBILE_MONEY, CARD, BANK_TRANSFER ;
  - `debit_amount_minor` ;
  - frais par poste : `fee_service_minor`, `fee_fx_minor`, `fee_method_minor` ;
  - `total_debit_minor` ;
  - `quoted_at`, `expires_at`, `used_at`, `attempt_id`.
- CHECK :
  - `total_debit_minor` = montant débité + somme des frais ;
  - `expires_at > quoted_at`.
- Accès :
  - RLS `fx_quotes_read` : `payer_id = auth.uid() or is_validator()` ;
  - `SELECT` seul.
- Devis figé : le déclencheur `fx_quotes_frozen` (hint `QUOTE_FROZEN`) n’autorise que la pose unique de `used_at` et `attempt_id`.

### Table `contributions`

- Colonnes : `tx_id`, `tranche_id`, `payer_id` ou `invited_phone` (l’un des deux est obligatoire), `amount_minor` (> 0), `currency`, `status`, `created_at`, `confirmed_at`.
- `status` ∈ PENDING, CONFIRMED, FAILED, REFUNDED.
- Index unique `contributions_one_live` (`tranche_id`, `payer_id`) pour les statuts PENDING et CONFIRMED.
- RLS `contributions_read` : `is_party(tx_id) or is_validator()`.

### Colonnes ajoutées à `payment_attempts`

- `contribution_id`, `quote_id`, `debit_currency`, `debit_amount_minor`, `fees_minor`.
- Index unique `payment_attempts_contribution_live`.

### app_config (mock_mode seulement)

- `fx_quote_ttl_seconds = '300'`.
- `simulated_fx_rates = {"EUR/XAF": "655.957"}`.
- `fee_schedule` : lue, absente par défaut. Sans barème, aucun frais n’est appliqué.

### Fonctions

**Internes** (`REVOKE` à tous)
- `_fx_quotes_frozen`, `_currency_decimals`, `_quote_fees`, `_quote_json`.
- `_refund_executed`, `_refunded`, `_create_refund`, `_process_payment_event`.
- `_post_journal` : les lignes peuvent porter leur propre devise (frais dans la devise débitée).
- `_attempt_json`.
- `_ledger_on_release` et `_resolve_dispute_v2` : redéfinies avec CONFIRMED, REQUESTED et EXECUTED.

**Publiques** (`GRANT` à authenticated, rien pour anon)

- **`get_quote(uuid, text, text)`**
  - Codes : `NOT_CONFIGURED` si la durée de vie des devis manque, `QUOTE_UNAVAILABLE` si le partenaire n’est pas simulé et que les devises diffèrent.
- **`accept_and_pay(uuid, text, uuid)`**
  - Codes : `QUOTE_INVALID`, `QUOTE_USED`, `QUOTE_EXPIRED`, `LIMITS_NOT_CONFIGURED` et `LIMIT_EXCEEDED` (via `_check_payer_limits`).
- **`start_payment(uuid, text, text)`** : raccourci, voir J1.
- **`mark_refund_executed(uuid, text)`**
  - Réservée à un administrateur non partie.
  - Codes : `NOT_FOUND`, `REFUND_NOT_PENDING`.
- **`request_refund(uuid, bigint, text, text)`**.
- **`demo_settle_payment(uuid, text)`** et **`demo_settle_refund(uuid, text)`**
  - Créées sans condition, protégées à l’exécution par `_mock_mode()` (`DEMO_DISABLED`).

**Vue `v_reconciliation`** : recréée avec les mêmes onze codes, mais calculée sur CONFIRMED, REQUESTED et EXECUTED.

---

## 0022 — 0022_lotx2_x6.sql (types de besoin configurables, K13)

### Colonnes de `request_modules`

- `beneficiary_mode text NOT NULL DEFAULT 'NAME'`, CHECK NAME, REFERENCE_ONLY ou NONE.
- `retention_days int`, CHECK 1 à 36 500, NULL. Le point ouvert 6 n’est pas tranché et aucune purge n’est prévue.

### Pièces des modules

- `_check_module_documents()` (déclencheur `request_modules_check`, posé en 0011) valide en plus `sensitivity` ∈ STANDARD ou SENSITIVE.
- Toutes les pièces reçoivent une sensibilité explicite, STANDARD par défaut.

### HEALTH

- `beneficiary_mode = 'REFERENCE_ONLY'`.
- `required_documents` se réduit à `[{kind: QUOTE, required: true, maxFiles: 3, sensitivity: SENSITIVE}]`.
- La pièce d’identité du bénéficiaire (BENEFICIARY_ID) et le certificat médical (MEDICAL_CERTIFICATE) sont retirés.

### `transactions`

- Nouvelle colonne `beneficiary_reference`, CHECK `^[A-Z0-9][A-Z0-9./-]{0,15}$`.
- Les noms de bénéficiaire sont effacés des modules qui ne sont pas en mode NAME (données de développement).

### Fonctions

**Internes** (`REVOKE` à tous)
- `_doc_sensitive(documents)`.
- `_doc_view_payload(documents)` : pour une pièce sensible, `path_sha256` remplace le chemin et le nom de fichier.

**Redéfinies**
- `_documents_guard()` : code `DOCUMENT_KIND_NOT_ALLOWED`.
- `_recently_opened(text)` : accepte aussi `path_sha256`.
- `get_document_access(uuid)` et `open_document(uuid)` : journalisation via `_doc_view_payload`.

**`save_draft(jsonb)`** (définition finale)
- Codes : `BENEFICIARY_NAME_NOT_ALLOWED`, `BENEFICIARY_REFERENCE_INVALID`.
- Contient encore le test `t.status not in ('DRAFT','REJECTED')`, alors que REJECTED n’est plus un statut d’opération autorisé (code mort).

**`submit_operation(uuid)`** (définition finale) : code `BENEFICIARY_REFERENCE_REQUIRED`.

**Droits** : `save_draft`, `submit_operation`, `get_document_access` et `open_document` sont accordées à authenticated, rien pour anon.

---

## 0023 — 0023_lotx2_fixes4.sql

- `_documents_guard()` (définition finale) ajoute `new.kind::text <> 'EVIDENCE'` à la condition `DOCUMENT_KIND_NOT_ALLOWED`.
- Remarque : ce contrôle ne s’applique déjà qu’aux pièces sans `tranche_id`. L’exemption ne change donc rien pour les preuves rattachées à une demande ; elle sert seulement pour une pièce `EVIDENCE` au niveau de l’opération.

---

## J1. `start_payment` comparé à `accept_and_pay` (définitions finales)

Définitions finales :
- `start_payment` : dernier `CREATE OR REPLACE` en 0021, après 0010, 0014 et 0018.
- `accept_and_pay` : définie uniquement en 0021.

Le `start_payment` final **ne contient plus de logique de paiement**. Il procède ainsi :
1. Si la clé d’idempotence est valide et déjà connue, il renvoie `accept_and_pay(p_tranche, v_key, NULL)`.
2. Sinon, il vérifie la longueur de la clé.
3. Il appelle `get_quote(p_tranche, NULL, p_method)`, devis dans la devise de la demande.
4. Il appelle `accept_and_pay(p_tranche, v_key, id_du_devis)`.

| Contrôle | `accept_and_pay` (0021) | `start_payment` (0021, via `get_quote` puis `accept_and_pay`) |
|---|---|---|
| Utilisateur connecté (`_require_user`) | oui | oui (trois fois) |
| Clé d’idempotence de 8 à 200 caractères | oui, `VALIDATION` | oui, `VALIDATION`, avant le devis |
| Rejeu de la clé (même demande, même auteur), sinon `IDEMPOTENCY_CONFLICT` | oui, en premier | oui (délégué) |
| Appelant partie de l’opération (`TRANCHE_NOT_FOUND`) | oui, demande verrouillée par `FOR UPDATE` | oui, dans `get_quote` sans verrou puis dans `accept_and_pay` avec verrou |
| Appelant payeur (`PAYER_ONLY`) | oui | oui (deux fois) |
| `on_hold` (`REQUEST_ON_HOLD`) | oui | oui (deux fois) |
| Opération ACTIVE (`TX_NOT_ACTIVE`) | oui | oui (deux fois) |
| Paiement en cours (INITIATED ou PENDING, `PAYMENT_IN_PROGRESS`) | oui | oui (deux fois) |
| Demande SUBMITTED (`NOT_PAYABLE`) | oui | oui (deux fois) |
| Moyen de paiement valide | indirect (`q.method`, contraint par le CHECK de `fx_quotes`) | oui, dans `get_quote` (`VALIDATION`) |
| Devise de débit | celle du devis (change possible) | toujours la devise de la demande (taux 1, source IDENTITY) |
| Durée de vie des devis configurée (`NOT_CONFIGURED`) | non directement, mais le devis vient de `get_quote` | oui |
| Devis du payeur, de la demande, du montant et de la devise (`QUOTE_INVALID`) | oui | oui, devis neuf |
| Devis non utilisé (`QUOTE_USED`) et non expiré (`QUOTE_EXPIRED`) | oui | oui, toujours satisfait (devis neuf) |
| Plafonds du niveau (`_check_payer_limits`) | oui, sur le reste dû | oui (délégué) |
| Niveau d’enrôlement du payeur | seulement à travers les plafonds (ligne `enrolment_limits` du niveau) ; aucun niveau minimal exigé | idem |
| Témoin (« witness ») | **absent** : aucune occurrence dans les migrations ni dans le dépôt | **absent** |
| Échéancier accepté (`accepted_at`) | non lu | non lu |
| Expiration de la demande (`tranches.expires_at`) | **non lue** (seul le statut est vérifié) | **non lue** |
| Effets | contribution, tentative INITIATED, devis consommé, demande ACCEPTED, audit `PAYMENT_STARTED` | idem, plus une ligne `fx_quotes` et un audit `QUOTE_ISSUED` |

### Différences constatées

1. `start_payment` n’autorise **aucun change** : le devis est toujours dans la devise de la demande.
2. `start_payment` valide `p_method` lui-même (dans `get_quote`). `accept_and_pay` reprend le moyen enregistré dans le devis.
3. `start_payment` fait deux passes de contrôle. La première, dans `get_quote`, ne verrouille pas la demande. Les contrôles verrouillés d’`accept_and_pay` restent ceux qui font foi.
4. `start_payment` crée un devis et un audit `QUOTE_ISSUED` de plus, annulés si la suite échoue (même transaction).
5. Ordre des erreurs : avec une clé connue, `start_payment` répond comme `accept_and_pay`. Avec une clé invalide, l’erreur `VALIDATION` sort avant tout autre contrôle.
6. **Version intermédiaire `start_payment` de 0018** (et 0014) : sans devis ni plafonds, avec contrôle `PENDING` seul. Une base où 0021 n’est pas appliquée garde donc un chemin de paiement **sans plafond**.

### Constats sur les deux fonctions

- Aucune ne vérifie `tranches.expires_at` : seul le statut compte. Or l’expiration passe par la tâche horaire `diaspay-expire-due-requests` (minute 15). Une demande dont l’échéance est dépassée reste payable jusqu’au passage suivant, soit jusqu’à environ 1 h.
- En pratique, l’écart est nul aujourd’hui : aucun module n’a de `request_expiry_days`, donc `expires_at` reste NULL.
- Aucune n’exige un niveau minimal du payeur. Un payeur N0 paie si `enrolment_limits` contient une ligne N0 pour la devise. En mock_mode, ces lignes existent sans plafond.

---

## J2. Tâches pg_cron (0001 à 0023)

L’extension est créée en 0005 : `create extension if not exists pg_cron with schema pg_catalog`. Aucun appel `cron.unschedule` n’existe. 0003 (lignes 598-599) ne contient que des exemples en commentaire (`release-tranches`, `activate-tranches`), jamais exécutés.

| Tâche | Planification | Fonction | Déclarée dans | Définition finale | Cohérence avec le modèle v2 |
|---|---|---|---|---|---|
| `diaspay-release-due-tranches` | `*/10 * * * *` | `public.release_due_tranches()` | 0005 | 0014 | Oui. Sélection : demandes `PAID` avec `funds_state='HELD'`, `release_mode <> 'EVIDENCE_REVIEW'`, `confirmed_at` renseigné, `contest_ends_at <= now()` et aucun litige ouvert ; effet : fonds RELEASED via `_set_funds_state`, déclencheur `AUTO_TIMEOUT`. Aucune référence aux anciens statuts. **Mais l’état de l’opération n’est pas vérifié** : une opération SUSPENDED pour fraude (`suspend_operation`) voit quand même ses fonds HELD libérés à l’échéance. |
| `diaspay-activate-due-tranches` | `0 6 * * *` | `public.activate_due_tranches()` | 0005 | 0014 | Oui. Sélection : demandes DRAFT d’opérations ACTIVE, échues sous `activation_lead_days` (7, posé en 0003) ou jalon suivant ; effet : soumission via `_submit_request`. Le nom garde l’ancien vocabulaire « tranches ». |
| `diaspay-expire-due-requests` | `15 * * * *` | `public.expire_due_requests()` | 0014 | 0014 | Oui. Sélection : demandes SUBMITTED ou INFO_REQUESTED avec `expires_at <= now()` et non `on_hold` ; effet : EXPIRED et jeton révoqué. **Sans effet aujourd’hui**, puisque `request_expiry_days` est NULL partout et `expires_at` donc jamais renseigné. L’état de l’opération n’est pas vérifié non plus. |

Les trois fonctions sont `SECURITY DEFINER` et révoquées à public, anon et authenticated (0014, section « Droits »). Elles tournent avec le rôle propriétaire de pg_cron.

---

## Autres points demandés

### Statuts

**Statuts d’opération autorisés** (contrainte `transactions_status_v2`, 0014) :
DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED.

L’enum `tx_status` contient encore les valeurs historiques, interdites par la contrainte : SUBMITTED, REJECTED, VALIDATED, TOKEN_ISSUED, AWAITING_PAYMENT, EXPIRED, PAID_LOCKED, SERVICE_CONFIRMED, RELEASED, DISPUTED, IN_PROGRESS.

**Statuts de demande autorisés** (contrainte `tranches_status_v2`, 0014) :
DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED.

L’enum `tranche_status` contient encore PLANNED, AWAITING_PAYMENT, PAID_LOCKED, EVIDENCE_SUBMITTED, CONFIRMED, RELEASED et DISPUTED, interdits par la contrainte.

**`DISPUTED`** n’est plus un statut de demande : la valeur existe dans l’enum mais est refusée par le CHECK. Le litige vit dans `disputes` (statut et issue) et dans `tranches.on_hold`.

### Modes et revue

- **`settlement_mode`** : enum DIRECT ou CONDITIONAL, sur `request_modules` et sur `transactions`, défaut DIRECT. Il est copié du module tant que l’opération est en DRAFT (`_draft_settlement`).
- **`platform_review`** : défaut `NEVER` depuis 0014 (il valait ALWAYS en 0011), et toutes les lignes sont passées à NEVER.

### Vues `release_rules` et `required_documents`

Créées en 0011 :
- `release_rules` : `SELECT code AS vertical, release_mode, contest_hours, dual_validation FROM request_modules` ;
- `required_documents` : `vertical`, `kind`, `required`, dépliés depuis le JSON du module.

Les anciennes tables sont renommées `_release_rules_0003` et `_required_documents_0005`, non supprimées. `save_draft` lit encore `release_rules`.

### `request_modules` — état après 0023

Lignes amorcées en 0011, modifiées en 0014 et 0022.

| Code | Vague | Activé | settlement_mode | release_mode | contest_hours | dual_validation | beneficiary_mode | Pièces (obligatoire ; sensibilité) |
|---|---|---|---|---|---|---|---|---|
| EDUCATION | 1 | oui | DIRECT | PROVIDER_CONFIRM | 72 | non | NAME | ENROLMENT_CERTIFICATE (oui ; STANDARD), SCHOOL_SCHEDULE (non ; STANDARD) |
| HEALTH | 1 | oui | DIRECT | PROVIDER_CONFIRM | 48 | non | **REFERENCE_ONLY** | QUOTE (oui ; **SENSITIVE**) uniquement |
| RENT | 1 | oui | DIRECT | PROVIDER_CONFIRM | 72 | non | NAME | LEASE (oui ; STANDARD), LAST_RECEIPT (non ; STANDARD) |
| AGRO | 2 | non | CONDITIONAL | PAYER_CONFIRM | 72 | non | NAME | SUPPORTING_DOCUMENT (oui ; STANDARD) |
| REAL_ESTATE | 2 | non | CONDITIONAL | EVIDENCE_REVIEW | 0 | oui | NAME | SUPPORTING_DOCUMENT (oui ; STANDARD) |
| LAND | 2 | non | CONDITIONAL | EVIDENCE_REVIEW | 0 | oui | NAME | SUPPORTING_DOCUMENT (oui ; STANDARD) |

Pour toutes les lignes :
- `platform_review = NEVER` ;
- `request_expiry_days` et `retention_days` sont NULL ;
- `multiple_payers = false` ;
- `maxFiles = 3` pour chaque pièce.

### `enrolment_limits`

- Vide hors mock_mode.
- En mock_mode : 12 lignes `dev_only` sans aucun plafond.
- Clé lue : `limits_when_missing` (défaut REFUSE, jamais insérée).

### `require_staff_mfa`

- Inséré à `'false'` en 0006, sans modification ultérieure.
- `is_validator()` et `is_admin()` n’exigent un jeton `aal2` que si la valeur est `'true'`.

### `presentation_tokens`

Voir 0016 : empreinte SHA-256 seulement, usage unique, rotation, révocation, durée de vie de 90 s en mock_mode seulement, aucune interface.

---

## Risques relevés (avec preuve)

1. **`mock_mode` vaut `'true'` dès 0001.**
   - Preuve : 0001_base_v0_1.sql, ligne 50, `insert into app_config values ('mock_mode','true')`. Aucune migration ne le repasse à `'false'`.
   - Conséquence : une base construite par simple application des migrations reçoit les réglages « développement seulement » de 0016, 0020 et 0021 :
     - `kyc_simulated_result = APPROVED`, donc N1 et N2 accordés automatiquement par `submit_enrolment` ;
     - plafonds NULL ;
     - taux EUR/XAF simulé ;
     - durées de vie des jetons et des devis ;
     - fonctions `demo_*` actives.
2. **Libération automatique malgré une suspension pour fraude.** `release_due_tranches` (0014) ne filtre pas `transactions.status`.
3. **Demande payable après son échéance.** Ni `accept_and_pay` ni `start_payment` ne lisent `expires_at` ; l’expiration dépend d’une tâche horaire. Risque latent tant que `request_expiry_days` reste NULL.
4. **Prise en charge par le porteur du jeton.** `claim_presentation_token` (0016) lie comme payeur tout porteur de la référence quand le payeur n’est connu que par téléphone : rien ne compare son numéro à `invited_phone`. Atténuations : 90 s, usage unique, empreinte seule stockée.
5. **Configuration manquante en production.** `enrolment_limits` vide → `LIMITS_NOT_CONFIGURED` ; `fx_quote_ttl_seconds` absent → `NOT_CONFIGURED` ; `presentation_token_ttl_seconds` absent. Aucun paiement n’est possible tant que ces réglages ne sont pas posés. C’est voulu, mais c’est un prérequis.
6. **Dette de nommage.** `tranches` et `transactions` contre `payment_requests` et opérations ; `payments.status` vaut SUCCEEDED quand `payment_attempts` dit CONFIRMED ; les valeurs d’enum obsolètes restent présentes ; le code mort `'REJECTED'` subsiste dans `save_draft` ; `_round_start` lit encore `SUBMITTED`.
7. **Bucket `identity` non réaligné.** Le `ON CONFLICT` de 0020 ne réapplique ni la limite de 10 Mo ni les types MIME si le bucket existe déjà.
8. **Remboursement mono-tentative.** `_create_refund` (0021) sélectionne « la » tentative CONFIRMED d’une demande. C’est valable en phase 1 (une seule contribution) ; ce sera à revoir pour les contributions multiples (K9).
