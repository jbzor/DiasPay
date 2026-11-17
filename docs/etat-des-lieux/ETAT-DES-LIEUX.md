# État des lieux du dépôt `diaspay` — 16 novembre 2026

Audit en lecture seule, branche `lotX`, commit `b31f68e`. Aucun accès au projet Supabase distant : tout ce qui suit est lu dans le dépôt. Les valeurs secrètes ne sont jamais reproduites.

**Étiquettes** : `[VÉRIFIÉ]` lu dans le code, avec preuve ; `[PARTIEL]` présent en partie ; `[ABSENT]` cherché, non trouvé ; `[DIVERGENT]` existe mais ne correspond pas à la décision ; `[NON DÉTERMINABLE]` impossible à savoir depuis le dépôt.

**Annexes** (`annexes/`) : `depot-et-outillage.md`, `migrations-0001-0013.md`, `migrations-0014-0023.md`, `base-de-donnees.md`, `domaine-et-api.md`, `mobile-et-web.md`.

---

## A. Identité du dépôt

- **Branche courante** : `lotX`. **Branches locales** : `lot5`, `lotX`, `master`. **Aucune branche distante, aucun dépôt distant configuré** (`git remote -v` vide). **Aucune étiquette.** `[VÉRIFIÉ]`
- **Branche principale** : `master`. Il n’existe pas de branche `main`.
- **Fusions** :
  - `lot5` est entièrement dans `master` : même commit `6993f7a`, 0 en avance, 0 en retard.
  - `lotX` a **14 commits d’avance sur `master` et n’est pas fusionnée**. Elle contient les deux passes du lot X : la passe 1 (v1) et la refonte v2.
  - Il n’existe pas de branches `lot1` à `lot4` : ces lots ont été commités en ligne sur la branche principale.
- **Historique** : 52 commits, du 9 au 13 novembre 2026. 1 `chore` (état initial v0.1), lot1 : 7, lot2 : 6, lot3 : 6, lot3b : 6, lot4 : 5, lot5 : 7, lotX : 14. Les 40 derniers commits sont dans l’annexe `depot-et-outillage.md` §1.
- **`git status`** : un seul fichier non suivi, `Archive.zip`, et aucune modification suivie.
  - `Archive.zip` pèse 261 429 384 octets et contient 1 943 entrées, dont 666 sous `node_modules`.
  - **Il contient `apps/web/.env.local` et `apps/mobile/.env.local`.** Contenu non lu.
- **`.gitignore`** :
  - Couvre `.env` et `.env.*` (sauf `.env.example`), `node_modules`, `dist`, `.turbo`, `.expo/`, `apps/mobile/dist/`, ainsi que `.next/`, `next-env.d.ts` et les rapports Playwright dans `apps/web/.gitignore`.
  - **Ne couvre pas `Archive.zip` ni `*.zip`.** `[VÉRIFIÉ]`

## B. Arborescence et volume

Monorepo pnpm et Turborepo :

| Paquet | Contenu |
|---|---|
| `apps/mobile` | application Expo, routes `expo-router` sous `src/app` |
| `apps/web` | bureau de contrôle Next.js 16 |
| `packages/domain` | règles métier en TypeScript pur |
| `packages/api-client` | contrat d’API, simulateur `MockApi`, `SupabaseApi` |
| `packages/ui-tokens` | charte graphique |

À côté : `supabase/` (23 migrations, 14 scripts de test, 3 seeds, 2 retours arrière), `scripts/` et `docs/`. L’arborescence complète sur 3 niveaux est dans l’annexe `depot-et-outillage.md` §2.

Lignes de code des fichiers suivis, hors tests et hors fichiers générés (`database.types.ts` fait 3 321 lignes et n’est pas compté) :

| Paquet | Fichiers | Lignes | Lignes de tests |
|---|---|---|---|
| apps/mobile | 84 | 6 722 | 762 |
| apps/web | 56 | 3 213 | 1 361 |
| packages/api-client | 12 | 2 898 | 1 852 |
| packages/domain | 23 | 2 507 | 1 463 |
| packages/ui-tokens | 1 | 89 | 74 |
| supabase/migrations | 23 | 8 370 | — |

## C. Dépendances et outillage

- **Outils** :
  - Le dépôt fixe pnpm 9.12.0 (`packageManager`), mais pas la version de Node : ni `engines` ni `.nvmrc`. Node v24.21.0 a servi pour l’audit.
  - TypeScript 5.9.3 à la racine et dans les paquets, **6.0.3** dans les deux applications.
  - turbo 2.11.10, vitest 2.1.9, Playwright 1.65.0.
  - Next.js 16.4.6, Expo SDK 58, React 19.3.0, React Native 0.88.1.
  - Le tableau complet, avec version demandée et version installée par paquet, est dans l’annexe §3.
- **Paquets demandés**, tous dans `apps/mobile` et tous importés :

  | Paquet | Version installée |
  |---|---|
  | `expo-router` | 58.0.30 |
  | `expo-secure-store` | 58.0.2 |
  | `expo-local-authentication` | 58.0.2 |
  | `expo-camera` | 58.0.14 |
  | `expo-haptics` | 58.0.7 |
  | `expo-sharing` | 58.0.22 (utilisé par le reçu) |
  | `expo-screen-capture` | 58.0.6 |
  | `expo-crypto` | 58.0.8 |
  | `aes-js` | 3.1.2 |
  | `react-native-get-random-values` | 2.1.0 |
  | `@react-native-community/netinfo` | 12.0.1 |

  **`expo-clipboard` et `react-native-view-shot` ne sont pas déclarés** `[VÉRIFIÉ]`.
- **Déclarés mais jamais importés** (hors outillage) :
  - `expo-linking` dans `apps/mobile` ;
  - `@supabase/supabase-js` dans `apps/mobile`, qui ne l’utilise qu’à travers `@diaspay/api-client`.
- **Importés mais non déclarés** : aucun. Seuls apparaissent des alias `@/` et des modules `node:` intégrés.
- **Scripts** :
  - racine : `test`, `typecheck`, `build`, `capture`, `db:types`, `db:test`, `test:supabase`, `dev:web` ;
  - applications : `typecheck`, `test`, `e2e` pour le web ;
  - seul `apps/web` a un script `build`.

## D. Base de données (d’après le dépôt)

### D.1 Migrations

Le détail est dans les annexes `migrations-0001-0013.md` et `migrations-0014-0023.md`. Les colonnes donnent la taille en octets et le commit qui a ajouté le fichier. Toutes les dates vont du 11 au 13 novembre 2026.

| N° | Octets | Commit | Résumé |
|---|---|---|---|
| 0001 | 19 633 | cb1dc44 | Schéma v0.1 : profils, opérations, parties, pièces, validations, `trust_tokens`, paiements, `audit_log` chaîné, `allowed_transitions`, RLS, bucket privé `dossiers` ; `mock_mode = true` |
| 0002 | 500 | cb1dc44 | Valeurs d’enum : verticales RENT, AGRO, REAL_ESTATE, LAND ; `tx_status` IN_PROGRESS |
| 0003 | 34 017 | cb1dc44 | Tranches, `release_rules`, `dual_thresholds`, `tranche_tokens`, `disputes`, `release_due_tranches`, `activate_due_tranches` |
| 0004 | 8 274 | cb1dc44 | Correctifs : `sha256()` natif, D4 (abandon, suppression d’un brouillon jamais audité), `guard_profile`, `disputes.reason_code` |
| 0005 | 62 433 | 69e4626 | Lot 4 : codes stables `_err` → `hint`, brouillons serveur (`save_draft`, `delete_draft`), invitations, prestataires, limites des pièces (3 par type, 10 Mo), notifications, fonctions `demo_*`, **deux tâches pg_cron** |
| 0006 | 35 078 | 02f08bb | Lot 5 : second facteur du personnel (`require_staff_mfa`, `_staff_aal_ok` dans `is_validator`), vues `bo_*`, contrôles automatiques, `claim_dossier`, `open_document` journalisé |
| **0007** | 798 | b7ecaf5 | Valeurs d’enum : tranche INFO_REQUESTED et REJECTED ; mode de déblocage IMMEDIATE |
| **0008** | 50 160 | b7ecaf5 | **Sécurité du TrustLink** : `revoked_at`, `revoke_token`, `reissue_token`, `security_events`, `_reference_guard` (TOO_MANY_ATTEMPTS), `eqr_image_enabled` (vrai). **Décisions du payeur** : `request_messages`, `request_info`, `answer_info`, `reject_request`, `mark_received`. **Initiation par un prestataire** : `can_initiate_requests` |
| **0009** | 17 161 | 7efbfdd | **TrustVault** : `documents.content_hash` et `hash_algo`, détection de réutilisation (`_hash_reuse`), `get_document_access` journalisée, pièces figées après soumission, réglage `require_content_hash` |
| **0010** | 38 271 | a795409 | **Fondations des paiements** : `payment_attempts` (clé d’idempotence unique), `refunds`, `webhook_events`, journal à double entrée (`ledger_accounts`, `ledger_journals`, `ledger_entries`), `apply_payment_event` (service_role seulement), `request_refund`, `v_reconciliation`, `start_payment`, `demo_settle_payment` |
| **0011** | 31 288 | a00c23f | **`request_modules`** : `transactions.vertical` passe en texte avec clé étrangère vers `request_modules(code)` ; anciennes tables renommées `_release_rules_0003` et `_required_documents_0005` ; vues de compatibilité `release_rules` et `required_documents` ; `platform_review` |
| **0012** | 3 182 | d2a3e36 | **Multi-payeurs** : `transaction_parties` reçoit son propre identifiant et des contraintes d’unicité ; second payeur seulement si le module l’autorise (MULTIPLE_PAYERS_NOT_ALLOWED) |
| **0013** | 2 038 | de85dfc | Valeurs d’enum v2 (PENDING_REVIEW, ACTIVE, SUSPENDED, SUBMITTED, ACCEPTED, PAID, REFUNDED, INITIATOR…) ; type `settlement_mode` (DIRECT, CONDITIONAL) |
| **0014** | 103 295 | de85dfc | **Noyau v2** : statuts imposés par des CHECK (anciens statuts convertis), `settlement_mode`, `funds_state`, `on_hold`, litige distinct (`dispute_messages`, issues), `payment_requests` en vue sur `tranches`, `platform_review` à NEVER, `allowed_transitions` et `tranche_transitions` réécrites, **3ᵉ tâche pg_cron** (`expire_due_requests`) |
| **0015** | 1 692 | 888fcb4 | `eqr_image_enabled` passe à **faux** ; `_party_token` réservé au payeur et à l’initiateur (au prestataire seulement en CONDITIONAL) |
| **0016** | 9 123 | 680471e | `accept_plan` ; `presentation_tokens` (empreinte SHA-256, usage unique, rotation, révocation) : `issue_presentation_token`, `claim_presentation_token`, `revoke_presentation_token` ; durée de vie de 90 s posée seulement en `mock_mode` |
| **0017** | 3 607 | de85dfc | `_notify_from_audit` : plus de notification TRANCHE_RELEASED en double après un litige |
| **0018** | 5 646 | de85dfc | REQUEST_ON_HOLD vérifié avant TX_NOT_ACTIVE ; `reissue_token` refusé en DIRECT |
| **0019** | 4 334 | de85dfc | Un remboursement total (REFUND_FULL) sur des fonds HELD les passe à RETURNED |
| 0020 | 39 767 | ed0e2b0 | Enrôlement N0 à N3 : `profiles.enrolment_level`, `enrolment_cases`, `enrolment_documents`, `enrolment_events`, `enrolment_limits`, KYC simulé et `apply_kyc_result` (service_role), bucket `identity` ; `can_initiate_requests` supprimée |
| 0021 | 52 038 | 309fdec | Paiements v2 : statuts de tentative et de remboursement, `contributions`, `fx_quotes`, `get_quote`, `accept_and_pay`, `start_payment` réduit à un raccourci, `mark_refund_executed`, frais au journal, `v_reconciliation` recréée |
| 0022 | 22 293 | b31f68e | `beneficiary_mode`, `retention_days`, sensibilité des pièces ; santé réduite au devis ; `transactions.beneficiary_reference` ; DOCUMENT_KIND_NOT_ALLOWED |
| 0023 | 3 228 | b31f68e | Correctif : la preuve de jalon (EVIDENCE) échappe à DOCUMENT_KIND_NOT_ALLOWED |

**Point d’attention sur la numérotation.** Les migrations 0007 à 0012 appartiennent à la **passe 1 du lot X (v1)**, dont la numérotation diffère de la v2 :

| Tâche | Passe 1 (v1) | Version 2 |
|---|---|---|
| X4 | TrustVault | Enrôlement |
| X5 | Paiements | Paiements |
| X6 | Modules | Modules |
| X7 | Multi-payeurs | Empreintes de pièces |

Plusieurs objets de la v1 **survivent et sont actifs** : `content_hash`, `_hash_reuse`, `transaction_parties`, `security_events`, `request_messages`, les tables du journal financier, et les tables archivées `_release_rules_0003` et `_required_documents_0005`, jamais supprimées.

### D.2 Tables

39 tables, dont 2 archivées, **toutes sous RLS** (aucune en FORCE RLS), 7 vues et 27 déclencheurs. `database.types.ts` est **en phase avec 0023** : mêmes tables, vues et fonctions. Il contient aussi les fonctions `demo_*`, ce qui montre qu’il a été généré sur une base en `mock_mode`. Ses énumérations gardent les valeurs v1, qu’on ne peut pas retirer d’un type PostgreSQL. Liste et colonnes : annexe `base-de-donnees.md` §3. `[VÉRIFIÉ]`

### D.3 Fonctions SQL

**175 fonctions** :
- 141 SECURITY DEFINER, toutes avec `set search_path = public`, et 34 INVOKER ;
- 25 fonctions de déclencheur ;
- 3 fonctions `demo_*`, créées seulement en `mock_mode`.

Droits :
- 81 fonctions sont accordées explicitement à `authenticated` ;
- 81 sont internes, retirées à `anon` et à `authenticated` ;
- seules `apply_payment_event` et `apply_kyc_result` sont accordées à `service_role`.

Les 98 codes d’erreur distincts passent tous par `_err`, qui place le code dans `hint`. Signatures, droits et codes par fonction : annexe `base-de-donnees.md` §6.

### D.4 Politiques, stockage, tâches planifiées, réglages

- **Politiques RLS** : 56, dont 7 sur `storage.objects` (annexe §7).
- **Buckets**, tous deux privés :
  - `dossiers` : 10 Mio ; jpeg, png, pdf (0001, limites en 0005).
  - `identity` : 10 Mio ; jpeg, png, heic, pdf (0020). Si le bucket existe déjà, son `on conflict` ne réapplique pas les limites.
- **pg_cron** : voir J2.
- **Clés `app_config` et valeurs initiales** :

  | Clé | Valeur initiale |
  |---|---|
  | `mock_mode` | `true` (0001) |
  | `token_ttl_days` | 7 |
  | `activation_lead_days` | 7 |
  | `open_verticals` | (plus lue depuis 0011) |
  | `require_staff_mfa` | `false` (0006) |
  | `auto_issue_token` | `false` (`seed.sql` la passe à `true`) |
  | `eqr_image_enabled` | `true` en 0008, puis `false` en 0015 |
  | `reference_failure_limit` | 10 |
  | `require_content_hash` | `false` |
  | `payment_provider` | `SIMULATED` |

  Clés posées **seulement en `mock_mode`** : `presentation_token_ttl_seconds` (90), `kyc_simulated_result` (APPROVED), `fx_quote_ttl_seconds` (300), `simulated_fx_rates` (EUR/XAF).

  `fee_schedule` est lue en 0021 mais jamais insérée.

### D.5 Scripts SQL de test

Méthode de comptage : appels `t.check`, `t.fails`, `t.hint` et `t.ok`, hors définitions des fonctions d’aide. Aucun n’est dans une boucle. **Ces scripts n’ont pas été lancés**, car ils exigent un accès à la base.

| Script | Contrôles | Couverture |
|---|---|---|
| 00_smoke | 93 | droits, RLS, chaîne d’audit, fonctions de base |
| 01_lot4 | 130 | codes stables, brouillons, invitations, pièces, notifications, reçu et litige |
| 02_lot5 | 144 | bureau de contrôle, second facteur, vues `bo_*` ; 143 en `mock_mode`, un contrôle conditionnel |
| 03_lotx | 115 | lot X passe 1, contrôles réécrits pour la v2 |
| 04_lotx_p2 | 140 | noyau v2 (0013, 0014, 0017 à 0019) |
| 05_lotx2_p1 | 44 | X1 et X3 v2 (0015, 0016). L’en-tête annonce « 0009 à 0012 » par erreur de copie |
| 06_lotx2_p2 | 119 | X4 (60), X5 (39), X6 (20) |

- Chaque variante `*_editor.sql` a le même nombre de contrôles que son script.
- Les comptes concordent avec `docs/lotx2-controles-sql.md`.
- Contrôles modifiés par la passe 2 : annexe §14.
- **Seeds** (tous refusent de s’exécuter hors `mock_mode`) :
  - `seed.sql` : 3 comptes du personnel par téléphone, 15 prestataires fictifs, niveaux d’enrôlement ;
  - `seed-staff.sql` : 5 comptes e-mail `@diaspay.test`, mot de passe passé en variable psql ;
  - `seed-evidence.sql` : un dossier LAND en CONDITIONAL avec une preuve de jalon à revoir.
- **Retours arrière** : seulement `0011_lotx_x6_down.sql` et `0012_lotx_x7_down.sql`. Ils sont antérieurs à 0014 et inutilisables sur une base à 0023.

### D.6 Fonctions sans révocation explicite pour `anon`

Aucune migration ne contient `ALTER DEFAULT PRIVILEGES` ni de `REVOKE … ON ALL FUNCTIONS`. 13 fonctions n’ont **aucun** `REVOKE … FROM anon/public` :

- **SECURITY DEFINER appelables par RPC** : `has_role`, `is_party`, `status_ok` (0001), `required_validations` (0003), `is_validator`, `is_admin` (0006).
  - `status_ok` et `required_validations` lisent `transactions` sans RLS : `status_ok` peut confirmer qu’un UUID d’opération existe. Impact faible.
- **INVOKER** : `verify_audit`, qui reste soumise à la RLS.
- **Déclencheurs, non appelables directement** : `handle_new_user` (definer), `audit_chain`, `audit_immutable`, `guard_status`, `guard_tranche_status`, `guard_profile`.

Le contrôle de 00_smoke sur ce point porte sur une **liste fermée** : il ne détecterait pas une nouvelle fonction ajoutée sans révocation. `[VÉRIFIÉ]`

## E. Domaine (`packages/domain`)

23 fichiers source, exportés par `src/index.ts`. Fichiers et exports : annexe `domaine-et-api.md` §2.1.

**Statuts** (`types.ts`) :
- **Opération** : DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED.
- **Demande** (`PAYMENT_REQUEST_STATUSES`, alias `TRANCHE_STATUSES`) : DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED.
- **Tentative** : INITIATED, PENDING, CONFIRMED, FAILED. **Remboursement** : REQUESTED, EXECUTED, FAILED. **Contribution** : PENDING, CONFIRMED, FAILED, REFUNDED.
- **Litige** : OPEN, AWAITING_RESPONSE, IN_MEDIATION, RESOLVED.
- **Modes** : `SettlementMode` vaut DIRECT ou CONDITIONAL ; `FundsState` vaut NONE, HELD, RELEASED ou RETURNED ; `ReleaseMode` vaut PROVIDER_CONFIRM, PAYER_CONFIRM, EVIDENCE_REVIEW ou AUTO.

**Machine de l’opération** (`operationMachine.ts`, `OPERATION_TRANSITIONS`). Elle est identique à `allowed_transitions` de 0014. STAFF désigne un validateur sans rôle dans le dossier. `[VÉRIFIÉ]`

| De | Vers | Rôles | Remarque du code |
|---|---|---|---|
| DRAFT | ACTIVE | INITIATOR | soumission sans revue (AUTO_ACTIVATED) |
| DRAFT | PENDING_REVIEW | INITIATOR | soumission avec revue |
| PENDING_REVIEW | IN_REVIEW | STAFF | prise en charge |
| PENDING_REVIEW | ACTIVE | STAFF | |
| IN_REVIEW | ACTIVE | STAFF | |
| PENDING_REVIEW | CANCELLED | STAFF | |
| IN_REVIEW | CANCELLED | STAFF | |
| ACTIVE | SUSPENDED | SYSTEM, STAFF | litige avant paiement, ou fraude |
| SUSPENDED | ACTIVE | SYSTEM, STAFF | |
| ACTIVE | CLOSED | SYSTEM | |
| DRAFT | CANCELLED | INITIATOR | |
| ACTIVE | CANCELLED | INITIATOR | |

Gardes, dans l’ordre :
1. TRANSITION_UNKNOWN.
2. VALIDATOR_ONLY, puis VALIDATOR_IS_PARTY.
3. TRANSITION_FORBIDDEN.
4. À la soumission : TX_CONTEXT_REQUIRED, puis `validatePlan` (PLAN_EMPTY, PLAN_BAD_AMOUNT, PLAN_SUM_MISMATCH), puis TX_NO_DOCUMENT.

**Machine de la demande de paiement** (`paymentRequestMachine.ts`, `PAYMENT_REQUEST_TRANSITIONS`). Elle est identique à `tranche_transitions` de 0014. `[VÉRIFIÉ]`

| De | Vers | Rôles |
|---|---|---|
| DRAFT | SUBMITTED | INITIATOR, SYSTEM |
| SUBMITTED | INFO_REQUESTED | PAYER |
| INFO_REQUESTED | SUBMITTED | INITIATOR |
| SUBMITTED | ACCEPTED | PAYER |
| ACCEPTED | PAID | SYSTEM |
| ACCEPTED | SUBMITTED | SYSTEM (toutes les tentatives ont échoué) |
| SUBMITTED, INFO_REQUESTED | REJECTED | PAYER |
| DRAFT, SUBMITTED, INFO_REQUESTED | CANCELLED | INITIATOR |
| SUBMITTED, INFO_REQUESTED | EXPIRED | SYSTEM |
| PAID | REFUNDED | SYSTEM |

Gardes : TRANSITION_UNKNOWN ; INITIATOR_ONLY pour la réponse ; TRANSITION_FORBIDDEN (y compris un payeur qui est aussi l’initiateur et demande des informations) ; REQUEST_ON_HOLD vers INFO_REQUESTED ou ACCEPTED pendant un litige ouvert avant paiement.

Une demande est **finale** si elle est REFUNDED, REJECTED, CANCELLED ou EXPIRED, ou PAID avec des fonds autres que HELD.

**Constantes** (annexe §2.6) :

| Constante | Valeur |
|---|---|
| `MAX_FILES_PER_KIND` | 3 |
| `MAX_FILE_BYTES` | 10 Mo |
| Types MIME | jpeg, png, pdf |
| `DUAL_THRESHOLDS` (unités mineures) | EUR 500 000, USD 550 000, XAF 3 000 000 |
| Échecs de résolution | 10 par heure |
| Messages | 3 à 2 000 caractères |
| Échéances | 2 à 12 (versements), 2 à 60 (récurrent) |
| Fenêtre d’activation | 7 jours |
| `BENEFICIARY_REFERENCE_RE` | `^[A-Z0-9][A-Z0-9./-]{0,15}$` |

`DEFAULT_MODULES` coïncide avec l’amorçage SQL de `request_modules`, et un test le vérifie.

**Restes de l’ancien modèle** :
- `txMachine` et `trancheMachine` sont **supprimés** (commit `de85dfc`). `docs/decisions.md` (D4) cite encore `txMachine.ts`.
- Encore exportés :

  | Export | Utilisé par |
  |---|---|
  | `RELEASE_RULES` | `api-client/src/mockApi.ts` (`mkTranche`), `modules.ts` |
  | `REQUIRED_DOCUMENTS`, `missingRequiredDocuments`, `requiredValidations`, `evidenceOutcome` | tests du domaine, `modules.ts` |
  | `describeRelease` | `apps/mobile/src/app/need/recap.tsx` |
  | alias `TrancheStatus` / `TRANCHE_STATUSES` | i18n mobile, `api-client` |

- `apps/web` et `apps/mobile` redéclarent chacune leur propre constante `VERTICALS`.

## F. Contrat d’API (`packages/api-client`)

- **`TransactionApi`** a 42 méthodes, **toutes présentes dans `MockApi` et dans `SupabaseApi`**. Aucune n’est marquée « non implémentée ».
- `SupabaseApi` appelle 35 fonctions SQL, toutes présentes dans `database.types.ts`.
- **`AuthApi`** a deux implémentations, `MockAuth` et `SupabaseAuth`. Signatures : annexe §3.1.
- **Méthode absente des deux côtés** : `issuePresentationToken`. **Le jeton de présentation (0016) n’a aucun client** : ni méthode, ni écran. `[ABSENT]`
- Les ports `PaymentPort` v2 et `KycPort` sont dans le domaine, chacun avec **un seul adaptateur, simulé**.
- **Codes d’erreur** : les 113 codes de `ERROR_CODES` (`packages/domain/src/errors.ts`) figurent tous dans `docs/error-codes.md`. Il n’y a pas d’écart réel. La documentation garde toutefois :
  - des codes retirés (`TX_*`, `TR_*`, `INITIATION_NOT_ALLOWED`) dans ses tableaux « Codes renommés » ;
  - `NOT_FOUND` en double ;
  - un libellé de TX_NOT_ACTIVE qui cite encore IN_PROGRESS.
- **Suite de contrat** (`test/contract/contract.ts`) : 19 parcours, exécutés contre le simulateur, et contre Supabase seulement si `SUPABASE_TEST_*` est défini.
  - **Couverts** : recherche de prestataires ; cycle et isolation des brouillons ; soumission santé K13 ; PLAN_SUM_MISMATCH ; annulation ; alertes ; X1 direct sans jeton ; X2 informations et rejet ; X3 prestataire N2 ; X4 empreinte et consultation ; X5 paiement idempotent ; X6 modules ; codes pour références inconnues ; parcours direct complet ; litige avant paiement ; litige après paiement avec remboursement ; enrôlement N1 par KYC ; devis EUR puis paiement avec rejeu.
  - **Non couverts** : jeton de présentation, mode CONDITIONAL, plafonds, `markRefundExecuted`, revue N3, authentification.

## G. Application mobile (`apps/mobile`)

### G.1 Routes par parcours

Les accès sont gardés par `Stack.Protected` avec `canSetup` et `canUseApp` (`src/app/_layout.tsx`, `src/lib/flow.ts`). Détail des écrans et des crochets : annexe `mobile-et-web.md` §1.

| Parcours | Routes |
|---|---|
| Démarrage et connexion | `index`, `(onboarding)/slides`, `(auth)/login`, `(auth)/otp`, `profile-setup`, `biometrics`, `+native-intent`, `tranche/[trancheId]`, `(tabs)/home`, `(tabs)/alerts` |
| Création d’un besoin | `need/type`, `need/details`, `need/provider`, `need/plan`, `need/documents`, `need/recap`, `need-done/[txId]`, `(tabs)/transactions` |
| Paiement et suivi | `tx/[id]`, `pay/[trancheId]` (biométrie puis `api.payTranche`), `token/[trancheId]` |
| Litiges et reçu | `dispute/[trancheId]`, `dispute/view/[trancheId]`, `receipt/[trancheId]` (impression, partage) |
| Profil et sécurité | `(tabs)/profile`, `profile/edit`, `profile/security` |
| Scan | `(tabs)/scan` (`expo-camera`, `scanReducer`, `resolveReference`, `confirmByReference`) |

**Aucun écran** pour l’enrôlement, le devis et les frais, l’acceptation de l’échéancier ou le jeton de présentation. `[ABSENT]`

### G.2 i18n et configuration

- **646 clés en français et 646 en anglais, parité complète.** Elle est imposée par le typage et testée (`test/i18n.test.ts`).
- Variables lues : `EXPO_PUBLIC_API`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_DEMO`, `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE`, `EXPO_PUBLIC_HELP_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_UPLOAD_FAILURE_RATE`. Toutes figurent dans `.env.example`.
- `app.json` :
  - schéma `diaspay` ;
  - seule permission : la caméra ;
  - **aucun domaine associé ni filtre d’intention Android** sur un domaine web.

### G.3 Ancien modèle

108 fichiers contiennent au moins un des termes cherchés. Le tableau complet est dans l’annexe §8.

**Aucun usage fonctionnel résiduel** dans le code applicatif. Les occurrences restantes sont :
- les migrations historiques et la conversion de 0014 ;
- des valeurs d’enum qu’on ne peut pas retirer ;
- des tests de refus ;
- des libellés du journal antérieur côté web ;
- des termes **légitimes en v2** : `IN_REVIEW` (statut), `RELEASED` (`funds_state`), `CONFIRMED` (tentative), `vertical` (nom de colonne conservé), `release_rules` (vue lue par `save_draft`).

Résidus à corriger :
- `supabase/README.md`, l.77 et l.93 ;
- le libellé de TX_NOT_ACTIVE dans `packages/domain/src/errors.ts`, l.26 ;
- un commentaire « table » au lieu de « vue » dans `packages/domain/src/rules.ts`, l.15.

### G.4 Adaptations minimales (`docs/lotx2-adaptations-ecrans.md`)

Presque tout est `[VÉRIFIÉ]`. Deux exceptions :
- **Reçu `[DIVERGENT]`** : le titre à l’écran reste « Tranche débloquée », même en DIRECT (`receipt/[trancheId].tsx`, l.80). Seuls le PDF et le partage disent « Tranche payée » (l.30).
- **Paiement `[PARTIEL]`** : le passage par un devis puis `accept_and_pay` n’existe que dans le simulateur. Sur Supabase, `payTranche` appelle `start_payment` (voir L, risque 1).

## H. Back-office (`apps/web`)

- **Routes** : `/`, `/connexion`, `/connexion/second-facteur`, `/mot-de-passe-oublie`, `/nouveau-mot-de-passe`, `/auth/confirm`, `/acces-refuse`, `/dossiers`, `/preuves`, `/litiges`, `/journal`. Toutes construites par `pnpm build`.
- **Fonctions SQL appelées** : `claim_dossier`, `decide_tx`, `decide_tranche`, `resolve_dispute`, `dossier_documents`, `dossier_checks`, `evidence_checks`, `bo_decisions`, `open_document`, `bo_find_transactions`, `bo_audit`, `bo_audit_verify`, `log_audit_export`. Toutes sont définies dans les migrations.
- **Vues et tables lues** : `bo_dossiers`, `bo_evidence_queue`, `bo_disputes` (redéfinies en 0014) ; `transactions`, `tranches`, `profiles`, `app_config`. Le stockage passe par des URL signées de 60 s.
- **Protection** :
  - `src/proxy.ts` (`getClaims`, `decideAccess`), revérifiée par `requireStaff` dans `(bo)/layout.tsx` ;
  - seuls VALIDATOR et ADMIN entrent ; `/litiges` est réservé à ADMIN ;
  - le second facteur (aal2) n’est exigé que si `require_staff_mfa = 'true'` ou si l’utilisateur a déjà un facteur.
- **En-têtes** : CSP avec nonce et `strict-dynamic`, `frame-ancestors 'none'`, X-Frame-Options DENY, HSTS, nosniff, `no-referrer`, Permissions-Policy, COOP, `no-store`.
- **Variables d’environnement** : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus `E2E_STAFF_PASSWORD`, `E2E_PORT` et `E2E_CAPTURE` pour les tests de bout en bout. Un test (`test/build-secrets.test.ts`) vérifie qu’aucune clé `service_role` n’entre dans le build.
- **Tests Playwright** (non lancés) : 29, soit authentification 5, dossiers 7, preuves 2, litiges 4, journal 3, sécurité 3, clavier 1, captures 4. Vitest : 7 fichiers, 49 tests.
- Le web ne dépend plus des anciens statuts : ses files reposent sur `PAID` avec des fonds `HELD`, et sur `PENDING_REVIEW` ou `IN_REVIEW`.

## I. Conformité aux décisions

| Réf. | Statut | Preuve | Remarque |
|---|---|---|---|
| X1.1 | `[VÉRIFIÉ]` | `apps/mobile/src/app/token/[trancheId].tsx` sans `Share` ni `Clipboard` ; `expo-clipboard` et `react-native-view-shot` non déclarés ; `EXPO_PUBLIC_LINK_BASE` jamais lue ; `apps/mobile/test/trustlink.test.ts` | `Share` ne sert qu’au reçu (`receipt/[trancheId].tsx`), ce qui est légitime |
| X1.2 | `[PARTIEL]` | pas de dossier `src/app/t/` ; `+native-intent.tsx` ignore `https://…/t/…` et n’accepte que `diaspay://tranche/<id>` ; schéma `diaspay` dans `app.json` | **Reste une déclaration orpheline `Stack.Screen name="t/[reference]"`** dans `_layout.tsx` (l.120), avec un commentaire périmé |
| X1.3 | `[VÉRIFIÉ]` | `packages/domain/src/notificationTemplates.ts` (3 canaux × 3 événements × 2 langues, textes fixes) ; test d’architecture dans `domain/test/lotx.test.ts` (bloc « X1.4 ») : ni URL, ni domaine, ni référence, ni chiffre, ni paramètre | L’absence de nom n’est pas testée explicitement ; le commentaire du module renvoie à un test `notificationTemplates.test.ts` qui n’existe pas |
| X1.4 | `[VÉRIFIÉ]` | 0008 : `tranche_tokens.revoked_at` et `revoke_reason`, un seul jeton actif, `revoke_token`, `reissue_token` (redéfinie en 0014, refusée en DIRECT en 0018) | |
| X1.5 | `[VÉRIFIÉ]` | `_party_token` filtre par `is_party` avant tout ; `resolve_reference_info` et `resolve_tranche_reference` (0008) répondent de la même façon, sans ligne et avec l’échec journalisé, pour une référence inconnue ou étrangère | TOKEN_REVOKED n’est révélé qu’à une partie |
| X1.6 | `[VÉRIFIÉ]` | `security_events` et `_reference_guard` (0008) : TOO_MANY_ATTEMPTS au-delà de `reference_failure_limit` (10 par heure) ; appelée en 0014 et 0016 | |
| X1.7 | `[VÉRIFIÉ]` | `mark_received` (0008) ; `get_document_access` (0009, redéfinie en 0022) ; méthodes présentes dans `SupabaseApi` et `MockApi` | |
| X1.8 | `[PARTIEL]` | `eqr_image_enabled = false` (0015) ; image du QR conditionnée (écran du jeton, l.121-125) ; `useNoScreenCapture('token')` (l.49) | **`SupabaseApi.eqrImageEnabled` affiche l’image si la ligne manque** (`supabase/api.ts`, l.351-354, « absent = oui ») |
| X2 | `[VÉRIFIÉ]` | 0014 : CHECK `transactions_status_v2` et `tranches_status_v2` ; `settlement_mode` (0013, 0014) ; DISPUTED reste dans l’enum mais est refusé par le CHECK ; `disputes` et `on_hold` ; vue `payment_requests` ; `platform_review` à NEVER partout | La table s’appelle toujours `tranches` : `payment_requests` n’est qu’une vue en lecture |
| X3 | `[PARTIEL]` | `request_info`, `answer_info`, `reject_request` (0008, réécrites en 0014) ; `accept_plan` (0016) ; `save_draft` avec un créateur prestataire de niveau N2 (0020) ; événements INFO_REQUESTED, INFO_ANSWERED, REQUEST_REJECTED, REQUEST_SUBMITTED (0014) et PLAN_ACCEPTED (0016) ; `issue_presentation_token` et `claim_presentation_token` (0016) | Le jeton de présentation n’existe qu’en SQL, **sans client** ; voir le risque 5 sur `claim_presentation_token` |
| X4 | `[VÉRIFIÉ]` | 0020 : `enrolment_level` N0 à N3 (protégé par `guard_profile`), `enrolment_cases`, `enrolment_limits` (vide hors développement), bucket `identity`, `can_initiate_requests` supprimée ; `KycPort` simulé (`domain/src/enrolment.ts`) | Aucun écran d’enrôlement |
| X5 | `[PARTIEL]` | `PaymentPort` v2 (domaine) ; `payment_attempts.idempotency_key` unique, `webhook_events`, `ledger_*`, `apply_payment_event` (0010) ; `fx_quotes`, `contributions`, `accept_and_pay`, `mark_refund_executed`, `v_reconciliation` (0021) | Serveur complet. **Côté client, le paiement sur Supabase passe par `demo_settle_payment`** (risque 1) |
| X6 | `[DIVERGENT]` partiel | `request_modules` (0011, 0014, 0022) ; vue `release_rules` (0011) ; `beneficiary_mode` (0022) ; santé réduite au devis, sans pièce d’identité ni certificat | **Aucune colonne `module_code`** : le lien reste `transactions.vertical`, en texte, avec une clé étrangère vers `request_modules(code)` (0011) |
| X7–X9 | `[DIVERGENT]` (traces) | Empreintes : `documents.content_hash`, `_hash_reuse` et `packages/domain/src/trustvault.ts` (0009, passe 1), encore actifs (0014, 0022, 0023), plus `apps/mobile/src/lib/contentHash.ts`. Multi-payeurs : `transaction_parties` (0012) et `contributions` (0021). **Témoins** : aucune occurrence de `witness` ni « témoin ». **Simulateur de scénarios** : aucune trace | Les empreintes et la réutilisation de pièces existent déjà, héritées de la v1 |
| K1 | `[VÉRIFIÉ]` | Amorçage de `request_modules` : EDUCATION, HEALTH et RENT (vague 1) en DIRECT ; AGRO, REAL_ESTATE et LAND (vague 2, désactivés) en CONDITIONAL | |
| K4 | `[PARTIEL]` | Aucun lien partageable (X1.1, X1.2) ; schéma du QR dynamique en 0016 | Pas de client, et la durée de vie n’est posée qu’en développement |
| K6 | `[VÉRIFIÉ]` | `accept_plan` distinct (0016) ; `accept_and_pay` exige le payeur et une demande SUBMITTED, à chaque demande (0021) | `accepted_at` n’est jamais lu : payer sans avoir accepté l’échéancier reste possible |
| K7 | `[VÉRIFIÉ]` | `domain/src/disputes.ts` : litige « après paiement » sur une demande PAID ou REFUNDED, sans changement de statut ; remboursement lié à la tentative, avec contrepassation (`mark_refund_executed`, 0021) | `_create_refund` suppose une seule tentative CONFIRMED par demande |
| K9 | `[VÉRIFIÉ]` | `contributions` (0021) : une contribution du montant total ; la demande passe à PAID quand la somme atteint la cible | |
| K10 | `[VÉRIFIÉ]` | `fx_quotes` (0021) : devises, taux arrondi au supérieur, source, horodatage, expiration, frais par poste, usage unique | `fee_schedule` n’est jamais insérée : aucun frais tant qu’elle n’est pas configurée |
| D2, K13 | `[VÉRIFIÉ]` | Santé : QUOTE seul, sensible, REFERENCE_ONLY (0022) ; 3 fichiers par type (`MAX_FILES_PER_KIND`, déclencheur de 0005) ; 10 Mo (domaine et bucket) | Contournement possible par la politique `tx_update_draft` (risque 2) |
| D3 | `[VÉRIFIÉ]` | `apps/mobile/src/i18n/messages.ts` : `plan_help_*`, `plan_sum_*` et `plan_note` en français et en anglais | Écrites `plan_help_*` au lieu de `plan.help.*`, comme D3 le prévoit elle-même ; le texte « payée, confirmée puis débloquée » ne correspond plus au règlement DIRECT |
| D4 | `[VÉRIFIÉ]` | `delete_draft` (0005) refuse un dossier audité (AUDITED_FILE) ; l’abandon passe par `cancelOperation` → `transition_tx(CANCELLED)` (DRAFT ou ACTIVE vers CANCELLED par l’initiateur) | Il n’y a plus de « dossier rejeté » en v2 (REJECTED converti en CANCELLED par 0014) ; `tx_update_draft` cite encore REJECTED |
| D5 | `[VÉRIFIÉ]` / `[DIVERGENT]` dans le simulateur | `SupabaseAuth` n’a aucun compteur ; ses erreurs sont traduites par `toAuthError` (`supabase/errors.ts`) | **`MockAuth` verrouille après 3 codes pendant 15 minutes** |
| D7 | `[PARTIEL]` | `is_validator` appelle `_staff_aal_ok` (0006) ; le proxy web exige aal2 selon `require_staff_mfa` | `require_staff_mfa = 'false'` par défaut ; la valeur en production est `[NON DÉTERMINABLE]` |

## J. Vérifications ciblées

### J.1 `start_payment` contre `accept_and_pay`

Définitions finales, toutes deux en 0021. Le tableau ligne à ligne est dans l’annexe `migrations-0014-0023.md`, section J1.

Le `start_payment` final **ne paie plus lui-même**. Il vérifie la clé, appelle `get_quote` dans la devise de la demande, puis `accept_and_pay`. Il hérite donc de tous ses contrôles :
- payeur ;
- `on_hold` ;
- opération ACTIVE ;
- aucun paiement en cours ;
- demande SUBMITTED ;
- devis valide, non utilisé et non expiré ;
- plafonds (`_check_payer_limits`) ;
- idempotence.

Différences :
1. `start_payment` ne fait **jamais de change** (taux 1, source IDENTITY).
2. Il valide le moyen de paiement lui-même ; `accept_and_pay` reprend celui du devis.
3. Il fait une première passe de contrôles **sans verrou** (`get_quote`). Les contrôles verrouillés d’`accept_and_pay` font foi.
4. Il ajoute un devis et un audit QUOTE_ISSUED.
5. **Les versions antérieures (0014, 0018) n’avaient ni devis ni plafonds** : une base où 0021 n’est pas appliquée garde un chemin de paiement sans plafond.

Communs aux deux :
- **aucun contrôle de témoin** (la notion n’existe pas) ;
- `accepted_at` n’est pas lu ;
- **`tranches.expires_at` n’est pas lu** : une demande échue reste payable jusqu’au passage horaire suivant de l’expiration ;
- **aucun niveau minimal du payeur** : un payeur N0 paie dès qu’une ligne N0 existe dans `enrolment_limits`.

### J.2 Tâches pg_cron

| Tâche | Horaire | Fonction | Pertinence en v2 |
|---|---|---|---|
| `diaspay-release-due-tranches` | `*/10 * * * *` | `release_due_tranches` (déclarée en 0005, corps final en 0014) | Cohérente (PAID, HELD, délai écoulé, sans litige), mais **ne vérifie pas le statut de l’opération** : une opération SUSPENDED pour fraude voit ses fonds libérés |
| `diaspay-activate-due-tranches` | `0 6 * * *` | `activate_due_tranches` (0014) | Cohérente (opération ACTIVE, demande DRAFT due) ; le nom garde l’ancien vocabulaire |
| `diaspay-expire-due-requests` | `15 * * * *` | `expire_due_requests` (0014) | Cohérente, mais **sans effet** : `request_expiry_days` est vide dans tous les modules |

Aucun `cron.unschedule` exécutable. L’état réel des tâches sur le projet distant est `[NON DÉTERMINABLE]`.

### J.3 Mode démonstration

- `EXPO_PUBLIC_DEMO` et `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` sont lues dans `apps/mobile/src/lib/releaseGuard.ts`, `src/lib/env.ts`, `src/app/_layout.tsx` et `(tabs)/profile.tsx`.
- **La garde existe** : `demoReleaseViolation` bloque l’application avec `DemoInReleaseBlocked` (`_layout.tsx`, l.64-105).
- **Elle est testée** : `apps/mobile/test/lot3b.test.ts`, l.8-18, 5 cas. `[VÉRIFIÉ]`
- **Il n’existe aucune garde équivalente pour `EXPO_PUBLIC_API`** : si elle manque, l’application tourne sur le simulateur (`src/state/backend.ts`, l.16).

### J.4 Secrets

Recherche dans les fichiers suivis et dans **tout** l’historique Git : JWT, clés Supabase (`sb_secret_`, `sb_publishable_`, `sbp_`), jetons GitHub, clés AWS, clés PEM, `sk_live`, mots de passe littéraux, URL PostgreSQL avec identifiants.

- **Seul résultat** : `scripts/db.sh` (commits `cb1dc44` et `02f08bb`), motif « mot de passe affecté ». C’est un **faux positif** : les deux affectations référencent une variable d’environnement.
- `service_role` n’apparaît que comme nom de rôle.
- Aucun `.env` réel n’est suivi.
- **Risque hors Git** : `Archive.zip` contient deux `.env.local` (voir A).

### J.5 Marqueurs et gros fichiers

Aucun `TODO`, `FIXME`, `HACK` ni `XXX`. Aucun fichier suivi de plus de 1 Mo, ni même de plus de 300 Ko.

### J.6 Variables d’environnement

Toutes les variables applicatives lues figurent dans un `.env.example`. Seules manquent les variables d’outillage : `NODE_ENV`, `CHROME_PATH`, `E2E_PORT`, `E2E_CAPTURE`. Tableau : annexe `depot-et-outillage.md` §6.

### J.7 Commandes de vérification

Résultats réellement obtenus le 16 novembre 2026, sorties dans l’annexe §9.

| Commande | Résultat |
|---|---|
| `pnpm -r test` | **483 tests réussis, 1 ignoré, 0 échec** : ui-tokens 50 ; domain 145 (12 fichiers) ; api-client 122 et 1 ignoré, la suite de contrat Supabase sans `SUPABASE_TEST_*` (7 fichiers) ; web 49 (7 fichiers) ; mobile 117 (11 fichiers) |
| `pnpm -r typecheck` | 5 paquets, **0 erreur** |
| `pnpm build` | **Réussi** : turbo n’a que `@diaspay/web` à construire (Next 16.4.6, 14 pages ; le build a lu `apps/web/.env.local`) |
| `expo export --platform web` | **Réussi** : 1 252 modules, sortie dans `apps/mobile/dist`, ignoré par Git |

Non lancés : les scripts SQL de `supabase/tests`, la suite de contrat contre Supabase et Playwright, parce qu’ils exigent des accès.

## K. Documentation

Inventaire complet dans l’annexe `depot-et-outillage.md` §8. 15 fichiers Markdown, plus `docs/maquette` (33 PNG) et `docs/captures` (29 PNG).

**À jour** (dernier commit `b31f68e`, 13 novembre) :
- `decisions.md`
- `error-codes.md`
- `lotx2-adaptations-ecrans.md`
- `lotx2-controles-sql.md`
- `open-parameters.md`
- `release-checklist.md`
- `supabase-setup.md`

**Périmés ou en partie périmés** :

| Document | Problème |
|---|---|
| `supabase/README.md` (lot 5) | Annonce « Quatre migrations » ; anciens statuts aux l.77 et l.93 |
| `docs/backoffice.md` (lot 5) | Décrit le bureau d’avant la v2 (files de preuves, validation de chaque dossier), alors que `platform_review` vaut NEVER |
| `docs/specs/trustlink-security.md` (passe 1) | État au 12 novembre, avant 0015 et 0016 |
| `docs/design-conformity.md` (lot 3b) | Conformité des écrans d’avant la v2 |
| `README.md` | Dernière mise à jour en X7 v1 (`d2a3e36`), avant la passe 2 |
| `docs/decisions.md` | Cite encore `txMachine.ts` (D4) |
| `docs/specs/multi-payers.md`, `ledger.md`, `modele-cible-v2.md` | Brouillons « pour le kickoff », à relire face au code de 0020 à 0023 |

## L. Dette technique et risques

Classés du plus grave au moins grave. « À confirmer » signifie : constaté à la lecture, sans test exécuté.

**Critiques**

1. **Le paiement échoue sur un vrai serveur.** `SupabaseApi.payTranche` et `acceptAndPay` appellent `demo_settle_payment` quand la tentative est INITIATED ou PENDING (`packages/api-client/src/supabase/api.ts`, l.105-123). Hors `mock_mode`, cette fonction lève DEMO_DISABLED (0021, l.523). L’erreur arrive après la création de la tentative. Aucun adaptateur réel du partenaire n’existe.
2. **Les contrôles de `save_draft` peuvent être contournés (à confirmer).**
   - La politique `tx_update_draft` (0003, l.654) permet de modifier n’importe quelle colonne d’une opération DRAFT par PostgREST, et aucune restriction par colonne n’existe.
   - `submit_operation` (0022) ne revérifie pas `beneficiary_name`.
   - Un nom de patient pourrait donc être enregistré, contre K13.
3. **Le téléphone du profil est modifiable par son titulaire (à confirmer).**
   - `profiles_self_update` (0004, l.119) ne restreint aucune colonne, et `guard_profile` (0020) ne protège pas `phone`.
   - `_user_by_phone` (0005) compare des numéros normalisés avec `limit 1`, alors que l’unicité porte sur la valeur brute.
   - Un utilisateur pourrait se faire désigner comme contrepartie à la place d’un autre.
4. **Valeurs de développement par défaut.** `mock_mode = 'true'` (0001, l.50) et `require_staff_mfa = 'false'` (0006).
   - Une base construite par les seules migrations reçoit KYC APPROVED automatique, l’absence de plafonds, des taux simulés et les fonctions `demo_*`.
   - La production ne repose que sur `docs/release-checklist.md` (point 8).
5. **Prise en charge du jeton de présentation.** `claim_presentation_token` (0016) lie comme payeur tout porteur du jeton quand le payeur n’était connu que par son téléphone, sans comparer le numéro.

**Importants**

6. `release_due_tranches` libère des fonds même si l’opération est SUSPENDED (0014, l.670-681).
7. `app_config` est lisible par tous les rôles : la politique `config_read using (true)` n’a pas de clause `TO` (0001, l.413).
8. **Valeurs par défaut du client** :
   - l’image du QR est affichée si la ligne de réglage manque (X1.8) ;
   - le simulateur est utilisé si `EXPO_PUBLIC_API` manque (J3).
9. **Rôle tiré du profil, pas de l’opération.** `personaForRole(primaryRole)` (`apps/mobile/src/state/auth.ts`, l.24-30) décide de l’action « Payer », du QR et du contrôle du scan. Le serveur reste juge, mais l’interface peut proposer des actions inadaptées.
10. **Le simulateur s’écarte du serveur** :
    - `MockAuth` verrouille après 3 codes, contre D5 ;
    - `MockApi` construit ses données avec `RELEASE_RULES` ;
    - le devis et `accept_and_pay` ne sont enchaînés que dans le simulateur.
11. **Droits des fonctions.** 6 fonctions SECURITY DEFINER sont appelables par `anon` sans révocation (D.6), et le contrôle de 00_smoke repose sur une liste fermée.
12. **`Archive.zip`** (261 Mo, avec deux `.env.local`) n’est pas couvert par `.gitignore`.
13. **Remboursements et contributions multiples.** `_create_refund` suppose une seule tentative CONFIRMED par demande, ce qui ne tiendra pas avec plusieurs contributions.
14. **Fonctions serveur sans client** : jeton de présentation, enrôlement, devis et frais, `accept_plan`.

**Mineurs**

15. **Dette de nommage** :
    - table `tranches` et vue `payment_requests` ;
    - `vertical` au lieu de `module_code` ;
    - `activate_due_tranches` ;
    - `payments.status` vaut SUCCEEDED quand `payment_attempts` dit CONFIRMED ;
    - valeurs v1 dans les enums ;
    - tables `_release_rules_0003` et `_required_documents_0005` jamais supprimées ;
    - test mort sur `'REJECTED'` dans `save_draft` et dans `tx_update_draft`.
16. Les retours arrière sont inutilisables après 0014, et le bucket `identity` ne réapplique pas ses limites (`on conflict`).
17. **Restes dans l’interface** :
    - route orpheline `t/[reference]` ;
    - reçu « Tranche débloquée » en DIRECT ;
    - un `getDispute` par demande dans le détail d’une opération (N+1).
18. `fee_schedule`, `enrolment_limits` et les durées de vie (`fx_quote_ttl_seconds`, `presentation_token_ttl_seconds`) sont absents hors développement. C’est voulu (`docs/open-parameters.md`), mais **tout paiement est refusé en production tant qu’ils ne sont pas configurés**.
19. **Tests manquants** :
    - suite de contrat sur le jeton de présentation, le mode CONDITIONAL, les plafonds, `markRefundExecuted` et la revue N3 ;
    - aucun test des contournements des risques 2 et 3 ;
    - les tests SQL et Playwright n’ont pas été exécutés ici.
20. Documentation périmée (K).

## M. Questions pour l’humain

1. Quelles migrations sont **réellement appliquées** sur le projet de développement, et existe-t-il un projet de production ? Les tests SQL 00 à 06 y passent-ils aujourd’hui ?
2. Quelle est la valeur de `mock_mode`, `require_staff_mfa`, `eqr_image_enabled`, `auto_issue_token` et `payment_provider` sur chaque projet distant ?
3. Les **trois tâches pg_cron** sont-elles actives (`cron.job`) ?
4. Les droits par défaut de `anon` sur les fonctions du schéma `public` ont-ils été retirés à la main sur le projet distant ?
5. `lotX` doit-elle être fusionnée dans `master` avant la passe 3 ? Faut-il créer un dépôt distant ?
6. Que contient `Archive.zip`, à quoi sert-il, et peut-on le supprimer ou l’ignorer ? Les clés de ses `.env.local` doivent-elles être renouvelées ?
7. **Décisions du client** encore ouvertes (`docs/open-parameters.md`) :
   - plafonds par niveau ;
   - durée de vie du jeton de présentation et des devis ;
   - expiration des demandes ;
   - barème des frais ;
   - durées de conservation ;
   - seuil RISK_BASED ;
   - affichage du QR en CONDITIONAL.
8. Le payeur doit-il avoir accepté l’échéancier (`accept_plan`) avant de payer ? Un payeur N0 peut-il payer ?
9. Le renommage `tranches` → `payment_requests` et `vertical` → `module_code` est-il attendu ?
10. Les témoins (X8 ?) et le simulateur de scénarios (X9 ?) : quel périmètre exact, et faut-il réutiliser les empreintes de la v1 pour X7 ?

## N. Résumé exécutif

Texte identique à `RESUME-POUR-CLAUDE.md`.

Branche `lotX` (`b31f68e`), 14 commits d’avance sur `master`, non fusionnée, sans dépôt distant. Migrations 0001 à 0023. Rapport complet : `docs/etat-des-lieux/ETAT-DES-LIEUX.md`.

### Livré

- **Noyau v2** (0013, 0014, 0017 à 0019) :
  - statuts de l’opération : DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED ;
  - statuts de la demande : DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED ;
  - `settlement_mode`, litige distinct, `platform_review` à NEVER ; machines du domaine identiques aux tables SQL.
- **X1** : aucun lien partageable, révocation, limitation des tentatives, réponse identique pour une référence inconnue ou étrangère, QR désactivé (0015), protection contre la capture d’écran.
- **X3** : `request_info`, `answer_info`, `reject_request`, `accept_plan`.
- **X4** : enrôlement N0 à N3, KYC simulé (0020).
- **X5** : paiements idempotents, journal à double entrée, devis de change, contributions, `accept_and_pay`, remboursements (0010, 0021).
- **X6** : `request_modules` ; santé réduite au devis et à une référence du patient (0022, 0023).
- **API** : 42 méthodes, présentes dans le simulateur et dans Supabase.
- **i18n** : 646 clés en français et en anglais, parité complète.

### Partiel ou absent

- Le jeton de présentation n’existe qu’en SQL (0016) : aucun client.
- Aucun écran pour l’enrôlement, le devis, les frais ou l’acceptation de l’échéancier.
- Les ports de paiement et de KYC n’ont qu’un adaptateur simulé.
- Pas de `module_code` : le lien reste `vertical`. La table `tranches` n’est exposée que par la vue `payment_requests`.
- X7 à X9 : les empreintes de pièces existent déjà (0009, passe 1) ; ni témoins, ni simulateur de scénarios.

### Tests

- `pnpm -r test` : **483 réussis, 1 ignoré, 0 échec**.
- Typecheck : 0 erreur ; builds web et Expo web : réussis.
- Non exécutés : tests SQL (785 contrôles), contrat Supabase, Playwright (29 tests).

### Cinq écarts

1. **X1.8** : le client affiche le QR si le réglage `eqr_image_enabled` manque.
2. **D5** : `MockAuth` verrouille après 3 codes ; `SupabaseAuth` est conforme.
3. **D7** : `require_staff_mfa` vaut `false` par défaut.
4. **X6** : pas de `module_code`, et les tables archivées restent.
5. **X1.2** : déclaration orpheline `t/[reference]` dans `_layout.tsx`.

### Cinq risques

1. **Le paiement échoue hors `mock_mode`.** `SupabaseApi` appelle `demo_settle_payment`, qui lève DEMO_DISABLED.
2. **Contournement de `save_draft` (à confirmer).** La politique `tx_update_draft` permet de modifier n’importe quelle colonne d’un brouillon, y compris le nom d’un patient (K13).
3. **Téléphone modifiable (à confirmer).** `profiles_self_update` ne protège pas `phone` : un utilisateur pourrait se faire désigner comme contrepartie à la place d’un autre.
4. **Valeurs de développement par défaut.** `mock_mode = true` dès 0001 ; seule la liste de contrôle protège la production.
5. **Libération et jeton de présentation.** `release_due_tranches` libère les fonds d’une opération SUSPENDED. `claim_presentation_token` lie n’importe quel porteur comme payeur quand le payeur n’est connu que par téléphone.

À noter aussi : `app_config` est lisible par `anon`. `Archive.zip` (261 Mo, avec deux `.env.local`) n’est pas ignoré par Git.

### Avant la passe 3

1. Corriger le chemin de paiement réel (risque 1).
2. Restreindre ces deux politiques colonne par colonne, puis ajouter des tests SQL.
3. Corriger `release_due_tranches` et `claim_presentation_token`.
4. Exécuter les tests SQL et Playwright sur le projet de développement ; relever les migrations appliquées et les tâches pg_cron actives.
5. Faire trancher par le client : plafonds, durées de vie, frais, expiration, conservation, second facteur.
6. Fusionner `lotX` ; traiter `Archive.zip` ; mettre à jour les documents périmés.
7. Ajouter les clients et les écrans de l’enrôlement, du devis, de `accept_plan` et du jeton de présentation.
