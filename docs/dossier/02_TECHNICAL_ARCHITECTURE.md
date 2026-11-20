# 02 — Architecture technique

⚠ **Limite d'accès** (mise à jour du 17 novembre). Je n'ai pas accès au dépôt. Depuis le 16 novembre, j'ai toutefois lu l'**audit complet du dépôt** (`ETAT-DES-LIEUX.md` et annexes), les **migrations 0001 à 0023**, `apps/mobile/package.json` et les documents de `docs/` ; les migrations **0024 à 0031** (lot X-C) ne me sont connues que par les comptes rendus. Le paragraphe ci-dessous décrit la situation antérieure, gardée pour mémoire.

Avant le 16 novembre : Tout ce qui suit vient (a) des prompts que j'ai rédigés, (b) des comptes rendus de l'assistant collés par l'utilisateur (lots 3, 3 bis, 4, 5, passe 2 du lot X v2), (c) du code que j'ai moi-même écrit au début (monorepo v0.1, SQL v0.1 à v0.3). **Les comptes rendus des lots 1 et 2 et de la passe 1 du lot X v2 ne m'ont jamais été montrés.** Pour ces éléments, l'état réel est **[INCONNU]** ou **[DEMANDÉ]**.

## 1. Vue d'ensemble

```
apps/mobile  (Expo, React Native)     apps/web (Next.js : Bureau de contrôle)
        \                                   /
         packages/api-client  (contrat TransactionApi / AuthApi ; MockApi ; SupabaseApi)
                 |                  
         packages/domain (types, règles, machines d'états, plans, pièces, audit chaîné, eQR, téléphone, montants)
         packages/ui-tokens (charte, contrastes testés)
                 |
         Supabase (PostgreSQL, Auth par téléphone, Storage, Realtime, pg_cron)
                 |   (phase 2, non démarrée)
         TrustEngine (Node/TypeScript) --> ports : PaymentPort, KycPort, LedgerPort, NotificationPort --> TrustPayway / Amzara / partenaire KYC
```

Principe directeur : **ports et adaptateurs**. Le front tourne sur des simulateurs derrière des interfaces stables ; le TrustEngine puis TrustPayway les remplaceront sans toucher aux applications. [DÉCIDÉ, d'origine]

## 2. Organisation du dépôt (monorepo)

| Chemin | Contenu | Fiabilité |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc` (`node-linker=hoisted`) | Monorepo pnpm 9.12.0 + Turborepo | [PRODUIT PAR MOI] puis [CONFIRMÉ] |
| `packages/domain` (`@diaspay/domain`) | `types.ts`, `rules.ts`, `money.ts`, `plan.ts`, `operationMachine.ts` (ex-`txMachine`), `paymentRequestMachine`, `conditionalRelease`, `trancheMachine.ts`, `phone.ts`, `documents.ts`, `need.ts`, `eqr.ts`, `audit.ts` | [VÉRIFIÉ, audit] |
| `packages/api-client` (`@diaspay/api-client`) | `types.ts` (contrat `TransactionApi`, `AuthApi`), `mockApi.ts` (`MockApi`, `seedTransactions`), `selectors.ts`, `src/supabase/` (`SupabaseApi`, `SupabaseAuth`, conversions, `database.types.ts` généré) | [CONFIRMÉ] jusqu'au lot 4 |
| `packages/ui-tokens` (`@diaspay/ui-tokens`) | `palette`, `semantic`, `chips`, `spacing`, `radius`, `fontSize`, `touchTarget`, `contrastRatio` ; test de contraste WCAG AA | [CONFIRMÉ] |
| `apps/mobile` (`@diaspay/mobile`) | Expo Router dans `src/app/` ; alias `@/` → `src/` ; `src/ui`, `src/i18n`, `src/state`, `src/features/*` | [CONFIRMÉ] |
| `apps/web` | Bureau de contrôle Next.js (App Router) : `proxy.ts` (ex-middleware), CSP à nonce, `@supabase/ssr` | [CONFIRMÉ] lot 5 |
| `supabase/migrations/` | Migrations numérotées **0001 à 0031** (voir §5) | Voir §5 |
| `supabase/tests/` | Scripts SQL `00` à `07` et variantes `*_editor.sql` | [RAPPORTÉ] |
| `supabase/seed.sql`, `seed-staff.sql`, `seed-evidence.sql` | Comptes de démonstration, prestataires fictifs, preuve de test | [CONFIRMÉ] lots 4–5 |
| `scripts/` | `db.sh` (`test`, `test-editor`), `sql-editor-variant.mjs`, `design-capture.mjs`, `prod-readiness.sql` (lecture seule) | [RAPPORTÉ] |
| `docs/` | `decisions.md`, `release-checklist.md`, `design-conformity.md`, `error-codes.md`, `supabase-setup.md`, `backoffice.md`, `open-parameters.md`, `lotx2-controles-sql.md`, `lotx2-adaptations-ecrans.md`, `maquette/` (33 PNG), `captures/`, `specs/…`, `etat-des-lieux/` (audit du 16 nov.), `sources-client.md` (hiérarchie des sources), `client/` (documents du client, à remplir) | [VÉRIFIÉ en partie] |

Fichier non suivi : `Archive.zip` (261 Mo, contient deux `.env.local`), ignoré par Git depuis X-C. Branche principale : `master` ; **aucun dépôt distant**.

## 3. Technologies et versions connues

| Élément | Version | Source |
|---|---|---|
| Expo SDK | **58** (`expo ~58.0.23`) | [CONFIRMÉ] |
| React Native | **0.88.1** | [CONFIRMÉ] |
| React | **19.3.0** | [CONFIRMÉ] |
| TypeScript | racine `^5.6`, application mobile `~6.0.3` | [CONFIRMÉ] |
| pnpm / Turborepo | 9.12.0 / 2.11.10 installé | [CONFIRMÉ] |
| Next.js | **16.4.6** (Node ≥ 20.9) ; le « middleware » s'appelle `proxy.ts` | [CONFIRMÉ] |
| `@supabase/supabase-js` | 2.119 | [CONFIRMÉ] |
| `@supabase/ssr` | 0.12.7 (cookies, `getClaims()`) | [CONFIRMÉ] |
| `@tanstack/react-query` | 5.107 (+ persister) | [CONFIRMÉ] |
| `zod` | ^4.6.7 (domain) | [CONFIRMÉ] |
| `@noble/hashes` | 2.4.0 (SHA-256, importé via `sha2.js`) | [CONFIRMÉ] |
| Vitest | ^2.1.0 | [CONFIRMÉ] |
| Playwright | 1.65.0 (`@playwright/test`, `playwright-core`) | [CONFIRMÉ] |
| `expo-font` / `@expo-google-fonts/inter` | ~58.0.11 / 0.4.2 (police Inter, 4 graisses, licence OFL 1.1) | [CONFIRMÉ] |
| `expo-print` | ~58.0.8 | [CONFIRMÉ] |
| `expo-document-picker` / `expo-image-picker` / `expo-image-manipulator` | ~58.0.4 / ~58.0.10 / ~58.0.16 (API `ImageManipulator.manipulate`, pas `manipulateAsync`) | [CONFIRMÉ] |
| `@react-native-community/datetimepicker` | 9.2.1 (inactif sur le web ; `DateField.web.tsx` en repli) | [CONFIRMÉ] |
| `@react-native-async-storage/async-storage` | 2.2.0 | [CONFIRMÉ] |
| `expo-file-system` | ~58.0.13 (`File.upload` pour l'envoi des pièces vers une URL signée) | [CONFIRMÉ] |
| `aes-js` / `react-native-get-random-values` / `@react-native-community/netinfo` | ^3.1.2 / ^2.1.0 / 12.0.1 | [VÉRIFIÉ] `package.json` |
| `expo-router` / `expo-secure-store` / `expo-local-authentication` | ~58.0.30 / ~58.0.2 / ~58.0.2 | [VÉRIFIÉ] |
| `expo-camera`, `expo-haptics`, `expo-crypto`, `expo-screen-capture`, `qrcode-generator` | présents | [VÉRIFIÉ] ; `expo-clipboard` et `react-native-view-shot` **absents** (copie et enregistrement du QR retirés) |
| Autres Expo installés (versions non relevées) | `expo-linking`, `expo-constants`, `expo-status-bar`, `expo-sharing`, `react-native-svg`, `react-native-safe-area-context`, `react-native-screens` ; `expo-camera`, `expo-clipboard`, `expo-haptics`, `react-native-view-shot` **demandés au lot 2 : installation non confirmée** | mixte |
| Base de données | **PostgreSQL 17.11** (projet Supabase de développement) | [CONFIRMÉ] |

L'identifiant du projet Supabase de développement figure dans le compte rendu du lot 4 ; **je ne le reproduis pas ici**. Aucun secret ne doit figurer dans ce dossier.

## 4. Environnements et configuration

| Variable ou réglage | Rôle |
|---|---|
| `EXPO_PUBLIC_API` | `mock` (développement) ou `supabase` ; **un build de boutique sans `supabase` est bloqué au lancement** (X-C T9) |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Accès public (clé anonyme) |
| `EXPO_PUBLIC_DEMO` | Active le mode démonstration (revue simulée, réinitialisation…) ; **ne doit jamais être présent dans un build de boutique** |
| `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` | Dérogation explicite à la garde de production |
| `EXPO_PUBLIC_HELP_URL`, `EXPO_PUBLIC_TERMS_URL` | Liens d'aide et de conditions (jamais en dur) |
| `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` | Taux d'échec simulé des envois |
| `E2E_STAFF_PASSWORD` | Mot de passe des comptes de test du personnel (`.env.local`) |
| `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` | Suite de contrat contre Supabase |
| `app_config` (table) | `mock_mode`, `token_ttl_days` (7), `activation_lead_days` (7), `dual_validation_threshold…`, `require_staff_mfa`, `eqr_image_enabled` (absent = image masquée côté client), `kyc_simulated_result`, `limits_when_missing` (liste non exhaustive ; `auto_issue_token` **supprimé** en 0031). **Lisible par `authenticated` seulement** (0029) |

**La clé `service_role` ne doit jamais** apparaître dans le dépôt, l'application ou une variable `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*`. Authentification par téléphone (code à usage unique) pour l'application ; **e-mail + mot de passe + TOTP** pour le personnel quand `require_staff_mfa = 'true'`. Durée de validité du code SMS : 300 s. Numéros de test à code fixe sur le projet de développement (+33 6 39 98 00 01 à 03 pour la démonstration ; 11 à 13 réservés aux tests automatisés). [CONFIRMÉ]

## 5. Base de données

**Migrations** [VÉRIFIÉ jusqu'à 0023] : 0001 base v0.1 ; 0002 valeurs d'enum v0.2 (**fichier séparé obligatoire**) ; 0003 tranches, règles de déblocage, litiges, jetons ; 0004 correctifs v0.3 ; 0005 lot 4 ; 0006 lot 5 ; **ancien lot X** : 0007 enums, 0008 sécurité du lien et décisions du payeur, 0009 TrustVault (empreintes, réutilisation), 0010 fondations des paiements, 0011 modules, 0012 multi-payeurs ; **lot X v2** : 0013 enums, 0014 noyau v2, 0015 X1, 0016 X3 (jeton de présentation), 0017 à 0019 correctifs, 0020 X4 (enrôlement), 0021 X5 (paiements), 0022 X6 (modules), 0023 correctif ; **lot X-C** [RAPPORTÉ] : 0024 brouillons, 0025 numéro de téléphone, 0026 jeton de présentation, 0027 libération et expiration, 0028 TrustToken pour toute demande, 0029 droits de `anon`, 0030 nom figé dès N1, 0031 échéance du jeton et suppression d'`auto_issue_token`. **Règle absolue : ne jamais modifier une migration appliquée.**

**Tables principales** (état v1 confirmé, v2 en partie) : `profiles` (niveau d'enrôlement N0–N3 depuis X4, `primary_role`, `push_enabled`, `platform_role` USER/VALIDATOR/ADMIN, `kyc_status`), `transactions` (= **Opération**), `transaction_parties`, `tranches` (= **Demande de paiement**, vue `payment_requests` en lecture), `recurrence_plans`, `documents` (`kind`, `storage_path`, `content_hash` existant depuis 0009), `validations`, `trust_tokens`/`tranche_tokens` (+ `signing_keys`), `payments`/`payment_attempts`, `contributions`, `fx_quotes`, `refunds`, `webhook_events`, `ledger_*`, `release_events`, `release_rules` (devenue vue), `request_modules` (X6), `dual_thresholds`, `disputes` + `dispute_messages`, `notifications`, `providers`, `enrolment_cases`, `enrolment_limits`, `security_events`, `request_messages`, `witnesses` (X8, demandé), `audit_log` (ajout seul, chaîné SHA-256, un chaînage par transaction), `app_config`, `allowed_transitions`, `tranche_transitions`.

**Fonctions principales (v1/v0.2 confirmées)** : `transition_tx`, `decide_tx` (signature v5 : `decide_tx(tx, approuvé, montant_vérifié, motif)`), `create_tranches`, `generate_recurring_tranches`, `transition_tranche`, `decide_tranche`, `resolve_tranche_reference`, `confirm_by_reference`, `open_dispute`, `resolve_dispute`, `respond_dispute`, `release_due_tranches`, `activate_due_tranches` (pg_cron), `save_draft`, `search_providers`, `get_receipt`, `get_dispute`, `claim_dossier`, `dossier_checks`, `bo_audit`, `bo_audit_verify`, `verify_audit`, `has_audit`, `is_validator`, `is_admin`, `is_party`, `has_role`, `demo_review`, `demo_resolve_dispute`, `demo_reset`, `start_payment`, `accept_and_pay`, `mark_refund_executed`, `apply_payment_event`. **Demandées au lot X (résultats de passe 1 non vus)** : `mark_received`, `request_info`, `answer_info`, `reject_request`, `accept_plan`, `revoke_token`, `reissue_token`, `get_document_access`, `issue_presentation_token`, `claim_presentation_token`, `designate_witness`, etc.

**Conventions SQL** : erreurs avec `hint` stable (table dans `docs/error-codes.md`) ; fonctions `SECURITY DEFINER` avec `search_path = public` ; **aucune fonction exécutable par `anon`** (Supabase l'accorde par défaut : retrait explicite et testé) ; `sha256()` et `gen_random_uuid()` natifs, **pas de pgcrypto** (voir mémoire) ; montants en unités mineures (FCFA sans décimales) ; référence de jeton de 18 caractères hexadécimaux ; numéros de téléphone comparés sur les chiffres seuls (stockés sans « + »).

**Stockage** : bucket privé `dossiers` (10 Mo, JPEG/PNG/PDF, chemin `<tx_id>/<kind>/<uuid>.<ext>`), bucket `identity` pour les pièces d'identité (X4) ; URL signées de courte durée ; consultations journalisées.

**Temps réel** : tables `transactions`, `tranches`, `disputes`, `notifications` ; la table `validations` n'est pas publiée (rechargement toutes les 30 s côté back-office). **pg_cron** actif : déblocage toutes les 10 min, activation à 06:00 UTC (à revoir sous le modèle v2 DIRECT).

## 6. API et intégrations

| Intégration | État |
|---|---|
| Supabase Auth, Storage, Realtime, PostgREST/RPC | Actif sur le projet de développement [CONFIRMÉ] |
| **TrustPayway** (paiement, séquestre, ledger) | **Non branché.** Simulateur via `PaymentPort` v2 (X5). Documentation et bac à sable **demandés, non reçus** |
| **Amzara** | Non branché |
| Partenaire **KYC** | Aucun ; adaptateur simulé `KycPort` (X4) |
| **Firebase** (notifications push) | Prévu au lot 6 ; non démarré |
| **Vercel** (déploiement du back-office) | Prévu ; non déployé ; nom de domaine non défini |
| Fournisseur de SMS (production) | **Non choisi** |
| Apple Developer, Google Play (builds de test) | Comptes à ouvrir **au nom du client** (en attente) |

## 7. Tests, qualité et outillage

Commandes confirmées : `pnpm -r test`, `pnpm -r typecheck` (ou `pnpm typecheck`), `pnpm build`, `pnpm --filter @diaspay/mobile exec expo export --platform web`, `pnpm --filter @diaspay/web e2e` (Playwright), `pnpm db:test`, `pnpm test:supabase` (suite de contrat sur le simulateur **et** sur Supabase), `pnpm db:types`, `pnpm capture` (captures d'écran, `scripts/design-capture.mjs`). Derniers chiffres (passe 2) : voir `05_CURRENT_STATUS.md`.

Chaque script SQL a une **variante pour l'éditeur SQL** de Supabase (un seul bloc `DO`, termine toujours par une erreur volontaire qui annule le test) générée par `scripts/sql-editor-variant.mjs`.

## 8. CI/CD

**Aucune intégration continue n'existe encore.** Prévu au « lot 6 » (CI avec tests, tests SQL, scan de secrets ; environnement « pilote » séparé ; builds de test iOS/Android via EAS ; déploiement du back-office ; push). Non démarré. [CONFIRMÉ : absence mentionnée dans mes propositions ; aucune contradiction rapportée]

## 9. Budget indicatif des outils (résumé initial de l'utilisateur, prix à vérifier)

| Poste | Coût indicatif | Phase |
|---|---|---|
| Supabase | 25 €/mois | 1 |
| Firebase (push, distribution aux testeurs ; surtout à l'usage) | 25 €/mois | 1 |
| Assistance IA au développement | 25 €/mois | 1 |
| Vercel | 25 €/mois (environ 20 $ en offre Pro) | 2 |
| **Total mensuel indicatif** | **100 €** | 2 |
| Apple Developer / Google Play / nom de domaine | ~99 $ par an / ~25 $ une fois / ~15 € par an | 1 |
| À prévoir plus tard | SMS ou WhatsApp pour les OTP (à l'usage), e-mails transactionnels, outil de maquettes (15 à 20 €/mois), service KYC | — |

Ces montants sont **indicatifs** et n'ont pas été revérifiés. [CONFIRMÉ : message prévu pour le client, 2 nov.]
