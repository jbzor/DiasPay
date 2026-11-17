# Annexe : base de données (état final après les migrations 0001 → 0023)

Document d’état des lieux, rédigé par lecture seule du dépôt (branche `lotX`, dernier commit `b31f68e`). Aucune connexion à Supabase, aucune exécution de script SQL. Toutes les affirmations renvoient à un fichier, un objet et un numéro de migration.

## 0. Méthode et limites

- **Source** : `supabase/migrations/0001_base_v0_1.sql` à `0023_lotx2_fixes4.sql`, appliquées dans l’ordre ; la dernière instruction gagne (`CREATE OR REPLACE`, `DROP`, `ALTER`, `GRANT`/`REVOKE`).
- **Outil** : un petit analyseur Node en lecture seule (hors dépôt) découpe chaque migration en instructions (en tenant compte des chaînes, commentaires et blocs `$tag$`), puis rejoue : création et suppression de fonctions (clé = nom + types des arguments d’entrée), droits `GRANT`/`REVOKE … ON FUNCTION` (y compris ceux exécutés par `execute '…'` dans des blocs `DO`), tables, colonnes et contraintes (`CREATE TABLE`, `ALTER TABLE`), politiques (`CREATE`/`DROP POLICY`), vues, déclencheurs, `storage.buckets`, `cron.schedule`, insertions dans `app_config`. Les fonctions créées par `execute $f$ … $f$` dans un bloc `DO` conditionnel (fonctions `demo_*`) sont prises en compte et signalées ⚑.
- **Corrections manuelles** apportées après relecture (l’analyseur ne les voit pas, car elles sont dans des blocs `DO`) : renommage de `release_rules` en `_release_rules_0003` et de `required_documents` en `_required_documents_0005` (0011, l. 119-126), contraintes ajoutées dans des blocs `DO` (0020 l. 25, 0022 l. 21, 24, 60), clés primaires remplacées (0008, 0012), contraintes `CHECK` en ligne remplacées par une contrainte du même nom.
- **Droits par défaut** : aucune migration ne contient `ALTER DEFAULT PRIVILEGES` ni `REVOKE … ON ALL FUNCTIONS` (recherche insensible à la casse sur les 23 fichiers : aucun résultat). Le dépôt documente lui-même le comportement de Supabase dans `supabase/tests/local-postgres-stubs.sql` (émulation locale) : `alter default privileges in schema public grant all on functions to anon, authenticated, service_role;` (idem pour tables et séquences). Conséquence : **toute fonction ou table créée dans `public` est exécutable/lisible par `anon`, `authenticated` et `service_role` tant qu’un `REVOKE` explicite visant ce rôle ne l’a pas retiré** ; un `REVOKE … FROM public` seul ne suffit pas. Dans les tableaux, « oui (défaut) » signifie « aucun `REVOKE` explicite trouvé ».
- **Codes d’erreur (hints)** : relevés dans le corps de la définition finale (`_err('CODE', …)`, `_err(case … then 'A' else 'B' end, …)`, `raise … hint = 'CODE'`). La colonne « via fonctions appelées » ajoute, de façon heuristique (nom de fonction suivi de `(` dans le corps, chaînes et commentaires retirés), les codes des fonctions `public` appelées, récursivement. Les codes levés par des **déclencheurs** des tables écrites ne sont pas propagés (ex. `_documents_guard`, `guard_profile`).
- Les numéros de migration sont abrégés (0014 = `0014_lotx2_core.sql`).

## 1. Synthèse chiffrée

| Objet | Nombre | Remarque |
|---|---|---|
| Tables `public` | **39** | dont 2 tables archivées (`_release_rules_0003`, `_required_documents_0005`) ; toutes ont la RLS activée |
| Vues | **7** | toutes `security_invoker = true` |
| Fonctions `public` (signatures distinctes) | **175** | 141 `SECURITY DEFINER`, 34 `SECURITY INVOKER` ; 25 fonctions de déclencheur ; 3 fonctions `demo_*` créées seulement si `mock_mode = 'true'` au moment de la migration |
| Fonctions DEFINER sans `set search_path` | **0** | toutes les DEFINER ont `set search_path = public` |
| Fonctions exécutables par `authenticated` (GRANT explicite) | 81 | 79 DEFINER, 2 INVOKER (`_storage_tx`, `_tx_ref`) |
| Fonctions internes (révoquées pour `anon` et `authenticated`) | 81 | 55 DEFINER, 26 INVOKER |
| Fonctions **sans aucune révocation pour `anon`** | **13** | 7 DEFINER, 6 INVOKER (détail en section 11) |
| Fonctions avec GRANT explicite à `service_role` | 2 | `apply_payment_event` (0010), `apply_kyc_result` (0020) |
| Politiques RLS | **56** | dont 7 sur `storage.objects` |
| Déclencheurs | **27** | dont 1 sur `auth.users` |
| Buckets | **2** | `dossiers`, `identity` |
| Tâches pg_cron | **3** | |
| Clés `app_config` insérées par les migrations | **15** | dont 4 seulement si `mock_mode` |
| Codes d’erreur distincts levés dans les corps | 98 | |
| Tests SQL | 7 scripts + 7 variantes éditeur | 785 vérifications statiques au total (hors variantes) |

## 2. Types, extensions, publication temps réel

**Types énumérés (valeurs finales, en accord avec `database.types.ts`)**

| Type | Créé | Valeurs ajoutées | Remarque |
|---|---|---|---|
| `tx_status` | 0001 | `IN_PROGRESS` (0002), `PENDING_REVIEW`, `ACTIVE`, `SUSPENDED` (0013) | les anciennes valeurs restent dans l’enum ; la contrainte `transactions_status_v2` (0014) limite à `DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED` |
| `vertical` | 0001 | `RENT, AGRO, REAL_ESTATE, LAND` (0002) | n’est plus utilisé par `transactions.vertical`, passé en `text` + clé étrangère vers `request_modules(code)` (0011) |
| `tx_role` | 0001 | `INITIATOR` (0013) | `INITIATOR` interdit dans `transaction_parties` (contrainte 0014) |
| `platform_role` | 0001 | — | `USER, VALIDATOR, ADMIN` |
| `currency` | 0001 | — | `EUR, USD, XAF` |
| `payment_status` | 0001 | — | table `payments` (lot 1) |
| `tranche_status` | 0003 | `INFO_REQUESTED, REJECTED` (0007), `DRAFT, SUBMITTED, ACCEPTED, PAID, REFUNDED` (0013) | contrainte `tranches_status_v2` (0014) : `DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED` |
| `release_mode` | 0003 | `IMMEDIATE` (0007) | `IMMEDIATE` interdit par `tranches_no_immediate` et `request_modules_no_immediate` (0014) |
| `recurrence_freq` | 0003 | — | |
| `settlement_mode` | 0013 | — | `DIRECT, CONDITIONAL` |

**Extensions** : `pgcrypto` (0001), `unaccent` dans le schéma `extensions` (0005), `pg_cron` dans `pg_catalog` (0005, avec `grant usage on schema cron to postgres`).

**Publication `supabase_realtime`** : `transactions`, `notifications` (0001), `tranches`, `disputes` (0003), `request_messages` (0008).

## 3. Tables

### 3.1 Vue d’ensemble

Clés primaires corrigées à la main : `transaction_parties` et `tranche_tokens` ont une clé `id` depuis 0012 et 0008 (l’ancienne clé est supprimée par `drop constraint … _pkey`). `release_rules` et `required_documents` sont devenues des **vues** (0011) ; les tables d’origine sont renommées et privées de tout droit pour `anon` et `authenticated` (0011 : `revoke all on _release_rules_0003, _required_documents_0005 from anon, authenticated`).

| Table | Créée | Dernière modif. de structure | RLS | Politiques | Clé primaire |
|---|---|---|---|---|---|
| profiles | 0001 | 0020 | oui | 2 | id |
| app_config | 0001 | — | oui | 1 | key |
| transactions | 0001 | 0022 | oui | 4 | id |
| transaction_parties | 0001 | 0014 | oui | 2 | id (0012) |
| documents | 0001 | 0009 | oui | 5 | id |
| validations | 0001 | 0006 | oui | 1 | id |
| trust_tokens | 0001 | 0004 | oui | 1 | tx_id |
| payments | 0001 | 0003 | oui | 1 | id |
| release_events | 0001 | 0008 | oui | 1 | id |
| notifications | 0001 | 0005 | oui | 2 | id |
| audit_log | 0001 | 0003 | oui | 1 | id |
| allowed_transitions | 0001 | — | oui | 0 | (from_status, to_status, role, validator_only) |
| _release_rules_0003 (ex release_rules) | 0003 | 0011 (renommée) | oui | 1 | vertical |
| dual_thresholds | 0003 | — | oui | 1 | currency |
| tranches | 0003 | 0014 | oui | 1 | id |
| recurrence_plans | 0003 | — | oui | 1 | tx_id |
| tranche_transitions | 0003 | — | oui | 0 | (from_status, to_status, role, validator_only) |
| signing_keys | 0003 | — | oui | 1 | kid |
| tranche_tokens | 0003 | 0008 | oui | 1 | id (0008) |
| disputes | 0003 | 0014 | oui | 1 | id |
| _required_documents_0005 (ex required_documents) | 0005 | 0011 (renommée) | oui | 1 | (vertical, kind) |
| providers | 0005 | — | oui | 2 | id |
| security_events | 0008 | — | oui | 1 | id |
| request_messages | 0008 | — | oui | 1 | id |
| payment_attempts | 0010 | 0021 | oui | 1 | id |
| refunds | 0010 | 0021 | oui | 1 | id |
| webhook_events | 0010 | — | oui | 1 | id |
| ledger_accounts | 0010 | — | oui | 1 | code |
| ledger_journals | 0010 | — | oui | 1 | id |
| ledger_entries | 0010 | — | oui | 1 | id |
| request_modules | 0011 | 0022 | oui | 2 | code |
| dispute_messages | 0014 | — | oui | 1 | id |
| presentation_tokens | 0016 | — | oui | 1 | id |
| enrolment_cases | 0020 | — | oui | 1 | id |
| enrolment_documents | 0020 | — | oui | 1 | id |
| enrolment_events | 0020 | — | oui | 1 | id |
| enrolment_limits | 0020 | — | oui | 2 | (level, currency) |
| fx_quotes | 0021 | — | oui | 1 | id |
| contributions | 0021 | — | oui | 1 | id |


### 3.2 Détail par table (colonnes finales, contraintes, migrations)

Légende : `_(+00NN)_` = colonne ou contrainte ajoutée par la migration 00NN ; `→ table` = clé étrangère ; « CHECK de colonne » = contrainte en ligne.

Corrections et compléments à lire avec le détail ci-dessous :
- **profiles** : contrainte `profiles_enrolment_level_check` (`N0`…`N3`) ajoutée en bloc `DO` (0020 l. 25) ; colonne `can_initiate_requests` (0008) supprimée en 0020.
- **transactions** : `vertical` est de type `text` depuis 0011 (référence `request_modules(code)`) ; contrainte `transactions_beneficiary_reference_check` (`^[A-Z0-9][A-Z0-9./-]{0,15}$`) ajoutée en bloc `DO` (0022 l. 60).
- **transaction_parties** : clé primaire finale `(id)` (0012) ; l’ancienne `(tx_id, role)` a disparu (même nom `transaction_parties_pkey`), remplacée par l’index unique partiel `transaction_parties_one_per_role (tx_id, role) where role <> 'PAYER'` (0012).
- **tranche_tokens** : clé primaire finale `(id)` (0008) ; un seul jeton actif par tranche (`tranche_tokens_one_active`, index unique partiel, 0008).
- **disputes** : la contrainte en ligne sur `status` a été remplacée par `disputes_status_check` (`OPEN, AWAITING_RESPONSE, IN_MEDIATION, RESOLVED`) et `disputes_outcome_check` (0014) ; index unique `one_open_dispute_per_tranche … where status <> 'RESOLVED'` (0014).
- **release_events** : la contrainte en ligne `trigger` a été remplacée par `release_events_trigger_check` (0003 puis 0008).
- **payment_attempts** / **refunds** : la contrainte en ligne sur `status` a été remplacée par `payment_attempts_status_check` (`INITIATED, PENDING, CONFIRMED, FAILED`) et `refunds_status_check` (`REQUESTED, EXECUTED, FAILED`) (0021) ; index uniques `payment_attempts_one_live` et `payment_attempts_contribution_live` (0021).
- **request_modules** : contraintes `request_modules_beneficiary_mode_check` (`NAME, REFERENCE_ONLY, NONE`) et `request_modules_retention_days_check` (1 à 36500) en bloc `DO` (0022 l. 21, 24).
- **release_rules** et **required_documents** ci-dessous = tables renommées `_release_rules_0003` et `_required_documents_0005` (contenu figé, plus lu).


#### profiles
- Créée : 0001 ; modifiée : 0004, 0008, 0020 ; RLS : activée (0001)
- Colonnes : `id` uuid → auth.users (cascade) **PK** ; `full_name` text ; `phone` text unique ; `country` text ; `locale` text ; `platform_role` platform_role ; `kyc_status` text ; `created_at` timestamptz ; `primary_role` text _(+0004)_ ; `push_enabled` boolean _(+0004)_ ; `enrolment_level` text _(+0020)_
- Contraintes de table : —
- CHECK de colonne sur : `locale`, `kyc_status`, `primary_role`
- Colonnes supprimées : can_initiate_requests@0020

#### app_config
- Créée : 0001 ; modifiée : — ; RLS : activée (0001)
- Colonnes : `key` text **PK** ; `value` text
- Contraintes de table : —
- CHECK de colonne sur : —

#### transactions
- Créée : 0001 ; modifiée : 0005, 0011, 0014, 0022 ; RLS : activée (0001)
- Colonnes : `id` uuid **PK** ; `vertical` vertical ; `purpose` text ; `amount_minor` bigint ; `currency` currency ; `status` tx_status ; `created_by` uuid → profiles ; `due_date` date ; `expires_at` timestamptz ; `reject_reason` text ; `created_at` timestamptz ; `updated_at` timestamptz ; `beneficiary_name` text _(+0005)_ ; `provider_id` uuid → providers (set null) _(+0005)_ ; `provider_name` text _(+0005)_ ; `plan_type` text _(+0005)_ ; `draft_data` jsonb _(+0005)_ ; `settlement_mode` settlement_mode _(+0014)_ ; `initiator_id` uuid → profiles _(+0014)_ ; `accepted_at` timestamptz _(+0014)_ ; `accepted_by` uuid → profiles _(+0014)_ ; `beneficiary_reference` text _(+0022)_
- Contraintes de table : `constraint tx_complete_unless_draft check (status = 'DRAFT' or (purpose is not null and amount_minor is not null and currency is not null))` _(+0005)_ ; `constraint transactions_vertical_module_fk foreign key (vertical) references request_modules(code)` _(+0011)_ ; `constraint transactions_status_v2 check (status in ('DRAFT','PENDING_REVIEW','IN_REVIEW','ACTIVE','SUSPENDED','CLOSED','CANCELLED'))` _(+0014)_
- CHECK de colonne sur : `purpose`, `amount_minor`, `plan_type`
- ALTER COLUMN : `purpose: drop not null [0005]` ; `amount_minor: drop not null [0005]` ; `currency: drop not null [0005]` ; `vertical: type text using vertical::text [0011]`

#### transaction_parties
- Créée : 0001 ; modifiée : 0012, 0014 ; RLS : activée (0001)
- Colonnes : `tx_id` uuid → transactions (cascade) ; `user_id` uuid → profiles ; `role` tx_role ; `invited_phone` text ; `id` uuid _(+0012)_
- Contraintes de table : ~~`primary key (tx_id, role)`~~ (supprimée en 0012, remplacée par la clé `id`) ; `check (user_id is not null or invited_phone is not null)` ; `constraint transaction_parties_pkey primary key (id)` _(+0012)_ ; `constraint transaction_parties_tx_user_role unique (tx_id, user_id, role)` _(+0012)_ ; `constraint transaction_parties_tx_phone_role unique (tx_id, invited_phone, role)` _(+0012)_ ; `constraint transaction_parties_no_initiator_role check (role <> 'INITIATOR')` _(+0014)_
- CHECK de colonne sur : —

#### documents
- Créée : 0001 ; modifiée : 0003, 0005, 0009 ; RLS : activée (0001)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `kind` text ; `storage_path` text ; `mime_type` text ; `size_bytes` int ; `uploaded_by` uuid → profiles ; `created_at` timestamptz ; `tranche_id` uuid → tranches (cascade) _(+0003)_ ; `file_name` text _(+0005)_ ; `deleted_at` timestamptz _(+0005)_ ; `content_hash` text _(+0009)_ ; `hash_algo` text _(+0009)_
- Contraintes de table : `constraint documents_content_hash_format check ( (content_hash is null and hash_algo is null) or (content_hash ~ '^[0-9a-f]{64}$' and hash_algo = 'SHA-256'))` _(+0009)_
- CHECK de colonne sur : `mime_type`, `size_bytes`

#### validations
- Créée : 0001 ; modifiée : 0003, 0006 ; RLS : activée (0001)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `validator_id` uuid → profiles ; `approved` boolean ; `reason` text ; `decided_at` timestamptz ; `tranche_id` uuid → tranches (cascade) _(+0003)_ ; `amount_checked` boolean _(+0006)_
- Contraintes de table : `check (approved or reason is not null)` ; `constraint validations_amount_checked check (tranche_id is not null or not approved or amount_checked) not valid` _(+0006)_
- CHECK de colonne sur : —

#### trust_tokens
- Créée : 0001 ; modifiée : 0004 ; RLS : activée (0001)
- Colonnes : `tx_id` uuid → transactions (cascade) **PK** ; `reference` text unique ; `signature` text ; `simulated` boolean ; `expires_at` timestamptz ; `used_at` timestamptz ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : —
- ALTER COLUMN : `reference: set default substr(replace(gen_random_uuid()::text,'-',''),1,18) [0004]`

#### payments
- Créée : 0001 ; modifiée : 0003 ; RLS : activée (0001)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `provider` text ; `external_id` text ; `status` payment_status ; `fee_minor` bigint ; `created_at` timestamptz ; `tranche_id` uuid → tranches (cascade) _(+0003)_
- Contraintes de table : —
- CHECK de colonne sur : —

#### release_events
- Créée : 0001 ; modifiée : 0003, 0008 ; RLS : activée (0001)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `trigger` text ; `created_at` timestamptz ; `tranche_id` uuid → tranches (cascade) _(+0003)_
- Contraintes de table : `constraint release_events_trigger_check check (trigger in ('PROVIDER_CONFIRMATION','AUTO_TIMEOUT','ADMIN','PAYER_APPROVAL','VALIDATOR_APPROVAL','DISPUTE_RESOLUTION','DIRE` _(+0008)_
- CHECK de colonne sur : `trigger`

#### notifications
- Créée : 0001 ; modifiée : 0005 ; RLS : activée (0001)
- Colonnes : `id` uuid **PK** ; `user_id` uuid → profiles (cascade) ; `tx_id` uuid → transactions (cascade) ; `event` text ; `read_at` timestamptz ; `created_at` timestamptz ; `payload` jsonb _(+0005)_
- Contraintes de table : —
- CHECK de colonne sur : —

#### audit_log
- Créée : 0001 ; modifiée : 0003 ; RLS : activée (0001)
- Colonnes : `id` bigint **PK** ; `tx_id` uuid → transactions ; `actor_id` uuid ; `event` text ; `from_status` tx_status ; `to_status` tx_status ; `payload` jsonb ; `prev_hash` text ; `hash` text ; `created_at` timestamptz ; `tranche_id` uuid _(+0003)_
- Contraintes de table : —
- CHECK de colonne sur : —

#### allowed_transitions
- Créée : 0001 ; modifiée : — ; RLS : activée (0001)
- Colonnes : `from_status` tx_status ; `to_status` tx_status ; `role` tx_role ; `validator_only` boolean
- Contraintes de table : `primary key (from_status, to_status, role, validator_only)`
- CHECK de colonne sur : —

#### _release_rules_0003 (ex `release_rules`, renommée en 0011)
- Créée : 0003 ; modifiée : — ; RLS : activée (0003)
- Colonnes : `vertical` text **PK** ; `release_mode` release_mode ; `contest_hours` int ; `dual_validation` boolean
- Contraintes de table : —
- CHECK de colonne sur : —

#### dual_thresholds
- Créée : 0003 ; modifiée : — ; RLS : activée (0003)
- Colonnes : `currency` currency **PK** ; `threshold_minor` bigint
- Contraintes de table : —
- CHECK de colonne sur : —

#### tranches
- Créée : 0003 ; modifiée : 0008, 0014 ; RLS : activée (0003)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `seq` int ; `label` text ; `amount_minor` bigint ; `due_date` date ; `status` tranche_status ; `release_mode` release_mode ; `contest_hours` int ; `contest_ends_at` timestamptz ; `released_at` timestamptz ; `created_at` timestamptz ; `updated_at` timestamptz ; `first_viewed_at` timestamptz _(+0008)_ ; `target_amount_minor` bigint _(+0014)_ ; `scheduled_for` date _(+0014)_ ; `currency` currency _(+0014)_ ; `expires_at` timestamptz _(+0014)_ ; `on_hold` boolean _(+0014)_ ; `refunded_minor` bigint _(+0014)_ ; `funds_state` text _(+0014)_ ; `paid_at` timestamptz _(+0014)_ ; `confirmed_at` timestamptz _(+0014)_ ; `evidence_submitted_at` timestamptz _(+0014)_
- Contraintes de table : `unique (tx_id, seq)` ; `constraint tranches_funds_state check (funds_state in ('NONE','HELD','RELEASED','RETURNED'))` _(+0014)_ ; `constraint tranches_status_v2 check (status in ('DRAFT','SUBMITTED','INFO_REQUESTED','ACCEPTED','PAID','REJECTED','CANCELLED','EXPIRED','REFUNDED'))` _(+0014)_ ; `constraint tranches_no_immediate check (release_mode <> 'IMMEDIATE')` _(+0014)_
- CHECK de colonne sur : `amount_minor`, `refunded_minor`
- ALTER COLUMN : `status: set default 'DRAFT' [0014]`

#### recurrence_plans
- Créée : 0003 ; modifiée : — ; RLS : activée (0003)
- Colonnes : `tx_id` uuid → transactions (cascade) **PK** ; `frequency` recurrence_freq ; `installments` int ; `start_date` date
- Contraintes de table : —
- CHECK de colonne sur : `installments`

#### tranche_transitions
- Créée : 0003 ; modifiée : — ; RLS : activée (0003)
- Colonnes : `from_status` tranche_status ; `to_status` tranche_status ; `role` tx_role ; `validator_only` boolean
- Contraintes de table : `primary key (from_status, to_status, role, validator_only)`
- CHECK de colonne sur : —

#### signing_keys
- Créée : 0003 ; modifiée : — ; RLS : activée (0003)
- Colonnes : `kid` text **PK** ; `public_key` text ; `active` boolean ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : —

#### tranche_tokens
- Créée : 0003 ; modifiée : 0004, 0008 ; RLS : activée (0003)
- Colonnes : `tranche_id` uuid → tranches (cascade) (ancienne PK, remplacée en 0008) ; `reference` text unique ; `kid` text → signing_keys ; `signature` text ; `simulated` boolean ; `expires_at` timestamptz ; `used_at` timestamptz ; `created_at` timestamptz ; `id` uuid _(+0008)_ ; `revoked_at` timestamptz _(+0008)_ ; `revoked_by` uuid → profiles _(+0008)_ ; `revoke_reason` text _(+0008)_
- Contraintes de table : `constraint tranche_tokens_pkey primary key (id)` _(+0008)_ ; `constraint tranche_tokens_revocation check (revoked_at is null or (revoke_reason is not null and length(trim(revoke_reason)) >= 3))` _(+0008)_
- CHECK de colonne sur : —
- ALTER COLUMN : `reference: set default substr(replace(gen_random_uuid()::text,'-',''),1,18) [0004]`

#### disputes
- Créée : 0003 ; modifiée : 0004, 0006, 0014 ; RLS : activée (0003)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `opened_by` uuid → profiles ; `reason` text ; `status` text ; `resolution_note` text ; `resolved_by` uuid → profiles ; `opened_at` timestamptz ; `resolved_at` timestamptz ; `reason_code` text _(+0004)_ ; `response` text _(+0006)_ ; `responded_by` uuid → profiles _(+0006)_ ; `responded_at` timestamptz _(+0006)_ ; `outcome` text _(+0014)_ ; `before_payment` boolean _(+0014)_ ; `refund_amount_minor` bigint _(+0014)_ ; `refund_id` uuid → refunds (set null) _(+0014)_
- Contraintes de table : `constraint disputes_status_check check (status in ('OPEN','AWAITING_RESPONSE','IN_MEDIATION','RESOLVED'))` _(+0014)_ ; `constraint disputes_outcome_check check ( (status = 'RESOLVED') = (outcome is not null) and (outcome is null or outcome in ('NO_ACTION','REFUND_FULL','REFUND_PARTIAL','FU` _(+0014)_
- CHECK de colonne sur : `reason`, `status`, `reason_code`

#### _required_documents_0005 (ex `required_documents`, renommée en 0011)
- Créée : 0005 ; modifiée : — ; RLS : activée (0005)
- Colonnes : `vertical` text ; `kind` text ; `required` boolean
- Contraintes de table : `primary key (vertical, kind)`
- CHECK de colonne sur : —

#### providers
- Créée : 0005 ; modifiée : — ; RLS : activée (0005)
- Colonnes : `id` uuid **PK** ; `name` text ; `city` text ; `verticals` text[] ; `verified` boolean ; `phone` text ; `user_id` uuid → profiles (set null) ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `name`

#### security_events
- Créée : 0008 ; modifiée : — ; RLS : activée (0008)
- Colonnes : `id` bigint **PK** ; `user_id` uuid → profiles (set null) ; `kind` text ; `detail` jsonb ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `kind`

#### request_messages
- Créée : 0008 ; modifiée : — ; RLS : activée (0008)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `author_id` uuid → profiles ; `kind` text ; `body` text ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `kind`, `body`

#### payment_attempts
- Créée : 0010 ; modifiée : 0021 ; RLS : activée (0010)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `idempotency_key` text unique ; `provider` text ; `method` text ; `status` text ; `amount_minor` bigint ; `currency` currency ; `provider_ref` text ; `error_code` text ; `created_by` uuid → profiles ; `created_at` timestamptz ; `updated_at` timestamptz ; `completed_at` timestamptz ; `contribution_id` uuid → contributions (cascade) _(+0021)_ ; `quote_id` uuid → fx_quotes _(+0021)_ ; `debit_currency` currency _(+0021)_ ; `debit_amount_minor` bigint _(+0021)_ ; `fees_minor` bigint _(+0021)_
- Contraintes de table : `constraint payment_attempts_status_check check (status in ('INITIATED','PENDING','CONFIRMED','FAILED'))` _(+0021)_
- CHECK de colonne sur : `idempotency_key`, `method`, `status`, `amount_minor`, `fees_minor`
- ALTER COLUMN : `status: set default 'INITIATED' [0021]`

#### refunds
- Créée : 0010 ; modifiée : 0021 ; RLS : activée (0010)
- Colonnes : `id` uuid **PK** ; `attempt_id` uuid → payment_attempts (cascade) ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `idempotency_key` text unique ; `amount_minor` bigint ; `currency` currency ; `status` text ; `provider_ref` text ; `reason` text ; `error_code` text ; `requested_by` uuid → profiles ; `created_at` timestamptz ; `completed_at` timestamptz ; `executed_by` uuid → profiles _(+0021)_
- Contraintes de table : `constraint refunds_status_check check (status in ('REQUESTED','EXECUTED','FAILED'))` _(+0021)_
- CHECK de colonne sur : `idempotency_key`, `amount_minor`, `status`, `reason`
- ALTER COLUMN : `status: set default 'REQUESTED' [0021]`

#### webhook_events
- Créée : 0010 ; modifiée : — ; RLS : activée (0010)
- Colonnes : `id` bigint **PK** ; `provider` text ; `event_id` text ; `signature_valid` boolean ; `payload` jsonb ; `received_at` timestamptz ; `processed_at` timestamptz ; `result` text ; `error` text ; `attempt_id` uuid ; `refund_id` uuid
- Contraintes de table : `unique (provider, event_id)`
- CHECK de colonne sur : `result`

#### ledger_accounts
- Créée : 0010 ; modifiée : — ; RLS : activée (0010)
- Colonnes : `code` text **PK** ; `kind` text ; `label_fr` text ; `label_en` text
- Contraintes de table : —
- CHECK de colonne sur : `kind`

#### ledger_journals
- Créée : 0010 ; modifiée : — ; RLS : activée (0010)
- Colonnes : `id` uuid **PK** ; `kind` text ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `attempt_id` uuid → payment_attempts (cascade) ; `refund_id` uuid → refunds (cascade) ; `reverses_journal_id` uuid → ledger_journals (cascade) ; `event_id` bigint ; `memo` text ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `kind`

#### ledger_entries
- Créée : 0010 ; modifiée : — ; RLS : activée (0010)
- Colonnes : `id` bigint **PK** ; `journal_id` uuid → ledger_journals (cascade) ; `account_code` text → ledger_accounts ; `currency` currency ; `debit_minor` bigint ; `credit_minor` bigint ; `created_at` timestamptz
- Contraintes de table : `check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0))`
- CHECK de colonne sur : `debit_minor`, `credit_minor`

#### request_modules
- Créée : 0011 ; modifiée : 0014, 0022 ; RLS : activée (0011)
- Colonnes : `code` text **PK** ; `label_fr` text ; `label_en` text ; `description_fr` text ; `description_en` text ; `enabled` boolean ; `wave` int ; `release_mode` release_mode ; `contest_hours` int ; `dual_validation` boolean ; `platform_review` text ; `multiple_payers` boolean ; `required_documents` jsonb ; `display_order` int ; `created_at` timestamptz ; `updated_at` timestamptz ; `settlement_mode` settlement_mode _(+0014)_ ; `request_expiry_days` int _(+0014)_ ; `beneficiary_mode` text _(+0022)_ ; `retention_days` int _(+0022)_
- Contraintes de table : `constraint request_modules_no_immediate check (release_mode <> 'IMMEDIATE')` _(+0014)_
- CHECK de colonne sur : `code`, `label_fr`, `label_en`, `wave`, `contest_hours`, `platform_review`, `required_documents`, `request_expiry_days`
- ALTER COLUMN : `platform_review: set default 'NEVER' [0014]`

#### dispute_messages
- Créée : 0014 ; modifiée : — ; RLS : activée (0014)
- Colonnes : `id` uuid **PK** ; `dispute_id` uuid → disputes (cascade) ; `tx_id` uuid → transactions (cascade) ; `author_id` uuid → profiles ; `kind` text ; `body` text ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `kind`, `body`

#### presentation_tokens
- Créée : 0016 ; modifiée : — ; RLS : activée (0016)
- Colonnes : `id` uuid **PK** ; `tranche_id` uuid → tranches (cascade) ; `token_hash` text unique ; `expires_at` timestamptz ; `claimed_at` timestamptz ; `claimed_by` uuid → profiles ; `revoked_at` timestamptz ; `created_by` uuid → profiles ; `created_at` timestamptz
- Contraintes de table : `check ((claimed_at is null) = (claimed_by is null))`
- CHECK de colonne sur : `token_hash`

#### enrolment_cases
- Créée : 0020 ; modifiée : — ; RLS : activée (0020)
- Colonnes : `id` uuid **PK** ; `profile_id` uuid → profiles (cascade) ; `requested_level` text ; `status` text ; `route` text ; `kyc_provider` text ; `kyc_reference` text ; `kyc_result` text ; `data` jsonb ; `reviewer_id` uuid → profiles ; `rejection_reason` text ; `submitted_at` timestamptz ; `reviewed_at` timestamptz
- Contraintes de table : `check (status <> 'REJECTED' or length(trim(coalesce(rejection_reason, ''))) >= 3)`
- CHECK de colonne sur : `requested_level`, `status`, `route`, `kyc_result`, `data`

#### enrolment_documents
- Créée : 0020 ; modifiée : — ; RLS : activée (0020)
- Colonnes : `id` uuid **PK** ; `case_id` uuid → enrolment_cases (cascade) ; `profile_id` uuid → profiles (cascade) ; `kind` text ; `storage_path` text unique ; `content_hash` text ; `mime_type` text ; `size_bytes` int ; `uploaded_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `kind`, `content_hash`, `size_bytes`

#### enrolment_events
- Créée : 0020 ; modifiée : — ; RLS : activée (0020)
- Colonnes : `id` bigint **PK** ; `profile_id` uuid → profiles (cascade) ; `case_id` uuid → enrolment_cases (cascade) ; `actor_id` uuid → profiles ; `event` text ; `payload` jsonb ; `created_at` timestamptz
- Contraintes de table : —
- CHECK de colonne sur : `event`

#### enrolment_limits
- Créée : 0020 ; modifiée : — ; RLS : activée (0020)
- Colonnes : `level` text ; `currency` currency ; `per_operation_minor` bigint ; `per_day_minor` bigint ; `per_month_minor` bigint ; `dev_only` boolean ; `updated_at` timestamptz ; `updated_by` uuid → profiles
- Contraintes de table : `primary key (level, currency)`
- CHECK de colonne sur : `level`, `per_operation_minor`, `per_day_minor`, `per_month_minor`

#### fx_quotes
- Créée : 0021 ; modifiée : — ; RLS : activée (0021)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `payer_id` uuid → profiles ; `request_currency` currency ; `request_amount_minor` bigint ; `debit_currency` currency ; `rate` numeric ; `source` text ; `simulated` boolean ; `method` text ; `debit_amount_minor` bigint ; `fee_service_minor` bigint ; `fee_fx_minor` bigint ; `fee_method_minor` bigint ; `total_debit_minor` bigint ; `quoted_at` timestamptz ; `expires_at` timestamptz ; `used_at` timestamptz ; `attempt_id` uuid → payment_attempts (set null)
- Contraintes de table : `check (total_debit_minor = debit_amount_minor + fee_service_minor + fee_fx_minor + fee_method_minor)` ; `check (expires_at > quoted_at)`
- CHECK de colonne sur : `request_amount_minor`, `rate`, `method`, `debit_amount_minor`, `fee_service_minor`, `fee_fx_minor`, `fee_method_minor`

#### contributions
- Créée : 0021 ; modifiée : — ; RLS : activée (0021)
- Colonnes : `id` uuid **PK** ; `tx_id` uuid → transactions (cascade) ; `tranche_id` uuid → tranches (cascade) ; `payer_id` uuid → profiles ; `invited_phone` text ; `amount_minor` bigint ; `currency` currency ; `status` text ; `created_at` timestamptz ; `confirmed_at` timestamptz
- Contraintes de table : `check (payer_id is not null or invited_phone is not null)`
- CHECK de colonne sur : `amount_minor`, `status`


## 4. Vues

| Vue | Définition finale | Contenu | Droits |
|---|---|---|---|
| `release_rules` | 0011 | `request_modules` : `code as vertical, release_mode, contest_hours, dual_validation` | `revoke all … from anon` ; `select` à `authenticated` (0011) |
| `required_documents` | 0011 | pièces de `request_modules.required_documents` (jsonb) : `vertical, kind, required` | idem |
| `payment_requests` | 0014 | vocabulaire du modèle cible sur `tranches` (lecture seule) | `revoke all … from anon, public` ; `select` à `authenticated` (0014) |
| `v_reconciliation` | 0021 (`create or replace`, recréée en 0014) | rapprochement tentatives / événements / journal | `revoke all … from public, anon` ; `select` à `authenticated` (0014) |
| `bo_dossiers` | 0014 | file du bureau (statuts `PENDING_REVIEW`, `IN_REVIEW`), filtrée par `is_validator()` | `revoke … from public, anon` ; `select` à `authenticated` (0014) |
| `bo_evidence_queue` | 0014 | preuves de jalon en attente (`PAID`, fonds `HELD`, preuve déposée), filtrée par `is_validator()` | idem |
| `bo_disputes` | 0014 | litiges pour le bureau | idem |

## 5. Déclencheurs (état final)

| Table | Déclencheur | Moment | Fonction | Migration |
|---|---|---|---|---|
| audit_log | audit_chain_trg | before insert | `audit_chain()` | 0001 |
| audit_log | audit_no_update | before update or delete | `audit_immutable()` | 0001 |
| audit_log | notify_from_audit_trg | after insert | `_notify_from_audit()` | 0005 |
| auth.users | on_auth_user_created | after insert | `handle_new_user()` | 0001 |
| dispute_messages | dispute_messages_immutable | before update or delete | `_dispute_messages_immutable()` | 0014 |
| documents | documents_guard_trg | before insert | `_documents_guard()` | 0005 |
| documents | documents_immutable_trg | before update or delete | `_documents_immutable()` | 0009 |
| enrolment_events | enrolment_events_immutable | before update or delete | `_enrolment_events_immutable()` | 0020 |
| fx_quotes | fx_quotes_frozen | before update or delete | `_fx_quotes_frozen()` | 0021 |
| ledger_entries | ledger_entries_balanced | after insert | `_ledger_check_balanced()` | 0010 |
| ledger_entries | ledger_entries_immutable | before update or delete | `_ledger_immutable()` | 0010 |
| ledger_journals | ledger_journals_balanced | after insert | `_ledger_check_balanced()` | 0010 |
| ledger_journals | ledger_journals_immutable | before update or delete | `_ledger_immutable()` | 0010 |
| profiles | guard_profile_trg | before update | `guard_profile()` | 0004 |
| profiles | attach_invitations_trg | after insert | `_attach_invitations()` | 0005 |
| profiles | profile_insert_level_trg | before insert | `_profile_insert_level()` | 0020 |
| release_events | ledger_on_release | after insert | `_ledger_on_release()` | 0010 |
| request_messages | request_messages_immutable | before update or delete | `_request_messages_immutable()` | 0008 |
| request_modules | request_modules_check | before insert or update | `_check_module_documents()` | 0011 |
| security_events | security_events_immutable | before update or delete | `_security_events_immutable()` | 0008 |
| tranches | guard_tranche_status_trg | before update | `guard_tranche_status()` | 0003 |
| tranches | tranches_defaults | before insert or update of tx_id, amount_minor | `_tranches_defaults()` | 0014 |
| transaction_parties | transaction_parties_multiple_payers | after insert or update of role, tx_id | `_check_multiple_payers()` | 0012 |
| transactions | guard_status_trg | before update | `guard_status()` | 0001 |
| transactions | transactions_defaults | before insert | `_transactions_defaults()` | 0014 |
| transactions | transactions_draft_settlement | before insert or update of vertical | `_draft_settlement()` | 0014 |
| webhook_events | webhook_events_guard | before update or delete | `_webhook_events_guard()` | 0010 |


## 6. Fonctions SQL (définition finale)

Lecture : « DEFINER » = `SECURITY DEFINER` ; « anon / authenticated » : `non (00NN)` = révoqué explicitement par la migration indiquée (dernière instruction de droits), `**oui** (00NN)` = `GRANT EXECUTE` explicite, `**oui (défaut)**` = aucun `REVOKE` visant ce rôle (droit hérité des privilèges par défaut, voir section 0). `service_role` n’est révoqué nulle part : « oui (défaut) » partout, sauf deux GRANT explicites. ⚑ = créée seulement si `app_config.mock_mode = 'true'` au moment de la migration (0005, 0006, 0014). « (n déf.) » = nombre de définitions successives.

Les codes renvoyés par les fonctions passent par l’assistant `_err(p_code, p_message, p_detail)` (0005), qui fait `raise exception using errcode = 'P0001', message = p_message, hint = p_code` : c’est le champ `hint` que lisent l’application et les tests (`t.hint`).

| # | Fonction (signature d’identité) | Retour | DEFINER | search_path | anon | authenticated | service_role | Codes (hint) levés dans le corps | Codes via fonctions appelées | Créée → déf. finale |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `_activate_operation(uuid,uuid,text,jsonb)` | transactions | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 2 | `_apply_kyc(uuid,text,text,text,text)` | enrolment_cases | oui | public | non (0020) | non (0020) | oui (défaut) | NOT_FOUND, INVALID_OUTCOME | — | 0020 → 0020 |
| 3 | `_approve_enrolment(uuid,uuid,text)` | enrolment_cases | oui | public | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 4 | `_attach_invitations()` | trigger | oui | public | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 5 | `_attempt_json(payment_attempts)` | jsonb | non | — | non (0021) | non (0021) | oui (défaut) | — | — | 0010 → 0021 (2 déf.) |
| 6 | `_check_initiator_level(uuid)` | void | oui | public | non (0020) | non (0020) | oui (défaut) | — | ENROLMENT_REQUIRED | 0020 → 0020 |
| 7 | `_check_message(text)` | text | non | — | non (0008) | non (0008) | oui (défaut) | REASON_REQUIRED, VALIDATION | — | 0008 → 0008 |
| 8 | `_check_module_documents()` | trigger | non | — | non (0022) | non (0022) | oui (défaut) | VALIDATION | — | 0011 → 0022 (2 déf.) |
| 9 | `_check_multiple_payers()` | trigger | oui | public | non (0012) | non (0012) | oui (défaut) | MULTIPLE_PAYERS_NOT_ALLOWED | — | 0012 → 0012 |
| 10 | `_check_payer_limits(uuid,currency,bigint)` | void | oui | public | non (0020) | non (0020) | oui (défaut) | LIMITS_NOT_CONFIGURED, LIMIT_EXCEEDED | — | 0020 → 0020 |
| 11 | `_check_token_manager(uuid)` | tranches | oui | public | non (0014) | non (0014) | oui (défaut) | TRANCHE_NOT_FOUND, INITIATOR_ONLY, NOT_REVOCABLE | NOT_AUTHENTICATED | 0008 → 0014 (2 déf.) |
| 12 | `_close_operation_if_done(uuid,uuid)` | void | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 13 | `_conditional_tranche(uuid)` | tranches | oui | public | non (0014) | non (0014) | oui (défaut) | WRONG_MODE, NOT_PAID, DISPUTE_OPEN | NOT_AUTHENTICATED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE | 0014 → 0014 |
| 14 | `_confirm_service(tranches,uuid,text,jsonb)` | tranches | oui | public | non (0014) | non (0014) | oui (défaut) | ALREADY_CONFIRMED | — | 0014 → 0014 |
| 15 | `_create_refund(uuid,bigint,text,text,uuid)` | refunds | oui | public | non (0021) | non (0021) | oui (défaut) | NOT_REFUNDABLE, AMOUNT_INVALID, REFUND_EXCEEDS_PAID | — | 0014 → 0021 (2 déf.) |
| 16 | `_currency_decimals(currency)` | int | non | — | non (0021) | non (0021) | oui (défaut) | — | — | 0021 → 0021 |
| 17 | `_dispute_messages_immutable()` | trigger | non | — | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 18 | `_dispute_notified_at(uuid)` | timestamptz | oui | public | non (0006) | **oui** (0006) | oui (défaut) | — | — | 0006 → 0006 |
| 19 | `_doc_sensitive(documents)` | boolean | oui | public | non (0022) | non (0022) | oui (défaut) | — | — | 0022 → 0022 |
| 20 | `_doc_view_payload(documents)` | jsonb | oui | public | non (0022) | non (0022) | oui (défaut) | — | — | 0022 → 0022 |
| 21 | `_documents_guard()` | trigger | oui | public | non (0011) | non (0011) | oui (défaut) | FILE_TYPE, FILE_TOO_LARGE, VALIDATION, DOCUMENT_KIND_NOT_ALLOWED, TOO_MANY_FILES, HASH_INVALID, HASH_REQUIRED | — | 0005 → 0023 (5 déf.) |
| 22 | `_documents_immutable()` | trigger | oui | public | non (0014) | non (0014) | oui (défaut) | HASH_IMMUTABLE, DOCUMENT_LOCKED | — | 0009 → 0014 (2 déf.) |
| 23 | `_draft_json(uuid)` | jsonb | oui | public | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 24 | `_draft_settlement()` | trigger | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 25 | `_duplicate_refs(uuid)` | text[] | oui | public | non (0011) | non (0011) | oui (défaut) | — | — | 0011 → 0011 |
| 26 | `_enrolment_events_immutable()` | trigger | non | — | non (0020) | non (0020) | oui (défaut) | AUDIT_IMMUTABLE | — | 0020 → 0020 |
| 27 | `_enrolment_json(enrolment_cases)` | jsonb | non | — | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 28 | `_enrolment_required_kinds(text)` | text[] | non | — | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 29 | `_err(text,text,text)` | void | non | — | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 30 | `_evidence_round_start(uuid)` | timestamptz | oui | public | non (0006) | **oui** (0014) | oui (défaut) | — | — | 0006 → 0014 (2 déf.) |
| 31 | `_fold(text)` | text | non | — | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 32 | `_fx_quotes_frozen()` | trigger | non | — | non (0021) | non (0021) | oui (défaut) | QUOTE_FROZEN | — | 0021 → 0021 |
| 33 | `_hash_reuse(text,uuid)` | uuid[] | oui | public | non (0009) | non (0009) | oui (défaut) | — | — | 0009 → 0009 |
| 34 | `_identity_recently_opened(text)` | boolean | oui | public | non (0020) | **oui** (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 35 | `_is_initiator(uuid)` | boolean | oui | public | non (0014) | **oui** (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 36 | `_issue_tranche_token(uuid)` | void | oui | public | non (0008) | non (0008) | oui (défaut) | — | — | 0003 → 0008 (3 déf.) |
| 37 | `_ledger_check_balanced()` | trigger | oui | public | non (0010) | non (0010) | oui (défaut) | LEDGER_UNBALANCED | — | 0010 → 0010 |
| 38 | `_ledger_immutable()` | trigger | non | — | non (0010) | non (0010) | oui (défaut) | LEDGER_IMMUTABLE | — | 0010 → 0010 |
| 39 | `_ledger_on_release()` | trigger | oui | public | non (0010) | non (0010) | oui (défaut) | — | — | 0010 → 0021 (2 déf.) |
| 40 | `_level_rank(text)` | int | non | — | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 41 | `_mock_mode()` | boolean | oui | public | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 42 | `_norm_hash(text)` | text | non | — | non (0009) | non (0009) | oui (défaut) | — | — | 0009 → 0009 |
| 43 | `_norm_phone(text)` | text | non | — | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 44 | `_notify_from_audit()` | trigger | oui | public | non (0017) | non (0017) | oui (défaut) | — | — | 0005 → 0017 (4 déf.) |
| 45 | `_party_name(uuid,tx_role)` | text | oui | public | non (0006) | **oui** (0006) | oui (défaut) | — | — | 0006 → 0006 |
| 46 | `_party_token(text)` | tranche_tokens | oui | public | non (0015) | non (0015) | oui (défaut) | — | — | 0008 → 0015 (2 déf.) |
| 47 | `_platform_review(uuid)` | jsonb | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0011 → 0014 (2 déf.) |
| 48 | `_post_journal(text,uuid,currency,jsonb,uuid,uuid,uuid,bigint,text)` | uuid | oui | public | non (0021) | non (0021) | oui (défaut) | — | — | 0010 → 0021 (2 déf.) |
| 49 | `_process_payment_event(bigint)` | jsonb | oui | public | non (0021) | non (0021) | oui (défaut) | — | — | 0010 → 0021 (3 déf.) |
| 50 | `_profile_insert_level()` | trigger | non | — | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 51 | `_quote_fees(bigint,text,boolean)` | jsonb | oui | public | non (0021) | non (0021) | oui (défaut) | — | — | 0021 → 0021 |
| 52 | `_quote_json(fx_quotes)` | jsonb | non | — | non (0021) | non (0021) | oui (défaut) | — | — | 0021 → 0021 |
| 53 | `_recently_opened(text)` | boolean | oui | public | non (0006) | **oui** (0006) | oui (défaut) | — | — | 0006 → 0022 (2 déf.) |
| 54 | `_reference_failed(text,text)` | void | oui | public | non (0008) | non (0008) | oui (défaut) | — | — | 0008 → 0008 |
| 55 | `_reference_failures()` | int | oui | public | non (0008) | non (0008) | oui (défaut) | — | — | 0008 → 0008 |
| 56 | `_reference_guard()` | void | oui | public | non (0008) | non (0008) | oui (défaut) | TOO_MANY_ATTEMPTS | — | 0008 → 0008 |
| 57 | `_refund_executed(uuid,text,bigint,uuid)` | refunds | oui | public | non (0021) | non (0021) | oui (défaut) | — | — | 0021 → 0021 |
| 58 | `_refunded(uuid)` | bigint | oui | public | non (0021) | non (0021) | oui (défaut) | — | — | 0010 → 0021 (2 déf.) |
| 59 | `_reject_enrolment(uuid,uuid,text,text)` | enrolment_cases | oui | public | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 60 | `_request_final(tranches)` | boolean | non | — | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 61 | `_request_messages_immutable()` | trigger | non | — | non (0008) | non (0008) | oui (défaut) | — | — | 0008 → 0008 |
| 62 | `_request_tranche(uuid)` | tranches | oui | public | non (0018) | non (0018) | oui (défaut) | TRANCHE_NOT_FOUND, REQUEST_ON_HOLD, TX_NOT_ACTIVE | NOT_AUTHENTICATED | 0008 → 0018 (3 déf.) |
| 63 | `_require_enrolment(profiles,text)` | void | oui | public | non (0020) | non (0020) | oui (défaut) | ENROLMENT_REQUIRED | — | 0020 → 0020 |
| 64 | `_require_user()` | uuid | non | — | non (0005) | non (0005) | oui (défaut) | NOT_AUTHENTICATED | — | 0005 → 0005 |
| 65 | `_require_validator()` | uuid | oui | public | non (0006) | non (0006) | oui (défaut) | VALIDATOR_ONLY | NOT_AUTHENTICATED | 0006 → 0006 |
| 66 | `_required_level(text)` | text | non | — | non (0020) | non (0020) | oui (défaut) | — | — | 0020 → 0020 |
| 67 | `_resolve_dispute_core(uuid,text,text,uuid)` | disputes | oui | public | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 68 | `_resolve_dispute_v2(uuid,text,text,uuid,bigint)` | disputes | oui | public | non (0019) | non (0019) | oui (défaut) | INVALID_OUTCOME, REFUND_EXCEEDS_PAID, AMOUNT_INVALID | NOT_REFUNDABLE | 0014 → 0021 (3 déf.) |
| 69 | `_revoke_active_token(uuid,text,uuid)` | uuid | oui | public | non (0008) | non (0008) | oui (défaut) | — | — | 0008 → 0008 |
| 70 | `_round_start(uuid)` | timestamptz | oui | public | non (0006) | **oui** (0014) | oui (défaut) | — | — | 0006 → 0014 (2 déf.) |
| 71 | `_security_events_immutable()` | trigger | non | — | non (0008) | non (0008) | oui (défaut) | — | — | 0008 → 0008 |
| 72 | `_set_funds_state(uuid,text,uuid,text,jsonb)` | tranches | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 73 | `_set_tranche_status(uuid,tranche_status,uuid,text,jsonb)` | tranches | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0003 → 0014 (3 déf.) |
| 74 | `_set_tx_status(uuid,tx_status,uuid,text,jsonb)` | transactions | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 75 | `_simulate_token_issue(uuid)` | void | oui | public | non (0006) | non (0006) | oui (défaut) | — | — | 0006 → 0006 |
| 76 | `_staff_aal_ok()` | boolean | oui | public | non (0006) | non (0006) | oui (défaut) | — | — | 0006 → 0006 |
| 77 | `_staff_name(uuid)` | text | oui | public | non (0006) | **oui** (0006) | oui (défaut) | — | — | 0006 → 0006 |
| 78 | `_storage_tx(text)` | uuid | non | — | non (0005) | **oui** (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 79 | `_submit_request(uuid,uuid)` | tranches | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 80 | `_token_hash(text)` | text | non | — | non (0016) | non (0016) | oui (défaut) | — | — | 0016 → 0016 |
| 81 | `_tranches_defaults()` | trigger | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 82 | `_transactions_defaults()` | trigger | non | — | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 83 | `_tx_ref(uuid)` | text | non | — | non (0006) | **oui** (0006) | oui (défaut) | — | — | 0006 → 0006 |
| 84 | `_user_by_phone(text)` | uuid | oui | public | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 85 | `_valid_phone(text)` | boolean | non | — | non (0005) | non (0005) | oui (défaut) | — | — | 0005 → 0005 |
| 86 | `_webhook_events_guard()` | trigger | non | — | non (0010) | non (0010) | oui (défaut) | LEDGER_IMMUTABLE | — | 0010 → 0010 |
| 87 | `accept_and_pay(uuid,text,uuid)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | VALIDATION, IDEMPOTENCY_CONFLICT, TRANCHE_NOT_FOUND, PAYER_ONLY, REQUEST_ON_HOLD, TX_NOT_ACTIVE, PAYMENT_IN_PROGRESS, NOT_PAYABLE, QUOTE_INVALID, QUOTE_USED, QUOTE_EXPIRED | LIMITS_NOT_CONFIGURED, LIMIT_EXCEEDED, NOT_AUTHENTICATED | 0021 → 0021 |
| 88 | `accept_plan(uuid)` | transactions | oui | public | non (0016) | **oui** (0016) | oui (défaut) | TX_NOT_FOUND, PAYER_ONLY, TX_NOT_ACTIVE | NOT_AUTHENTICATED | 0016 → 0016 |
| 89 | `activate_due_tranches()` | int | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0003 → 0014 (2 déf.) |
| 90 | `add_dispute_message(uuid,text)` | disputes | oui | public | non (0014) | **oui** (0014) | oui (défaut) | NO_OPEN_DISPUTE | NOT_AUTHENTICATED, REASON_REQUIRED, VALIDATION | 0014 → 0014 |
| 91 | `add_document(uuid,text,text,text,text,integer,text)` | jsonb | oui | public | non (0009) | **oui** (0009) | oui (défaut) | TX_NOT_FOUND, TRANSITION_FORBIDDEN, NOT_EDITABLE | NOT_AUTHENTICATED | 0009 → 0009 |
| 92 | `answer_info(uuid,text)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | INITIATOR_ONLY, TRANSITION_UNKNOWN | NOT_AUTHENTICATED, REASON_REQUIRED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, VALIDATION | 0008 → 0014 (2 déf.) |
| 93 | `apply_kyc_result(uuid,text,text,text,text)` | jsonb | oui | public | non (0020) | non (0020) | **oui** (0020) | — | INVALID_OUTCOME, NOT_FOUND | 0020 → 0020 |
| 94 | `apply_payment_event(text,text,boolean,jsonb)` | jsonb | oui | public | non (0010) | non (0010) | **oui** (0010) | VALIDATION | — | 0010 → 0010 |
| 95 | `approve_release(uuid)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | PAYER_ONLY, NOT_CONFIRMED | DISPUTE_OPEN, NOT_AUTHENTICATED, NOT_PAID, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, WRONG_MODE | 0014 → 0014 |
| 96 | `audit_chain()` | trigger | non | — | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0004 (3 déf.) |
| 97 | `audit_immutable()` | trigger | non | — | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0005 (2 déf.) |
| 98 | `bo_audit(uuid)` | table (id bigint, created_at timestamptz | oui | public | non (0006) | **oui** (0006) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 99 | `bo_audit_verify(uuid)` | jsonb | oui | public | non (0006) | **oui** (0006) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 100 | `bo_decisions(uuid,uuid)` | table (validator_id uuid, validator_name | oui | public | non (0006) | **oui** (0006) | oui (défaut) | — | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 101 | `bo_find_transactions(text)` | table (id uuid, reference text, vertical | oui | public | non (0006) | **oui** (0006) | oui (défaut) | — | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 102 | `claim_dossier(uuid)` | transactions | oui | public | non (0014) | **oui** (0014) | oui (défaut) | TX_NOT_FOUND, VALIDATOR_IS_PARTY | BENEFICIARY_REFERENCE_REQUIRED, DOCUMENT_REQUIRED, ENROLMENT_REQUIRED, INITIATOR_ONLY, NOT_AUTHENTICATED, PLAN_EMPTY, PLAN_SUM_MISMATCH, REASON_REQUIRED, TRANSITION_FORBIDDEN, TRANSITION_UNKNOWN, TX_NO_DOCUMENT, VALIDATION, VALIDATOR_ONLY, VERTICAL_UNAVAILABLE | 0006 → 0014 (2 déf.) |
| 103 | `claim_enrolment_case(uuid)` | jsonb | oui | public | non (0020) | **oui** (0020) | oui (défaut) | VALIDATOR_ONLY, NOT_FOUND, SELF_REVIEW, CASE_CLOSED, KYC_PENDING, ALREADY_CLAIMED | NOT_AUTHENTICATED | 0020 → 0020 |
| 104 | `claim_presentation_token(text)` | jsonb | oui | public | non (0016) | **oui** (0016) | oui (défaut) | TOKEN_REVOKED, TOKEN_USED, TOKEN_EXPIRED, NOT_PAYABLE | NOT_AUTHENTICATED, TOO_MANY_ATTEMPTS | 0016 → 0016 |
| 105 | `confirm_by_reference(text,timestamptz)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | UNKNOWN_REFERENCE, TOKEN_REVOKED, PROVIDER_ONLY, TOKEN_USED, DEVICE_TIME_INVALID, TOKEN_EXPIRED, WRONG_MODE, NOT_PAID | ALREADY_CONFIRMED, NOT_AUTHENTICATED, TOO_MANY_ATTEMPTS | 0003 → 0014 (4 déf.) |
| 106 | `confirm_service(uuid)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | WRONG_CONFIRMER | ALREADY_CONFIRMED, DISPUTE_OPEN, NOT_AUTHENTICATED, NOT_PAID, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, WRONG_MODE | 0014 → 0014 |
| 107 | `create_tranches(uuid,jsonb)` | setof tranches | oui | public | non (0005) | **oui** (0005) | oui (défaut) | TX_NOT_FOUND, NOT_EDITABLE, TRANSITION_FORBIDDEN, VALIDATION, PLAN_BAD_AMOUNT | NOT_AUTHENTICATED | 0003 → 0005 (2 déf.) |
| 108 | `decide_enrolment(uuid,boolean,text)` | jsonb | oui | public | non (0020) | **oui** (0020) | oui (défaut) | VALIDATOR_ONLY, NOT_FOUND, SELF_REVIEW, ALREADY_CLAIMED, REASON_REQUIRED, CASE_CLOSED, NOT_CLAIMED | NOT_AUTHENTICATED | 0020 → 0020 |
| 109 | `decide_tranche(uuid,boolean,text)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | VALIDATOR_ONLY, TRANCHE_NOT_FOUND, VALIDATOR_IS_PARTY, NO_EVIDENCE_PENDING, REASON_REQUIRED, ALREADY_DECIDED | NOT_AUTHENTICATED | 0003 → 0014 (3 déf.) |
| 110 | `decide_tx(uuid,boolean,boolean,text)` | transactions | oui | public | non (0014) | **oui** (0014) | oui (défaut) | VALIDATOR_ONLY, TX_NOT_FOUND, VALIDATOR_IS_PARTY, NOT_IN_REVIEW, REASON_REQUIRED, AMOUNT_NOT_CHECKED, ALREADY_DECIDED | NOT_AUTHENTICATED | 0006 → 0014 (2 déf.) |
| 111 | `delete_draft(uuid)` | void | oui | public | non (0005) | **oui** (0005) | oui (défaut) | TX_NOT_FOUND, AUDITED_FILE, NOT_EDITABLE | NOT_AUTHENTICATED | 0005 → 0005 |
| 112 | `demo_reset()` ⚑ | int | oui | public | non (0005) | **oui** (0005) | oui (défaut) | DEMO_DISABLED | NOT_AUTHENTICATED | 0005 → 0005 |
| 113 | `demo_resolve_dispute(uuid,text,text)` ⚑ | disputes | oui | public | non (0014) | **oui** (0014) | oui (défaut) | DEMO_DISABLED, TRANCHE_NOT_FOUND, NO_OPEN_DISPUTE, REASON_REQUIRED | AMOUNT_INVALID, INVALID_OUTCOME, NOT_AUTHENTICATED, NOT_REFUNDABLE, REFUND_EXCEEDS_PAID | 0005 → 0014 (2 déf.) |
| 114 | `demo_review(uuid,boolean,text)` ⚑ | transactions | oui | public | non (0014) | **oui** (0014) | oui (défaut) | DEMO_DISABLED, TX_NOT_FOUND, NOT_IN_REVIEW, DEMO_NO_VALIDATOR, REASON_REQUIRED | NOT_AUTHENTICATED | 0005 → 0014 (3 déf.) |
| 115 | `demo_settle_payment(uuid,text)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | DEMO_DISABLED, PAYMENT_NOT_FOUND, INVALID_OUTCOME | NOT_AUTHENTICATED, VALIDATION | 0010 → 0021 (2 déf.) |
| 116 | `demo_settle_refund(uuid,text)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | DEMO_DISABLED, ADMIN_ONLY, NOT_FOUND, INVALID_OUTCOME | NOT_AUTHENTICATED, VALIDATION | 0010 → 0021 (2 déf.) |
| 117 | `document_reuse(text,uuid)` | jsonb | oui | public | non (0009) | **oui** (0009) | oui (défaut) | HASH_INVALID, NOT_FOUND | NOT_AUTHENTICATED | 0009 → 0009 |
| 118 | `dossier_checks(uuid)` | table (code text, result text, detail js | oui | public | non (0009) | **oui** (0009) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0009 (2 déf.) |
| 119 | `dossier_documents(uuid)` | jsonb | oui | public | non (0006) | **oui** (0006) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 120 | `evidence_checks(uuid)` | table (code text, result text, detail js | oui | public | non (0006) | **oui** (0006) | oui (défaut) | TRANCHE_NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 121 | `expire_due_requests()` | int | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0014 → 0014 |
| 122 | `generate_recurring_tranches(uuid,recurrence_freq,integer,date,text)` | setof tranches | oui | public | non (0005) | **oui** (0005) | oui (défaut) | TX_NOT_FOUND, PLAN_BAD_COUNT, PLAN_TOO_SMALL | NOT_AUTHENTICATED, NOT_EDITABLE, PLAN_BAD_AMOUNT, TRANSITION_FORBIDDEN, VALIDATION | 0003 → 0005 (2 déf.) |
| 123 | `get_dispute(uuid)` | jsonb | oui | public | non (0014) | **oui** (0014) | oui (défaut) | TRANCHE_NOT_FOUND | NOT_AUTHENTICATED | 0005 → 0014 (2 déf.) |
| 124 | `get_document_access(uuid)` | jsonb | oui | public | non (0022) | **oui** (0022) | oui (défaut) | NOT_FOUND | NOT_AUTHENTICATED | 0009 → 0022 (2 déf.) |
| 125 | `get_draft(uuid)` | jsonb | oui | public | non (0005) | **oui** (0005) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED | 0005 → 0005 |
| 126 | `get_drafts()` | jsonb | oui | public | non (0005) | **oui** (0005) | oui (défaut) | — | NOT_AUTHENTICATED | 0005 → 0005 |
| 127 | `get_enrolment_document_access(uuid)` | jsonb | oui | public | non (0020) | **oui** (0020) | oui (défaut) | NOT_FOUND | NOT_AUTHENTICATED | 0020 → 0020 |
| 128 | `get_quote(uuid,text,text)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | TRANCHE_NOT_FOUND, PAYER_ONLY, REQUEST_ON_HOLD, TX_NOT_ACTIVE, PAYMENT_IN_PROGRESS, NOT_PAYABLE, VALIDATION, NOT_CONFIGURED, QUOTE_UNAVAILABLE | NOT_AUTHENTICATED | 0021 → 0021 |
| 129 | `get_receipt(uuid)` | jsonb | oui | public | non (0014) | **oui** (0014) | oui (défaut) | TRANCHE_NOT_FOUND, NOT_RELEASED | NOT_AUTHENTICATED | 0005 → 0014 (3 déf.) |
| 130 | `guard_profile()` | trigger | non | — | **oui (défaut)** | **oui (défaut)** | oui (défaut) | PROFILE_PROTECTED | — | 0004 → 0020 (3 déf.) |
| 131 | `guard_status()` | trigger | non | — | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0001 |
| 132 | `guard_tranche_status()` | trigger | non | — | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0003 → 0003 |
| 133 | `handle_new_user()` | trigger | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0001 |
| 134 | `has_audit(uuid)` | boolean | oui | public | non (0004) | **oui** (0004) | oui (défaut) | — | — | 0004 → 0004 |
| 135 | `has_role(uuid,tx_role)` | boolean | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0001 |
| 136 | `is_admin()` | boolean | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0003 → 0006 (2 déf.) |
| 137 | `is_party(uuid)` | boolean | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0001 |
| 138 | `is_validator()` | boolean | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0006 (2 déf.) |
| 139 | `issue_presentation_token(uuid)` | jsonb | oui | public | non (0016) | **oui** (0016) | oui (défaut) | INITIATOR_ONLY, NOT_PAYABLE, NOT_CONFIGURED | NOT_AUTHENTICATED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE | 0016 → 0016 |
| 140 | `lift_suspension(uuid,text)` | transactions | oui | public | non (0014) | **oui** (0014) | oui (défaut) | VALIDATOR_IS_PARTY, TRANSITION_UNKNOWN, DISPUTE_OPEN, REASON_REQUIRED | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0014 → 0014 |
| 141 | `log_audit_export(uuid,integer)` | void | oui | public | non (0006) | **oui** (0006) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0006 |
| 142 | `mark_received(uuid)` | tranches | oui | public | non (0008) | **oui** (0008) | oui (défaut) | TRANCHE_NOT_FOUND, PAYER_ONLY | NOT_AUTHENTICATED | 0008 → 0008 |
| 143 | `mark_refund_executed(uuid,text)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | ADMIN_ONLY, NOT_FOUND, VALIDATOR_IS_PARTY, VALIDATION, REFUND_NOT_PENDING | NOT_AUTHENTICATED | 0021 → 0021 |
| 144 | `my_enrolment()` | jsonb | oui | public | non (0020) | **oui** (0020) | oui (défaut) | — | NOT_AUTHENTICATED | 0020 → 0020 |
| 145 | `needs_platform_review(uuid)` | boolean | oui | public | non (0011) | **oui** (0011) | oui (défaut) | TX_NOT_FOUND | NOT_AUTHENTICATED | 0011 → 0011 |
| 146 | `open_dispute(uuid,text,text)` | disputes | oui | public | non (0014) | **oui** (0014) | oui (défaut) | TRANCHE_NOT_FOUND, NOT_A_PARTY, REASON_TOO_SHORT, VALIDATION, DISPUTE_NOT_ALLOWED | NOT_AUTHENTICATED | 0004 → 0014 (3 déf.) |
| 147 | `open_document(uuid)` | jsonb | oui | public | non (0022) | **oui** (0022) | oui (défaut) | NOT_FOUND | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0006 → 0022 (2 déf.) |
| 148 | `reissue_token(uuid,text)` | jsonb | oui | public | non (0018) | **oui** (0018) | oui (défaut) | NO_TOKEN, REASON_REQUIRED | INITIATOR_ONLY, NOT_AUTHENTICATED, NOT_REVOCABLE, TRANCHE_NOT_FOUND | 0008 → 0018 (3 déf.) |
| 149 | `reject_request(uuid,text)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | PAYER_ONLY, TRANSITION_UNKNOWN | NOT_AUTHENTICATED, REASON_REQUIRED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, VALIDATION | 0008 → 0014 (2 déf.) |
| 150 | `release_due_tranches()` | int | oui | public | non (0014) | non (0014) | oui (défaut) | — | — | 0003 → 0014 (2 déf.) |
| 151 | `remove_document(uuid)` | text | oui | public | non (0005) | **oui** (0005) | oui (défaut) | NOT_FOUND, NOT_EDITABLE | NOT_AUTHENTICATED | 0005 → 0005 |
| 152 | `request_dispute_response(uuid,text)` | disputes | oui | public | non (0014) | **oui** (0014) | oui (défaut) | ADMIN_ONLY, NO_OPEN_DISPUTE, VALIDATOR_IS_PARTY | NOT_AUTHENTICATED, REASON_REQUIRED, VALIDATION | 0014 → 0014 |
| 153 | `request_info(uuid,text)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | PAYER_ONLY, TRANSITION_UNKNOWN, TRANSITION_FORBIDDEN, REQUEST_ON_HOLD | NOT_AUTHENTICATED, REASON_REQUIRED, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, VALIDATION | 0008 → 0014 (2 déf.) |
| 154 | `request_refund(uuid,bigint,text,text)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | ADMIN_ONLY, VALIDATION, IDEMPOTENCY_CONFLICT, TRANCHE_NOT_FOUND, VALIDATOR_IS_PARTY, REASON_REQUIRED | AMOUNT_INVALID, NOT_AUTHENTICATED, NOT_REFUNDABLE, REFUND_EXCEEDS_PAID | 0010 → 0021 (3 déf.) |
| 155 | `required_validations(uuid,uuid)` | int | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0003 → 0003 |
| 156 | `resolve_dispute(uuid,text,text,bigint)` | disputes | oui | public | non (0014) | **oui** (0014) | oui (défaut) | ADMIN_ONLY, NO_OPEN_DISPUTE, VALIDATOR_IS_PARTY, REASON_REQUIRED | AMOUNT_INVALID, INVALID_OUTCOME, NOT_AUTHENTICATED, NOT_REFUNDABLE, REFUND_EXCEEDS_PAID | 0014 → 0014 |
| 157 | `resolve_reference(text)` | table (tx_id uuid, status tx_status, exp | oui | public | non (0003) | **oui** (0001) | oui (défaut) | — | — | 0001 → 0001 |
| 158 | `resolve_reference_info(text)` | jsonb | oui | public | non (0008) | **oui** (0008) | oui (défaut) | TOKEN_REVOKED | NOT_AUTHENTICATED, TOO_MANY_ATTEMPTS | 0005 → 0008 (2 déf.) |
| 159 | `resolve_tranche_reference(text)` | table (tranche_id uuid, tx_id uuid, labe | oui | public | non (0008) | **oui** (0008) | oui (défaut) | TOKEN_REVOKED | NOT_AUTHENTICATED, TOO_MANY_ATTEMPTS | 0003 → 0008 (2 déf.) |
| 160 | `respond_dispute(uuid,text)` | disputes | oui | public | non (0014) | **oui** (0014) | oui (défaut) | NO_OPEN_DISPUTE, NOT_RESPONDENT, ALREADY_ANSWERED, REASON_TOO_SHORT | NOT_AUTHENTICATED | 0006 → 0014 (2 déf.) |
| 161 | `revoke_presentation_tokens(uuid)` | int | oui | public | non (0016) | **oui** (0016) | oui (défaut) | INITIATOR_ONLY | NOT_AUTHENTICATED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE | 0016 → 0016 |
| 162 | `revoke_token(uuid,text)` | jsonb | oui | public | non (0008) | **oui** (0008) | oui (défaut) | REASON_REQUIRED, NO_TOKEN | INITIATOR_ONLY, NOT_AUTHENTICATED, NOT_REVOCABLE, TRANCHE_NOT_FOUND | 0008 → 0008 |
| 163 | `save_draft(jsonb)` | jsonb | oui | public | non (0022) | **oui** (0022) | oui (défaut) | VALIDATION, BENEFICIARY_NAME_NOT_ALLOWED, BENEFICIARY_REFERENCE_INVALID, TX_NOT_FOUND, NOT_EDITABLE, PHONE_INVALID, SELF_PAYER | ENROLMENT_REQUIRED, NOT_AUTHENTICATED | 0005 → 0022 (5 déf.) |
| 164 | `search_providers(text,text)` | table (id uuid, name text, city text, ve | oui | public | non (0005) | **oui** (0005) | oui (défaut) | — | NOT_AUTHENTICATED | 0005 → 0005 |
| 165 | `simulate_system_transition(uuid,tx_status)` | transactions | oui | public | non (0005) | **oui** (0005) | oui (défaut) | DEMO_DISABLED, TX_NOT_FOUND, TRANSITION_UNKNOWN | NOT_AUTHENTICATED | 0001 → 0005 (3 déf.) |
| 166 | `simulate_tranche_system(uuid,tranche_status)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | DEMO_DISABLED, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, TRANSITION_UNKNOWN | IDEMPOTENCY_CONFLICT, INVALID_OUTCOME, LIMITS_NOT_CONFIGURED, LIMIT_EXCEEDED, NOT_AUTHENTICATED, NOT_CONFIGURED, NOT_PAYABLE, PAYER_ONLY, PAYMENT_IN_PROGRESS, PAYMENT_NOT_FOUND, QUOTE_EXPIRED, QUOTE_INVALID, QUOTE_UNAVAILABLE, QUOTE_USED, REQUEST_ON_HOLD, VALIDATION | 0003 → 0014 (4 déf.) |
| 167 | `start_payment(uuid,text,text)` | jsonb | oui | public | non (0021) | **oui** (0021) | oui (défaut) | VALIDATION | IDEMPOTENCY_CONFLICT, LIMITS_NOT_CONFIGURED, LIMIT_EXCEEDED, NOT_AUTHENTICATED, NOT_CONFIGURED, NOT_PAYABLE, PAYER_ONLY, PAYMENT_IN_PROGRESS, QUOTE_EXPIRED, QUOTE_INVALID, QUOTE_UNAVAILABLE, QUOTE_USED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE | 0010 → 0021 (4 déf.) |
| 168 | `status_ok(uuid)` | boolean | oui | public | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0001 |
| 169 | `submit_enrolment(text,jsonb,jsonb)` | jsonb | oui | public | non (0020) | **oui** (0020) | oui (défaut) | VALIDATION, ALREADY_ENROLLED, ENROLMENT_REQUIRED, ENROLMENT_PENDING, HASH_INVALID, DOCUMENT_REQUIRED | INVALID_OUTCOME, NOT_AUTHENTICATED, NOT_FOUND | 0020 → 0020 |
| 170 | `submit_evidence(uuid)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | PROVIDER_ONLY, NO_EVIDENCE_NEEDED, EVIDENCE_MISSING | DISPUTE_OPEN, NOT_AUTHENTICATED, NOT_PAID, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE, WRONG_MODE | 0014 → 0014 |
| 171 | `submit_operation(uuid)` | transactions | oui | public | non (0022) | **oui** (0022) | oui (défaut) | TX_NOT_FOUND, TRANSITION_UNKNOWN, INITIATOR_ONLY, VERTICAL_UNAVAILABLE, VALIDATION, BENEFICIARY_REFERENCE_REQUIRED, PLAN_EMPTY, PLAN_SUM_MISMATCH, TX_NO_DOCUMENT, DOCUMENT_REQUIRED | ENROLMENT_REQUIRED, NOT_AUTHENTICATED | 0014 → 0022 (3 déf.) |
| 172 | `suspend_operation(uuid,text)` | transactions | oui | public | non (0014) | **oui** (0014) | oui (défaut) | VALIDATOR_IS_PARTY, TX_NOT_ACTIVE, REASON_REQUIRED | NOT_AUTHENTICATED, VALIDATOR_ONLY | 0014 → 0014 |
| 173 | `transition_tranche(uuid,tranche_status,text)` | tranches | oui | public | non (0014) | **oui** (0014) | oui (défaut) | TRANSITION_UNKNOWN, TRANSITION_FORBIDDEN, INITIATOR_ONLY | NOT_AUTHENTICATED, REQUEST_ON_HOLD, TRANCHE_NOT_FOUND, TX_NOT_ACTIVE | 0003 → 0014 (4 déf.) |
| 174 | `transition_tx(uuid,tx_status,text)` | transactions | oui | public | non (0014) | **oui** (0014) | oui (défaut) | TX_NOT_FOUND, TRANSITION_UNKNOWN, VALIDATOR_ONLY, VALIDATOR_IS_PARTY, TRANSITION_FORBIDDEN, REASON_REQUIRED | BENEFICIARY_REFERENCE_REQUIRED, DOCUMENT_REQUIRED, ENROLMENT_REQUIRED, INITIATOR_ONLY, NOT_AUTHENTICATED, PLAN_EMPTY, PLAN_SUM_MISMATCH, TX_NO_DOCUMENT, VALIDATION, VERTICAL_UNAVAILABLE | 0001 → 0014 (6 déf.) |
| 175 | `verify_audit(uuid)` | boolean | non | — | **oui (défaut)** | **oui (défaut)** | oui (défaut) | — | — | 0001 → 0004 (3 déf.) |


Liste des 98 codes levés dans les corps : `ADMIN_ONLY`, `ALREADY_ANSWERED`, `ALREADY_CLAIMED`, `ALREADY_CONFIRMED`, `ALREADY_DECIDED`, `ALREADY_ENROLLED`, `AMOUNT_INVALID`, `AMOUNT_NOT_CHECKED`, `AUDITED_FILE`, `AUDIT_IMMUTABLE`, `BENEFICIARY_NAME_NOT_ALLOWED`, `BENEFICIARY_REFERENCE_INVALID`, `BENEFICIARY_REFERENCE_REQUIRED`, `CASE_CLOSED`, `DEMO_DISABLED`, `DEMO_NO_VALIDATOR`, `DEVICE_TIME_INVALID`, `DISPUTE_NOT_ALLOWED`, `DISPUTE_OPEN`, `DOCUMENT_KIND_NOT_ALLOWED`, `DOCUMENT_LOCKED`, `DOCUMENT_REQUIRED`, `ENROLMENT_PENDING`, `ENROLMENT_REQUIRED`, `EVIDENCE_MISSING`, `FILE_TOO_LARGE`, `FILE_TYPE`, `HASH_IMMUTABLE`, `HASH_INVALID`, `HASH_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `INITIATOR_ONLY`, `INVALID_OUTCOME`, `KYC_PENDING`, `LEDGER_IMMUTABLE`, `LEDGER_UNBALANCED`, `LIMITS_NOT_CONFIGURED`, `LIMIT_EXCEEDED`, `MULTIPLE_PAYERS_NOT_ALLOWED`, `NOT_AUTHENTICATED`, `NOT_A_PARTY`, `NOT_CLAIMED`, `NOT_CONFIGURED`, `NOT_CONFIRMED`, `NOT_EDITABLE`, `NOT_FOUND`, `NOT_IN_REVIEW`, `NOT_PAID`, `NOT_PAYABLE`, `NOT_REFUNDABLE`, `NOT_RELEASED`, `NOT_RESPONDENT`, `NOT_REVOCABLE`, `NO_EVIDENCE_NEEDED`, `NO_EVIDENCE_PENDING`, `NO_OPEN_DISPUTE`, `NO_TOKEN`, `PAYER_ONLY`, `PAYMENT_IN_PROGRESS`, `PAYMENT_NOT_FOUND`, `PHONE_INVALID`, `PLAN_BAD_AMOUNT`, `PLAN_BAD_COUNT`, `PLAN_EMPTY`, `PLAN_SUM_MISMATCH`, `PLAN_TOO_SMALL`, `PROFILE_PROTECTED`, `PROVIDER_ONLY`, `QUOTE_EXPIRED`, `QUOTE_FROZEN`, `QUOTE_INVALID`, `QUOTE_UNAVAILABLE`, `QUOTE_USED`, `REASON_REQUIRED`, `REASON_TOO_SHORT`, `REFUND_EXCEEDS_PAID`, `REFUND_NOT_PENDING`, `REQUEST_ON_HOLD`, `SELF_PAYER`, `SELF_REVIEW`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `TOKEN_USED`, `TOO_MANY_ATTEMPTS`, `TOO_MANY_FILES`, `TRANCHE_NOT_FOUND`, `TRANSITION_FORBIDDEN`, `TRANSITION_UNKNOWN`, `TX_NOT_ACTIVE`, `TX_NOT_FOUND`, `TX_NO_DOCUMENT`, `UNKNOWN_REFERENCE`, `VALIDATION`, `VALIDATOR_IS_PARTY`, `VALIDATOR_ONLY`, `VERTICAL_UNAVAILABLE`, `WRONG_CONFIRMER`, `WRONG_MODE`.

## 7. Politiques RLS et droits de table

### 7.1 Politiques (état final)

La RLS est activée sur les 39 tables (sections 3.1). Aucune table n’a `FORCE ROW LEVEL SECURITY`. Deux tables ont la RLS sans aucune politique (donc inaccessibles par l’API) : `allowed_transitions`, `tranche_transitions`. Rôle `public` = politique sans clause `TO` (s’applique aussi à `anon`).

| Table | Politique | Commande | Rôles | Expression (USING / WITH CHECK) | Migration |
|---|---|---|---|---|---|
| app_config | config_read | SELECT | public | `using (true)` | 0001 |
| audit_log | audit_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0001 |
| contributions | contributions_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0021 |
| dispute_messages | dispute_messages_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0014 |
| disputes | disputes_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0003 |
| documents | docs_delete | DELETE | public | `using ( exists (select 1 from transactions t where t.id = tx_id and t.status in ('DRAFT','REJECTED') and not has_audit(t.id) and (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER'))))` | 0005 |
| documents | docs_insert | INSERT | public | `with check (uploaded_by = auth.uid() and exists (select 1 from transactions where id = tx_id and status in ('DRAFT','REJECTED') and (has_role(id,'REQUESTER') or has_role(id,'PAYER'))))` | 0001 |
| documents | docs_insert_info | INSERT | public | `with check ( uploaded_by = auth.uid() and tranche_id is not null and exists (select 1 from tranches tr join transactions t on t.id = tr.tx_id where tr.id = tranche_id and tr.tx_id = documents.tx_id and tr.status = 'INFO_REQUESTED' and t.created_by = auth.ui…` | 0008 |
| documents | docs_insert_evidence | INSERT | public | `with check ( uploaded_by = auth.uid() and tranche_id is not null and exists (select 1 from tranches tr where tr.id = tranche_id and tr.status = 'PAID' and tr.funds_state = 'HELD' and has_role(tr.tx_id,'PROVIDER')))` | 0014 |
| documents | docs_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0001 |
| dual_thresholds | thresholds_read | SELECT | public | `using (true)` | 0003 |
| enrolment_cases | enrolment_cases_read | SELECT | public | `using (profile_id = auth.uid() or is_validator())` | 0020 |
| enrolment_documents | enrolment_documents_read | SELECT | public | `using (profile_id = auth.uid() or is_validator())` | 0020 |
| enrolment_events | enrolment_events_read | SELECT | public | `using (profile_id = auth.uid() or is_validator())` | 0020 |
| enrolment_limits | enrolment_limits_admin_write | ALL | authenticated | `using (is_admin()) with check (is_admin())` | 0020 |
| enrolment_limits | enrolment_limits_read | SELECT | authenticated | `using (true)` | 0020 |
| fx_quotes | fx_quotes_read | SELECT | public | `using (payer_id = auth.uid() or is_validator())` | 0021 |
| ledger_accounts | ledger_accounts_read | SELECT | public | `using (is_validator())` | 0010 |
| ledger_entries | ledger_entries_staff_read | SELECT | public | `using (is_validator())` | 0010 |
| ledger_journals | ledger_journals_staff_read | SELECT | public | `using (is_validator())` | 0010 |
| notifications | notif_own | SELECT | public | `using (user_id = auth.uid())` | 0001 |
| notifications | notif_update | UPDATE | public | `using (user_id = auth.uid())` | 0001 |
| payment_attempts | payment_attempts_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0010 |
| payments | payments_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0001 |
| presentation_tokens | presentation_tokens_staff_read | SELECT | public | `using (is_validator())` | 0016 |
| profiles | profiles_self_read | SELECT | public | `using (id = auth.uid() or is_validator())` | 0001 |
| profiles | profiles_self_update | UPDATE | public | `using (id = auth.uid()) with check (id = auth.uid())` | 0004 |
| providers | providers_admin_write | ALL | authenticated | `using (is_admin()) with check (is_admin())` | 0005 |
| providers | providers_read | SELECT | authenticated | `using (true)` | 0005 |
| recurrence_plans | recur_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0003 |
| refunds | refunds_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0010 |
| release_events | release_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0001 |
| _release_rules_0003 (ex release_rules) | rules_read | SELECT | public | `using (true)` | 0003 |
| request_messages | request_messages_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0008 |
| request_modules | request_modules_admin_write | ALL | authenticated | `using (is_admin()) with check (is_admin())` | 0011 |
| request_modules | request_modules_read | SELECT | authenticated | `using (true)` | 0011 |
| _required_documents_0005 (ex required_documents) | required_docs_read | SELECT | public | `using (true)` | 0005 |
| security_events | security_events_staff_read | SELECT | public | `using (is_validator())` | 0008 |
| signing_keys | keys_read | SELECT | public | `using (true)` | 0003 |
| storage.objects | dossiers_delete | DELETE | public | `using ( bucket_id = 'dossiers' and exists ( select 1 from transactions t where t.id = _storage_tx(name) and t.status in ('DRAFT','REJECTED') and not has_audit(t.id) and (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER'))))` | 0005 |
| storage.objects | dossiers_insert | INSERT | public | `with check ( bucket_id = 'dossiers' and exists ( select 1 from transactions t where t.id = _storage_tx(name) and t.status in ('DRAFT','REJECTED') and (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER'))))` | 0005 |
| storage.objects | dossiers_insert_info | INSERT | public | `with check ( bucket_id = 'dossiers' and exists ( select 1 from transactions t join tranches tr on tr.tx_id = t.id where t.id = _storage_tx(name) and tr.status = 'INFO_REQUESTED' and t.created_by = auth.uid()))` | 0008 |
| storage.objects | identity_insert | INSERT | authenticated | `with check (bucket_id = 'identity' and (storage.foldername(name))[1] = auth.uid()::text)` | 0020 |
| storage.objects | dossiers_read | SELECT | public | `using ( bucket_id = 'dossiers' and ( exists (select 1 from transactions t where t.id = _storage_tx(name) and t.created_by = auth.uid() and t.status = 'DRAFT' and not has_audit(t.id)) or (_recently_opened(name) and (is_validator() or exists ( select 1 from t…` | 0009 |
| storage.objects | identity_read | SELECT | public | `using (bucket_id = 'identity' and _identity_recently_opened(name))` | 0020 |
| tranche_tokens | ttokens_read | SELECT | public | `using ( revoked_at is null and exists (select 1 from tranches tr where tr.id = tranche_id and tr.status <> 'DRAFT' and has_role(tr.tx_id, 'PAYER')))` | 0014 |
| tranches | tranches_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0003 |
| transaction_parties | parties_insert | INSERT | public | `with check (exists (select 1 from transactions where id = tx_id and created_by = auth.uid() and status = 'DRAFT'))` | 0001 |
| transaction_parties | parties_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0001 |
| transactions | tx_delete_draft | DELETE | public | `using (created_by = auth.uid() and status = 'DRAFT' and not has_audit(id))` | 0004 |
| transactions | tx_insert | INSERT | public | `with check (created_by = auth.uid() and status = 'DRAFT')` | 0001 |
| transactions | tx_read | SELECT | public | `using (created_by = auth.uid() or is_party(id) or is_validator())` | 0004 |
| transactions | tx_update_draft | UPDATE | public | `using (status in ('DRAFT','REJECTED') and (has_role(id,'REQUESTER') or has_role(id,'PAYER'))) with check (status in ('DRAFT','REJECTED') and created_by = auth.uid())` | 0003 |
| trust_tokens | tokens_read | SELECT | public | `using (is_party(tx_id) and status_ok(tx_id))` | 0001 |
| validations | validations_read | SELECT | public | `using (is_party(tx_id) or is_validator())` | 0001 |
| webhook_events | webhook_events_staff_read | SELECT | public | `using (is_validator())` | 0010 |


Historique utile : `ttokens_read` (0003) a été remplacée en 0014 (jeton lisible par le payeur seulement, non révoqué, demande hors `DRAFT`) ; `tx_update_draft` remplacée en 0003 ; `tx_read` et `tx_delete_draft` en 0004 ; `dossiers_read` (stockage) en 0009.

### 7.2 Droits de table explicites (GRANT / REVOKE)

- **Révoqués pour `anon`** : `providers` (0005) ; `security_events`, `request_messages` (0008) ; `payment_attempts`, `refunds`, `webhook_events`, `ledger_accounts`, `ledger_journals`, `ledger_entries` (0010) ; `_release_rules_0003`, `_required_documents_0005` (aussi pour `authenticated`), `request_modules`, vues `release_rules`, `required_documents`, `bo_*` (0011) ; `payment_requests`, `dispute_messages`, `v_reconciliation`, `bo_*` (0014) ; `presentation_tokens` (0016) ; `enrolment_cases`, `enrolment_documents`, `enrolment_events`, `enrolment_limits` (0020) ; `fx_quotes`, `contributions` (0021).
- **Écriture retirée à `authenticated`** (lecture seule via RLS) : `security_events`, `request_messages` (0008), tables financières (0010), `dispute_messages` (0014), `presentation_tokens` (0016), `enrolment_*` (0020), `fx_quotes`, `contributions` (0021). `notifications` : `insert, update, delete` retirés à `anon` et `authenticated`, puis `grant update (read_at)` à `authenticated` (0005). `request_modules` : `select, insert, update` à `authenticated`, `delete` retiré (0011) ; l’écriture reste filtrée par `request_modules_admin_write` (`is_admin()`).
- **Aucun droit explicite** (privilèges par défaut + RLS seule) : `profiles`, `app_config`, `transactions`, `transaction_parties`, `documents`, `validations`, `trust_tokens`, `payments`, `release_events`, `audit_log`, `allowed_transitions`, `dual_thresholds`, `tranches`, `recurrence_plans`, `tranche_transitions`, `signing_keys`, `disputes`, `notifications` (lecture).

## 8. Stockage (buckets)

| Bucket | Créé | Public | Taille max | Types MIME | Politiques `storage.objects` |
|---|---|---|---|---|---|
| `dossiers` | 0001 (`insert … ('dossiers','dossiers', false)`) ; limites posées en 0005 (`update storage.buckets set public = false, file_size_limit = 10485760, allowed_mime_types = …`) | non | 10 485 760 octets (10 Mio) | `image/jpeg`, `image/png`, `application/pdf` | `dossiers_insert`, `dossiers_delete` (0005), `dossiers_insert_info` (0008), `dossiers_read` (0009 : brouillon non audité de l’auteur, ou ouverture récemment journalisée `_recently_opened(name)` par un validateur ou une partie) |
| `identity` | 0020 (`insert … on conflict (id) do update set public = false`) | non | 10 485 760 octets | `image/jpeg`, `image/png`, `image/heic`, `application/pdf` | `identity_insert` (`authenticated`, dossier = `auth.uid()`), `identity_read` (`_identity_recently_opened(name)`) (0020) |

Cohérence : la table `documents` impose aussi `mime_type in ('image/jpeg','image/png','application/pdf')` et `size_bytes <= 10*1024*1024` (0001). Remarque : en cas de bucket `identity` préexistant, `on conflict … do update` ne remet que `public = false`, pas les limites (0020).

## 9. Tâches planifiées (pg_cron)

| Nom | Planification | Commande | Migration |
|---|---|---|---|
| `diaspay-release-due-tranches` | `*/10 * * * *` (toutes les 10 min) | `select public.release_due_tranches()` | 0005 |
| `diaspay-activate-due-tranches` | `0 6 * * *` (chaque jour à 06:00, heure du serveur) | `select public.activate_due_tranches()` | 0005 |
| `diaspay-expire-due-requests` | `15 * * * *` (chaque heure, à la minute 15) | `select public.expire_due_requests()` | 0014 |

Les trois fonctions sont révoquées pour `anon` et `authenticated` (exécutées par le propriétaire via pg_cron). 0003 contenait des `cron.schedule` en commentaire seulement (l. 598-599, non exécutés).

## 10. `app_config` (clés insérées par les migrations, valeurs non sensibles)

Table `app_config(key text primary key, value text not null)` (0001), RLS activée, politique `config_read` **`using (true)` sans clause `TO`** et aucun `REVOKE` de table : lisible par `anon` comme par `authenticated` ; aucune politique d’écriture (modification seulement en SQL privilégié).

| Clé | Valeur initiale | Migration | Remarque |
|---|---|---|---|
| `mock_mode` | `'true'` | 0001 | mode simulation ; conditionne la création des `demo_*`, les seeds, les valeurs de développement ci-dessous. `docs/release-checklist.md` (point 8) exige `'false'` en production **avant** 0005 |
| `token_ttl_days` | `'7'` | 0001 | |
| `activation_lead_days` | `'7'` | 0003 | prévenance d’activation |
| `open_verticals` | `'EDUCATION,HEALTH,RENT'` | 0005 | conservée mais plus lue depuis 0011 (remplacée par `request_modules.enabled`, commentaire 0011 l. 13) |
| `require_staff_mfa` | `'false'` | 0006 | si `'true'`, `is_validator()`/`is_admin()` exigent `aal2` (`_staff_aal_ok`, 0006) ; checklist point 17 : `'true'` en production |
| `auto_issue_token` | `'false'` | 0006 | `seed.sql` la met à `'true'` |
| `eqr_image_enabled` | `'true'` (0008) puis **`'false'`** (0015 : `update app_config set value = 'false'`) | 0008 → 0015 | image du QR désactivée par défaut |
| `reference_failure_limit` | `'10'` | 0008 | limitation des résolutions de référence |
| `require_content_hash` | `'false'` | 0009 | empreinte SHA-256 obligatoire ou non |
| `payment_provider` | `'SIMULATED'` | 0010 | |
| `presentation_token_ttl_seconds` | `'90'` | 0016 | **seulement si `mock_mode`** (bloc `DO`) ; absente sinon → `NOT_CONFIGURED` |
| `kyc_simulated_result` | `'APPROVED'` | 0020 | **seulement si `mock_mode`** |
| `fx_quote_ttl_seconds` | `'300'` | 0021 | **seulement si `mock_mode`** ; absente → `NOT_CONFIGURED` dans `get_quote` |
| `simulated_fx_rates` | `{"EUR/XAF": "655.957"}` | 0021 | **seulement si `mock_mode`** |

Clé lue mais jamais insérée : `fee_schedule` (`_quote_fees`, 0021 l. 103 : `coalesce(…, '{}')`). Les plafonds d’enrôlement ne sont pas dans `app_config` mais dans `enrolment_limits` (lignes à valeurs nulles, `dev_only = true`, insérées seulement si `mock_mode`, 0020).

## 11. Fonctions sans révocation explicite pour `anon`

Recherche : aucune `ALTER DEFAULT PRIVILEGES`, aucune `REVOKE … ON ALL FUNCTIONS` dans les migrations. Les 162 autres fonctions ont toutes un `REVOKE … FROM … anon` explicite. Restent **13 fonctions** exécutables par `anon` (et par `authenticated`) :

| Fonction | DEFINER | Définition finale | Appel direct possible ? | Ce qu’elle fait / exposition |
|---|---|---|---|---|
| `has_role(uuid, tx_role)` | **oui** | 0001 | oui (RPC) | `exists` dans `transaction_parties` pour `auth.uid()` : faux pour `anon` |
| `is_party(uuid)` | **oui** | 0001 | oui | idem, tout rôle |
| `status_ok(uuid)` | **oui** | 0001 | oui | lit `transactions` **sans RLS** : renvoie vrai/faux selon le statut, ou NULL si l’identifiant n’existe pas (oracle d’existence sur un UUID, impact faible) |
| `required_validations(uuid, uuid)` | **oui** | 0003 | oui | lit `transactions`, `tranches`, `release_rules`, `dual_thresholds` sans RLS ; renvoie un entier (1 ou 2) |
| `is_validator()` | **oui** | 0006 | oui | rôle de `auth.uid()` + `_staff_aal_ok()` : faux pour `anon` |
| `is_admin()` | **oui** | 0006 | oui | idem |
| `handle_new_user()` | **oui** | 0001 | non (fonction de déclencheur, `returns trigger`) | crée le profil à l’inscription (`auth.users`) |
| `verify_audit(uuid)` | non | 0004 | oui | relit `audit_log` **sous RLS** : rien de visible pour `anon` |
| `audit_chain()`, `audit_immutable()`, `guard_status()`, `guard_tranche_status()`, `guard_profile()` | non | 0004, 0005, 0001, 0003, 0020 | non (déclencheurs) | gardes |

Évaluation : les fonctions DEFINER appelables (`has_role`, `is_party`, `is_validator`, `is_admin`, `status_ok`, `required_validations`) sont les assistants des politiques RLS ; elles doivent rester exécutables par `authenticated` (utilisées dans les `USING`), mais rien n’impose qu’`anon` les exécute. Risque faible, à fermer par un `revoke execute … from anon` (et `from public`) sur ces six fonctions. Le test `00_smoke.sql` vérifie « aucune fonction sensible exécutable par anon » sur une **liste fermée** qui ne comprend pas ces 13 fonctions.

## 12. Cohérence avec `packages/api-client/src/supabase/database.types.ts`

Fichier généré (« `pnpm db:types` (supabase gen types) : ne pas modifier à la main », l. 1), modifié en dernier par le commit `b31f68e` (0022/0023).

- **Tables** : 39 dans les deux sources. Différence de nom seulement apparente : les types listent `_release_rules_0003` et `_required_documents_0005` (noms réels après 0011) ; `release_rules` et `required_documents` y figurent comme **vues**, conformément à 0011.
- **Vues** : 7 = 7.
- **Fonctions** : 150 dans les types = 175 − 25 fonctions de déclencheur (les déclencheurs ne sont pas exposés par la génération). Aucune fonction des types n’est absente des migrations ; aucune fonction non-déclencheur des migrations n’est absente des types. Les 3 `demo_*` y figurent : les types ont été générés sur un projet en `mock_mode`.
- **Colonnes** : aucune différence de colonnes sur les 39 tables. Les types ajoutent des « champs calculés » (fonctions prenant la ligne en argument) : `documents._doc_sensitive`, `documents._doc_view_payload`, `tranches._request_final`, `payment_attempts._attempt_json`, `enrolment_cases._enrolment_json`, `fx_quotes._quote_json` ; ce n’est pas un écart.
- **Énumérations** : identiques (section 2).
- **Conclusion** : `database.types.ts` est **à jour** avec 0023 (aucun écart de structure relevé). Les types incluent aussi des fonctions internes révoquées pour `authenticated` (la génération ne tient pas compte des droits).

## 13. Scripts de test SQL (`supabase/tests/`)

**Format commun** (lu dans chaque fichier) : `begin;` → schéma `t` et table `t.results` → assistants `t.check(ok, label)` (insère une ligne PASS/FAIL), `t.fails(sql, label)` (vrai si l’instruction échoue), `t.hint(sql, expected, label)` (vrai si le `hint` de l’erreur vaut le code attendu), `t.ok(sql, label)` (06 seulement : vrai si l’instruction réussit) ; `t.login(uid)` / `t.anon()` / `t.admin()` changent de rôle (`set local role authenticated|anon`, réclamations JWT simulées) ; résumé final (`RESULTAT : n vérifications` ou exception `ECHEC`) ; `rollback`.

**Méthode de comptage** : nombre d’appels à `t.check(`, `t.fails(`, `t.hint(` et `t.ok(` dans le fichier, après retrait des commentaires et des définitions des assistants (les `perform t.check` internes à `t.fails`, `t.hint`, `t.ok` ne sont pas comptés). Aucun appel n’est placé dans une boucle ; un seul est conditionnel (02, voir note). Ce compte statique = nombre de lignes de `t.results` = nombre annoncé par le résumé.

| Script | Vérifications (check / fails / hint / ok) | Total | Variante `_editor` | Couverture (une phrase) |
|---|---|---|---|---|
| `00_smoke.sql` | 71 / 16 / 6 / 0 | **93** | 93 (identique) | Parcours de bout en bout du modèle v2 : structure et droits (RLS, fonctions non exécutables par `anon`), revue du bureau, règlement DIRECT et CONDITIONAL, scan, contestation, déblocage, litiges, rejet, suppression de brouillon (D4). |
| `01_lot4.sql` | 78 / 7 / 45 / 0 | **130** | 130 | Lot 4 (0005) mis à jour v2 : codes d’erreur, recherche de prestataires, `save_draft`, invitations, pièces (limites, archivage), soumission, notifications, litiges, rejet, fonctions de démonstration et refus hors `mock_mode`. |
| `02_lot5.sql` | 110 / 3 / 31 / 0 | **144** (143 exécutées en `mock_mode`) | 144 | Bureau de contrôle (0006) : file `bo_*`, prise en charge, décision avec case du montant, double validation, validateur partie, pièces et ouvertures journalisées, preuves de jalon, litiges, journal d’audit, second facteur `aal2`, chaîne d’audit rompue. |
| `03_lotx.sql` | 76 / 6 / 33 / 0 | **115** | 115 | Lot X passe 1 (0007-0008) sur le noyau v2 : jetons lisibles par le payeur, substitution de destinataire, révocation/réémission, décisions du payeur, règlement DIRECT, demandes initiées par un prestataire (niveau N2). |
| `04_lotx_p2.sql` | 96 / 7 / 37 / 0 | **140** | 140 | Lot X passe 2 (0009-0012) : empreintes SHA-256, pièces immuables, réutilisation, consultations journalisées, tentatives de paiement idempotentes, événements du partenaire, journal financier équilibré et immuable, remboursements, modules configurables, multi-payeurs. |
| `05_lotx2_p1.sql` | 31 / 0 / 13 / 0 | **44** | 44 | Lot X v2 passe 1 (0013-0019) : statuts v2 et contraintes, résolution de référence (0015), acceptation du plan et jeton de présentation (0016), litige avant paiement `REQUEST_ON_HOLD` (0018), remboursement de fonds bloqués (0019). |
| `06_lotx2_p2.sql` | 70 / 2 / 44 / 3 | **119** | 119 | Lot X v2 passe 2 (0020-0023) : enrôlement et niveaux (60 selon la doc), devis, devises, paiements, remboursements (39), santé à données minimales et types de pièce (20). |
| `local-postgres-stubs.sql` | — | **0** | — | Émulation minimale de Supabase pour un PostgreSQL ordinaire : rôles `anon`/`authenticated`/`service_role`, schémas `auth`, `storage`, `extensions`, `auth.uid()`, `auth.jwt()`, `storage.foldername`, publication `supabase_realtime`, privilèges par défaut. |

Notes :
- **Variantes `_editor`** : générées par `scripts/sql-editor-variant.mjs` (en-tête « ne pas modifier ») ; seules différences (`diff`) : 2 lignes d’en-tête et le bloc de résumé, qui lève toujours une exception (pour annuler le test dans l’éditeur Supabase) et liste les échecs. Même nombre de vérifications pour les 7 paires.
- **02** : la vérification de la l. 462 (« demo_review absente … rien à vérifier ») ne s’exécute que si `demo_review` n’existe pas ; en `mock_mode`, 143 vérifications s’exécutent, ce qui correspond au compte « 133 → 143 » de `docs/lotx2-controles-sql.md`.
- **04** : 140 = 139 annoncées pour la passe 1 + 1 ajoutée en passe 2 X6 (« `OTHER` refusé [`DOCUMENT_KIND_NOT_ALLOWED`] (140 contrôles au lieu de 139) »).
- **06** : 119 = 60 (X4) + 39 (X5) + 20 (X6), conforme à la doc.
- **Incohérence d’en-tête** : `05_lotx2_p1.sql` porte le même commentaire d’en-tête que `04_lotx_p2.sql` (« Test des migrations 0009 à 0012 ») alors que son contenu teste 0013-0019 (sections « X1 », « X3 », « 0018 », « 0019 »).
- Prérequis déclarés : `mock_mode = 'true'` (01 à 06) ; « 0001 à 0016 appliquées » (02, 04, 05), « 0001 à 0023 » (06).

## 14. Contrôles modifiés par la « passe 2 » (`docs/lotx2-controles-sql.md`)

Comptes globaux de la passe 1 du lot X v2 (avant la passe 2, l. 5 du document) : 00_smoke 70 → 93, 01_lot4 119 → 130, 02_lot5 133 → 143, 03_lotx 111 → 115, 04_lotx_p2 123 → 139.

**Passe 2, X4 (0020) — niveaux d’enrôlement**
- Jeu d’essai (sans vérification) : le demandeur de 00, 01, 02, 03, 05 est relevé à `N1` (`save_draft` exige N1).
- `03_lotx.sql`, trois contrôles remplacés : « prestataire sans autorisation refusé [`INITIATION_NOT_ALLOWED`] » → « prestataire sans le niveau N2 refusé [`ENROLMENT_REQUIRED`] » ; « un utilisateur ne s’accorde pas l’autorisation d’initier » → « … pas de niveau d’enrôlement [`PROFILE_PROTECTED`] » ; « autorisation inchangée » → « niveau inchangé (N0) ». Réglage `can_initiate_requests = true` → `enrolment_level = 'N2'`.
- Nouveau : `06_lotx2_p2.sql`, partie X4, 60 vérifications.

**Passe 2, X5 (0021) — statuts de tentative et de remboursement**
- `00_smoke.sql` : remboursement intégral créé → `refunds.status` `'PENDING'` → `'REQUESTED'`.
- `02_lot5.sql` : litige tranché, demande toujours PAID → `'PENDING'` → `'REQUESTED'`.
- `05_lotx2_p1.sql` : REFUND_FULL sur fonds bloqués → `'PENDING'` → `'REQUESTED'`.
- `04_lotx_p2.sql` : `start_payment` (tentative `'PENDING'` → `'INITIATED'`) ; signature invalide (toujours `'INITIATED'`) ; montant différent (toujours `'INITIATED'`) ; paiement réussi (`'SUCCEEDED'` → `'CONFIRMED'`) ; hors d’ordre (`'CONFIRMED'`) ; même clé après réussite (`'CONFIRMED'`) ; écart volontaire du rapprochement (jeu d’essai) `'CONFIRMED'`.
- Nouveau : `06_lotx2_p2.sql`, partie X5, 39 vérifications.

**Passe 2, X6 (0022, 0023) — santé à données minimales, types de pièce prévus**
- `00_smoke.sql` : jeu d’essai santé du rejet → devis seul et `beneficiary_reference` posée.
- `01_lot4.sql` : pièces obligatoires D2 7 → 6 ; « pièce obligatoire manquante (pièce d’identité) [`DOCUMENT_REQUIRED`] » **remplacé** par « pièce d’identité refusée pour la santé [`DOCUMENT_KIND_NOT_ALLOWED`] » ; `save_draft` conserve 1 pièce au lieu de 2 ; brouillons santé `beneficiaryName` → `beneficiaryReference`.
- `04_lotx_p2.sql` : `required_documents` (vue) santé = devis seul ; « pièce obligatoire du module manquante » avec une pièce facultative `PHOTO` ; **ajout** « `OTHER` refusé » (139 → 140).
- Nouveau : `06_lotx2_p2.sql`, partie X6, 20 vérifications.

## 15. Seeds

| Fichier | Garde | Ce qu’il crée |
|---|---|---|
| `supabase/seed.sql` | refuse si `app_config.mock_mode <> 'true'` ; idempotent | 3 comptes de plateforme dans `auth.users` + `auth.identities` (fournisseur « phone ») : Validateur A, Validateur B (`VALIDATOR`), Administrateur (`ADMIN`), sur des **numéros de test réservés** (tranche fictive ARCEP indiquée en commentaire ; code OTP fixe déclaré dans la configuration d’authentification, aucun SMS) ; 15 prestataires vérifiés fictifs (`providers`, Yaoundé et Douala : éducation, santé, location, agro), dont 3 portant le numéro du compte prestataire de démonstration (rattachés à ce compte) ; `app_config.auto_issue_token = 'true'` ; niveaux d’enrôlement `N1` (demandeur de démonstration) et `N2` (prestataire de démonstration, compte des tests de contrat). |
| `supabase/seed-staff.sql` | refuse si `mock_mode <> 'true'` ; mot de passe lu depuis la variable psql `staff_password` (fournie par `scripts/db.sh seed-staff` depuis `.env.local`, 12 caractères minimum), effacée en fin de script | 5 comptes e-mail `@diaspay.test` : 2 validateurs, 1 administratrice, 1 validateur aussi payeur dans un dossier de test (avec un numéro réservé aux tests), 1 utilisateur ordinaire (pour vérifier le refus d’accès au bureau) ; mot de passe haché `bf` (pgcrypto) ; identités « email » ; rôles de plateforme. |
| `supabase/seed-evidence.sql` | refuse si `mock_mode <> 'true'` ; exige deux validateurs (seed ou seed-staff) | Un dossier terrain (`LAND`) en règlement `CONDITIONAL` amené jusqu’à « preuve de jalon en attente » : soit fictif (2 tranches `EVIDENCE_REVIEW`, 2 pièces sans fichier dans le bucket), soit à partir d’un brouillon existant (`<tx_id>`) ; statuts `PENDING_REVIEW` → `IN_REVIEW` → `ACTIVE`, 2 validations, contribution et tentative `CONFIRMED`, ligne `payments`, journal financier `PAYMENT`, demande `PAID` fonds `HELD`, `EVIDENCE_SUBMITTED` ; apparaît dans `bo_evidence_queue`. |

## 16. Retours arrière (`supabase/rollbacks/`)

| Fichier | Lignes | Objet |
|---|---|---|
| `0011_lotx_x6_down.sql` | 256 | Annule 0011 : restaure les tables `release_rules` et `required_documents`, `transactions.vertical` en enum, et les fonctions de 0008/0009 copiées à l’identique (`transition_tx`, `save_draft`, `_documents_guard`) ; refuse si un dossier utilise un type absent de l’enum `vertical`. |
| `0012_lotx_x7_down.sql` | 20 | Annule 0012 : restaure la clé primaire `(tx_id, role)` ; à exécuter **avant** celui de 0011 ; refuse si un dossier a deux parties de même rôle. |

Aucun retour arrière pour 0013-0023. Ces deux scripts datent d’avant le noyau v2 (0014) : ils ne sont pas cohérents avec l’état final (par exemple `save_draft` et `transition_tx` ont été redéfinis depuis en 0014, 0020, 0022) et ne doivent pas être joués sur une base à 0023 sans réécriture.

## 17. Risques et points d’attention (avec preuves)

1. **Six fonctions DEFINER exécutables par `anon`** (section 11) : `has_role`, `is_party`, `is_validator`, `is_admin` (0001, 0006), `status_ok` (0001), `required_validations` (0003). Impact faible (résultats liés à `auth.uid()`, ou oracle minimal sur un UUID), mais incohérent avec la règle affichée en 0005 (« Aucune fonction nouvelle n’est exécutable par anon »).
2. **`app_config` lisible par `anon`** : politique `config_read … using (true)` sans `TO` (0001) et aucun `REVOKE` de table. Les valeurs actuelles ne sont pas secrètes, mais toute clé sensible ajoutée plus tard serait publique ; cela révèle aussi `mock_mode`, `require_staff_mfa`, `payment_provider`.
3. **Valeurs par défaut de développement** : `mock_mode = 'true'` (0001) et `require_staff_mfa = 'false'` (0006) à l’installation ; la production dépend de `docs/release-checklist.md` (points 8, 9, 17). Si 0005/0006/0014 sont appliquées avec `mock_mode = 'true'`, les `demo_*` existent (exécutables par `authenticated`, refus `DEMO_DISABLED` hors `mock_mode`).
4. **Écriture directe sur `transactions` en brouillon** (à confirmer par un test) : la politique `tx_update_draft` (0003) autorise l’`UPDATE` de toute colonne d’un dossier `DRAFT`/`REJECTED` par son créateur partie (REQUESTER ou PAYER) ; aucun `REVOKE UPDATE` ni droit par colonne sur `transactions` ; aucun déclencheur ne contrôle `beneficiary_name` (déclencheurs `guard_status`, `transactions_defaults`, `transactions_draft_settlement` seulement). `submit_operation` (0022) vérifie la présence de `beneficiary_reference` mais pas l’absence de `beneficiary_name`. Un client pourrait donc contourner `BENEFICIARY_NAME_NOT_ALLOWED` de `save_draft` (K13, santé) par un `PATCH` PostgREST. Même logique pour `tx_insert` (0001) et `parties_insert` (0001), qui permettent l’insertion directe en `DRAFT` hors `save_draft` (les contrôles de niveau sont toutefois refaits à la soumission : `ENROLMENT_REQUIRED` via `submit_operation`).
5. **`profiles.phone` modifiable par l’utilisateur** (à confirmer) : `profiles_self_update` (0004) sans restriction de colonne ; `guard_profile` (0020) ne protège que `platform_role`, `kyc_status`, `enrolment_level`. Or `_user_by_phone` (DEFINER) résout une contrepartie par `_norm_phone(phone)` avec `limit 1`, alors que l’unicité porte sur la valeur brute (`phone text unique`, 0001) : un utilisateur pourrait se donner le numéro (normalisé ou dans un autre format) d’un tiers et être désigné à sa place dans un nouveau dossier.
6. **Retours arrière obsolètes** (section 16).
7. **`fee_schedule` jamais initialisée** (0021) : frais à zéro par défaut ; et **durées de vie non configurées hors `mock_mode`** (`presentation_token_ttl_seconds`, `fx_quote_ttl_seconds`) : `NOT_CONFIGURED` en production tant que l’exploitant ne les a pas posées (comportement voulu, « point ouvert 2 »).
8. **`enrolment_limits` vide hors développement** : `_check_payer_limits` lève `LIMITS_NOT_CONFIGURED` (0020), donc aucun paiement `accept_and_pay` possible en production sans plafonds configurés (voulu, à inscrire dans la mise en production).
9. **Test 00** : la vérification « aucune fonction sensible exécutable par anon » repose sur une liste fermée ; elle ne détecte pas une nouvelle fonction oubliée.
