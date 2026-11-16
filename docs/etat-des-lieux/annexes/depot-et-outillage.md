# Annexe — dépôt, outillage, dépendances, secrets

Établie le 16 novembre 2026 sur la branche `lotX` (commit `b31f68e`), en lecture seule. Aucune valeur secrète n’est reproduite.

## 1. Les 40 derniers commits (`git log --oneline -40`, sujets tronqués à 160 caractères)

```
b31f68e lotX(X6): types de besoin configurables, données minimales (0022, correctif 0023, K13) : request_modules complétée (beneficiary_mode NAME, REFERENCE_ONL
309fdec lotX(X5): paiements, devises, remboursements (0021, K7, K9, K10, K12) : statuts du modèle cible (tentative INITIATED → PENDING → CONFIRMED ou FAILED, pa
ed0e2b0 lotX(X4): enrôlement et niveaux (0020, K3) : profiles.enrolment_level N0 à N3 protégé comme platform_role (PROFILE_PROTECTED) et remplaçant can_initiate
680471e lotX(X3): décisions du payeur et jeton de présentation (0016) : accept_plan (acceptation de l’échéancier, sans paiement anticipé, alerte PLAN_ACCEPTED) 
888fcb4 lotX(X1): QR (0015) : image du QR désactivée par défaut (eqr_image_enabled faux) ; _party_token réservé au payeur et à l’initiateur, au prestataire seul
de85dfc lotX(X2): refonte du noyau v2 (0013, 0014, correctifs 0017 à 0019) : statuts d’opération (DRAFT à CLOSED, SUSPENDED) et de demande (SUBMITTED, ACCEPTED,
d2a3e36 lotX(X7): structure multi-payeurs (0012), sans interface : transaction_parties avec identifiant propre, unicité (transaction, utilisateur, rôle) et (tra
a00c23f lotX(X6): types de besoin configurables (0011) : table request_modules (libellés et descriptions, activé, vague, règle de déblocage, double validation, 
a795409 lotX(X5): fondations des paiements (0010), sans appeler TrustPayWay : PaymentPort v2 (createPayment, getPaymentStatus, refund, verifyWebhook, parseWebho
7efbfdd lotX(X4): TrustVault (0009) : empreinte SHA-256 des pièces (documents.content_hash, hash_algo) calculée sur l’appareil avant l’envoi (expo-crypto, WebCr
83c2abe lotX(X1–X3): client des trois tâches (domaine, contrat d’API, simulateur, SupabaseApi, application mobile, bureau de contrôle, documentation), regroupé 
9e1bbb7 lotX(X3): demandes initiées par un prestataire côté serveur (0008, partie X3) : profiles.can_initiate_requests (enrôlement provisoire, faux par défaut, 
0f450d0 lotX(X2): décisions du payeur côté serveur (0008, partie X2) : statuts de tranche INFO_REQUESTED et REJECTED (terminal, compté pour la clôture), transit
b7ecaf5 lotX(X1): sécurité du TrustLink côté serveur (migrations 0007 et 0008, partie X1) : réglage eqr_image_enabled (image du QR facultative, true par défaut)
6993f7a lot5(T7): qualité : tests de bout en bout Playwright (connexion refusée à un utilisateur ordinaire, message identique compte existant ou non, déconnexio
0af5580 lot5(T6): Journal d’audit (BO5) : recherche d’une transaction (liste déroulante accessible au clavier, sans accents ni casse, par objectif, nom ou référ
1b04fda lot5(T5): Litiges (BO7), administrateurs seulement : tableau (motif, dossier, montant, ouvert par, ouvert le, statut ; ouverts ou résolus), volet avec v
3c3c98a lot5(T4): Preuves de jalons (BO6) : file des tranches EVIDENCE_SUBMITTED, aperçu de la preuve dans le volet (consultation journalisée) et visionneur agr
b180c56 lot5(T3): Dossiers à valider (BO1) : tableau à filets navigable au clavier (tri par ancienneté, filtres verticale et statut, recherche), mise à jour en 
02f08bb lot5(T2): migration 0006 et test 02_lot5 (132/132 sur le projet réel) : second facteur en base (require_staff_mfa, aal2), vues bo_dossiers, bo_evidence_
6fa6b26 lot5(T1): bureau de contrôle Next.js 16 (apps/web) : charte générée depuis @diaspay/ui-tokens, navigation 200 px et volet de détail, connexion e-mail et
d0f06b2 lot4(T5): suite de contrat commune au simulateur et à SupabaseApi (8 + 8), numéros de test réservés, nettoyage, liste de contrôle de publication (mock_m
3398dbd lot4(T4): crochets react-query (clés centralisées, chargement, erreur, Réessayer, actualisation), simulateur et Supabase par les mêmes crochets, temps r
c0255af lot4(T3): SupabaseApi et SupabaseAuth (packages/api-client/src/supabase), types générés (pnpm db:types), session chiffrée (clé dans SecureStore), conver
69e4626 lot4(T2): migration 0005 (codes d’erreur stables, brouillons serveur, invitations, prestataires, limites des pièces, notifications, reçu et litige, démo
cb1dc44 lot4(T1): projet Supabase de développement vérifié (67/67), configuration SMS (300 s, numéros de test), seed, scripts et documentation
13264bf lot3b(T6): tests des alertes, du reçu, du litige et du parcours complet du simulateur, README
9b7923d lot3b(T5): conformité des 33 écrans à la maquette v5, script de captures reproductible, tableau de conformité
bf11468 lot3b(T4): écrans Alertes, Profil, Sécurité, Suivi de litige, Reçu (PDF), accès depuis le détail d’une transaction
2e43278 lot3b(T3): police Inter, textes d’aide D3, pièces multiples, images réencodées sans métadonnées, abandon, garde de production du mode démonstration
5f9cfc3 lot3b(T2): alertes, litiges, reçus, abandon (D4), pièces multiples, journal chaîné et persistance de la simulation
77f238f lot3b(T1): statut CANCELLED (D4), pièces D2 et 3 fichiers par type, journal d’audit chaîné SHA-256, décisions D1 à D4, maquette de référence
dd6ebae lot3(T6): tests de l’assistant, dates locales, contrastes, README
5534ecb lot3(T5): brouillons dans la liste, suivi par statut (examen, rejet, correction), revue simulée, bouton « Nouveau besoin » actif
4b01b20 lot3(T4): assistant « Nouveau besoin » en six étapes (type, détails, prestataire, plan, justificatifs, récapitulatif)
9a26d3f lot3(T3): persistance des brouillons (AsyncStorage), sauvegarde différée, pièces à rajouter, brouillons par utilisateur
8259e72 lot3(T2): contrat et simulation du besoin (prestataires, brouillons, pièces, soumission, correction, revue simulée)
2a13ec1 lot3(T1): domaine du besoin (schémas zod par étape, pièces requises, constructeurs de plan, RG-12)
8fefffb lot2(T6): parcours complet du mock, parité des erreurs localisées, README
8fac870 lot2(T5): liens profonds /t/<référence> selon le profil et l’état de la tranche
```

## 2. Arborescence des fichiers suivis (3 niveaux ; `node_modules`, `.git`, `.turbo`, `dist`, `.expo`, `.next` exclus de fait car non suivis)

```
.env.example
.gitignore
.npmrc
README.md
apps/
  mobile/
    .gitignore
    app.json
    assets/
    locales/
    package.json
    src/
    test/
    tsconfig.json
  web/
    .env.example
    .gitignore
    e2e/
    next.config.ts
    package.json
    playwright.config.ts
    src/
    test/
    tsconfig.json
    vitest.config.ts
docs/
  backoffice.md
  captures/
    01_Splash.png
    02_Onboarding1.png
    03_Onboarding2.png
    04_Onboarding3.png
    05_Login.png
    06_Otp.png
    07_Profile.png
    08_Biometrie.png
    09_Type.png
    10_Details.png
    11_Provider.png
    12_Plan.png
    13_Create.png
    14_Recap.png
    15_Main.png
    16_List.png
    17_Detail.png
    18_Token.png
    19_Paiement.png
    20_Scan.png
    21_Evidence.png
    22_Dispute.png
    23_Receipt.png
    25_Notifs.png
    26_NotifsVide.png
    27_Profil.png
    28_Securite.png
    29_LitigeSuivi.png
    30_LitigeResolu.png
  decisions.md
  design-conformity.md
  error-codes.md
  lotx2-adaptations-ecrans.md
  lotx2-controles-sql.md
  maquette/
    01_Splash.png
    02_Onboarding1.png
    03_Onboarding2.png
    04_Onboarding3.png
    05_Login.png
    06_Otp.png
    07_Profile.png
    08_Biometrie.png
    09_Type.png
    10_Details.png
    11_Provider.png
    12_Plan.png
    13_Create.png
    14_Recap.png
    15_Main.png
    16_List.png
    17_Detail.png
    18_Token.png
    19_Paiement.png
    20_Scan.png
    21_Evidence.png
    22_Dispute.png
    23_Receipt.png
    24_Backoffice.png
    25_Notifs.png
    26_NotifsVide.png
    27_Profil.png
    28_Securite.png
    29_LitigeSuivi.png
    30_LitigeResolu.png
    31_BoPreuves.png
    32_BoLitiges.png
    33_BoJournal.png
  open-parameters.md
  release-checklist.md
  specs/
    ledger.md
    modele-cible-v2.md
    multi-payers.md
    trustlink-security.md
  supabase-setup.md
package.json
packages/
  api-client/
    package.json
    src/
    test/
    tsconfig.json
  domain/
    package.json
    src/
    test/
    tsconfig.json
  ui-tokens/
    package.json
    src/
    test/
    tsconfig.json
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/
  db.sh
  design-capture.mjs
  fixtures/
    devis_hopital.pdf
    piece_identite.png
  sql-editor-variant.mjs
supabase/
  .gitignore
  README.md
  config.toml
  migrations/
    0001_base_v0_1.sql
    0002_v0_2_enums.sql
    0003_v0_2_tranches.sql
    0004_v0_3_fixes.sql
    0005_lot4.sql
    0006_lot5.sql
    0007_lotx_enums.sql
    0008_lotx.sql
    0009_lotx_x4.sql
    0010_lotx_x5.sql
    0011_lotx_x6.sql
    0012_lotx_x7.sql
    0013_lotx2_enums.sql
    0014_lotx2_core.sql
    0015_lotx2_x1.sql
    0016_lotx2_x3.sql
    0017_lotx2_fixes.sql
    0018_lotx2_fixes2.sql
    0019_lotx2_fixes3.sql
    0020_lotx2_x4.sql
    0021_lotx2_x5.sql
    0022_lotx2_x6.sql
    0023_lotx2_fixes4.sql
  rollbacks/
    0011_lotx_x6_down.sql
    0012_lotx_x7_down.sql
  seed-evidence.sql
  seed-staff.sql
  seed.sql
  tests/
    00_smoke.sql
    00_smoke_editor.sql
    01_lot4.sql
    01_lot4_editor.sql
    02_lot5.sql
    02_lot5_editor.sql
    03_lotx.sql
    03_lotx_editor.sql
    04_lotx_p2.sql
    04_lotx_p2_editor.sql
    05_lotx2_p1.sql
    05_lotx2_p1_editor.sql
    06_lotx2_p2.sql
    06_lotx2_p2_editor.sql
    local-postgres-stubs.sql
tsconfig.base.json
turbo.json

```

## 3. Dépendances directes : version demandée et version installée (`pnpm-lock.yaml`, lockfileVersion 9.0)

Colonne « usage » : recherche d’un `import`/`require` dans les sources du paquet (hors `node_modules`, `.next`, `dist`). Les imports à effet de bord ont été vérifiés à part : `react-native-get-random-values` est importé (`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/state/sessionStorage.ts`), `server-only` aussi (`apps/web/src/lib/supabase/server.ts`, `apps/web/src/lib/staff.ts`). « NON IMPORTÉ » est normal pour `typescript`, `@types/*`, `react-dom` (exigé par Next et Expo web), `react-native-web`, `react-native-screens` et `@expo/metro-runtime` (chargés par Expo/expo-router).


### .

| type | paquet | demandé | installé | usage |
|---|---|---|---|---|
| dev | playwright-core | 1.65.0 | 1.65.0 | (racine) |
| dev | turbo | ^2.1.0 | 2.11.10 | (racine) |
| dev | typescript | ^5.6.0 | 5.9.3 | (racine) |

### apps/mobile

| type | paquet | demandé | installé | usage |
|---|---|---|---|---|
| prod | @diaspay/api-client | workspace:* | link:../../packages/api-client | importé |
| prod | @diaspay/domain | workspace:* | link:../../packages/domain | importé |
| prod | @diaspay/ui-tokens | workspace:* | link:../../packages/ui-tokens | importé |
| prod | @expo-google-fonts/inter | ^0.4.2 | 0.4.2 | importé |
| prod | @expo/metro-runtime | ~58.0.17 | 58.0.17 | NON IMPORTÉ |
| prod | @react-native-async-storage/async-storage | 2.2.0 | 2.2.0 | importé |
| prod | @react-native-community/datetimepicker | 9.2.1 | 9.2.1 | importé |
| prod | @react-native-community/netinfo | 12.0.1 | 12.0.1 | importé |
| prod | @supabase/supabase-js | ^2.119.0 | 2.119.0 | NON IMPORTÉ |
| prod | @tanstack/query-async-storage-persister | ^5.107.1 | 5.107.1 | importé |
| prod | @tanstack/react-query | ^5.107.1 | 5.107.1 | importé |
| prod | @tanstack/react-query-persist-client | ^5.107.1 | 5.107.1 | importé |
| prod | aes-js | ^3.1.2 | 3.1.2 | importé |
| prod | expo | ~58.0.23 | 58.0.23 | plugin app.json |
| prod | expo-camera | ~58.0.14 | 58.0.14 | importé |
| prod | expo-constants | ~58.0.15 | 58.0.15 | importé |
| prod | expo-crypto | ~58.0.8 | 58.0.8 | importé |
| prod | expo-document-picker | ~58.0.4 | 58.0.4 | importé |
| prod | expo-file-system | ~58.0.13 | 58.0.13 | importé |
| prod | expo-font | ~58.0.11 | 58.0.11 | importé |
| prod | expo-haptics | ~58.0.7 | 58.0.7 | importé |
| prod | expo-image-manipulator | ~58.0.16 | 58.0.16 | importé |
| prod | expo-image-picker | ~58.0.10 | 58.0.10 | importé |
| prod | expo-linking | ~58.0.16 | 58.0.16 | NON IMPORTÉ |
| prod | expo-local-authentication | ~58.0.2 | 58.0.2 | importé |
| prod | expo-print | ~58.0.8 | 58.0.8 | importé |
| prod | expo-router | ~58.0.30 | 58.0.30 | importé |
| prod | expo-screen-capture | ~58.0.6 | 58.0.6 | importé |
| prod | expo-secure-store | ~58.0.2 | 58.0.2 | importé |
| prod | expo-sharing | ~58.0.22 | 58.0.22 | importé |
| prod | expo-splash-screen | ~58.0.13 | 58.0.13 | importé |
| prod | expo-status-bar | ~58.0.4 | 58.0.4 | importé |
| prod | qrcode-generator | ^2.0.4 | 2.0.4 | importé |
| prod | react | 19.3.0 | 19.3.0 | importé |
| prod | react-dom | 19.3.0 | 19.3.0 | NON IMPORTÉ |
| prod | react-native | 0.88.1 | 0.88.1 | importé |
| prod | react-native-get-random-values | ^2.1.0 | 2.1.0 | importé (effet de bord) |
| prod | react-native-safe-area-context | ~5.11.1 | 5.11.1 | importé |
| prod | react-native-screens | ~4.30.1 | 4.30.1 | NON IMPORTÉ |
| prod | react-native-svg | 15.16.0 | 15.16.0 | importé |
| prod | react-native-web | ~0.21.4 | 0.21.4 | NON IMPORTÉ |
| dev | @types/aes-js | ^3.1.4 | 3.1.4 | NON IMPORTÉ |
| dev | @types/react | ~19.3.0 | 19.3.0 | NON IMPORTÉ |
| dev | typescript | ~6.0.3 | 6.0.3 | NON IMPORTÉ |
| dev | vitest | ^2.1.0 | 2.1.9 | importé |

### apps/web

| type | paquet | demandé | installé | usage |
|---|---|---|---|---|
| prod | @diaspay/api-client | workspace:^ | link:../../packages/api-client | importé |
| prod | @diaspay/domain | workspace:^ | link:../../packages/domain | importé |
| prod | @diaspay/ui-tokens | workspace:^ | link:../../packages/ui-tokens | importé |
| prod | @supabase/ssr | 0.12.7 | 0.12.7 | importé |
| prod | @supabase/supabase-js | ^2.119.0 | 2.119.0 | importé |
| prod | next | 16.4.6 | 16.4.6 | importé |
| prod | react | 19.3.0 | 19.3.0 | importé |
| prod | react-dom | 19.3.0 | 19.3.0 | NON IMPORTÉ |
| prod | server-only | ^0.0.1 | 0.0.1 | importé (effet de bord) |
| dev | @playwright/test | 1.65.0 | 1.65.0 | importé |
| dev | @types/node | ^22 | 22.20.5 | NON IMPORTÉ |
| dev | @types/react | ^19 | 19.3.0 | NON IMPORTÉ |
| dev | @types/react-dom | ^19 | 19.3.0 | NON IMPORTÉ |
| dev | typescript | ~6.0.3 | 6.0.3 | NON IMPORTÉ |
| dev | vitest | ^2.1.0 | 2.1.9 | importé |

### packages/api-client

| type | paquet | demandé | installé | usage |
|---|---|---|---|---|
| prod | @diaspay/domain | workspace:* | link:../domain | importé |
| prod | @supabase/supabase-js | ^2.119.0 | 2.119.0 | importé |
| dev | typescript | ^5.6.0 | 5.9.3 | NON IMPORTÉ |
| dev | vitest | ^2.1.0 | 2.1.9 | importé |

### packages/domain

| type | paquet | demandé | installé | usage |
|---|---|---|---|---|
| prod | @noble/hashes | ^2.4.0 | 2.4.0 | importé |
| prod | zod | ^4.6.7 | 4.6.7 | importé |
| dev | typescript | ^5.6.0 | 5.9.3 | NON IMPORTÉ |
| dev | vitest | ^2.1.0 | 2.1.9 | importé |

### packages/ui-tokens

| type | paquet | demandé | installé | usage |
|---|---|---|---|---|
| dev | typescript | ^5.6.0 | 5.9.3 | NON IMPORTÉ |
| dev | vitest | ^2.1.0 | 2.1.9 | importé |

Outils : Node `v24.21.0` (local), pnpm `9.12.0` (`packageManager`), TypeScript 5.9.3 (racine, paquets) et 6.0.3 (`apps/mobile`, `apps/web`), turbo 2.11.10, vitest 2.1.9, Playwright 1.65.0, Next.js 16.4.6, Expo SDK 58, React 19.3.0, React Native 0.88.1. Aucun champ `engines` ni `.nvmrc` : version de Node non fixée par le dépôt.

Dépendances **déclarées et jamais importées** (hors outillage) : `expo-linking` (apps/mobile), `@supabase/supabase-js` (apps/mobile, utilisé seulement via `@diaspay/api-client`). Dépendances **importées et non déclarées** : aucune (seuls des alias `@/…` et des modules `node:` intégrés).

Paquets demandés par l’audit, côté `apps/mobile` : expo-router 58.0.30 ; expo-secure-store 58.0.2 ; expo-local-authentication 58.0.2 ; expo-camera 58.0.14 ; **expo-clipboard : absent** ; expo-haptics 58.0.7 ; expo-sharing 58.0.22 (reçu) ; **react-native-view-shot : absent** ; expo-screen-capture 58.0.6 ; expo-crypto 58.0.8 ; aes-js 3.1.2 ; react-native-get-random-values 2.1.0 ; @react-native-community/netinfo 12.0.1. Tous importés.

## 4. Scripts

| paquet | scripts |
|---|---|
| . | `test`, `typecheck`, `capture`, `db:types`, `db:test`, `test:supabase`, `build`, `dev:web` |
| apps/mobile | `start`, `android`, `ios`, `web`, `typecheck`, `test` |
| apps/web | `dev`, `build`, `start`, `typecheck`, `test`, `e2e` |
| packages/api-client | `test`, `typecheck` |
| packages/domain | `test`, `typecheck` |
| packages/ui-tokens | `test`, `typecheck` |

## 5. Recherche de secrets (fichiers suivis et tout l’historique Git)

Motifs cherchés : jeton JWT (`eyJ…`), clés Supabase `sb_secret_`, `sb_publishable_`, jeton d’accès `sbp_`, jetons GitHub, clés AWS, clés privées PEM, clés `sk_live`/`rk_live`, mot de passe littéral affecté, URL PostgreSQL avec identifiants. Script : lignes ajoutées de tous les commits (`git log --all -p -G`).

| type de motif | fichier | commit | verdict |
|---|---|---|---|
| mot de passe affecté | `scripts/db.sh` (2 lignes) | cb1dc44, 02f08bb | **faux positif** : les deux affectations référencent une variable d’environnement (`SUPABASE_DB_PASSWORD`, variable de mot de passe du personnel de test), aucune valeur littérale |

Aucun autre motif trouvé, ni dans `HEAD` ni dans l’historique. Le mot `service_role` apparaît dans 22 fichiers suivis : uniquement comme nom de rôle (migrations, tests SQL, documentation, garde `packages/api-client/src/supabase/client.ts` qui refuse une clé secrète, test `apps/web/test/build-secrets.test.ts`), jamais avec une clé.

Fichiers `.env*` suivis : `.env.example`, `apps/web/.env.example` (gabarits sans valeur réelle). Présents sur disque, non suivis (ignorés) : `.env.local`, `apps/mobile/.env.local`, `apps/web/.env.local`.

**`Archive.zip`** (non suivi, 261 429 384 octets, 1 943 entrées, 666 sous `node_modules`) contient `apps/web/.env.local` et `apps/mobile/.env.local` ainsi que `supabase/.temp`. `.gitignore` **ne couvre pas** `Archive.zip` ni `*.zip` : un `git add .` le validerait.

## 6. Variables d’environnement (noms seulement)

| variable | lue dans | dans un `.env.example` | présente dans un `.env.local` local |
|---|---|---|---|
| `CHROME_PATH` | `scripts/design-capture.mjs` | **absente** | non |
| `E2E_CAPTURE` | `apps/web/e2e/zz-capture.spec.ts` | **absente** | non |
| `E2E_PORT` | `apps/web/playwright.config.ts` | **absente** | non |
| `E2E_STAFF_PASSWORD` | `apps/web/e2e/env.ts` `apps/web/e2e/global-setup.ts` `apps/web/playwright.config.ts` `scripts/db.sh` | apps/web/.env.example | .env.local |
| `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` | `apps/mobile/src/app/_layout.tsx` `apps/mobile/src/lib/releaseGuard.ts` `scripts/design-capture.mjs` | .env.example | non |
| `EXPO_PUBLIC_API` | `apps/mobile/src/state/api.ts` `apps/mobile/src/state/auth.ts` `apps/mobile/src/state/backend.ts` | .env.example | .env.local apps/mobile/.env.local |
| `EXPO_PUBLIC_DEMO` | `apps/mobile/src/app/(tabs)/profile.tsx` `apps/mobile/src/app/_layout.tsx` `apps/mobile/src/lib/env.ts` `apps/mobile/src/lib/releaseGuard.ts` | .env.example | non |
| `EXPO_PUBLIC_HELP_URL` | `apps/mobile/src/lib/env.ts` | .env.example | non |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `apps/mobile/src/state/backend.ts` `package.json` `packages/api-client/src/supabase/client.ts` | .env.example | .env.local apps/mobile/.env.local |
| `EXPO_PUBLIC_SUPABASE_URL` | `apps/mobile/src/state/backend.ts` `package.json` `packages/api-client/src/supabase/client.ts` | .env.example | .env.local apps/mobile/.env.local |
| `EXPO_PUBLIC_TERMS_URL` | `apps/mobile/src/lib/env.ts` | .env.example | non |
| `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` | `apps/mobile/src/state/api.ts` | .env.example | non |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/web/e2e/env.ts` `apps/web/e2e/global-setup.ts` `apps/web/src/lib/env.ts` `apps/web/src/lib/supabase/browser.ts` | apps/web/.env.example | apps/web/.env.local |
| `NEXT_PUBLIC_SUPABASE_URL` | `apps/web/e2e/env.ts` `apps/web/e2e/global-setup.ts` `apps/web/src/lib/env.ts` `apps/web/src/lib/supabase/browser.ts` | apps/web/.env.example | apps/web/.env.local |
| `NODE_ENV` | `apps/web/src/proxy.ts` | **absente** | non |
| `SUPABASE_DB_PASSWORD` | `scripts/db.sh` | .env.example | .env.local |
| `SUPABASE_TEST_ANON_KEY` | `package.json` `packages/api-client/test/contract/contract.ts` `packages/api-client/test/contract/supabase.contract.test.ts` | .env.example | non |
| `SUPABASE_TEST_URL` | `package.json` `packages/api-client/test/contract/contract.ts` `packages/api-client/test/contract/supabase.contract.test.ts` | .env.example | non |

`NODE_ENV`, `CHROME_PATH`, `E2E_CAPTURE`, `E2E_PORT` sont des variables d’outillage (build, Playwright, captures) ; leur absence des gabarits est normale. `SUPABASE_ACCESS_TOKEN` est déclarée dans `.env.example` pour la CLI Supabase (lue par la CLI, pas par le code).

## 7. `TODO`, `FIXME`, `HACK`, fichiers volumineux

- `git grep -E '\b(TODO|FIXME|HACK|XXX)\b'` (hors `pnpm-lock.yaml`) : **aucune occurrence**.
- Fichiers suivis de plus de 1 Mo : **aucun** (aucun au-delà de 300 Ko non plus).

## 8. Documentation (`docs/**` et README)

| fichier | octets | dernier commit | titre | première ligne utile (tronquée) |
|---|---|---|---|---|
| `README.md` | 22685 | 2026-11-12 d2a3e36 | DiasPay & DiasPayQR | Monorepo pnpm + Turborepo. |
| `docs/backoffice.md` | 11657 | 2026-11-11 6993f7a | Bureau de contrôle (back-office web) | Application Next.js 16 (App Router, TypeScript strict) dans `apps/web`, utilisée par les **validateurs** et les **admini |
| `docs/decisions.md` | 50050 | 2026-11-13 b31f68e | Décisions du projet DiasPayQR | Choix délégués par le client au prestataire. Chaque décision reste révisable par le client. |
| `docs/design-conformity.md` | 11579 | 2026-11-10 9b7923d | Conformité au design — maquette v5 (33 écrans) | - **Référence** : `docs/maquette/` (images fournies, 780 × 1688 pour le mobile). |
| `docs/error-codes.md` | 14901 | 2026-11-13 b31f68e | Codes d’erreur | Table unique des codes d’erreur stables (lot 4). La source de vérité est `packages/domain/src/errors.ts` ; un test (`pac |
| `docs/lotx2-adaptations-ecrans.md` | 26356 | 2026-11-13 b31f68e | Lot X version 2 : adaptations des écrans existants | Annexe de `docs/decisions.md` (X2-v2). Aucun écran nouveau : adaptations minimales des écrans existants au modèle cible  |
| `docs/lotx2-controles-sql.md` | 46501 | 2026-11-13 b31f68e | Lot X version 2 : contrôles SQL modifiés, remplacés ou ajoutés | Annexe de `docs/decisions.md` (entrée X2-v2). Une ligne par contrôle : ancien libellé → nouveau → raison. Les comporteme |
| `docs/open-parameters.md` | 3782 | 2026-11-13 b31f68e | Paramètres ouverts (à ne pas inventer) | Les valeurs ci-dessous ne sont pas fournies par le client, le partenaire de paiement ou le conseil juridique. Elles exis |
| `docs/release-checklist.md` | 11622 | 2026-11-13 b31f68e | Liste de contrôle avant publication | À dérouler pour chaque build destiné aux stores (App Store, Google Play) ou à la production web. |
| `docs/specs/ledger.md` | 9024 | 2026-11-12 309fdec | Journal financier et paiements (brouillon pour le kickoff) | État au 12 novembre 2026 (lot X, X5). Ce document propose un plan de comptes minimal et décrit les règles déjà en place. |
| `docs/specs/modele-cible-v2.md` | 12505 | 2026-11-12 de85dfc | Modèle cible v2 — après le kickoff | Spécification de travail (pas une mise à jour du cahier des charges). Elle traduit les décisions K1 à K14 en un modèle d |
| `docs/specs/multi-payers.md` | 3778 | 2026-11-12 d2a3e36 | Plusieurs payeurs pour une même demande (brouillon pour le kickoff) | État au 12 novembre 2026 (lot X, X7). Ce document décrit ce qui est en place et propose la suite pour la phase 2. **Rien |
| `docs/specs/trustlink-security.md` | 4752 | 2026-11-12 83c2abe | Sécurité du TrustLink : état réel après le lot X (passe 1) | Brouillon pour le kickoff. Référence : exigence 5.1 du « Cahier d’extension fonctionnelle de DiasPayQR ». État vérifié l |
| `docs/supabase-setup.md` | 14389 | 2026-11-13 b31f68e | Mise en place de Supabase | Guide pour un projet de **développement**. La production suit le même ordre, sans les numéros de test ni le seed (voir ` |
| `supabase/README.md` | 12429 | 2026-11-11 02f08bb | Base de données DiasPay (Supabase / PostgreSQL) | Quatre migrations à appliquer **dans l'ordre**, une par fichier : |

Images : `docs/maquette/` (33 PNG, maquette v5) et `docs/captures/` (29 PNG, captures du lot 3b).

## 9. Sorties des commandes de vérification (16 novembre 2026)

Lancées avec `SUPABASE_TEST_URL` et `SUPABASE_TEST_ANON_KEY` non définies (la suite de contrat Supabase est donc ignorée).

```
$ pnpm -r test
packages/ui-tokens test:  Test Files  1 passed (1)
packages/ui-tokens test:       Tests  50 passed (50)
packages/domain test:  Test Files  12 passed (12)
packages/domain test:       Tests  145 passed (145)
packages/api-client test:  Test Files  6 passed | 1 skipped (7)
packages/api-client test:       Tests  122 passed | 1 skipped (123)
apps/web test:  Test Files  7 passed (7)
apps/web test:       Tests  49 passed (49)
apps/mobile test:  Test Files  11 passed (11)
apps/mobile test:       Tests  117 passed (117)

$ pnpm -r typecheck
packages/ui-tokens typecheck: Done
packages/domain typecheck: Done
packages/api-client typecheck: Done
apps/web typecheck: Done
apps/mobile typecheck: Done
EXIT 0

$ pnpm build   (turbo : seul @diaspay/web a un script build)
@diaspay/web:build: ▲ Next.js 16.4.6 (Turbopack)
@diaspay/web:build: - Environments: .env.local
@diaspay/web:build: ✓ Compiled successfully in 1261ms
@diaspay/web:build: ✓ Generating static pages using 7 workers (14/14) in 196ms
 Tasks:    1 successful, 1 total
EXIT 0

$ pnpm --filter @diaspay/mobile exec expo export --platform web
Web Bundled 9103ms node_modules/expo-router/entry.js (1252 modules)
› web bundles (34):
Exported: dist
EXIT 0
```
