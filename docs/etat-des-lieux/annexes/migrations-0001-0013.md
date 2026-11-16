# Annexe : migrations Supabase 0001 à 0013

Source : `supabase/migrations/` (branche `lotX`, lecture seule). Tout ce qui suit est lu dans les fichiers SQL ; les
dates et empreintes de commit viennent de `git log --diff-filter=A`. Aucune requête n’a été exécutée sur une base.

Conventions :

- **SD** = fonction `SECURITY DEFINER` (toutes avec `set search_path = public`) ; **invoker** = droits de l’appelant.
- « révoquée anon » = `REVOKE … FROM public, anon` explicite ; « interne » = `REVOKE ALL … FROM public, anon, authenticated`.
- À partir de 0005, les erreurs métier passent par `_err(code, message, detail)`, qui lève
  `RAISE EXCEPTION USING errcode = 'P0001', hint = <code>` : le client lit le **code dans `hint`**. Avant 0005 (0001 à 0004),
  les fonctions lèvent des `raise exception '<texte>'` sans code stable.
- « voir 0014 / 00xx » n’est indiqué que lorsqu’un `grep` dans les migrations ultérieures l’a confirmé.

## Vue d’ensemble

| N° | Fichier | Octets | Ajouté le | Commit | Résumé |
|---|---|---|---|---|---|
| 0001 | `0001_base_v0_1.sql` | 19 633 | 2026-11-11 | `cb1dc44` | Schéma MVP v0.1 : profils, dossiers (transactions), parties, pièces, validations, jeton eQR par dossier, paiements, journal d’audit chaîné, machine d’états, RLS, bucket `dossiers`. |
| 0002 | `0002_v0_2_enums.sql` | 500 | 2026-11-11 | `cb1dc44` | Valeurs d’enum seules : verticales RENT, AGRO, REAL_ESTATE, LAND et statut IN_PROGRESS. |
| 0003 | `0003_v0_2_tranches.sql` | 34 017 | 2026-11-11 | `cb1dc44` | Tranches de paiement, règles de déblocage par verticale, double validation, jetons par tranche, litiges, tâches planifiables. |
| 0004 | `0004_v0_3_fixes.sql` | 8 274 | 2026-11-11 | `cb1dc44` | Correctifs après exécution réelle : SHA-256 natif, abandon/suppression de brouillon (D4), protection du profil, motif codé des litiges. |
| 0005 | `0005_lot4.sql` | 62 433 | 2026-11-11 | `69e4626` | Lot 4 : codes d’erreur stables, brouillons serveur, invitations, prestataires, limites des pièces, notifications serveur, démo, pg_cron. |
| 0006 | `0006_lot5.sql` | 35 078 | 2026-11-11 | `02f08bb` | Lot 5 (back-office) : MFA aal2 du personnel, files du bureau, contrôles automatiques, prise en charge, consultation journalisée des pièces. |
| 0007 | `0007_lotx_enums.sql` | 798 | 2026-11-12 | `b7ecaf5` | Valeurs d’enum seules : tranche INFO_REQUESTED et REJECTED, mode de déblocage IMMEDIATE. |
| 0008 | `0008_lotx.sql` | 50 160 | 2026-11-12 | `b7ecaf5` (puis `0f450d0`, `9e1bbb7`) | Lot X passe 1 : sécurité du jeton (révocation, limitation, événements de sécurité), décisions du payeur, demandes initiées par un prestataire. |
| 0009 | `0009_lotx_x4.sql` | 17 161 | 2026-11-12 | `7efbfdd` | TrustVault : empreinte SHA-256 des pièces, détection de réutilisation, consultations journalisées pour tous, pièces immuables après soumission. |
| 0010 | `0010_lotx_x5.sql` | 38 271 | 2026-11-12 | `a795409` | Fondations des paiements : tentatives idempotentes, événements du partenaire, grand livre en partie double, remboursements, rapprochement. |
| 0011 | `0011_lotx_x6.sql` | 31 288 | 2026-11-12 | `a00c23f` | Types de besoin configurables : table `request_modules`, vues de compatibilité, revue plateforme ALWAYS/RISK_BASED/NEVER. |
| 0012 | `0012_lotx_x7.sql` | 3 182 | 2026-11-12 | `d2a3e36` | Structure multi-payeurs : clé propre de `transaction_parties`, second payeur seulement si le module l’autorise. |
| 0013 | `0013_lotx2_enums.sql` | 2 038 | 2026-11-12 | `de85dfc` | Valeurs d’enum du modèle cible v2 (statuts d’opération et de demande, rôle INITIATOR, type `settlement_mode`). |

Sujets de commit (abrégés) :
`cb1dc44` « lot4(T1): projet Supabase de développement vérifié (67/67)… » ; `69e4626` « lot4(T2): migration 0005 (codes d’erreur stables, brouillons serveur…) » ;
`02f08bb` « lot5(T2): migration 0006 et test 02_lot5… second facteur en base… » ; `b7ecaf5` « lotX(X1): sécurité du TrustLink côté serveur (migrations 0007 et 0008, partie X1)… » ;
`0f450d0` « lotX(X2): décisions du payeur côté serveur (0008, partie X2) » ; `9e1bbb7` « lotX(X3): demandes initiées par un prestataire côté serveur » ;
`7efbfdd` « lotX(X4): TrustVault (0009)… » ; `a795409` « lotX(X5): fondations des paiements (0010), sans appeler TrustPayWay… » ;
`a00c23f` « lotX(X6): types de besoin configurables (0011)… » ; `d2a3e36` « lotX(X7): structure multi-payeurs (0012), sans interface… » ;
`de85dfc` « lotX(X2): refonte du noyau v2 (0013, 0014, correctifs 0017 à 0019)… ».

Remarque : 0001 à 0004 ont été ajoutées ensemble dans un seul commit (`cb1dc44`). 0008 a été modifiée par trois commits
successifs (parties X1, X2, X3). Les autres fichiers 0001–0013 n’ont qu’un commit.

Réglages `app_config` insérés par 0001–0013 (valeurs initiales, toutes non sensibles) :

| Clé | Valeur initiale | Migration | Devenir constaté |
|---|---|---|---|
| `mock_mode` | `true` | 0001 | — |
| `token_ttl_days` | `7` | 0001 | — |
| `activation_lead_days` | `7` | 0003 | — |
| `open_verticals` | `EDUCATION,HEALTH,RENT` | 0005 | n’est plus lu après 0011 (remplacé par `request_modules.enabled`) |
| `require_staff_mfa` | `false` | 0006 | à passer à `true` en production (commentaire du fichier) |
| `auto_issue_token` | `false` | 0006 | `true` posé par `seed.sql` selon le commentaire |
| `eqr_image_enabled` | `true` | 0008 | **0015 le passe à `false`** (`update app_config set value = 'false'`) |
| `reference_failure_limit` | `10` | 0008 | — |
| `require_content_hash` | `false` | 0009 | à passer à `true` avant production (commentaire) ; relu par 0022/0023 |
| `payment_provider` | `SIMULATED` | 0010 | relu par 0014, 0018, 0021 |

Tâches pg_cron (0001–0013) : uniquement dans **0005** (voir ci-dessous). 0003 ne contient qu’un exemple en commentaire.
Pour mémoire, 0014 ajoute `diaspay-expire-due-requests` (`15 * * * *`, `select public.expire_due_requests()`).

---

## 0001 — `0001_base_v0_1.sql`

- Taille : 19 633 octets ; ajouté le 2026-11-11, commit `cb1dc44`.
- Résumé : crée le schéma MVP v0.1 (un dossier = une transaction payée en une fois), avec RLS, journal d’audit chaîné par
  empreinte et machine d’états en base.

**Extension** : `pgcrypto`.

**Types enum créés**

| Type | Valeurs |
|---|---|
| `tx_status` | DRAFT, SUBMITTED, IN_REVIEW, REJECTED, VALIDATED, TOKEN_ISSUED, AWAITING_PAYMENT, EXPIRED, CANCELLED, PAID_LOCKED, SERVICE_CONFIRMED, RELEASED, CLOSED, DISPUTED |
| `vertical` | EDUCATION, HEALTH |
| `tx_role` | PAYER, REQUESTER, PROVIDER, SYSTEM |
| `platform_role` | USER, VALIDATOR, ADMIN |
| `currency` | EUR, USD, XAF |
| `payment_status` | PENDING, SUCCEEDED, FAILED, REFUNDED |

**Tables**

| Table | Colonnes principales |
|---|---|
| `profiles` | `id` (= auth.users), `full_name`, `phone` unique, `country`, `locale` (fr/en), `platform_role` (défaut USER), `kyc_status` (NONE/PENDING/VERIFIED/REJECTED) |
| `app_config` | `key` PK, `value` |
| `transactions` | `id`, `vertical`, `purpose` (3–500), `amount_minor` > 0, `currency`, `status` (défaut DRAFT), `created_by`, `due_date`, `expires_at`, `reject_reason` |
| `transaction_parties` | `tx_id`, `user_id`, `role`, `invited_phone` ; **PK (tx_id, role)** ; `user_id` ou `invited_phone` requis |
| `documents` | `id`, `tx_id`, `kind`, `storage_path`, `mime_type` (jpeg/png/pdf), `size_bytes` ≤ 10 Mo, `uploaded_by` |
| `validations` | `id`, `tx_id`, `validator_id`, `approved`, `reason` (obligatoire si refus), `decided_at` |
| `trust_tokens` | `tx_id` PK, `reference` unique (9 octets hex), `signature` (simulée), `simulated`, `expires_at`, `used_at` |
| `payments` | `id`, `tx_id`, `provider` (défaut MOCK), `external_id`, `status`, `fee_minor` ; index unique `one_success_per_tx` |
| `release_events` | `id`, `tx_id`, `trigger` (PROVIDER_CONFIRMATION, AUTO_TIMEOUT, ADMIN) |
| `notifications` | `id`, `user_id`, `tx_id`, `event`, `read_at` |
| `audit_log` | `id` identity, `tx_id`, `actor_id`, `event`, `from_status`, `to_status`, `payload`, `prev_hash`, `hash` |
| `allowed_transitions` | `from_status`, `to_status`, `role`, `validator_only` (PK sur les quatre) ; 19 lignes insérées (DRAFT→SUBMITTED … PAID_LOCKED→DISPUTED) |

**Fonctions**

| Fonction | SD | Droits |
|---|---|---|
| `handle_new_user()` (déclencheur sur `auth.users`) | SD | aucun REVOKE |
| `audit_chain()` (déclencheur, empreinte SHA-256 chaînée, verrou consultatif par dossier) | invoker | aucun REVOKE |
| `audit_immutable()` (déclencheur, refuse UPDATE/DELETE) | invoker | aucun REVOKE |
| `verify_audit(p_tx uuid)` → boolean | invoker | **aucun REVOKE** (jamais révoquée ensuite) |
| `guard_status()` (déclencheur : statut modifiable seulement si `app.via_transition = on`) | invoker | aucun REVOKE |
| `is_validator()`, `has_role(p_tx, p_role)`, `is_party(p_tx)` | SD | **aucun REVOKE** (jamais révoquées ensuite) |
| `transition_tx(p_tx, p_to tx_status, p_reason)` | SD | REVOKE public ; GRANT authenticated |
| `decide_tx(p_tx, p_approved, p_reason)` | SD | REVOKE public ; GRANT authenticated |
| `simulate_system_transition(p_tx, p_to)` (mock_mode seulement) | SD | REVOKE public ; GRANT authenticated |
| `resolve_reference(p_ref text)` | SD | GRANT authenticated **sans REVOKE** dans 0001 (révoquée public, anon en 0003) |
| `status_ok(p_tx)` | SD | **aucun REVOKE** (jamais révoquée ensuite) |

**Déclencheurs** : `on_auth_user_created` (auth.users, after insert) ; `audit_chain_trg` (before insert) ; `audit_no_update`
(before update/delete) ; `guard_status_trg` (before update sur transactions).

**RLS** : activée sur les 12 tables. Politiques :

| Table | Politique | Commande |
|---|---|---|
| profiles | `profiles_self_read` | SELECT (soi ou validateur) |
| profiles | `profiles_self_update` | UPDATE (soi, platform_role = USER) — remplacée en 0004 |
| transactions | `tx_read` (remplacée 0004), `tx_insert`, `tx_update_draft` (remplacée 0003) | SELECT, INSERT, UPDATE |
| transaction_parties | `parties_read`, `parties_insert` | SELECT, INSERT |
| documents | `docs_read`, `docs_insert` | SELECT, INSERT |
| validations | `validations_read` | SELECT |
| trust_tokens | `tokens_read` | SELECT (partie et `status_ok`) |
| payments / release_events / audit_log | `payments_read`, `release_read`, `audit_read` | SELECT |
| notifications | `notif_own`, `notif_update` | SELECT, UPDATE |
| app_config | `config_read` | SELECT `using (true)` (sans restriction de rôle) |

**Stockage** : bucket `dossiers` privé (aucune limite de taille/type à ce stade). Politiques `storage.objects` :
`dossiers_read` (SELECT), `dossiers_insert` (INSERT), fondées sur le premier dossier du chemin.

**Temps réel** : `supabase_realtime` ← `transactions`, `notifications`.

**Codes d’erreur** : aucun (messages libres « Transaction introuvable », « Transition % -> % non autorisée », etc.).

---

## 0002 — `0002_v0_2_enums.sql`

- Taille : 500 octets ; 2026-11-11, `cb1dc44`.
- Résumé : ajoute des valeurs d’enum dans un fichier séparé (PostgreSQL interdit d’utiliser une valeur ajoutée dans la même transaction).
- `vertical` : + RENT, AGRO, REAL_ESTATE, LAND. `tx_status` : + IN_PROGRESS.
- Aucun autre objet ; aucun code d’erreur.

---

## 0003 — `0003_v0_2_tranches.sql`

- Taille : 34 017 octets ; 2026-11-11, `cb1dc44`.
- Résumé : introduit le paiement par tranches (chaque tranche a son cycle et son jeton), les règles de déblocage par
  verticale, la double validation, les litiges et les fonctions planifiables.

**Types enum créés** : `tranche_status` (PLANNED, AWAITING_PAYMENT, PAID_LOCKED, EVIDENCE_SUBMITTED, CONFIRMED, RELEASED,
DISPUTED, CANCELLED, EXPIRED) ; `release_mode` (PROVIDER_CONFIRM, PAYER_CONFIRM, EVIDENCE_REVIEW, AUTO) ;
`recurrence_freq` (WEEKLY, MONTHLY, QUARTERLY).

**Tables créées**

| Table | Colonnes / contenu |
|---|---|
| `release_rules` | `vertical` PK, `release_mode`, `contest_hours`, `dual_validation` ; 6 lignes (EDUCATION 72 h, HEALTH 48 h, RENT 72 h en PROVIDER_CONFIRM ; AGRO PAYER_CONFIRM 72 h ; REAL_ESTATE et LAND EVIDENCE_REVIEW 0 h, double validation). Renommée en 0011. |
| `dual_thresholds` | `currency` PK, `threshold_minor` ; EUR 500000, USD 550000, XAF 3000000 |
| `tranches` | `id`, `tx_id`, `seq` (unique par dossier), `label`, `amount_minor`, `due_date`, `status`, `release_mode`, `contest_hours`, `contest_ends_at`, `released_at` |
| `recurrence_plans` | `tx_id` PK, `frequency`, `installments` (2–60), `start_date` |
| `tranche_transitions` | `from_status`, `to_status`, `role`, `validator_only` ; 12 lignes |
| `signing_keys` | `kid` PK, `public_key` (Ed25519 base64), `active` ; ligne `SIMULATED` à clé vide |
| `tranche_tokens` | `tranche_id` PK (changée en 0008), `reference` unique, `kid`, `signature`, `simulated`, `expires_at`, `used_at` |
| `disputes` | `id`, `tx_id`, `tranche_id`, `opened_by`, `reason` (≥ 10), `status` (OPEN, RELEASED_TO_PROVIDER, REFUNDED_TO_PAYER), `resolution_note`, `resolved_by`, `resolved_at` ; index unique `one_open_dispute_per_tranche` |

**Colonnes ajoutées** : `tranche_id` sur `documents`, `validations`, `payments`, `release_events`, `audit_log`.
Index `one_success_per_tx` remplacé par `one_success_per_tranche`. Contrainte `release_events_trigger_check` élargie
(+ PAYER_APPROVAL, VALIDATOR_APPROVAL, DISPUTE_RESOLUTION). `app_config.activation_lead_days = 7`.
`allowed_transitions` : + TOKEN_ISSUED→IN_PROGRESS, IN_PROGRESS→CLOSED, IN_PROGRESS→DISPUTED (payeur, prestataire).

**Fonctions** (toutes SD sauf mention)

| Fonction | Droits |
|---|---|
| `audit_chain()`, `verify_audit(uuid)` redéfinies (tranche_id dans l’empreinte) — invoker | aucun REVOKE |
| `guard_tranche_status()` (déclencheur) — invoker | aucun REVOKE |
| `is_admin()` | **aucun REVOKE** (jamais révoquée ensuite) |
| `required_validations(p_tx, p_tranche default null)` → 1 ou 2 | **aucun REVOKE** (jamais révoquée ensuite) |
| `_set_tranche_status(p_tranche, p_to, p_actor, p_event, p_payload)` | interne (public, anon, authenticated) |
| `_issue_tranche_token(p_tranche)` | interne |
| `create_tranches(p_tx, p_items jsonb)`, `generate_recurring_tranches(p_tx, p_freq, p_n, p_start, p_label)` | révoquée anon ; GRANT authenticated |
| `transition_tx` v0.2, `decide_tx` (double validation, validateur non partie) | révoquée anon ; GRANT authenticated |
| `transition_tranche(p_tranche, p_to, p_reason)`, `decide_tranche(p_tranche, p_approved, p_reason)` | révoquée anon ; GRANT authenticated |
| `resolve_tranche_reference(p_ref)` (SQL), `confirm_by_reference(p_ref, p_device_time)` | révoquée anon ; GRANT authenticated |
| `open_dispute(p_tranche, p_reason)` (remplacée en 0004), `resolve_dispute(p_dispute, p_outcome, p_note)` (admin non partie) | révoquée anon ; GRANT authenticated |
| `release_due_tranches()`, `activate_due_tranches()` | interne (réservées service_role / pg_cron) |
| `simulate_tranche_system(p_tranche, p_to)` | révoquée anon ; GRANT authenticated |
| `resolve_reference`, `simulate_system_transition`, `transition_tx`, `decide_tx` | REVOKE public, anon (rattrapage de 0001) |

**Déclencheur** : `guard_tranche_status_trg` (before update sur tranches).

**RLS** (activée sur les 8 nouvelles tables) : `rules_read`, `thresholds_read`, `keys_read` (SELECT `using (true)`) ;
`tranches_read`, `recur_read`, `disputes_read` (SELECT partie ou validateur) ; `ttokens_read` (SELECT partie, tranche ≠ PLANNED) ;
`docs_insert_evidence` sur documents (INSERT, prestataire, tranche PAID_LOCKED) ; `tx_update_draft` recréée (UPDATE).

**pg_cron** : exemple seulement, en commentaire (`release-tranches` toutes les 10 min, `activate-tranches` à 6 h).

**Temps réel** : + `tranches`, `disputes`.

**Codes d’erreur** : aucun (messages libres).

---

## 0004 — `0004_v0_3_fixes.sql`

- Taille : 8 274 octets ; 2026-11-11, `cb1dc44`.
- Résumé : corrige les défauts trouvés à l’exécution réelle et applique la décision D4 (abandon et suppression de brouillon)
  et la politique de litige.

**Modifications**

- `tx_read` recréée (SELECT : créateur, partie ou validateur).
- `audit_chain()` et `verify_audit()` réécrites avec `sha256()` natif (pgcrypto n’est pas visible depuis `search_path = public`
  sur Supabase) ; `_issue_tranche_token` et `simulate_system_transition` utilisent `gen_random_uuid()`.
- Défaut de `trust_tokens.reference` et `tranche_tokens.reference` : 18 caractères hexadécimaux issus d’un UUID.
- `allowed_transitions` : + REJECTED→CANCELLED (demandeur, payeur).
- `has_audit(p_tx)` SD ; révoquée public, anon ; GRANT authenticated. Politique `tx_delete_draft` (DELETE : créateur, DRAFT jamais audité).
- `profiles` : + `primary_role` (PAYER/REQUESTER/PROVIDER), + `push_enabled` (défaut true). `profiles_self_update` recréée sans
  la condition sur platform_role ; déclencheur `guard_profile_trg` → `guard_profile()` (invoker) refuse la modification de
  `platform_role` et `kyc_status` par anon/authenticated. `guard_profile` n’a pas de REVOKE (fonction déclencheur).
- `disputes.reason_code` (NOT_DELIVERED, INCOMPLETE, WRONG_AMOUNT, OTHER) ; `open_dispute(uuid, text)` supprimée et recréée
  en `open_dispute(p_tranche, p_reason, p_reason_code default null)` SD ; révoquée anon ; GRANT authenticated.

**Codes d’erreur** : aucun (messages libres).

---

## 0005 — `0005_lot4.sql`

- Taille : 62 433 octets ; 2026-11-11, `69e4626`.
- Résumé : fournit ce que l’application mobile attend du serveur (lot 4) : codes d’erreur stables, brouillons côté serveur,
  invitations, annuaire des prestataires, limites des pièces, notifications créées par le serveur, démonstration, pg_cron.

**Outils (internes, révoqués public/anon/authenticated)** : `_err(p_code, p_message, p_detail)` (invoker, lève P0001 + hint),
`_norm_phone(text)`, `_valid_phone(text)`, `_require_user()` (code NOT_AUTHENTICATED), `_mock_mode()` SD, `_fold(text)`
(unaccent), `_draft_json(uuid)` SD, `_user_by_phone(text)` SD, `_attach_invitations()` SD, `_documents_guard()` SD,
`_storage_tx(text)` (invoker ; **re-GRANT à authenticated**, utilisée par les politiques du stockage), `_notify_from_audit()` SD,
`_resolve_dispute_core(uuid, text, text, uuid)` SD.

**Extensions** : `unaccent` (schéma extensions), `pg_cron` (schéma pg_catalog) ; `grant usage on schema cron to postgres`.

**Tables et colonnes**

- `required_documents` (vertical, kind, required ; PK vertical+kind) : 10 lignes (HEALTH : QUOTE, BENEFICIARY_ID obligatoires,
  MEDICAL_CERTIFICATE facultatif ; EDUCATION : ENROLMENT_CERTIFICATE, SCHOOL_SCHEDULE ; RENT : LEASE, LAST_RECEIPT ;
  AGRO, REAL_ESTATE, LAND : SUPPORTING_DOCUMENT). RLS, politique `required_docs_read` (SELECT `using (true)`). Renommée en 0011.
- `providers` (id, name, city, verticals text[], verified, phone, user_id). RLS : `providers_read` (SELECT authenticated),
  `providers_admin_write` (ALL, `is_admin()`) ; REVOKE all anon.
- `transactions` : `purpose`, `amount_minor`, `currency` deviennent nullables ; contrainte `tx_complete_unless_draft` ;
  + `beneficiary_name`, `provider_id`, `provider_name`, `plan_type` (SINGLE/PARTIAL/INSTALLMENTS/RECURRING), `draft_data` jsonb.
- `documents` : + `file_name`, + `deleted_at` (archivage). `notifications` : + `payload` jsonb.
- `notifications` : REVOKE insert/update/delete anon, authenticated ; GRANT update(`read_at`) authenticated.
- `app_config.open_verticals = EDUCATION,HEALTH,RENT`.

**Fonctions publiques (SD, révoquées public/anon, GRANT authenticated)** : `search_providers(p_query, p_vertical)`,
`save_draft(p_draft jsonb)`, `get_draft(p_tx)`, `get_drafts()`, `delete_draft(p_tx)`, `add_document(p_tx, p_kind, p_path,
p_name, p_mime, p_size)` (remplacée en 0009), `remove_document(p_doc)` (DELETED ou ARCHIVED), `get_receipt(p_tranche)`,
`get_dispute(p_tranche)`, `resolve_reference_info(p_ref)`. Redéfinies avec codes : `transition_tx`, `decide_tx`,
`simulate_system_transition`, `create_tranches`, `generate_recurring_tranches`, `transition_tranche`, `decide_tranche`,
`confirm_by_reference`, `open_dispute`, `resolve_dispute`, `simulate_tranche_system` (droits réappliqués).
`audit_immutable()` permet la suppression seulement si `app.demo_reset = on` et mock_mode.

**Fonctions de démonstration** (créées seulement si mock_mode = true au moment de la migration ; révoquées anon ; GRANT
authenticated) : `demo_review(p_tx, p_approved, p_reason)`, `demo_resolve_dispute(p_tranche, p_outcome, p_note)`, `demo_reset()`.

**Déclencheurs** : `attach_invitations_trg` (after insert sur profiles), `documents_guard_trg` (before insert sur documents :
JPEG/PNG/PDF, ≤ 10 Mo, chemin `<tx_id>/…`, 3 fichiers par type), `notify_from_audit_trg` (after insert sur audit_log ;
types TX_VALIDATED, TX_REJECTED, DISPUTE_OPENED, DISPUTE_RESOLVED, PAYMENT_READY, TRANCHE_CONFIRMED, TRANCHE_RELEASED).

**Politiques** : `docs_delete` (DELETE documents) ; stockage `dossiers_delete` (DELETE), `dossiers_insert` (INSERT, recréée),
`dossiers_read` (SELECT, recréée).

**Bucket** `dossiers` : `public = false`, `file_size_limit = 10485760` (10 Mo), `allowed_mime_types` = image/jpeg, image/png, application/pdf.

**pg_cron**

| Nom | Planification | Commande |
|---|---|---|
| `diaspay-release-due-tranches` | `*/10 * * * *` | `select public.release_due_tranches()` |
| `diaspay-activate-due-tranches` | `0 6 * * *` | `select public.activate_due_tranches()` |

`release_due_tranches()` et `activate_due_tranches()` restent internes (révoquées public, anon, authenticated).

**Codes d’erreur (hint)** : ADMIN_ONLY, ALREADY_DECIDED, AUDITED_FILE, DEMO_DISABLED, DEMO_NO_VALIDATOR, DEVICE_TIME_INVALID,
DISPUTE_NOT_ALLOWED, DOCUMENT_REQUIRED, EVIDENCE_MISSING, FILE_TOO_LARGE, FILE_TYPE, INVALID_OUTCOME, NOT_AUTHENTICATED,
NOT_A_PARTY, NOT_EDITABLE, NOT_FOUND, NOT_IN_REVIEW, NOT_PAID, NOT_PAYABLE, NOT_RELEASED, NO_EVIDENCE_NEEDED,
NO_EVIDENCE_PENDING, NO_OPEN_DISPUTE, PAYER_ONLY, PHONE_INVALID, PLAN_BAD_AMOUNT, PLAN_BAD_COUNT, PLAN_EMPTY,
PLAN_SUM_MISMATCH, PLAN_TOO_SMALL, PROVIDER_ONLY, REASON_REQUIRED, REASON_TOO_SHORT, TOKEN_EXPIRED, TOKEN_USED,
TOO_MANY_FILES, TRANCHE_NOT_FOUND, TRANSITION_FORBIDDEN, TRANSITION_UNKNOWN, TX_NOT_ACTIVE, TX_NOT_FOUND, TX_NO_DOCUMENT,
UNKNOWN_REFERENCE, VALIDATION, VALIDATOR_IS_PARTY, VALIDATOR_ONLY, VERTICAL_UNAVAILABLE, WRONG_CONFIRMER, WRONG_MODE.

---

## 0006 — `0006_lot5.sql`

- Taille : 35 078 octets ; ajouté le 2026-11-11, commit `02f08bb`.
- Résumé : fournit ce que le back-office attend du serveur (lot 5) : second facteur du personnel, files de travail,
  contrôles automatiques, prise en charge, confirmation humaine du montant, consultation journalisée des pièces, journal.

**Réglages** : `require_staff_mfa = false`, `auto_issue_token = false`.

**MFA (D7)** : `_staff_aal_ok()` SD (vrai si `require_staff_mfa` ≠ true ou JWT `aal = aal2`) ; `is_validator()` et `is_admin()`
redéfinies pour l’exiger (même signature, donc toutes les politiques RLS en héritent).

**Colonnes** : `validations.amount_checked` (défaut false) + contrainte `validations_amount_checked` (NOT VALID : toute
approbation de dossier doit avoir la case cochée) ; `disputes.response`, `responded_by`, `responded_at`.

**Vues** (`security_invoker = true`, filtrées par `is_validator()` / `is_admin()`) : `bo_dossiers` (SUBMITTED, IN_REVIEW),
`bo_evidence_queue` (tranches EVIDENCE_SUBMITTED), `bo_disputes` (admin). REVOKE public, anon ; GRANT select authenticated.
Recréées à l’identique en 0011, supprimées/recréées en 0014.

**Fonctions** (toutes SD sauf `_tx_ref` invoker)

| Fonction | Droits |
|---|---|
| `_staff_aal_ok()`, `_require_validator()`, `_simulate_token_issue(uuid)` | internes |
| `_tx_ref(uuid)`, `_party_name(uuid, tx_role)`, `_staff_name(uuid)`, `_round_start(uuid)`, `_evidence_round_start(uuid)`, `_dispute_notified_at(uuid)` | révoquées public/anon/authenticated puis **re-GRANT authenticated** (évaluées dans les vues) |
| `_recently_opened(p_path)` | révoquée public, anon ; GRANT authenticated |
| `decide_tx(p_tx, p_approved, p_amount_checked, p_reason)` (l’ancienne signature à 3 arguments est supprimée) | révoquée anon ; GRANT authenticated |
| `claim_dossier(p_tx)` (SUBMITTED → IN_REVIEW, D8), `dossier_checks(p_tx)` (DOCUMENTS, PROVIDER_VERIFIED, DUPLICATE, PLAN_SUM), `evidence_checks(p_tranche)` (EVIDENCE_PRESENT, PROVIDER_VERIFIED), `bo_decisions(p_tx, p_tranche)`, `dossier_documents(p_tx)`, `open_document(p_doc)` (journal DOCUMENT_VIEWED), `bo_audit(p_tx)`, `bo_audit_verify(p_tx)`, `log_audit_export(p_tx, p_rows)`, `bo_find_transactions(p_query)`, `respond_dispute(p_dispute, p_text)` | révoquées public, anon ; GRANT authenticated |
| `demo_review` redéfinie (si mock_mode) | droits réappliqués |

**Stockage** : `dossiers_read` recréée : parties comme avant ; personnel seulement dans les 2 minutes suivant une ouverture
journalisée (`_recently_opened`).

**Codes d’erreur** : ALREADY_ANSWERED, ALREADY_DECIDED, AMOUNT_NOT_CHECKED, DEMO_DISABLED, DEMO_NO_VALIDATOR, NOT_FOUND,
NOT_IN_REVIEW, NOT_RESPONDENT, NO_OPEN_DISPUTE, REASON_REQUIRED, REASON_TOO_SHORT, TRANCHE_NOT_FOUND, TX_NOT_FOUND,
VALIDATOR_IS_PARTY, VALIDATOR_ONLY.

---

## 0007 — `0007_lotx_enums.sql`

- Taille : 798 octets ; 2026-11-12, commit `b7ecaf5` (« lotX(X1): sécurité du TrustLink côté serveur (migrations 0007 et 0008, partie X1) »).
- Résumé : ajoute, dans un fichier séparé, les valeurs d’enum utilisées par 0008 ; ne change aucun comportement à elle seule.

| Type | Valeur ajoutée | Usage annoncé dans le fichier |
|---|---|---|
| `tranche_status` | `INFO_REQUESTED` | le payeur demande des informations (X2) |
| `tranche_status` | `REJECTED` | le payeur rejette la demande (X2) |
| `release_mode` | `IMMEDIATE` | paiement direct (X2.6) ; « aucun type de besoin ne l’utilise tant que le client n’a pas tranché (K1) » |

Devenir : `IMMEDIATE` est ensuite **interdit** par 0014 (contrainte `request_modules_no_immediate`, `release_mode <> 'IMMEDIATE'`) ;
la valeur reste dans l’enum (une valeur d’enum ne se supprime pas, cf. commentaire de 0013).

Aucun code d’erreur.

---

## 0008 — `0008_lotx.sql`

- Taille : 50 160 octets ; ajoutée le 2026-11-12 par `b7ecaf5` (partie X1), complétée par `0f450d0` (X2, décisions du payeur)
  et `9e1bbb7` (X3, demandes initiées par un prestataire).
- Résumé : pose les fondations du cahier d’extension « lot X » sans changer le flux par défaut : sécurité du jeton QR
  (TrustLink), décisions du payeur côté serveur, et création de demandes par un prestataire.
- Test associé (en-tête) : `supabase/tests/03_lotx.sql` (variante `03_lotx_editor.sql`).

### X1 — Sécurité du TrustLink

**Réglages** : `eqr_image_enabled = 'true'` (image du QR facultative ; décision client attendue) — **passé à `'false'` par 0015** ;
`reference_failure_limit = '10'` (échecs de résolution par utilisateur et par heure).

**`tranche_tokens` modifiée** : + `id uuid` (devient la **clé primaire** à la place de `tranche_id`), + `revoked_at`,
+ `revoked_by` (→ profiles), + `revoke_reason` ; contrainte `tranche_tokens_revocation` (motif ≥ 3 caractères si révoqué) ;
index unique partiel `tranche_tokens_one_active (tranche_id) where revoked_at is null` ; index `tranche_tokens_tranche`.
Une tranche peut donc avoir plusieurs jetons, un seul actif.

**Politique `ttokens_read`** recréée (SELECT) : jeton non révoqué, tranche ≠ PLANNED, **payeur seulement** (avant : toute partie).
0014 la supprime et la recrée (`drop policy if exists ttokens_read`, ligne 536 de 0014).

**Table `security_events`** (nouvelle)

| Colonne | Type / règle |
|---|---|
| `id` | bigint identity PK |
| `user_id` | uuid → profiles, `on delete set null` |
| `kind` | `REFERENCE_FAILED` ou `SUSPICIOUS_ACTIVITY` |
| `detail` | jsonb (via, préfixe de 4 caractères de la référence ; ou raison, compte, fenêtre) |
| `created_at` | timestamptz |

Index `security_events_user (user_id, kind, created_at)`. RLS ; politique `security_events_staff_read` (SELECT, `is_validator()`).
REVOKE insert/update/delete anon, authenticated ; REVOKE all anon ; GRANT select authenticated. Déclencheur
`security_events_immutable` (before update/delete) → `_security_events_immutable()` (ajout seul, sans exception de démonstration).
Aucune migration ultérieure (0014–0023) ne mentionne `security_events`.

**Fonctions X1**

| Fonction | SD | Rôle | Droits |
|---|---|---|---|
| `_issue_tranche_token(p_tranche)` | SD | un seul jeton actif (`on conflict (tranche_id) where revoked_at is null do nothing`) | interne |
| `_revoke_active_token(p_tranche, p_reason, p_actor)` → uuid | SD | révoque, journal `TOKEN_REVOKED` | interne |
| `_check_token_manager(p_tranche)` → tranches | SD | initiateur avant paiement (PLANNED, AWAITING_PAYMENT, INFO_REQUESTED) ou admin non partie | interne |
| `revoke_token(p_tranche uuid, p_reason text)` → jsonb | SD | révocation par l’initiateur / l’admin | révoquée public, anon ; GRANT authenticated |
| `reissue_token(p_tranche uuid, p_reason text default 'Réémission du jeton')` → jsonb | SD | révoque et réémet, journal `TOKEN_REISSUED` (nouvelle référence jamais journalisée) | révoquée public, anon ; GRANT authenticated ; **redéfinie en 0014 et 0018** |
| `_reference_failures()` → int | SD | échecs `REFERENCE_FAILED` de la dernière heure | interne |
| `_reference_guard()` | SD | lève **TOO_MANY_ATTEMPTS** au-delà de `reference_failure_limit` | interne ; **toujours appelée en 0014 et 0016** |
| `_reference_failed(p_ref, p_via)` | SD | écrit `REFERENCE_FAILED`, et `SUSPICIOUS_ACTIVITY` une fois au seuil | interne |
| `_party_token(p_ref)` → tranche_tokens | SD | jeton d’une référence pour une partie ; inconnue et dossier étranger : même réponse (null) | interne ; redéfinie en 0015 (droits internes réappliqués) |
| `resolve_reference_info(p_ref)` → jsonb | SD | garde, null + échec enregistré si inconnue, TOKEN_REVOKED si révoqué | révoquée public, anon ; GRANT authenticated |
| `resolve_tranche_reference(p_ref)` → table | SD (plpgsql) | mêmes règles, aucune ligne si inconnue | idem |
| `confirm_by_reference(p_ref, p_device_time)` → tranches | SD | UNKNOWN_REFERENCE, TOKEN_REVOKED, PROVIDER_ONLY, TOKEN_USED, DEVICE_TIME_INVALID (> +5 min), TOKEN_EXPIRED, NOT_PAID, WRONG_MODE | idem |
| `get_receipt(p_tranche)` → jsonb | SD | reçu d’une tranche RELEASED (référence du jeton actif ou du dernier, dernière empreinte, `verify_audit`) | idem |
| `mark_received(p_tranche uuid)` → tranches | SD | payeur seulement ; 1re ouverture : `tranches.first_viewed_at` + journal `REQUEST_VIEWED` (idempotent) | révoquée public, anon ; GRANT authenticated |

**Colonne** : `tranches.first_viewed_at` (relue par 0014).

### X2 — Décisions du payeur

**`tranche_transitions`** : + AWAITING_PAYMENT→INFO_REQUESTED (PAYER), INFO_REQUESTED→AWAITING_PAYMENT (REQUESTER, PROVIDER),
AWAITING_PAYMENT→REJECTED (PAYER), INFO_REQUESTED→REJECTED (PAYER), AWAITING_PAYMENT→RELEASED (SYSTEM, mode IMMEDIATE).
**`release_events_trigger_check`** : + `DIRECT_PAYMENT`.

**Table `request_messages`** (nouvelle) : `id`, `tx_id` (cascade), `tranche_id` (cascade), `author_id`, `kind`
(INFO_REQUEST, INFO_ANSWER, NOTE), `body` (3–2000), `created_at`. Index `request_messages_tx`. RLS ; politique
`request_messages_read` (SELECT, partie ou validateur). REVOKE insert/update/delete anon, authenticated ; GRANT select
authenticated. Déclencheur `request_messages_immutable` → `_request_messages_immutable()` (ajout seul ; suppression seulement
en réinitialisation de démo). Ajoutée à `supabase_realtime`. Relue par 0014.

**Fonctions X2** (SD sauf `_check_message` invoker immutable)

| Fonction | Rôle | Droits |
|---|---|---|
| `_set_tranche_status(...)` | REJECTED devient terminal pour la clôture du dossier | interne |
| `transition_tranche(p_tranche, p_to, p_reason)` | refuse INFO_REQUESTED, REJECTED et toute sortie d’INFO_REQUESTED (TRANSITION_FORBIDDEN : passer par les fonctions dédiées) | révoquée anon ; GRANT authenticated |
| `simulate_tranche_system(p_tranche, p_to)` | en mode IMMEDIATE, le paiement simulé débloque directement (événement DIRECT_PAYMENT) | idem |
| `_check_message(p_text)` | 3–2000 caractères | interne |
| `_request_tranche(p_tranche)` | partie + dossier IN_PROGRESS | interne |
| `request_info(p_tranche, p_message)` | payeur non initiateur ; AWAITING_PAYMENT → INFO_REQUESTED | révoquée anon ; GRANT authenticated ; redéfinie en 0014 |
| `answer_info(p_tranche, p_message)` | initiateur ; INFO_REQUESTED → AWAITING_PAYMENT | idem ; redéfinie en 0014 |
| `reject_request(p_tranche, p_reason)` | payeur ; → REJECTED, jeton révoqué | idem ; redéfinie en 0014 |
| `_notify_from_audit()` | + PAYMENT_REQUEST_RECEIVED (au payeur, si le créateur est le prestataire), INFO_REQUESTED, INFO_ANSWERED, REQUEST_REJECTED (aux autres parties) | interne ; redéfinie 0014, 0017 |

**Politiques** : `docs_insert_info` (INSERT documents : initiateur, tranche INFO_REQUESTED) ; stockage `dossiers_insert_info`
(INSERT storage.objects, même condition).

### X3 — Demandes initiées par un prestataire

- `profiles.can_initiate_requests boolean default false` (enrôlement provisoire) ; `guard_profile()` la protège en plus de
  `platform_role` et `kyc_status`. **Supprimée en 0020** (`alter table profiles drop column if exists can_initiate_requests`,
  remplacée par `enrolment_level`).
- `allowed_transitions` : + DRAFT→SUBMITTED, REJECTED→DRAFT, REJECTED→CANCELLED pour PROVIDER.
- `transition_tx(p_tx, p_to, p_reason)` : le prestataire n’agit sur un brouillon que s’il en est le créateur ; une demande
  initiée par un prestataire exige un payeur désigné ; ouverture lue dans `open_verticals`.
- `save_draft(p_draft)` : `creatorRole` facultatif (PAYER, REQUESTER, PROVIDER) ; PROVIDER exige `can_initiate_requests`
  (INITIATION_NOT_ALLOWED) et refuse de se désigner payeur (SELF_PAYER).
- Droits : `transition_tx`, `save_draft` révoquées public, anon ; GRANT authenticated.

**Codes d’erreur (hint) de 0008** : DEMO_DISABLED, DEVICE_TIME_INVALID, DOCUMENT_REQUIRED, EVIDENCE_MISSING,
INITIATION_NOT_ALLOWED, INITIATOR_ONLY, NOT_EDITABLE, NOT_PAID, NOT_PAYABLE, NOT_RELEASED, NOT_REVOCABLE, NO_EVIDENCE_NEEDED,
NO_TOKEN, PAYER_ONLY, PHONE_INVALID, PLAN_EMPTY, PLAN_SUM_MISMATCH, PROVIDER_ONLY, REASON_REQUIRED, SELF_PAYER, TOKEN_EXPIRED,
TOKEN_REVOKED, TOKEN_USED, TOO_MANY_ATTEMPTS, TRANCHE_NOT_FOUND, TRANSITION_FORBIDDEN, TRANSITION_UNKNOWN, TX_NOT_ACTIVE,
TX_NOT_FOUND, TX_NO_DOCUMENT, UNKNOWN_REFERENCE, VALIDATION, VALIDATOR_IS_PARTY, VALIDATOR_ONLY, VERTICAL_UNAVAILABLE,
WRONG_CONFIRMER, WRONG_MODE. Nouveaux par rapport à 0005 : INITIATION_NOT_ALLOWED, INITIATOR_ONLY, NOT_REVOCABLE, NO_TOKEN,
SELF_PAYER, TOKEN_REVOKED, TOO_MANY_ATTEMPTS. Les décisions du payeur réutilisent aussi REASON_REQUIRED (motif < 3) et
VALIDATION (message > 2000).

Aucun bucket ni tâche pg_cron.

---

## 0009 — `0009_lotx_x4.sql`

- Taille : 17 161 octets ; 2026-11-12, commit `7efbfdd` (« lotX(X4): TrustVault (0009)… »).
- Résumé : ajoute l’empreinte SHA-256 des pièces, la détection d’un justificatif réutilisé dans un autre dossier, la
  journalisation de toute consultation de pièce et l’immuabilité des pièces d’un dossier soumis.
- Test associé : `supabase/tests/04_lotx_p2.sql`.

**Colonnes** : `documents.content_hash` (texte) et `documents.hash_algo` ; contrainte `documents_content_hash_format`
(les deux nuls, ou 64 caractères hex minuscules et `SHA-256`) ; index partiel `documents_content_hash`. **Toujours utilisées
après 0014** (relues dans 0014, 0020, 0022, 0023).

**Réglage** : `require_content_hash = 'false'` (empreinte facultative pour les anciennes versions de l’app ; « à passer à
'true' avant la mise en production »).

**Fonctions**

| Fonction | SD | Rôle | Droits |
|---|---|---|---|
| `_norm_hash(p text)` | invoker (immutable) | minuscule, sans espaces | interne |
| `_documents_guard()` (déclencheur existant `documents_guard_trg`) | SD | + HASH_INVALID, HASH_REQUIRED si le réglage l’impose | interne ; redéfinie en 0011 |
| `_documents_immutable()` (nouveau déclencheur `documents_immutable_trg`, before update/delete) | SD | empreinte jamais modifiable (HASH_IMMUTABLE) ; pièce figée hors DRAFT/REJECTED et hors réponse INFO_REQUESTED (DOCUMENT_LOCKED) ; exceptions : cascade et réinitialisation de démo | interne ; relue en 0014 |
| `add_document(p_tx, p_kind, p_path, p_name, p_mime, p_size int, p_hash text default null)` | SD | l’ancienne signature à 6 paramètres est supprimée | révoquée public, anon ; GRANT authenticated |
| `_hash_reuse(p_hash, p_tx)` → uuid[] | SD | autres dossiers non brouillons ayant la même empreinte | interne |
| `document_reuse(p_hash text, p_tx uuid default null)` → jsonb | SD | partie : un nombre ; personnel : + références courtes | révoquée public, anon ; GRANT authenticated |
| `dossier_checks(p_tx)` | SD | + contrôle `DOCUMENT_REUSED` (ATTENTION, sans blocage) | révoquée public, anon ; GRANT authenticated |
| `get_document_access(p_document uuid)` → jsonb | SD | journalise `DOCUMENT_VIEWED` (rôle, pièce, nom de fichier, chemin) pour toute partie ou le personnel, sauf brouillon jamais audité du créateur ; renvoie chemin et empreinte | révoquée public, anon ; GRANT authenticated ; **redéfinie en 0022** |

**Politique de stockage** `dossiers_read` recréée (SELECT) : brouillon jamais audité de son créateur, **ou** consultation
journalisée de moins de 2 minutes (`_recently_opened`) par une partie, le créateur ou le personnel. Avant : toute partie, sans journal.

**Codes d’erreur** : DOCUMENT_LOCKED, FILE_TOO_LARGE, FILE_TYPE, HASH_IMMUTABLE, HASH_INVALID, HASH_REQUIRED, NOT_EDITABLE,
NOT_FOUND, TOO_MANY_FILES, TRANSITION_FORBIDDEN, TX_NOT_FOUND, VALIDATION (+ VALIDATOR_ONLY via `_require_validator` dans `dossier_checks`).

---

## 0010 — `0010_lotx_x5.sql`

- Taille : 38 271 octets ; 2026-11-12, commit `a795409` (« lotX(X5): fondations des paiements (0010), sans appeler TrustPayWay… »).
- Résumé : pose les fondations des paiements sans appeler le partenaire : tentatives idempotentes, événements du partenaire
  (webhook) idempotents et tolérants à l’ordre, grand livre en partie double (miroir des mouvements du partenaire, « DiasPay ne
  détient pas de fonds »), remboursements, vue de rapprochement, simulation par le même chemin.
- Référence citée : `docs/specs/ledger.md`.

**Réglage** : `payment_provider = 'SIMULATED'`.

**Tables**

| Table | Colonnes principales | Contraintes / index |
|---|---|---|
| `payment_attempts` | `id`, `tx_id`, `tranche_id`, `idempotency_key` (unique, 8–200), `provider`, `method` (SIMULATED, MOBILE_MONEY, CARD, BANK_TRANSFER), `status` (PENDING, SUCCEEDED, FAILED), `amount_minor`, `currency`, `provider_ref`, `error_code`, `created_by`, `completed_at` | `payment_attempts_one_live` (une tentative PENDING/SUCCEEDED par tranche), `payment_attempts_provider_ref` unique, `payment_attempts_tx` |
| `refunds` | `id`, `attempt_id`, `tx_id`, `tranche_id`, `idempotency_key` (unique), `amount_minor`, `currency`, `status` (PENDING, SUCCEEDED, FAILED), `provider_ref`, `reason` (≥ 3), `error_code`, `requested_by` | `refunds_attempt` |
| `webhook_events` | `id` identity, `provider`, `event_id`, `signature_valid`, `payload`, `received_at`, `processed_at`, `result` (APPLIED, IGNORED, REJECTED, INVALID_SIGNATURE), `error`, `attempt_id`, `refund_id` (sans clé étrangère) | unique (provider, event_id) |
| `ledger_accounts` | `code` PK, `kind` (ASSET, LIABILITY, REVENUE), `label_fr`, `label_en` ; 4 comptes : PARTNER_CASH, DUE_TO_PROVIDER, REFUNDS_PAYABLE, FEES | — |
| `ledger_journals` | `id`, `kind` (PAYMENT, RELEASE, REFUND_REQUESTED, REFUND_SETTLED, REFUND_REVERSED), `tx_id`, `tranche_id`, `attempt_id`, `refund_id`, `reverses_journal_id`, `event_id`, `memo` | `ledger_journals_tranche` |
| `ledger_entries` | `id` identity, `journal_id`, `account_code`, `currency`, `debit_minor`, `credit_minor` (exactement un des deux > 0) | `ledger_entries_journal` |

**Statut ultérieur** : toutes ces tables **survivent** ; 0021 change les statuts (`payment_attempts` : INITIATED, PENDING,
CONFIRMED, FAILED ; `refunds` : REQUESTED, EXECUTED, FAILED ; index `payment_attempts_one_live` supprimé) et ajoute des
colonnes (`contribution_id`, `quote_id`, `debit_currency`, `debit_amount_minor`, `fees_minor`, `refunds.executed_by`).

**Déclencheurs**

| Déclencheur | Table | Fonction | Effet |
|---|---|---|---|
| `webhook_events_guard` (before update/delete) | webhook_events | `_webhook_events_guard()` invoker | événement immuable, traité une seule fois (LEDGER_IMMUTABLE) |
| `ledger_entries_balanced`, `ledger_journals_balanced` (constraint, after insert, deferrable initially deferred) | ledger_entries, ledger_journals | `_ledger_check_balanced()` SD | ≥ 2 lignes et équilibre par devise à la fin de la transaction (LEDGER_UNBALANCED) |
| `ledger_journals_immutable`, `ledger_entries_immutable` (before update/delete) | ledger_* | `_ledger_immutable()` invoker | ajout seul ; correction = contrepassation (LEDGER_IMMUTABLE) |
| `ledger_on_release` (after insert) | release_events | `_ledger_on_release()` SD | journal RELEASE (DUE_TO_PROVIDER → PARTNER_CASH) |

**Fonctions**

| Fonction | SD | Rôle | Droits |
|---|---|---|---|
| `_post_journal(p_kind, p_tranche, p_currency, p_lines, p_attempt, p_refund, p_reverses, p_event, p_memo)` → uuid | SD | écrit un journal | interne ; redéfinie 0021 |
| `_refunded(p_attempt)` → bigint | SD | montant engagé en remboursement | interne |
| `_attempt_json(payment_attempts)` | invoker | sérialisation | interne |
| `start_payment(p_tranche uuid, p_idempotency_key text, p_method text default 'SIMULATED')` → jsonb | SD | payeur ; même clé = même tentative ; journal `PAYMENT_STARTED` | révoquée public, anon ; GRANT authenticated ; redéfinie 0014, 0018, 0021 |
| `_process_payment_event(p_event bigint)` → jsonb | SD | applique PAYMENT_PENDING/SUCCEEDED/FAILED, REFUND_SUCCEEDED/FAILED ; résultats APPLIED/IGNORED/REJECTED (UNKNOWN_ATTEMPT, STALE_EVENT, ALREADY_APPLIED, CONTRADICTS_FINAL_STATE, AMOUNT_MISMATCH, TRANCHE_NOT_AWAITING, UNKNOWN_REFUND, UNKNOWN_TYPE — codes de résultat stockés, pas des exceptions) | interne ; redéfinie 0014, 0021 |
| `apply_payment_event(p_provider text, p_event_id text, p_signature_valid boolean, p_payload jsonb)` → jsonb | SD | point d’entrée du partenaire ; doublon → DUPLICATE ; signature invalide enregistrée, jamais appliquée | **révoquée public, anon, authenticated ; GRANT service_role seulement** |
| `request_refund(p_tranche uuid, p_amount_minor bigint, p_idempotency_key text, p_reason text)` → jsonb | SD | admin non partie ; jamais au-delà du payé ; tranche RELEASED refusée | révoquée public, anon ; GRANT authenticated ; redéfinie 0014, 0021 |
| `demo_settle_payment(p_attempt uuid, p_outcome text default 'SUCCEEDED')`, `demo_settle_refund(p_refund uuid, p_outcome text default 'SUCCEEDED')` | SD | mock_mode ; passent par `apply_payment_event` | révoquées public, anon ; GRANT authenticated ; redéfinies 0021 |

**Vue** `v_reconciliation` (`security_invoker = true`, filtrée par `is_validator()`) : une ligne par tentative, colonne
`issues` (SUCCEEDED_WITHOUT_EVENT, SUCCEEDED_WITHOUT_LEDGER, LEDGER_WITHOUT_SUCCESS, LEDGER_AMOUNT_MISMATCH, TRANCHE_NOT_PAID,
PAID_WITHOUT_ATTEMPT, RELEASED_NOT_IN_LEDGER, CANCELLED_NOT_REFUNDED, REFUNDED_TRANCHE_OPEN, REFUND_EXCEEDS_PAID, EVENT_REJECTED).
REVOKE public, anon ; GRANT select authenticated. Supprimée en 0014 puis recréée en 0021.

**RLS** (activée sur les 6 tables) : `payment_attempts_read`, `refunds_read` (SELECT partie ou validateur) ;
`webhook_events_staff_read`, `ledger_accounts_read`, `ledger_journals_staff_read`, `ledger_entries_staff_read` (SELECT,
validateur). REVOKE all anon ; REVOKE insert/update/delete authenticated ; GRANT select authenticated.

**Codes d’erreur (hint)** : ADMIN_ONLY, AMOUNT_INVALID, DEMO_DISABLED, IDEMPOTENCY_CONFLICT, INVALID_OUTCOME, LEDGER_IMMUTABLE,
LEDGER_UNBALANCED, NOT_FOUND, NOT_PAYABLE, NOT_REFUNDABLE, PAYER_ONLY, PAYMENT_IN_PROGRESS, PAYMENT_NOT_FOUND, REASON_REQUIRED,
REFUND_EXCEEDS_PAID, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, VALIDATION, VALIDATOR_IS_PARTY.

---

## 0011 — `0011_lotx_x6.sql`

- Taille : 31 288 octets ; 2026-11-12, commit `a00c23f` (« lotX(X6): types de besoin configurables (0011)… »).
- Résumé : remplace les règles codées par verticale par une table de modules (`request_modules`) éditable par un
  administrateur, convertit `transactions.vertical` en texte référencé, garde des vues de compatibilité et introduit la
  revue plateforme configurable.
- Réversible : `supabase/rollbacks/0011_lotx_x6_down.sql` (fichier présent).

**Table `request_modules`** (survit après 0014 ; 0014 ajoute `settlement_mode`, `request_expiry_days`, met le défaut de
`platform_review` à `NEVER` et interdit IMMEDIATE ; 0022 ajoute `beneficiary_mode`, `retention_days`)

| Colonne | Règle |
|---|---|
| `code` | PK, `^[A-Z][A-Z0-9_]{1,39}$` |
| `label_fr`, `label_en` | ≥ 2 caractères |
| `description_fr`, `description_en` | facultatives |
| `enabled` | défaut false (remplace `open_verticals`) |
| `wave` | 1–9 |
| `release_mode` | enum `release_mode` |
| `contest_hours` | 0–720 |
| `dual_validation` | booléen |
| `platform_review` | ALWAYS (défaut ici), RISK_BASED, NEVER |
| `multiple_payers` | booléen, défaut false |
| `required_documents` | jsonb tableau `[{kind, required, maxFiles 1–10, labels{fr,en}}]` |
| `display_order`, `created_at`, `updated_at` | — |

Amorçage (6 lignes, miroir de `DEFAULT_MODULES` de `@diaspay/domain`) : EDUCATION, HEALTH, RENT (activés, vague 1,
PROVIDER_CONFIRM) ; AGRO (PAYER_CONFIRM), REAL_ESTATE, LAND (EVIDENCE_REVIEW, double validation) désactivés, vague 2 ;
tous `platform_review = ALWAYS`, `multiple_payers = false`. Un bloc `DO` arrête la migration si l’amorçage diffère de
`release_rules`, `required_documents` ou `open_verticals`.

**Conversion**

- `release_rules` → renommée `_release_rules_0003` ; `required_documents` → `_required_documents_0005` (REVOKE all anon,
  authenticated) ; remplacées par des **vues** du même nom (`security_invoker`) sur `request_modules` (GRANT select authenticated).
- `transactions.vertical` passe de l’enum `vertical` au **texte**, avec clé étrangère `transactions_vertical_module_fk` →
  `request_modules(code)`. Les vues `bo_dossiers`, `bo_evidence_queue`, `bo_disputes` sont supprimées puis recréées à
  l’identique depuis leur définition lue dans le catalogue.
- `app_config.open_verticals` conservé mais plus lu.

**Déclencheur** `request_modules_check` (before insert/update) → `_check_module_documents()` (invoker ; hint VALIDATION).

**Fonctions**

| Fonction | SD | Rôle | Droits |
|---|---|---|---|
| `_duplicate_refs(p_tx)` → text[] | SD | dossiers semblables (règle DUPLICATE) | interne |
| `_platform_review(p_tx)` → jsonb `{review, mode, reasons}` | SD | raisons ALWAYS, DUAL_VALIDATION, FIRST_REQUEST, DUPLICATE | interne ; relue en 0014, 0020, 0022 |
| `needs_platform_review(p_tx uuid)` → boolean | SD | partie, créateur ou personnel | révoquée public, anon ; GRANT authenticated |
| `transition_tx(p_tx, p_to, p_reason)` | SD | ouverture lue dans `request_modules.enabled` ; à la soumission, validation automatique (journal `AUTO_VALIDATED`) si aucune revue requise | révoquée public, anon ; GRANT authenticated |
| `save_draft(p_draft)` | SD | `vertical` = code de module | idem |
| `_documents_guard()` | SD | nombre maximal de fichiers lu dans le module (défaut 3) | interne |

**RLS** : `request_modules_read` (SELECT, authenticated, `true`) ; `request_modules_admin_write` (ALL, authenticated,
`is_admin()`). REVOKE all anon ; GRANT select, insert, update authenticated ; REVOKE delete authenticated.

**Codes d’erreur** : DOCUMENT_REQUIRED, FILE_TOO_LARGE, FILE_TYPE, HASH_INVALID, HASH_REQUIRED, INITIATION_NOT_ALLOWED,
NOT_EDITABLE, PHONE_INVALID, PLAN_EMPTY, PLAN_SUM_MISMATCH, SELF_PAYER, TOO_MANY_FILES, TRANSITION_FORBIDDEN,
TRANSITION_UNKNOWN, TX_NOT_FOUND, TX_NO_DOCUMENT, VALIDATION, VALIDATOR_IS_PARTY, VALIDATOR_ONLY, VERTICAL_UNAVAILABLE.

---

## 0012 — `0012_lotx_x7.sql`

- Taille : 3 182 octets ; 2026-11-12, commit `d2a3e36` (« lotX(X7): structure multi-payeurs (0012), sans interface… »).
- Résumé : prépare plusieurs payeurs par dossier (phase 2) sans changer le comportement observable.
- Réversible : `supabase/rollbacks/0012_lotx_x7_down.sql` (présent). Spécification citée : `docs/specs/multi-payers.md`.

**`transaction_parties`** (survit ; 0014 y ajoute la contrainte `transaction_parties_no_initiator_role`)

- + `id uuid` qui devient la clé primaire (`transaction_parties_pkey`) à la place de (tx_id, role).
- Unicités `transaction_parties_tx_user_role (tx_id, user_id, role)` et `transaction_parties_tx_phone_role (tx_id, invited_phone, role)`.
- Index unique partiel `transaction_parties_one_per_role (tx_id, role) where role <> 'PAYER'` (un seul demandeur, prestataire,
  système) ; index `transaction_parties_tx`.

**Déclencheur de contrainte** `transaction_parties_multiple_payers` (after insert or update of role, tx_id) →
`_check_multiple_payers()` SD : un second PAYER n’est admis que si `request_modules.multiple_payers` est vrai (faux partout).
Fonction interne (révoquée public, anon, authenticated).

**Code d’erreur** : MULTIPLE_PAYERS_NOT_ALLOWED.

---

## 0013 — `0013_lotx2_enums.sql`

- Taille : 2 038 octets ; 2026-11-12, commit `de85dfc` (« lotX(X2): refonte du noyau v2 (0013, 0014, correctifs 0017 à 0019)… »).
- Résumé : ajoute, dans un fichier séparé, les valeurs d’enum du modèle cible v2 (`docs/specs/modele-cible-v2.md`) utilisées
  par 0014 ; les anciennes valeurs ne peuvent pas être retirées et sont refusées par des contraintes dans 0014.

| Type | Valeurs ajoutées | Commentaire du fichier |
|---|---|---|
| `tx_status` | PENDING_REVIEW, ACTIVE, SUSPENDED | opération : DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED |
| `tranche_status` | DRAFT, SUBMITTED, ACCEPTED, PAID, REFUNDED | demande : DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED |
| `tx_role` | INITIATOR | rôle des tables de transitions seulement ; jamais dans `transaction_parties` (contrainte de 0014) |
| `settlement_mode` (nouveau type, créé s’il n’existe pas) | DIRECT, CONDITIONAL | K1 : DIRECT par défaut, CONDITIONAL (séquestre, phases 2 et 3) |

Valeurs déclarées obsolètes par le commentaire : SUBMITTED, VALIDATED, TOKEN_ISSUED, IN_PROGRESS, DISPUTED, PLANNED,
AWAITING_PAYMENT, PAID_LOCKED, CONFIRMED, RELEASED, EVIDENCE_SUBMITTED, IMMEDIATE.

Aucun code d’erreur.

---

## Constats transverses

1. **Objets du lot X v1 (0007–0012) encore présents après 0014** (vérifié par recherche dans 0014–0023) :
   - `security_events` et sa limitation : `_reference_guard()` (code **TOO_MANY_ATTEMPTS**) est encore appelée en 0014 et 0016 ;
     la table n’est plus mentionnée après 0008.
   - `request_messages` (relue par 0014), `request_info`, `answer_info`, `reject_request` (redéfinies en 0014).
   - `revoke_token` (jamais redéfinie ni supprimée après 0008), `reissue_token` (redéfinie 0014, 0018).
   - `mark_received` (non redéfinie ; citée en commentaire de 0016 « statuts v2 dans 0014 ») et `tranches.first_viewed_at` (relue 0014).
   - `documents.content_hash` / `hash_algo`, `_documents_immutable`, `require_content_hash` (relus 0014, 0020, 0022, 0023) ;
     `document_reuse` (non redéfinie) ; `get_document_access` (redéfinie en 0022).
   - Tables de paiement de 0010 : `payment_attempts`, `refunds`, `webhook_events`, `ledger_*` (modifiées en 0021) ;
     `apply_payment_event` (service_role seulement), `start_payment`, `request_refund`, `_process_payment_event` (redéfinies).
   - `request_modules` (étendue en 0014 et 0022), `needs_platform_review`, `_platform_review` (relue 0014, 0020, 0022).
   - `transaction_parties` avec clé `id` et déclencheur `_check_multiple_payers` (non retouchés après 0012).
   - Tables renommées `_release_rules_0003` et `_required_documents_0005` : aucune suppression trouvée dans 0012–0023.
2. **Objets du lot X v1 supprimés ou neutralisés** : `profiles.can_initiate_requests` (supprimée en 0020) ; `release_mode`
   IMMEDIATE interdit par contrainte en 0014 ; `eqr_image_enabled` passé de `true` à `false` en 0015 ; `v_reconciliation`
   supprimée en 0014 puis recréée en 0021 ; vues `bo_*` supprimées et recréées en 0014.
3. **pg_cron** : deux tâches créées en 0005 (`diaspay-release-due-tranches` toutes les 10 min, `diaspay-activate-due-tranches`
   à 6 h) ; aucune dans 0007–0013. Aucun `cron.unschedule` trouvé dans 0001–0023.
4. **Fonctions sans `REVOKE … FROM anon/public` explicite dans aucune migration (0001–0023)** — en PostgreSQL, une fonction
   est exécutable par `PUBLIC` par défaut ; aucune instruction `ALTER DEFAULT PRIVILEGES` ni `… ON ALL FUNCTIONS IN SCHEMA`
   n’a été trouvée dans les migrations. Le projet Supabase peut avoir ses propres privilèges par défaut : **à vérifier sur la base**.
   - Appelables en RPC (non déclencheurs) : `is_validator()`, `is_admin()`, `has_role(uuid, tx_role)`, `is_party(uuid)`,
     `status_ok(uuid)`, `required_validations(uuid, uuid)` (toutes SD), `verify_audit(uuid)` (invoker).
     Ces fonctions ne font que des tests sur `auth.uid()` ou renvoient un booléen / un entier ; elles sont utilisées par les
     politiques RLS, ce qui explique sans doute l’absence de REVOKE (non documenté dans le code).
   - Fonctions déclencheurs (non appelables directement) : `handle_new_user`, `audit_chain`, `audit_immutable`, `guard_status`,
     `guard_tranche_status`, `guard_profile`.
   - `resolve_reference` (0001) n’avait qu’un GRANT dans 0001 ; le REVOKE public, anon arrive en 0003.
5. **Codes d’erreur** : 0001–0004 n’ont aucun code stable (messages libres) ; le mécanisme `_err` → `hint` date de 0005.
