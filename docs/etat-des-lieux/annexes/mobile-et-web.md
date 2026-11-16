# Annexe : application mobile et bureau de contrôle (web)

Audit en lecture seule de la branche `lotX` (dernier commit `b31f68e`, X6). Chemins relatifs à la racine du dépôt. Aucune valeur de variable d’environnement n’est reproduite. Aucun test ni build n’a été lancé pour cette annexe.

## 0. Volumétrie

| Périmètre | Fichiers | Lignes |
|---|---:|---:|
| `apps/mobile/src` (ts, tsx ; hors `expo-env.d.ts` et tests) | 84 | 6 722 (dont `src/i18n/messages.ts` : 1 062) |
| `apps/mobile/test` (vitest) | 11 | 762 |
| `apps/web/src` (ts, tsx, css ; hors `next-env.d.ts`) | 54 | 3 347 (dont `src/i18n/fr.ts` : 605) |
| `apps/web/test` + `apps/web/e2e` | 7 + 13 | 1 361 |

Pile mobile (`apps/mobile/package.json`) : Expo 58, expo-router 58 (`main: expo-router/entry`), React Native 0.88, TanStack Query (cache persistant en mode Supabase), `@diaspay/api-client`, `@diaspay/domain`, `@diaspay/ui-tokens`. Pile web (`apps/web/package.json`) : Next.js 16.4, `@supabase/ssr`, Playwright 1.65, vitest.

## 1. Mobile : routes (G1)

Navigation : `src/app/_layout.tsx` (Stack racine). Deux gardes `Stack.Protected` : `canSetup(session)` (session ouverte) pour `(auth)/profile-setup` et `(auth)/biometrics`, `canUseApp(session)` (session avec profil) pour les onglets et tous les écrans d’opération (`src/lib/flow.ts`). Écrans publics : `index`, `(onboarding)/slides`, `(auth)/login`, `(auth)/otp`.

Constats sur la déclaration des routes :
- `_layout.tsx` déclare `<Stack.Screen name="t/[reference]">` alors qu’aucun fichier `src/app/t/` n’existe (et `test/trustlink.test.ts` vérifie justement son absence). Déclaration orpheline : avertissement d’Expo Router en développement, pas de route réelle.
- `src/app/tranche/[trancheId].tsx` n’est pas déclaré dans le Stack, donc hors des `Stack.Protected` ; l’écran vérifie lui-même `canUseApp` et redirige (`<Redirect href={startRoute(state)} />`).

### 1.1 Démarrage et connexion

| Route | Fichier | Composants / hooks / appels principaux |
|---|---|---|
| `/` | `src/app/index.tsx` (`Launch`) | `useSession`, `bootstrap()` (`state/auth.ts`), `startRoute` (`lib/flow.ts`), `Logo`, `LangSwitch` ; affichage minimal 1,2 s |
| `/slides` | `src/app/(onboarding)/slides.tsx` | `markOnboardingSeen`, `IllustrationLock/Proof/Purpose`, `StepDots` |
| `/login` | `src/app/(auth)/login.tsx` | `requestOtp`, `composePhone`, `isValidPhone` |
| `/otp` | `src/app/(auth)/otp.tsx` | `verifyOtp`, `requestOtp`, `startRoute` ; code simulé affiché seulement si `SHOW_DEMO && API_MODE === 'mock'` (l.122) |
| `/profile-setup` | `src/app/(auth)/profile-setup.tsx` | `ProfileForm` (`features/profile/ProfileForm.tsx`) |
| `/biometrics` | `src/app/(auth)/biometrics.tsx` | `expo-local-authentication`, `setBiometric`, `bioKind` |
| (racine) | `src/app/_layout.tsx` | `useFonts`, `DataProvider` (persistance TanStack en mode Supabase), `useRealtime`, `useOnline`, `OfflineBanner`, `ToastHost`, `demoReleaseViolation`, `mockApi.runTimers()` (simulateur) |
| (filtre d’adresses) | `src/app/+native-intent.tsx` | `redirectSystemPath` : seul `diaspay://tranche/<id>` est accepté (`parseInternalLink`, `packages/domain/src/links.ts`) |
| `/tranche/[trancheId]` | `src/app/tranche/[trancheId].tsx` (`OpenTranche`) | `api.getTranche` puis `router.replace('/tx/[id]')` |
| Onglets | `src/app/(tabs)/_layout.tsx` | `Tabs` : home, transactions, scan, alerts, profile |
| `/home` | `src/app/(tabs)/home.tsx` | `useTransactionsQuery`, `QueryGate`, `nextPayment`, `lockedFunds`, `startNewNeed` |
| `/alerts` | `src/app/(tabs)/alerts.tsx` | `useNotificationsQuery`, `alertKeys`, `groupByDay`, `api.markNotificationRead`, `api.markAllNotificationsRead` |

### 1.2 Création d’un besoin (assistant en 6 étapes)

| Route | Fichier | Composants / hooks / appels |
|---|---|---|
| `need/_layout` | `src/app/need/_layout.tsx` | `useWizard`, `getWizard`, `closeWizard` (enregistre le brouillon à la sortie) ; redirige vers `/transactions` sans état |
| `/need/type` | `src/app/need/type.tsx` | `useModulesQuery`, `useModuleList`, `WizardFrame` |
| `/need/details` | `src/app/need/details.tsx` | `AmountField`, `DateField`, `findModule(...).beneficiaryMode` (NAME / REFERENCE_ONLY / NONE) |
| `/need/plan` | `src/app/need/plan.tsx` | `planGap`, `stepIssues`, clés D3 `plan_help_*`, `plan_sum_*` |
| `/need/provider` | `src/app/need/provider.tsx` | `api.searchProviders`, `normalizePhone` |
| `/need/documents` | `src/app/need/documents.tsx` | `pickFile`, `api.attachDocument`, `api.removeDocument`, `checkFile`, `missingModuleDocuments` |
| `/need/recap` | `src/app/need/recap.tsx` | `describeRelease`, `api.submitNeed`, `saveNow`, `discardWizard` |
| `/need-done/[txId]` | `src/app/need-done/[txId].tsx` | `useTransactions` ; texte `submittedActiveText` si l’opération est déjà `ACTIVE` |
| `/transactions` | `src/app/(tabs)/transactions.tsx` | `useTransactionsQuery`, `useDraftsQuery`, `filterTransactions`, `openDraft`, `api.deleteDraft` |

### 1.3 Paiement et suivi

| Route | Fichier | Composants / hooks / appels |
|---|---|---|
| `/tx/[id]` | `src/app/tx/[id].tsx` (`TransactionDetail`, `TrancheItem`) | `useTransactionsQuery`, `useDisputeQuery` (par tranche), `canOpenDispute`, `receiptAvailable`, `api.cancelOperation`, `api.confirmService`, `api.approveRelease`, `api.simulateReview` (démo) |
| `/pay/[trancheId]` | `src/app/pay/[trancheId].tsx` | `biometric(t('bioReason'))` puis `api.payTranche(tr.id, idempotencyKey)` ; note `lockedNote` (CONDITIONAL) ou `directNote` |
| `/token/[trancheId]` | `src/app/token/[trancheId].tsx` (`TokenScreen`) | `useNoScreenCapture('token')`, `api.getTranche`, `api.getToken`, `api.eqrImageEnabled`, `QrCode`, `tokenState` |

### 1.4 Litiges et reçu

| Route | Fichier | Composants / hooks / appels |
|---|---|---|
| `/dispute/[trancheId]` | `src/app/dispute/[trancheId].tsx` | `api.openDispute` ; bandeau `disputeBanner` / `disputePaidNote` |
| `/dispute/view/[trancheId]` | `src/app/dispute/view/[trancheId].tsx` (`DisputeTracking`) | `useDisputeQuery`, `disputeSteps`, `disputeStatus`, `resolutionAmount`, `demoOutcomes`, `suspendsTranche`, `api.simulateDisputeResolution` (démo) |
| `/receipt/[trancheId]` | `src/app/receipt/[trancheId].tsx` | `useReceiptQuery`, `receiptRows`, `receiptHtml`, `Print.printToFileAsync`, `Sharing.shareAsync`, `Share.share` (partage du texte du reçu, pas du jeton) |

### 1.5 Profil et sécurité

| Route | Fichier | Composants / hooks / appels |
|---|---|---|
| `/profile` | `src/app/(tabs)/profile.tsx` | `useDemo`, `usePersona`, `setPersona` (bloc de démonstration seulement), `setLocale`, `signOut`, `HELP_URL`, `TERMS_URL`, `api.resetDemoData` |
| `/profile/edit` | `src/app/profile/edit.tsx` | `ProfileForm` |
| `/profile/security` | `src/app/profile/security.tsx` | `setPreferences`, `useBioKind`, `signOut`, `expo-local-authentication` |

### 1.6 Scan

| Route | Fichier | Composants / hooks / appels |
|---|---|---|
| `/scan` | `src/app/(tabs)/scan.tsx` | `CameraView`, `useCameraPermissions` (expo-camera), `scanReducer` / `precheck` (`features/scan/reducer.ts`), `api.resolveReference`, `biometric(...)` puis `api.confirmByReference`, message `scanWrongMode` |

### 1.7 Enrôlement, devis, acceptation-paiement, jeton de présentation

Aucun écran. Preuves :
- aucune occurrence de `getEnrolment`, `submitEnrolment`, `getQuote`, `acceptAndPay`, `acceptPlan`, `presentation` dans `apps/mobile/src` ni `apps/web/src` (recherche faite) ; seule mention : `src/state/api.ts` l.58-60 force `enrolmentLevel: 'N2'` dans le simulateur ;
- les méthodes existent dans `packages/api-client/src/supabase/api.ts` (`acceptPlan` l.161, `getQuote` l.117, `acceptAndPay` l.121, `getEnrolment` l.395, `submitEnrolment` l.399) ;
- aucune méthode client pour le jeton de présentation (`issue_presentation_token`, `claim_presentation_token`, migration `0016_lotx2_x3.sql`) : seul le type généré `presentation_tokens` existe dans `database.types.ts` ;
- `docs/lotx2-adaptations-ecrans.md` (passe 2) annonce ces écrans pour le lot Y.

## 2. Internationalisation et configuration (G2)

### 2.1 Dictionnaires mobile

- Source : `apps/mobile/src/i18n/messages.ts` (objets `fr` et `en: Record<Key, string>`, clés plates). `apps/mobile/locales/fr.json` et `en.json` ne contiennent que `ios.NSCameraUsageDescription` (localisation native d’`app.json`).
- Comptage par script d’aplatissement (`/private/tmp/claude-501/-Users-macbook-Projets-react-native--diaspay/94f03499-6e23-4b7b-9eaf-08423e5e945f/scratchpad/i18n-compare.mjs`) : **FR 646 clés, EN 646 clés ; aucune clé manquante d’un côté ni de l’autre.** La parité est aussi imposée à la compilation (`en: Record<Key, string>`) et par `apps/mobile/test/i18n.test.ts` (mêmes clés, aucune valeur vide, apostrophes typographiques, mêmes paramètres `{…}`, un message pour chaque code de `ERROR_CODES`).
- Décision D3 (`docs/decisions.md` l.31-47) : les clés `plan.help.*` et `plan.sum.*` sont écrites `plan_help_single|partial|installments|recurring`, `plan_sum_ok|under|over` et `plan_note` (la décision le prévoit explicitement, « les dictionnaires n’utilisant que des identifiants simples »). **Présentes en FR (l.275-282) et en EN (l.805-812), textes identiques à ceux de D3.** Utilisées par `src/app/need/plan.tsx` l.22 et l.129-130. Aucune clé à point `plan.help.*` n’existe.
- Web : une seule langue, `apps/web/src/i18n/fr.ts` (environ 442 clés `fr` + table `frErrors: Record<ErrorCode, string>`), `locale = 'fr-FR'` (`apps/web/src/i18n/index.ts`).

### 2.2 Variables `EXPO_PUBLIC_*` lues par le code mobile

| Nom | Lu dans | Dans `.env.example` (racine) |
|---|---|---|
| `EXPO_PUBLIC_API` | `src/state/backend.ts` l.16 (`API_MODE` : `'supabase'` sinon `'mock'`), `src/state/api.ts`, `src/state/auth.ts` (commentaires) | oui |
| `EXPO_PUBLIC_SUPABASE_URL` | `src/state/backend.ts` l.25 ; `packages/api-client/src/supabase/client.ts` l.44 (message) | oui |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `src/state/backend.ts` l.26, l.43 ; `packages/api-client/src/supabase/client.ts` l.44 | oui |
| `EXPO_PUBLIC_DEMO` | `src/lib/env.ts` (`SHOW_DEMO`, `DEMO_REVIEW`), `src/app/_layout.tsx` l.33, `src/state/queries.ts` (`useDemo`), `src/state/backend.ts` | oui |
| `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` | `src/app/_layout.tsx` l.33 | oui |
| `EXPO_PUBLIC_HELP_URL`, `EXPO_PUBLIC_TERMS_URL` | `src/lib/env.ts` l.8-9 | oui |
| `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` | `src/state/api.ts` l.20 (simulateur) | oui |
| `EXPO_PUBLIC_LINK_BASE` | **jamais lue** (absence vérifiée par `test/trustlink.test.ts`) | non |

Fichiers d’environnement présents (existence seulement) : `.env.example`, `.env.local` (racine), `apps/mobile/.env.local`, `apps/web/.env.example`, `apps/web/.env.local`. `.env.example` racine nomme aussi `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` (outillage et tests, pas l’application).

### 2.3 `app.json` (pas d’`app.config.*`)

- `scheme: "diaspay"` ; `experiments.typedRoutes: true` ; identifiants `com.diaspay.app` (iOS et Android) ; `locales` fr/en.
- Plugins : `expo-router`, `expo-local-authentication`, `expo-status-bar`, `expo-splash-screen`, `expo-secure-store`, `expo-sharing`, `expo-camera` (texte de permission caméra ; `recordAudioAndroid: false`, `microphonePermission: false`), `@react-native-community/datetimepicker`, `expo-font`.
- Permissions : caméra seulement (texte dans `expo-camera` et `locales/*.json`). Biométrie via `expo-local-authentication` (aucun texte `NSFaceIDUsageDescription` personnalisé déclaré).
- **Aucun lien universel** : pas d’`ios.associatedDomains`, pas d’`android.intentFilters`. Une adresse `https://…/t/…` n’ouvre donc pas l’application ; si elle y parvenait, `+native-intent.tsx` la ramène à `/` (démarrage) ou l’ignore.

## 3. Ancien modèle (G3)

Méthode : script `/private/tmp/claude-501/-Users-macbook-Projets-react-native--diaspay/94f03499-6e23-4b7b-9eaf-08423e5e945f/scratchpad/oldmodel.mjs` sur `apps/mobile`, `apps/web`, `packages/*`, `supabase/` (extensions ts, tsx, js, mjs, sql, json, md ; hors `node_modules`, `dist`, `.next`, `test-results`). Termes en majuscules comptés en mot entier (`PAYMENT_CONFIRMED` ne compte pas pour `CONFIRMED`) ; `vertical` compté comme sous-chaîne (inclut `verticalLabel`, `VERTICALS`).

Totaux : 108 fichiers. `vertical` 690, `RELEASED` 146, `CONFIRMED` 133, `IN_REVIEW` 132, `release_rules` 56, `PAID_LOCKED` 55, `AWAITING_PAYMENT` 51, `IN_PROGRESS` 42, `IMMEDIATE` 41, `EVIDENCE_SUBMITTED` 37, `DISPUTED` 34, `VALIDATED` 32, `TOKEN_ISSUED` 29, `can_initiate_requests` 19.

Repères pour juger (migrations) :
- `0013_lotx2_enums.sql` : les anciennes valeurs d’enum ne peuvent pas être retirées ; 0014 les refuse par contraintes.
- `0014_lotx2_core.sql` l.84-113 : conversions `PAID_LOCKED/EVIDENCE_SUBMITTED/CONFIRMED/RELEASED/DISPUTED → PAID` (avec `funds_state` HELD/RELEASED), `AWAITING_PAYMENT → SUBMITTED`, `PLANNED → DRAFT` ; opérations `SUBMITTED → PENDING_REVIEW`, `VALIDATED/TOKEN_ISSUED/IN_PROGRESS/DISPUTED/... → ACTIVE`, `REJECTED/EXPIRED → CANCELLED` ; contraintes `status in ('DRAFT','PENDING_REVIEW','IN_REVIEW','ACTIVE','SUSPENDED','CLOSED','CANCELLED')` et `('DRAFT','SUBMITTED','INFO_REQUESTED','ACCEPTED','PAID','REJECTED','CANCELLED','EXPIRED','REFUNDED')` ; `IMMEDIATE` interdit (`request_modules_no_immediate`, `tranches_no_immediate`).
- `IN_REVIEW` reste un statut v2 d’opération (et de dossier d’enrôlement, 0020) ; `RELEASED` reste une valeur de `funds_state` ; `CONFIRMED` est un statut v2 de tentative de paiement (0021) ; `vertical` reste le nom de la colonne `transactions.vertical` (texte, clé étrangère vers `request_modules`, 0011) ; `release_rules` est une **vue** de compatibilité (0011 l.129) encore lue par `save_draft` (0022 l.276) ; `can_initiate_requests` est supprimée (0020 l.584).

Synthèse : aucun usage fonctionnel résiduel d’un ancien statut dans le code applicatif (mobile, web, paquets). Résidus relevés :
1. `supabase/README.md` l.77 (« `claim_dossier` passe un dossier `SUBMITTED` en `IN_REVIEW` » : en v2, `PENDING_REVIEW`) et l.93 (émission simulée du jeton : `IN_PROGRESS`, `VALIDATED`, statuts supprimés) : documentation périmée.
2. `packages/domain/src/errors.ts` l.26 : `TX_NOT_ACTIVE: '… n’est pas en cours (IN_PROGRESS)'` (libellé de la table des erreurs).
3. `packages/domain/src/rules.ts` l.15 : commentaire « Miroir de la table SQL release_rules » (c’est une vue depuis 0011).
4. Terminologie : `vertical` est partout (690 occurrences) alors que le modèle parle de « type de besoin » / module (`request_modules`) ; légitime techniquement (nom de colonne conservé), mais à connaître.

Tableau complet par fichier : section 8.

## 4. Adaptations minimales v2 (G4)

Vérification point par point de `docs/lotx2-adaptations-ecrans.md`.

### 4.1 Mobile (passe 1)

| Point annoncé | Verdict | Preuve |
|---|---|---|
| `tx/[id]` : bandeau revue `PENDING_REVIEW`/`IN_REVIEW`, `SUSPENDED` en erreur, rejet = `CANCELLED` + `rejectionReason` + `rejectedFinal`, sans « Corriger » | VÉRIFIÉ | `src/app/tx/[id].tsx` l.30-46 ; clés `correct`, `abandon*` absentes de `messages.ts` |
| « Annuler l’opération » (`cancelOperation`) : initiateur, `ACTIVE`, aucune demande `ACCEPTED` | VÉRIFIÉ | l.34 (`tx.ownerId === me.id`, `!tx.tranches.some(r => r.status === 'ACCEPTED')`), l.61-63 |
| Texte d’état et pastille recalculés (statuts, `fundsState`, `onHold`, `paidAt`, `refundedMinor`) | VÉRIFIÉ | l.99-112 (`info`), l.80 (`dotColor`) |
| « Payer » : payeur, `ACTIVE`, `SUBMITTED`, non suspendue | VÉRIFIÉ | l.114 `canPay` |
| « Ouvrir un litige » selon `canOpenDispute` et sans litige en cours | VÉRIFIÉ, avec réserve | l.93 ; réserve : `roles` vient du profil global (`persona`, l.89), pas des rôles de l’utilisateur dans l’opération |
| QR / « Confirmer la prestation » / « Débloquer » : CONDITIONAL et fonds HELD seulement | VÉRIFIÉ | l.95 `held`, l.133-141 |
| « Voir le litige » (via `getDispute`), « Voir le reçu » (`receiptAvailable`), erreurs en toast | VÉRIFIÉ | l.90-92, l.143-148, l.97 |
| Accueil : libellé `lockedFunds` modifié | VÉRIFIÉ | `messages.ts` l.6 (FR) et l.536 (EN) |
| Transactions : « Preuve à valider » sans `EVIDENCE_SUBMITTED` | VÉRIFIÉ | `src/app/(tabs)/transactions.tsx` l.83-85 |
| Scan : `WRONG_MODE` → `scanWrongMode` | VÉRIFIÉ | `src/app/(tabs)/scan.tsx` l.149 |
| Réducteur du scan : `PAID` au lieu de `PAID_LOCKED` | VÉRIFIÉ | `src/features/scan/reducer.ts` l.57 |
| Jeton : état `direct` sans appel à `getToken` ; QR au payeur, `PAID`, `HELD`, non confirmé | VÉRIFIÉ | `src/app/token/[trancheId].tsx` l.57-64 |
| Paiement : `lockedNote` en CONDITIONAL, `directNote` sinon | VÉRIFIÉ | `src/app/pay/[trancheId].tsx` l.69 |
| Ouverture de litige : bandeau selon le moment ; ligne de contestation en CONDITIONAL | VÉRIFIÉ | `src/app/dispute/[trancheId].tsx` l.40, l.45 |
| Suivi de litige : résolu = `RESOLVED`, issues, `suspendsTranche`, reçu via `receiptAvailable`, bouton « classer sans suite » | VÉRIFIÉ | `src/features/dispute/state.ts` l.20, l.36-65 ; `src/app/dispute/view/[trancheId].tsx` l.42, l.51, l.98, l.103 |
| Reçu : titre « Tranche payée » en direct, « Tranche débloquée » en CONDITIONAL | **PARTIEL / DIVERGENT** | `src/app/receipt/[trancheId].tsx` l.30 : le titre conditionnel ne sert qu’au PDF et au partage (`labels.title`) ; à l’écran, l.80 affiche toujours `t('trancheReleased')`, y compris en règlement direct |
| `receiptAvailable` ; référence « — » si vide | VÉRIFIÉ | `src/features/receipt/receipt.ts` l.21-24, l.37 |
| Alertes : `NO_ACTION`, `REQUEST_PAID`, `PLAN_ACCEPTED`, `ALERT_TYPES satisfies`, `ALERT_OUTCOMES` | VÉRIFIÉ | `src/features/alerts/alerts.ts` l.82-94 ; `src/app/(tabs)/alerts.tsx` l.12, l.27 |
| Récapitulatif : règlement direct, note de revue si `platformReview ≠ NEVER` | VÉRIFIÉ | `src/app/need/recap.tsx` l.32-36 |
| `need-done` : `submittedActiveText`, filtre `ACTIVE` | VÉRIFIÉ | `src/app/need-done/[txId].tsx` l.17-18, l.31 |
| `txStatusKey` / `trancheStatusKey` exhaustifs (`satisfies`) | VÉRIFIÉ | `src/i18n/index.ts` l.55-62 |
| Couleurs `txStatusKind` | VÉRIFIÉ | `src/ui/index.tsx` l.288-289 |
| Clés ajoutées (30 listées), modifiées, supprimées | VÉRIFIÉ | toutes les clés ajoutées présentes en FR et EN ; `txRejected`, `txDisputed`, `txValidated`, `txToken`, `txSubmitted`, `trEvidence`, `trConfirmed`, `trReleased`, `trDisputed`, `correct`, `abandon*` absentes ; `txCancelled` = « Annulée » (l.24) |

### 4.2 Mobile (passe 2, X4 à X6)

| Point annoncé | Verdict | Preuve |
|---|---|---|
| Champ bénéficiaire selon `beneficiaryMode` (NAME, REFERENCE_ONLY majuscules 16 car. + aide, NONE) | VÉRIFIÉ | `src/app/need/details.tsx` l.37, l.48-55 |
| Récapitulatif : « Référence du patient » / aucune ligne | VÉRIFIÉ | `src/app/need/recap.tsx` l.78-79 |
| Détail et paiement : référence à la place du nom | VÉRIFIÉ | `src/app/tx/[id].tsx` l.173 ; `src/app/pay/[trancheId].tsx` l.54-55 |
| Scan : ligne « Bénéficiaire » seulement si nom | VÉRIFIÉ | `src/app/(tabs)/scan.tsx` l.159 |
| Simulateur : compte de démonstration N2 | VÉRIFIÉ | `src/state/api.ts` l.58-60 |
| Clés X4, X5, X6 (`err_ENROLMENT_REQUIRED` … `beneficiaryReferenceHint`) ; `err_INITIATION_NOT_ALLOWED` retirée | VÉRIFIÉ | toutes présentes FR et EN ; `err_INITIATION_NOT_ALLOWED` absente |
| « `payTranche` demande un devis … puis accepte et paie (X5) » | **PARTIEL** | vrai dans le simulateur (`packages/api-client/src/mockApi.ts` l.526-531 : `getQuote` puis `acceptAndPay`) ; sur Supabase, `payTranche` appelle le raccourci `start_payment` (`packages/api-client/src/supabase/api.ts` l.105-108), sans devis |

### 4.3 Web

| Point annoncé | Verdict | Preuve |
|---|---|---|
| `bo.ts` : `DisputeRow` v2 et colonnes `outcome`, `beforePayment`, `onHold`, `settlementMode`, `fundsState`, `refundedMinor` | VÉRIFIÉ | `apps/web/src/lib/bo.ts` ; vue `bo_disputes` de 0014 (l.1345-1360) fournit ces colonnes |
| `resolveDispute` avec `p_amount_minor` ; `decideEvidence` renvoie `funds_state` | VÉRIFIÉ | `bo.ts` l.163, l.193 |
| `dossierDetail` lit `settlement_mode` | VÉRIFIÉ | `bo.ts` l.109 |
| `lib/disputes.ts` : `isOpenDispute`, `availableOutcomes`, `disputeInputError` | VÉRIFIÉ | `apps/web/src/lib/disputes.ts` l.7, l.14, l.27 |
| Litiges : filtre ouverts, boutons issus de `availableOutcomes`, double confirmation | VÉRIFIÉ | `apps/web/src/features/litiges/LitigesScreen.tsx` l.21-29, l.100-118 |
| Dossiers : `PENDING_REVIEW` remplace `SUBMITTED` (prise en charge, filtre, lecture seule) | VÉRIFIÉ | `apps/web/src/features/dossiers/DossiersScreen.tsx` l.60, l.99, l.144, l.161 |
| Preuves : approbation partielle sur `funds === 'HELD'` | VÉRIFIÉ | `apps/web/src/features/preuves/PreuvesScreen.tsx` l.104-106 ; file `bo_evidence_queue` (0014) : `PAID`, `HELD`, `evidence_submitted_at` non nul |
| `audit.ts` : libellé rejet → annulation, `payload.funds_to` | VÉRIFIÉ | `apps/web/src/lib/audit.ts` l.19-20, l.29-30 |
| `fr.ts` : statuts v2 + anciens marqués « ancien statut » ; événements ; litiges ; erreurs | VÉRIFIÉ | `apps/web/src/i18n/fr.ts` l.114-150, l.390-476 |
| Point ouvert « `review.ts` encore aux anciennes issues » | DÉPASSÉ (corrigé depuis) | `packages/domain/src/review.ts` l.24-27 : `disputeDecisionError` s’appuie sur `DISPUTE_OUTCOMES` v2 |
| e2e passe 2 : dossier santé (référence, devis seul), remboursement `REQUESTED` | VÉRIFIÉ | `apps/web/e2e/fixtures.ts` l.129, l.136 ; `apps/web/e2e/litiges.spec.ts` l.69 |

Points signalés par le document (section « Points de l’API à signaler » 1 à 7) : non revérifiés un à un ici, hors du point 7 confirmé indirectement (rôle déduit de `persona` côté écrans, voir risques).

## 5. Jeton, liens, démonstration (G5)

| Contrôle | Résultat | Preuve |
|---|---|---|
| « Partager le lien », « Copier », « Enregistrer le QR », affichage d’adresse sur l’écran du jeton | Absents | `src/app/token/[trancheId].tsx` (lecture complète) ; seul le web a « Copier l’empreinte » (journal, `apps/web/src/i18n/fr.ts` l.367), sans rapport |
| `Share`, `Clipboard`, `expo-clipboard`, `react-native-view-shot`, `EXPO_PUBLIC_LINK_BASE` | Absents de l’écran du jeton et des dépendances ; `Share` n’est utilisé que par le reçu (`src/app/receipt/[trancheId].tsx` l.65) | `apps/mobile/package.json` ; test `test/trustlink.test.ts` l.20-36 |
| Route `t/[reference]` | Fichier absent ; **déclaration orpheline** dans `src/app/_layout.tsx` l.120 (`<Stack.Screen name="t/[reference]">`, commentaire « Lien profond : accessible sans session… » obsolète) | `test/trustlink.test.ts` l.29 vérifie l’absence du dossier |
| Adresses `https://…/t/…` | Ignorées : `+native-intent.tsx` renvoie `/` au démarrage, `null` sinon ; aucun domaine associé dans `app.json` | `src/app/+native-intent.tsx` ; `packages/domain/src/links.ts` ; tests `test/trustlink.test.ts` l.40-52, `packages/domain/test/lotx.test.ts` l.60-77 |
| Schéma `diaspay://` | Déclaré (`app.json`), réservé à `diaspay://tranche/<id>` (navigation interne depuis une notification) → `/tranche/<id>` → `/tx/[id]` | `packages/domain/src/links.ts` l.11-36 ; `src/app/tranche/[trancheId].tsx` |
| QR conditionné par `eqr_image_enabled` | Oui : `image ? <QrCode …/> : <Banner text={t('tokenImageOff')} />` | `src/app/token/[trancheId].tsx` l.65, l.121-125 ; `0015_lotx2_x1.sql` l.12-13 met la valeur à `false` |
| Protection contre la capture d’écran | Oui sur l’écran du jeton : `useNoScreenCapture('token')` → `ScreenCapture.preventScreenCaptureAsync` (sans effet sur le web) | `src/lib/screenCapture.ts` ; `src/app/token/[trancheId].tsx` l.49 ; vérifié par `test/trustlink.test.ts` l.23 |
| `EXPO_PUBLIC_DEMO` / `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` | Garde de production : `demoReleaseViolation({ dev: __DEV__, demo, allow })` vrai si build de production + démo sans autorisation → écran bloquant `DemoInReleaseBlocked` (aucun `bootstrap`, aucune donnée) | `src/lib/releaseGuard.ts` ; `src/app/_layout.tsx` l.32-34, l.64-75, l.91, l.105 |
| Test de la garde | Oui : `apps/mobile/test/lot3b.test.ts` l.8-18 (« garde de production du mode démonstration ») | 5 cas (prod+démo bloqué ; dev, sans démo, démo=0, démo autorisée passent) |

Écarts relevés :
- Valeur par défaut d’`eqr_image_enabled` incohérente côté client Supabase : `eqrImageEnabled()` renvoie `row?.value !== 'false'` (`packages/api-client/src/supabase/api.ts` l.351-355), donc **ligne absente ou illisible = image affichée**, alors que la migration 0015 fixe la valeur serveur à `false`. Commentaires périmés « défaut : oui » dans `packages/api-client/src/types.ts` l.224 et `mockApi.ts` l.59 (le simulateur, lui, vaut `false` par défaut, l.250).
- Aucune garde équivalente pour `EXPO_PUBLIC_API` : sans cette variable, `API_MODE` vaut `'mock'` (`src/state/backend.ts` l.16) et un build de production tournerait sur le simulateur local. Seule protection : la liste de contrôle `docs/release-checklist.md` l.26.
- Le scan n’a pas de protection contre la capture (non exigé).

## 6. Bureau de contrôle web (H)

### 6.1 Routes (`apps/web/src/app`)

| Route | Fichier | Accès |
|---|---|---|
| `/` | `page.tsx` | redirige vers `/dossiers` |
| `/connexion` | `connexion/page.tsx`, `LoginForm.tsx` | public |
| `/connexion/second-facteur` | `connexion/second-facteur/page.tsx` | connecté aal1 ; TOTP (`mfa.enroll`, `mfa.challengeAndVerify`) |
| `/mot-de-passe-oublie` | `mot-de-passe-oublie/page.tsx` | public |
| `/nouveau-mot-de-passe` | `nouveau-mot-de-passe/page.tsx` | session ouverte par le lien |
| `/auth/confirm` | `auth/confirm/route.ts` | public (gestionnaire de route) |
| `/acces-refuse` | `acces-refuse/page.tsx` | utilisateur non membre du personnel |
| `/dossiers` | `(bo)/dossiers/page.tsx` → `DossiersScreen` | VALIDATOR ou ADMIN |
| `/preuves` | `(bo)/preuves/page.tsx` → `PreuvesScreen` | VALIDATOR ou ADMIN |
| `/journal` | `(bo)/journal/page.tsx` → `JournalScreen` | VALIDATOR ou ADMIN |
| `/litiges` | `(bo)/litiges/page.tsx` → `LitigesScreen` | ADMIN seulement (`ADMIN_PATHS`) |
| `/icon.svg` | `icon.svg/route.ts` | statique |

### 6.2 Appels à la base

- RPC (`apps/web/src/lib/bo.ts`) : `claim_dossier`, `decide_tx`, `dossier_documents` (×3), `dossier_checks`, `bo_decisions` (×2), `evidence_checks`, `decide_tranche`, `resolve_dispute`, `open_document`, `bo_find_transactions`, `bo_audit`, `bo_audit_verify`, `log_audit_export`. Toutes définies dans les migrations (dernières définitions : 0006, 0009, 0014 ou 0022).
- Tables et vues (`.from`) : vues `bo_dossiers`, `bo_evidence_queue`, `bo_disputes` (redéfinies en 0014) ; tables `transactions` (`settlement_mode`), `tranches`, `profiles` (rôle, nom : `proxy.ts`, `lib/staff.ts`), `app_config` (`require_staff_mfa`) ; stockage `dossiers` (`createSignedUrl(path, 60)`, `bo.ts` l.206).
- Temps réel (`src/hooks/useRealtime.ts`) : `transactions` (dossiers), `tranches` (preuves, litiges), `disputes` (litiges) ; jeton posé avant l’abonnement, relance toutes les 30 s.

### 6.3 Protection par rôle et second facteur

- `src/proxy.ts` (Next 16, ex-middleware) à chaque requête : `auth.getClaims()` (jamais `getSession` côté serveur), lecture de `profiles.platform_role`, `app_config.require_staff_mfa`, `mfa.getAuthenticatorAssuranceLevel()`, puis `decideAccess` (`src/lib/access.ts`).
- Règles : sans session → `/connexion?suite=…` ; rôle non VALIDATOR/ADMIN → `/acces-refuse` ; second facteur exigé si `require_staff_mfa = 'true'` **ou** si l’utilisateur a déjà un facteur (`nextAal === 'aal2'`) et que le jeton n’est pas `aal2` → `/connexion/second-facteur` ; `/litiges` réservé à ADMIN ; `safeNext` empêche la redirection ouverte.
- Seconde barrière serveur : `src/app/(bo)/layout.tsx` → `requireStaff()` (`src/lib/staff.ts`, `server-only`).
- Côté base : `0006_lot5.sql` l.20-24, `is_validator()` / `is_admin()` exigent aal2 si `require_staff_mfa = 'true'`. **Valeur par défaut `'false'`** (0006 l.20) : l’aal2 n’est donc imposé à tous qu’après réglage manuel (`docs/release-checklist.md` l.35-37, point 17).

### 6.4 En-têtes de sécurité

- `next.config.ts` : `poweredByHeader: false` ; `STATIC_SECURITY_HEADERS` (`src/lib/security.ts`) sur `/:path*` : `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` (caméra, micro, géolocalisation, paiement, USB interdits), `Cross-Origin-Opener-Policy: same-origin`, `Strict-Transport-Security` (2 ans, sous-domaines).
- `src/proxy.ts` : CSP à nonce par requête (`buildCsp`) : `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src` à nonce en production, `connect-src` limité au projet Supabase (https et wss), `frame-ancestors 'none'`, `object-src 'none'`, `upgrade-insecure-requests` en production ; `Cache-Control: private, no-store`.

### 6.5 Variables d’environnement lues (noms seulement)

| Nom | Lu dans | Dans `apps/web/.env.example` |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/env.ts` l.8, `src/lib/supabase/browser.ts` l.12 | oui |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/env.ts` l.9 (contrôlée par `assertPublicKey`), `src/lib/supabase/browser.ts` l.13 | oui |
| `NODE_ENV` | `src/proxy.ts` l.22 | sans objet |
| `E2E_PORT`, `E2E_CAPTURE`, `E2E_STAFF_PASSWORD` | `playwright.config.ts`, `e2e/zz-capture.spec.ts`, `e2e/env.ts` (lit aussi les `.env.local` sans les afficher) | non |

### 6.6 Tests

Playwright (`apps/web/e2e`) :
- `auth.spec.ts` : message identique que le compte existe ou non ; un utilisateur ordinaire n’accède à rien ; sans session, retour à la connexion, déconnexion ; session expirée ; second facteur exigé (`require_staff_mfa = true`), aucun accès sans aal2 par l’interface ni par l’API, inscription puis code TOTP.
- `dossiers.spec.ts` : validation simple (prise en charge, case obligatoire, approbation, alertes) ; approbation impossible sans la case, aussi par l’API (`AMOUNT_NOT_CHECKED`) ; double validation ; rejet avec motif ; doublon signalé sans blocage ; validateur partie au dossier en lecture seule (RG-03) ; consultation d’une pièce journalisée.
- `preuves.spec.ts` : preuve de jalon (aperçu journalisé, motif obligatoire, double validation, fonds libérés) ; rejet avec motif, fonds toujours bloqués.
- `litiges.spec.ts` : validateur sans accès aux litiges (interface et base) ; litige après paiement direct (issues valides, double confirmation, remboursement demandé, demande toujours payée, journal) ; litige CONDITIONAL en faveur du prestataire (fonds libérés) ; litige avant paiement (suspension, seule la clôture sans suite).
- `journal.spec.ts` : recherche au clavier, chaîne vérifiée, empreinte copiée ; export CSV (colonnes, empreintes, UTF-8 BOM, export journalisé) ; chaîne rompue (réponse simulée).
- `security.spec.ts` : en-têtes sur pages et fichiers statiques ; aucune violation de CSP ; pas d’affichage dans un cadre tiers.
- `keyboard.spec.ts` : navigation clavier complète.
- `zz-capture.spec.ts` : 4 captures (seulement avec `E2E_CAPTURE=1`).

Vitest (`apps/web/test`) : `access.test.ts` (7 cas d’accès, dont aal2 et redirection ouverte), `build-secrets.test.ts` (aucune clé `sb_secret_` ni JWT service_role dans `.next/static`), `csv-audit.test.ts`, `disputes.test.ts`, `format.test.ts`, `security.test.ts`, `tokens-i18n.test.ts` (charte, aucun style en ligne, aucun texte français en dur, un message par code d’erreur).

### 6.7 Anciens statuts côté web

Aucune file ni filtre ne repose sur un statut supprimé. `bo_evidence_queue` (0014) filtre `PAID` + `HELD` + `evidence_submitted_at` ; `bo_dossiers` filtre `PENDING_REVIEW`/`IN_REVIEW` (0014 l.1330) ; le web filtre `PENDING_REVIEW`/`IN_REVIEW` (`DossiersScreen.tsx`). Les anciens statuts (`EVIDENCE_SUBMITTED`, `PAID_LOCKED`, `TOKEN_ISSUED`, etc.) ne subsistent que comme libellés du journal d’audit antérieur (`fr.ts` l.122-146, 398-476 ; `audit.ts` l.46), ce qui est voulu (journal en ajout seul). `EVIDENCE_SUBMITTED` reste aussi un nom d’**événement** v2 (0014 l.589).

## 7. Risques et points d’attention

1. **Rôle déduit du profil global, pas de l’opération** : `personaForRole(primaryRole)` (`src/state/auth.ts` l.24-30) alimente `usePersona()`, utilisé pour décider des actions : `tx/[id].tsx` l.89 (`roles`), l.114 (`canPay`), l.133 ; `token/[trancheId].tsx` l.61 (QR réservé au persona PAYER) ; `scan.tsx` l.58 (`isProvider`) → `precheck` renvoie `PROVIDER_ONLY` si le persona n’est pas PROVIDER (`features/scan/reducer.ts` l.52). Un utilisateur dont le rôle principal est « demandeur » est traité en PAYER. Un utilisateur payeur dans une opération et prestataire dans une autre verra des actions inadaptées. Le serveur reste juge (RLS, fonctions), mais l’interface peut masquer une action légitime (scan d’un prestataire dont le rôle principal n’est pas PROVIDER).
2. **Paiement Supabase hors démonstration** : `SupabaseApi.payTranche` appelle `start_payment` puis, si la tentative est `INITIATED`/`PENDING`, `demo_settle_payment` à travers `unwrap` (`packages/api-client/src/supabase/api.ts` l.105-114) ; le commentaire l.100-103 indique `DEMO_DISABLED` hors `mock_mode`. Sur un serveur réel, l’écran de paiement afficherait donc une erreur alors que la tentative est créée. Pas de devis ni de détail des frais (`getQuote`/`acceptAndPay` non branchés sur Supabase côté écran).
3. **Image du QR par défaut côté client** : ligne `eqr_image_enabled` absente ou illisible ⇒ image affichée (`supabase/api.ts` l.354), contraire à 0015.
4. **Pas de garde de build pour `EXPO_PUBLIC_API`** (simulateur par défaut, `backend.ts` l.16) ; seule la liste de contrôle couvre ce cas.
5. **Second facteur du personnel non imposé par défaut** (`require_staff_mfa = 'false'`, 0006 l.20) : dépend d’un réglage manuel en production.
6. **Reçu** : titre à l’écran toujours « Tranche débloquée » même en règlement direct (`receipt/[trancheId].tsx` l.80).
7. **Déclaration de route orpheline** `t/[reference]` dans `_layout.tsx` (et commentaire trompeur « Lien profond : accessible sans session »).
8. **Requêtes N+1** : `useDisputeQuery` par tranche dans le détail (`tx/[id].tsx` l.90), signalé par le document d’adaptations (point 5).
9. **Écrans manquants** : enrôlement (X4), devis et frais (X5), acceptation de l’échéancier (`acceptPlan`), jeton de présentation (X3) : API côté serveur, aucune interface (prévu au lot Y).
10. **Documentation périmée** : `supabase/README.md` l.77 et l.93 ; libellé `TX_NOT_ACTIVE` (`packages/domain/src/errors.ts` l.26).

## 8. Tableau complet G3 (occurrences par fichier)

Colonnes : nombre total d’occurrences des 14 termes, détail par terme, appréciation (« Légitime » ou « RÉSIDUEL »).

| Fichier | Total | Détail | Appréciation |
|---|---:|---|---|
| `apps/mobile/src/app/(onboarding)/slides.tsx` | 1 | vertical:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/(tabs)/alerts.tsx` | 6 | vertical:6 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/(tabs)/home.tsx` | 7 | vertical:7 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/(tabs)/scan.tsx` | 1 | CONFIRMED:1 | Légitime : CONFIRMED = action locale du réducteur du scan |
| `apps/mobile/src/app/(tabs)/transactions.tsx` | 8 | vertical:8 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/dispute/[trancheId].tsx` | 3 | vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/dispute/view/[trancheId].tsx` | 3 | vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/need/details.tsx` | 5 | vertical:5 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/need/documents.tsx` | 9 | vertical:9 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/need/plan.tsx` | 1 | vertical:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/need/provider.tsx` | 10 | vertical:10 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/need/recap.tsx` | 9 | vertical:9 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/need/type.tsx` | 4 | vertical:4 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/pay/[trancheId].tsx` | 3 | vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/receipt/[trancheId].tsx` | 3 | vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/token/[trancheId].tsx` | 5 | vertical:5 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/app/tx/[id].tsx` | 5 | RELEASED:1, IN_REVIEW:1, vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/features/alerts/alerts.ts` | 3 | RELEASED:1, vertical:2 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/features/need/wizard.ts` | 4 | vertical:4 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/features/receipt/receipt.ts` | 1 | RELEASED:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/features/scan/reducer.ts` | 2 | CONFIRMED:2 | Légitime : CONFIRMED = action locale du réducteur du scan |
| `apps/mobile/src/i18n/index.ts` | 2 | IN_REVIEW:1, vertical:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/src/i18n/messages.ts` | 2 | vertical:2 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/mobile/test/scanReducer.test.ts` | 3 | CONFIRMED:3 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `apps/mobile/test/screens3b.test.ts` | 3 | RELEASED:1, vertical:2 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `apps/mobile/test/wizard.test.ts` | 8 | vertical:8 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `apps/web/e2e/dossiers.spec.ts` | 2 | IN_REVIEW:2 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/e2e/fixtures.ts` | 11 | vertical:11 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/e2e/litiges.spec.ts` | 1 | RELEASED:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/e2e/preuves.spec.ts` | 1 | RELEASED:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/e2e/zz-capture.spec.ts` | 1 | vertical:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/src/features/dossiers/DossiersScreen.tsx` | 15 | IN_REVIEW:6, vertical:9 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/src/i18n/fr.ts` | 31 | PAID_LOCKED:2, AWAITING_PAYMENT:2, CONFIRMED:2, RELEASED:4, EVIDENCE_SUBMITTED:3, DISPUTED:3, IN_REVIEW:2, VALIDATED:2, TOKEN_ISSUED:3, IN_PROGRESS:2, vertical:6 | Légitime : libellés « ancien statut » pour le journal d’audit antérieur (ajout seul) ; fundsState.RELEASED v2 |
| `apps/web/src/i18n/index.ts` | 1 | vertical:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/src/lib/audit.ts` | 3 | IN_REVIEW:2, TOKEN_ISSUED:1 | Légitime : lecture du journal antérieur (TOKEN_ISSUED) ; IN_REVIEW v2 |
| `apps/web/src/lib/bo.ts` | 15 | RELEASED:1, IN_REVIEW:2, vertical:12 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/src/lib/labels.ts` | 4 | vertical:4 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `apps/web/test/csv-audit.test.ts` | 12 | PAID_LOCKED:1, AWAITING_PAYMENT:1, RELEASED:1, EVIDENCE_SUBMITTED:1, IN_REVIEW:4, VALIDATED:2, TOKEN_ISSUED:2 | Légitime : bloc « journal antérieur au lot X v2 » |
| `apps/web/test/disputes.test.ts` | 1 | RELEASED:1 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/api-client/src/mockApi.ts` | 50 | CONFIRMED:1, RELEASED:9, IN_REVIEW:4, vertical:36 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/api-client/src/need.ts` | 11 | vertical:11 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/api-client/src/selectors.ts` | 1 | IN_REVIEW:1 | Légitime : IN_REVIEW statut v2 |
| `packages/api-client/src/supabase/api.ts` | 6 | vertical:6 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/api-client/src/supabase/convert.ts` | 11 | RELEASED:1, IN_REVIEW:1, vertical:9 | Légitime : IN_REVIEW = statut d’enrôlement ou de dossier v2 ; vertical = champ |
| `packages/api-client/src/supabase/database.types.ts` | 102 | PAID_LOCKED:4, AWAITING_PAYMENT:4, CONFIRMED:2, RELEASED:4, EVIDENCE_SUBMITTED:2, DISPUTED:4, IN_REVIEW:2, VALIDATED:2, TOKEN_ISSUED:2, IN_PROGRESS:2, IMMEDIATE:2, release_rules:5, vertical:67 | Légitime : fichier généré ; les valeurs d’enum ne peuvent pas être retirées (0013) |
| `packages/api-client/src/types.ts` | 5 | RELEASED:2, vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/api-client/test/contract/contract.ts` | 17 | IMMEDIATE:2, vertical:15 | Légitime : IMMEDIATE = option du banc de test (règlement du remboursement), sans rapport avec l’ancien mode ; vertical = champ |
| `packages/api-client/test/contract/mock.contract.test.ts` | 2 | IMMEDIATE:1, vertical:1 | Légitime : IMMEDIATE = option du banc de test (règlement du remboursement), sans rapport avec l’ancien mode ; vertical = champ |
| `packages/api-client/test/contract/supabase.contract.test.ts` | 1 | vertical:1 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/api-client/test/lot3b.test.ts` | 5 | RELEASED:3, vertical:2 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/api-client/test/mockApi.test.ts` | 3 | RELEASED:3 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/api-client/test/need.test.ts` | 10 | vertical:10 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/api-client/test/supabaseConvert.test.ts` | 13 | PAID_LOCKED:1, CONFIRMED:2, IN_PROGRESS:2, vertical:8 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/domain/src/conditionalRelease.ts` | 4 | PAID_LOCKED:1, CONFIRMED:1, RELEASED:1, EVIDENCE_SUBMITTED:1 | Légitime : commentaire « au lieu des anciens statuts » |
| `packages/domain/src/disputes.ts` | 1 | RELEASED:1 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/domain/src/documents.ts` | 3 | vertical:3 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/domain/src/enrolment.ts` | 1 | IN_REVIEW:1 | Légitime : IN_REVIEW = statut d’enrôlement ou de dossier v2 ; vertical = champ |
| `packages/domain/src/errors.ts` | 1 | IN_PROGRESS:1 | RÉSIDUEL (libellé) : `TX_NOT_ACTIVE` décrit « en cours (IN_PROGRESS) » au lieu de ACTIVE |
| `packages/domain/src/need.ts` | 8 | vertical:8 | Légitime : `vertical` = nom de champ/colonne conservé (0011) ; RELEASED = funds_state ; IN_REVIEW v2 |
| `packages/domain/src/operationMachine.ts` | 3 | IN_REVIEW:3 | Légitime : IN_REVIEW statut v2 |
| `packages/domain/src/paymentRequestMachine.ts` | 1 | CONFIRMED:1 | Légitime : CONFIRMED = tentative de paiement v2 ; RELEASED = funds_state |
| `packages/domain/src/payments.ts` | 21 | CONFIRMED:19, RELEASED:2 | Légitime : CONFIRMED = tentative de paiement v2 ; RELEASED = funds_state |
| `packages/domain/src/rules.ts` | 4 | release_rules:1, vertical:3 | Résidu mineur : commentaire « Miroir de la table SQL release_rules » (vue de compatibilité depuis 0011) ; `vertical` = nom de colonne conservé |
| `packages/domain/src/types.ts` | 6 | RELEASED:2, DISPUTED:1, IN_REVIEW:2, IMMEDIATE:1 | Légitime : commentaires de remplacement ; IN_REVIEW v2 ; FundsState RELEASED |
| `packages/domain/test/domain.test.ts` | 1 | vertical:1 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/domain/test/lotx_p2.test.ts` | 12 | CONFIRMED:6, RELEASED:1, IMMEDIATE:1, vertical:4 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/domain/test/lotx.test.ts` | 1 | vertical:1 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/domain/test/lotx2.test.ts` | 21 | PAID_LOCKED:2, AWAITING_PAYMENT:1, CONFIRMED:1, RELEASED:4, EVIDENCE_SUBMITTED:1, DISPUTED:4, IN_REVIEW:4, VALIDATED:1, TOKEN_ISSUED:1, IN_PROGRESS:2 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/domain/test/need.test.ts` | 8 | vertical:8 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `packages/domain/test/payments_v2.test.ts` | 5 | CONFIRMED:5 | Légitime : tests (refus d’anciens statuts, statuts v2, champ vertical) |
| `supabase/migrations/0001_base_v0_1.sql` | 34 | PAID_LOCKED:5, AWAITING_PAYMENT:6, RELEASED:3, DISPUTED:4, IN_REVIEW:5, VALIDATED:4, TOKEN_ISSUED:4, vertical:3 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0002_v0_2_enums.sql` | 5 | IN_PROGRESS:1, vertical:4 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0003_v0_2_tranches.sql` | 91 | PAID_LOCKED:15, AWAITING_PAYMENT:8, CONFIRMED:14, RELEASED:15, EVIDENCE_SUBMITTED:8, DISPUTED:4, IN_REVIEW:1, VALIDATED:1, TOKEN_ISSUED:1, IN_PROGRESS:9, release_rules:7, vertical:8 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0004_v0_3_fixes.sql` | 5 | PAID_LOCKED:1, CONFIRMED:1, EVIDENCE_SUBMITTED:1, DISPUTED:1, TOKEN_ISSUED:1 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0005_lot4.sql` | 92 | PAID_LOCKED:7, AWAITING_PAYMENT:4, CONFIRMED:6, RELEASED:11, EVIDENCE_SUBMITTED:4, DISPUTED:1, IN_REVIEW:6, VALIDATED:5, TOKEN_ISSUED:4, IN_PROGRESS:5, release_rules:5, vertical:34 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0006_lot5.sql` | 35 | AWAITING_PAYMENT:1, EVIDENCE_SUBMITTED:2, IN_REVIEW:8, VALIDATED:5, TOKEN_ISSUED:3, IN_PROGRESS:3, vertical:13 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0007_lotx_enums.sql` | 1 | IMMEDIATE:1 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0008_lotx.sql` | 78 | PAID_LOCKED:5, AWAITING_PAYMENT:15, CONFIRMED:5, RELEASED:14, EVIDENCE_SUBMITTED:1, VALIDATED:1, IN_PROGRESS:5, IMMEDIATE:5, can_initiate_requests:6, release_rules:3, vertical:18 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0009_lotx_x4.sql` | 5 | vertical:5 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0010_lotx_x5.sql` | 15 | PAID_LOCKED:2, AWAITING_PAYMENT:3, CONFIRMED:1, RELEASED:4, EVIDENCE_SUBMITTED:1, DISPUTED:1, IN_PROGRESS:2, IMMEDIATE:1 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0011_lotx_x6.sql` | 54 | DISPUTED:1, VALIDATED:4, TOKEN_ISSUED:1, IN_PROGRESS:1, can_initiate_requests:1, release_rules:13, vertical:33 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0012_lotx_x7.sql` | 1 | vertical:1 | Légitime : migration historique (avant v2), jamais réécrite |
| `supabase/migrations/0013_lotx2_enums.sql` | 11 | PAID_LOCKED:1, AWAITING_PAYMENT:1, CONFIRMED:1, RELEASED:1, EVIDENCE_SUBMITTED:1, DISPUTED:1, IN_REVIEW:1, VALIDATED:1, TOKEN_ISSUED:1, IN_PROGRESS:1, IMMEDIATE:1 | Légitime : ajout des valeurs d’enum v2 ; commentaire listant les anciennes valeurs |
| `supabase/migrations/0014_lotx2_core.sql` | 81 | PAID_LOCKED:4, AWAITING_PAYMENT:3, CONFIRMED:4, RELEASED:20, EVIDENCE_SUBMITTED:7, DISPUTED:5, IN_REVIEW:18, VALIDATED:1, TOKEN_ISSUED:1, IN_PROGRESS:1, IMMEDIATE:4, vertical:13 | Légitime : conversion ancien → v2 et contraintes de refus ; IN_REVIEW statut v2 ; RELEASED = funds_state ; vertical = colonne |
| `supabase/migrations/0017_lotx2_fixes.sql` | 4 | RELEASED:2, IN_REVIEW:2 | Légitime : IN_REVIEW statut v2, RELEASED = funds_state |
| `supabase/migrations/0019_lotx2_fixes3.sql` | 1 | RELEASED:1 | Légitime : IN_REVIEW statut v2, RELEASED = funds_state |
| `supabase/migrations/0020_lotx2_x4.sql` | 33 | CONFIRMED:2, IN_REVIEW:10, can_initiate_requests:5, release_rules:2, vertical:14 | Légitime : conversion et suppression de can_initiate_requests ; IN_REVIEW = statut de dossier d’enrôlement ; release_rules = vue lue par save_draft |
| `supabase/migrations/0021_lotx2_x5.sql` | 38 | CONFIRMED:35, RELEASED:3 | Légitime : CONFIRMED = statut v2 de tentative de paiement ; RELEASED = funds_state |
| `supabase/migrations/0022_lotx2_x6.sql` | 24 | release_rules:3, vertical:21 | Légitime : vertical = colonne (clé étrangère vers request_modules) ; release_rules = vue lue par save_draft |
| `supabase/migrations/0023_lotx2_fixes4.sql` | 2 | vertical:2 | Légitime : vertical = colonne (clé étrangère vers request_modules) ; release_rules = vue lue par save_draft |
| `supabase/README.md` | 6 | IN_REVIEW:1, VALIDATED:1, IN_PROGRESS:1, vertical:3 | RÉSIDUEL (doc) : l.77 « SUBMITTED → IN_REVIEW » (v2 : PENDING_REVIEW → IN_REVIEW), l.93 `IN_PROGRESS` / `VALIDATED` (statuts supprimés) |
| `supabase/rollbacks/0011_lotx_x6_down.sql` | 41 | can_initiate_requests:1, release_rules:7, vertical:33 | Légitime : retour arrière de 0011 |
| `supabase/seed-evidence.sql` | 8 | CONFIRMED:2, EVIDENCE_SUBMITTED:2, IN_REVIEW:2, vertical:2 | Légitime : EVIDENCE_SUBMITTED = événement de journal v2 ; IN_REVIEW v2 ; CONFIRMED tentative |
| `supabase/seed.sql` | 3 | vertical:3 | Légitime : colonne vertical |
| `supabase/tests/00_smoke_editor.sql` | 20 | RELEASED:2, IN_REVIEW:7, TOKEN_ISSUED:1, IN_PROGRESS:1, vertical:9 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/00_smoke.sql` | 20 | RELEASED:2, IN_REVIEW:7, TOKEN_ISSUED:1, IN_PROGRESS:1, vertical:9 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/01_lot4_editor.sql` | 32 | RELEASED:5, IN_REVIEW:3, VALIDATED:1, TOKEN_ISSUED:1, IN_PROGRESS:1, vertical:21 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/01_lot4.sql` | 32 | RELEASED:5, IN_REVIEW:3, VALIDATED:1, TOKEN_ISSUED:1, IN_PROGRESS:1, vertical:21 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/02_lot5_editor.sql` | 23 | RELEASED:2, EVIDENCE_SUBMITTED:1, IN_REVIEW:9, vertical:11 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/02_lot5.sql` | 23 | RELEASED:2, EVIDENCE_SUBMITTED:1, IN_REVIEW:9, vertical:11 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/03_lotx_editor.sql` | 20 | PAID_LOCKED:1, AWAITING_PAYMENT:1, CONFIRMED:1, RELEASED:1, IMMEDIATE:5, can_initiate_requests:1, release_rules:1, vertical:9 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/03_lotx.sql` | 20 | PAID_LOCKED:1, AWAITING_PAYMENT:1, CONFIRMED:1, RELEASED:1, IMMEDIATE:5, can_initiate_requests:1, release_rules:1, vertical:9 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/04_lotx_p2_editor.sql` | 30 | CONFIRMED:4, RELEASED:3, IN_REVIEW:1, IMMEDIATE:5, release_rules:4, vertical:13 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/04_lotx_p2.sql` | 30 | CONFIRMED:4, RELEASED:3, IN_REVIEW:1, IMMEDIATE:5, release_rules:4, vertical:13 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/05_lotx2_p1_editor.sql` | 5 | PAID_LOCKED:1, DISPUTED:2, IMMEDIATE:1, vertical:1 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/05_lotx2_p1.sql` | 5 | PAID_LOCKED:1, DISPUTED:2, IMMEDIATE:1, vertical:1 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/06_lotx2_p2_editor.sql` | 11 | CONFIRMED:3, can_initiate_requests:2, vertical:6 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
| `supabase/tests/06_lotx2_p2.sql` | 11 | CONFIRMED:3, can_initiate_requests:2, vertical:6 | Légitime : tests SQL (refus des anciens statuts/IMMEDIATE, absence de can_initiate_requests, IN_REVIEW v2, CONFIRMED tentative, RELEASED funds_state) |
