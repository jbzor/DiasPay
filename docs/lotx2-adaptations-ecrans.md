# Lot X version 2 : adaptations des écrans existants

Annexe de `docs/decisions.md` (X2-v2). Aucun écran nouveau : adaptations minimales des écrans existants au modèle cible (règlement direct par défaut, statuts v2, litige distinct). L’interface complète vient au lot Y.

## Application mobile


Adaptations minimales des écrans existants (aucun nouvel écran, aucune refonte ; l’interface complète arrive au lot Y). Aucun fichier de `packages/*`, des migrations, de `apps/web` ou de `docs` n’a été modifié. Rien n’a été commité.

### Écrans et fichiers

- `src/app/tx/[id].tsx` (détail d’une opération) :
  - Panneau de revue : bandeau « en cours d’examen » pour `PENDING_REVIEW` / `IN_REVIEW`, avec les boutons de démonstration du bureau, qui restent. Bandeau d’erreur pour `SUSPENDED` (litige ouvert avant paiement). Un rejet du bureau devient `CANCELLED` avec `rejectionReason` : le motif s’affiche avec la mention « dossier clos, non corrigible », sans bouton « Corriger » (`reopenForCorrection` n’existe plus).
  - « Abandonner » (`abandonRejected`, supprimée) devient « Annuler l’opération » (`cancelOperation`). Le bouton est proposé à l’initiateur seulement (`ownerId` = utilisateur connecté), pour une opération `ACTIVE` sans paiement en cours (`ACCEPTED`).
  - Tranches :
    - Texte d’état recalculé à partir des nouveaux statuts, de `fundsState`, `onHold`, `paidAt` et `refundedMinor` : prévue, à payer, paiement en cours, payée le…, remboursée en tout ou en partie. En `CONDITIONAL` seulement : en attente de confirmation (prestataire ou payeur), preuve en examen, déblocage automatique, débloquée, fonds rendus.
    - Couleur et coche de la pastille recalculées de la même façon.
  - Actions :
    - « Payer » : payeur, opération `ACTIVE`, demande `SUBMITTED` et non suspendue.
    - « Ouvrir un litige » : payeur ou prestataire, selon `canOpenDispute(status, rôles)` (avant ou après paiement), et s’il n’y a pas de litige déjà en cours.
    - « Afficher le QR », « Confirmer la prestation » (`confirmService`, nouvelle API) et « Débloquer » (`approveRelease`) : `CONDITIONAL` seulement, quand les fonds sont bloqués. En règlement direct, il n’y a donc ni « Débloquer », ni délai de contestation, ni confirmation, ni QR.
    - « Voir le litige » : un dossier de litige existe (lu par `getDispute`, puisque le litige n’est plus un statut).
    - « Voir le reçu » : selon `receiptAvailable`.
    - Les erreurs des actions s’affichent dans un toast.
- `src/app/(tabs)/home.tsx` : aucun changement de code (`nextPayment` et `lockedFunds` viennent des sélecteurs déjà adaptés). Seul le libellé `lockedFunds` change dans `messages.ts` : « Fonds bloqués (déblocage conditionnel) », parce que ce total ne compte plus que les fonds `CONDITIONAL` bloqués.
- `src/app/(tabs)/transactions.tsx` : l’ancien statut `EVIDENCE_SUBMITTED` est remplacé par une condition équivalente pour « Preuve à valider » : payée, fonds bloqués, règle `EVIDENCE_REVIEW`, preuve déposée, non confirmée. Les filtres viennent de `filterTransactions` (déjà adapté).
- `src/app/(tabs)/scan.tsx` : l’onglet reste. Un `WRONG_MODE` (règlement direct, ou autre règle de déblocage) affiche un message dédié (`scanWrongMode`) : il n’y a rien à confirmer par scan, le scan ne sert qu’au déblocage conditionnel.
- `src/features/scan/reducer.ts` : la vérification locale attend `PAID` au lieu de `PAID_LOCKED`. Le serveur répond `WRONG_MODE` en règlement direct et `NOT_PAID` si les fonds sont déjà traités.
- `src/app/token/[trancheId].tsx` :
  - Nouvel état `direct` : une opération en règlement direct affiche clairement que le QR n’est pas utilisé (`tokenDirectMode`), sans appeler `getToken`, qui renverrait `NO_TOKEN`.
  - En `CONDITIONAL`, le QR n’est affiché qu’au payeur, pour une demande `PAID` aux fonds `HELD` et non encore confirmée. Cela remplace `PAID_LOCKED`.
- `src/app/pay/[trancheId].tsx` : la note de verrouillage des fonds (`lockedNote`) ne s’affiche qu’en `CONDITIONAL`. En règlement direct, une note `directNote` dit que le paiement va au prestataire sans blocage.
- `src/app/dispute/[trancheId].tsx` (ouverture d’un litige) :
  - Le bandeau dépend du moment. Avant paiement : la tranche est suspendue (`disputeBanner`). Après paiement : le paiement reste exécuté, et un remboursement éventuel sera lié au paiement d’origine (`disputePaidNote`).
  - La ligne « Contestation possible jusqu’au » n’apparaît qu’en `CONDITIONAL`.
- `src/app/dispute/view/[trancheId].tsx` (suivi d’un litige) :
  - Résolu seulement au statut `RESOLVED` ; `OPEN`, `AWAITING_RESPONSE` et `IN_MEDIATION` comptent comme en cours.
  - Le libellé et le montant dépendent de l’issue : remboursé (`REFUND_FULL`, `REFUND_PARTIAL` avec `refundAmountMinor`, `FUNDS_RETURNED`), remis au prestataire (`FUNDS_RELEASED`), ou sans suite (`NO_ACTION`, sans montant).
  - Le bandeau « tranche suspendue » ne s’affiche que pour un litige ouvert avant paiement ; sinon, « le paiement reste exécuté ».
  - « Voir le reçu » dépend du paiement (`receiptAvailable`), plus du litige.
  - Boutons de démonstration, seulement là où le serveur les accepte :
    - « remettre » → `FUNDS_RELEASED` : fonds bloqués seulement.
    - « rembourser » → `FUNDS_RETURNED` si les fonds sont bloqués, `REFUND_FULL` si le paiement direct est exécuté et pas encore entièrement remboursé.
    - « classer sans suite » → `NO_ACTION` : toujours. Ce bouton est nouveau : c’est la seule issue valide avant paiement, et sans lui une opération suspendue ne pouvait pas reprendre en démonstration.
- `src/features/dispute/state.ts` :
  - `isResolved` vaut `status === 'RESOLVED'`.
  - `disputeStatus` dépend de l’issue (nouvelle clé `disputeResolvedNoAction`).
  - `canViewReceipt` est supprimé : le reçu ne dépend plus du litige.
  - Nouvelles fonctions pures : `resolutionAmount`, `demoOutcomes`, `suspendsTranche`.
- `src/app/receipt/[trancheId].tsx` : le titre est « Tranche payée » en règlement direct, où le reçu existe dès `PAID`, et « Tranche débloquée » en `CONDITIONAL`.
- `src/features/receipt/receipt.ts` :
  - Nouvelle fonction `receiptAvailable(tx, tr)`, miroir de `getReceipt` : `PAID` ou `REFUNDED`, et règlement direct ou fonds `RELEASED`.
  - La ligne Référence affiche « — » quand elle est vide (règlement direct : aucun jeton, donc aucune référence).
- `src/app/(tabs)/alerts.tsx` : le type du formateur d’issue accepte aussi `NO_ACTION`.
- `src/features/alerts/alerts.ts` :
  - Nouveaux événements `REQUEST_PAID` et `PLAN_ACCEPTED`. `ALERT_TYPES` est vérifié contre l’union `NotificationEvent` (`satisfies`).
  - Nouveau type `DisputeResolvedOutcome` et liste `ALERT_OUTCOMES` (`RELEASED`, `REFUNDED`, `NO_ACTION`).
- `src/app/need/recap.tsx` :
  - Règle de déblocage : un module en règlement direct affiche « Paiement direct : débloqué dès le paiement », sans délai de contestation.
  - La note « le bureau de contrôle examine votre dossier » n’apparaît que si le module a une revue (`platformReview` ≠ `NEVER`).
- `src/app/need-done/[txId].tsx` : sans revue, le dossier est `ACTIVE` dès l’envoi. Le texte devient alors `submittedActiveText`, et le retour à la liste se fait sur le filtre « En cours » au lieu de « À valider ». Le minuteur lit le statut le plus récent.
- `src/i18n/index.ts` : `txStatusKey` et `trancheStatusKey` couvrent exactement les nouveaux statuts (vérifiés par `satisfies Record<…, Key>`). Pour les demandes :
  - `DRAFT` → « Prévue » et `SUBMITTED` → « À payer » (clés existantes).
  - `ACCEPTED` → « Paiement en cours » et `REFUNDED` → « Remboursée » (clés nouvelles).
- `src/ui/index.tsx` : couleurs de `txStatusKind` pour les statuts d’opération :
  - `ACTIVE` : en cours.
  - `SUSPENDED` : erreur.
  - `DRAFT`, `CLOSED`, `CANCELLED` : neutre.
  - `PENDING_REVIEW`, `IN_REVIEW` : en attente.
- `src/i18n/messages.ts` (français et anglais, apostrophes typographiques) :
  - Clés ajoutées :
    - Statuts : `txPendingReview`, `txSuspended`, `trAccepted`, `trRefunded`.
    - Textes d’état des tranches : `paidOn`, `paymentPending`, `awaitingPayerConfirm`, `fundsReturned`, `refundedFull`, `refundedPartial`.
    - Notes et bandeaux : `directNote`, `txSuspendedBanner`, `rejectedFinal`, `tokenDirectMode`, `scanWrongMode`, `disputePaidNote`, `submittedActiveText`, `tranchePaid`.
    - Annulation : `cancelOperation`, `cancelOperationConfirm`.
    - Litige : `disputeResolvedNoAction`, `simNoAction`, `outcome_NO_ACTION`.
    - Alertes : `alert_REQUEST_PAID_title` / `_body`, `alert_PLAN_ACCEPTED_title` / `_body`.
    - Erreurs : `err_REQUEST_ON_HOLD`, `err_DISPUTE_OPEN`, `err_ALREADY_CONFIRMED`, `err_NOT_CONFIRMED`, `err_NOT_CONFIGURED`.
  - Clés modifiées :
    - `txCancelled` : « Abandonné » devient « Annulée » (couvre aussi le rejet du bureau).
    - `err_WRONG_MODE`, `err_NO_TOKEN`, `err_NOT_RELEASED` et `err_DISPUTE_NOT_ALLOWED` : mentionnent le règlement direct, le paiement, ou un litige déjà en cours.
    - `alert_DISPUTE_OPENED_body` : neutre, car un litige après paiement ne suspend rien.
    - `lockedFunds` : voir l’accueil.
  - Clés supprimées, devenues inutilisées :
    - Anciens statuts d’opération : `txRejected`, `txDisputed`, `txValidated`, `txToken`, `txSubmitted`.
    - Anciens statuts de tranche : `trEvidence`, `trConfirmed`, `trReleased`, `trDisputed`.
    - Correction et abandon : `correct`, `abandon`, `abandonTitle`, `abandonConfirm`.

Écrans vérifiés et non modifiés :
- `src/app/(tabs)/profile.tsx` : seulement la réinitialisation de la démonstration.
- `src/app/tranche/[trancheId].tsx`, le lien interne : il redirige vers le détail.
- `src/app/need/*` (hors récapitulatif), la connexion et l’accueil de présentation.
- `src/app/_layout.tsx` : `runTimers` du simulateur, inchangé.

Les brouillons de correction déjà enregistrés (`correctionOf`) restent affichés comme avant dans la liste. On ne peut plus en créer.

### Tests

- `test/scanReducer.test.ts` (modifié par le coordinateur) : `PAID` remplace `PAID_LOCKED` ; `NOT_PAID` est vérifié sur `SUBMITTED` et `REFUNDED`.
- `test/lot3b.test.ts` (modifié par le coordinateur) : filtres sur les nouveaux statuts. `SUSPENDED` compte comme « En cours » ; `PENDING_REVIEW` comme « À valider ».
- `test/trustlink.test.ts` (modifié par le coordinateur) : écran du QR. Le QR n’existe qu’en `CONDITIONAL`, pour une demande `PAID` aux fonds `HELD`.
- `test/screens3b.test.ts` :
  - Partie litige (modifiée par le coordinateur) : `resolutionAmount`, `demoOutcomes`, `suspendsTranche`, issues `REFUND_PARTIAL`, `FUNDS_RELEASED`, `NO_ACTION`, et `IN_MEDIATION` non résolu.
  - Parité des libellés d’alerte (renforcée par moi) : elle couvre maintenant tous les `ALERT_OUTCOMES`, dont `outcome_NO_ACTION`, et les nouveaux `ALERT_TYPES` (`REQUEST_PAID`, `PLAN_ACCEPTED`).

### Points de l’API à signaler (non corrigés, `packages/*` interdit)

1. Le simulateur ne fait pas comme le serveur pour une référence en règlement direct. `byReference` ignore le règlement direct : `resolveReference` répond donc `UNKNOWN_REFERENCE`, et pas `WRONG_MODE`.
2. `ReferenceInfo` ne porte ni `settlementMode` ni `fundsState`. Le scan ne peut donc pas reconnaître le règlement direct avant d’appeler le serveur.
3. `resolveDisputeDecision` accepte `REFUND_FULL` sur des fonds `HELD`, mais ne change pas `fundsState`. Les fonds restent alors bloqués après le remboursement. La démonstration utilise `FUNDS_RETURNED` dans ce cas.
4. `cancelOperation` (simulateur) avec une demande `ACCEPTED` : la transition est acceptée, mais l’opération reste `ACTIVE`, car `closeIfDone` ne clôt pas. L’interface masque le bouton dans ce cas.
5. Une demande ne dit pas qu’elle a un litige après paiement : aucun champ, parce que `onHold` ne concerne que l’avant-paiement. Le détail appelle donc `getDispute` pour chaque tranche éligible (N requêtes sur Supabase). Un champ sur `PaymentRequest`, par exemple `disputeStatus`, éviterait ces requêtes.
6. L’alerte `DISPUTE_RESOLVED.outcome` reste grossière : `REFUND_PARTIAL` et `FUNDS_RETURNED` y deviennent tous deux `REFUNDED`.
7. `openDispute` (simulateur) déduit le rôle du profil de démonstration (`persona`), pas de `rolesFor(tx)`.

### Vérifications

Depuis `apps/mobile` :
- `npx tsc --noEmit -p tsconfig.json` : aucune erreur.
- `npx vitest run` : 11 fichiers, 117 tests, tous réussis.
- `npx expo export --platform web` : réussi, vers `/private/tmp/claude-501/-Users-macbook-Projets-react-native--diaspay/5242446b-954c-4d25-b6ab-24167811b2f8/scratchpad/web-export-mobile`.

## Bureau de contrôle (web)


Adaptations minimales, aucun nouvel écran. Rien n’est commité. packages/*, migrations, apps/mobile et docs ne sont pas modifiés.

### Code de l’application

- `src/lib/bo.ts` : `DisputeRow.status` passe au type `DisputeStatus` (OPEN, AWAITING_RESPONSE, IN_MEDIATION, RESOLVED). Ajout des colonnes de `bo_disputes` (0014) : outcome, beforePayment, onHold, settlementMode, fundsState, refundedMinor. Pourquoi : les anciens statuts RELEASED_TO_PROVIDER et REFUNDED_TO_PAYER n’existent plus, et l’écran a besoin de ces colonnes pour ne proposer que les issues valides.
- `src/lib/bo.ts` : `resolveDispute(dispute, outcome, note, amountMinor?)` appelle `resolve_dispute` avec `p_amount_minor` (seulement pour REFUND_PARTIAL) et ne relit plus le statut de la tranche. Pourquoi : la nouvelle signature de la fonction SQL, et une demande payée garde son statut (K7).
- `src/lib/bo.ts` : `decideEvidence` renvoie `funds_state` au lieu de `status`. Pourquoi : `decide_tranche` laisse la demande en PAID. Une approbation partielle laisse les fonds en HELD, une approbation complète les passe en RELEASED.
- `src/lib/bo.ts` : `dossierDetail` lit aussi `transactions.settlement_mode` (nouveau champ `settlementMode`). Les commentaires ont été mis à jour (PENDING_REVIEW, 0014). Pourquoi : la règle de déblocage ne s’applique qu’en CONDITIONAL.
- `src/lib/disputes.ts` (nouveau) : `isOpenDispute` (tout statut sauf RESOLVED), `availableOutcomes(row)` et `disputeInputError` (note de 3 caractères minimum ; montant partiel positif et au plus égal au restant). `availableOutcomes` reprend les refus de `_resolve_dispute_v2` : avant paiement, NO_ACTION seulement ; après paiement, REFUND_FULL et REFUND_PARTIAL s’il reste un montant à rembourser ; FUNDS_RELEASED et FUNDS_RETURNED seulement en CONDITIONAL avec des fonds HELD. Pourquoi : `disputeDecisionError` et `DisputeOutcomeCode` de @diaspay/domain (review.ts) n’acceptent encore que les anciennes issues, et le paquet n’est pas modifiable ici.
- `src/features/litiges/LitigesScreen.tsx` : le filtre « Ouverts » et le compteur couvrent OPEN, AWAITING_RESPONSE et IN_MEDIATION. Les boutons sont générés à partir de `availableOutcomes(row)`. Un champ « Montant du remboursement partiel » est lu avec `parseAmountInput` dans la devise du dossier. Un avertissement s’affiche pour une demande suspendue (litige ouvert avant paiement). La ligne « Déjà remboursé » apparaît si le montant est supérieur à 0. Une fois le litige résolu, le statut affiché est l’issue. La double confirmation (case puis mot à saisir) est conservée pour chaque issue. Une erreur INVALID_OUTCOME recharge la liste. Pourquoi : nouvelles issues et nouveaux statuts.
- `src/features/dossiers/DossiersScreen.tsx` : SUBMITTED est remplacé par PENDING_REVIEW pour la prise en charge à l’ouverture, le filtre de statut, la lecture seule et la prise en charge avant la décision. La règle de déblocage ne s’affiche qu’en CONDITIONAL ; en DIRECT, un texte « Règlement direct » la remplace. Pourquoi : la file ne reçoit plus que PENDING_REVIEW et IN_REVIEW (`claim_dossier` fait PENDING_REVIEW → IN_REVIEW, `decide_tx` approuve vers ACTIVE et rejette vers CANCELLED). Le résultat IN_REVIEW signale toujours une approbation partielle.
- `src/features/preuves/PreuvesScreen.tsx` : le message d’approbation partielle repose sur `funds === 'HELD'` (avant : `status === 'EVIDENCE_SUBMITTED'`). Le commentaire est mis à jour. Pourquoi : `bo_evidence_queue` contient les demandes CONDITIONAL PAID avec fonds HELD et preuve déposée ; le statut ne change plus.
- `src/lib/audit.ts` : nouveau libellé « Dossier rejeté (opération annulée) » pour IN_REVIEW ou PENDING_REVIEW → CANCELLED (le rejet par `decide_tx` est un STATUS_CHANGE). Le libellé d’un événement générique peut aussi venir de `payload.funds_to`. Pourquoi : un rejet se lit désormais comme une annulation, et les fonds ont leur propre état.
- `src/i18n/fr.ts`, statuts : libellés `txStatus.*` pour DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED et CANCELLED. Libellés `trStatus.*` pour DRAFT, SUBMITTED, ACCEPTED, PAID et REFUNDED. Nouveaux libellés `fundsState.*` et `settlement.DIRECT`. Les anciens statuts restent, marqués « ancien statut », parce que le journal d’audit (ajout seul) contient encore des lignes de l’ancien parcours.
- `src/i18n/fr.ts`, événements : `event.STATUS_CHANGE.*` pour PENDING_REVIEW, ACTIVE, CANCELLED (et `.review`), SUSPENDED et CLOSED. Libellés `event.*` pour AUTO_ACTIVATED, REQUEST_SUBMITTED, REQUEST_ACCEPTED, REQUEST_PAID, REQUEST_REFUNDED, REQUEST_CANCELLED, REQUEST_EXPIRED, PAYMENT_RETRY_ALLOWED, FUNDS_RELEASED, FUNDS_RETURNED, SERVICE_CONFIRMED, OPERATION_SUSPENDED, OPERATION_RESUMED, PLAN_ACCEPTED, DISPUTE_RESPONSE_REQUESTED, DISPUTE_MESSAGE, PRESENTATION_TOKEN_ISSUED, PRESENTATION_TOKEN_REVOKED, PRESENTATION_CLAIMED et TX_CANCELLED (EVIDENCE_SUBMITTED existait déjà). `event.trancheTo.*` couvre DRAFT, SUBMITTED, ACCEPTED, PAID et REFUNDED, et `event.fundsTo.*` couvre HELD, RELEASED et RETURNED. TX_CLOSED devient « Opération close ». Pourquoi : écran Journal.
- `src/i18n/fr.ts`, litiges : `litiges.status.*` couvre les 4 statuts. Nouvelles clés par issue : `litiges.outcome.*`, `litiges.result.*`, `litiges.confirmTitle.*`, `litiges.confirm.*` (avec `NO_ACTION.onHold`), `litiges.confirmWord.*` et `litiges.done.*`. Nouvelles clés `litiges.onHold`, `litiges.refunded` et `litiges.partial*`. Les clés RELEASE_TO_PROVIDER et REFUND_PAYER sont supprimées. Les textes des preuves parlent maintenant de fonds libérés.
- `src/i18n/fr.ts`, erreurs : messages en français pour REQUEST_ON_HOLD, DISPUTE_OPEN, ALREADY_CONFIRMED, NOT_CONFIRMED et NOT_CONFIGURED. Pourquoi : `frErrors` est un `Record<ErrorCode>`, et sans eux tsc échouait.

### Tests unitaires (vitest)

- `test/csv-audit.test.ts` : la ligne de base passe à DRAFT → PENDING_REVIEW. Ajout de cas pour le nouveau parcours (prise en charge, validation vers ACTIVE, rejet vers CANCELLED, annulation, AUTO_ACTIVATED, suspension, REQUEST_SUBMITTED, REQUEST_PAID, FUNDS_RELEASED, tranche_to et funds_to génériques). Les anciens cas restent dans un bloc « journal antérieur ». Ajout d’une vérification qu’il existe un libellé pour chaque statut, chaque `trancheTo` et chaque nouvel événement. Aucune assertion n’a été affaiblie.
- `test/disputes.test.ts` (nouveau) : couvre le filtre « ouvert », les issues selon le moment (avant paiement, DIRECT payé, déjà remboursé, CONDITIONAL HELD ou RELEASED), les erreurs de saisie et la présence des libellés pour chaque statut et chaque issue.

### Tests de bout en bout (Playwright) et données de développement

- `e2e/fixtures.ts` : nouveaux `setModule` et `restoreModules`. Le compte administrateur modifie `request_modules` (platform_review, settlement_mode) grâce à la politique `request_modules_admin_write`, et `cleanup()` rétablit les valeurs d’origine (vérifié : tous les modules sont revenus à NEVER, EDUCATION, HEALTH et RENT en DIRECT). `submittedDossier` passe le module en ALWAYS et vérifie PENDING_REVIEW. Le nouveau `activeDossier({ conditional? })` passe le module en NEVER et en DIRECT ou CONDITIONAL, et vérifie ACTIVE. `openedDispute` part d’une opération active sans revue, paie la demande (sauf `beforePayment`) et accepte `conditional`. Pourquoi : platform_review vaut NEVER partout par défaut, donc sans ce réglage la file reste vide.
- `e2e/dossiers.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/zz-capture.spec.ts` : aucun changement. Ils utilisent `submittedDossier`, qui envoie désormais en PENDING_REVIEW.
- `e2e/journal.spec.ts` : les assertions « Jeton émis / Toutes / Tranche activée » de l’ancien parcours sont remplacées par « Dossier validé (opération active) » (validateur), « Demande de paiement envoyée au payeur » (Système, Tranche 1) et « Demande payée ». Pourquoi : il n’y a plus de jeton en règlement DIRECT.
- `e2e/litiges.spec.ts` : premier cas, litige après paiement DIRECT. On vérifie le statut « En médiation », la présence des seules issues valides, le montant partiel obligatoire, puis REFUND_FULL : la demande reste PAID, `refunds` contient une ligne PENDING de 300 000, le journal a outcome REFUND_FULL et l’alerte REFUNDED est envoyée. Deuxième cas, CONDITIONAL : FUNDS_RELEASED donne PAID avec funds_state RELEASED et une chaîne intacte. Nouveau troisième cas, litige avant paiement : l’opération est SUSPENDED et seule la clôture sans suite est proposée ; elle remet l’opération en ACTIVE et la demande en SUBMITTED sans suspension.
- `e2e/preuves.spec.ts` : après approbation, on attend PAID et funds_state RELEASED, plus l’événement FUNDS_RELEASED. Après rejet, on attend PAID, HELD, `evidence_submitted_at` vide, et la ligne quitte la file.
- `supabase/seed-evidence.sql` (script de développement, garde mock_mode conservée) : le script est réécrit pour le modèle cible. L’opération LAND est en CONDITIONAL, la règle EVIDENCE_REVIEW, et les statuts passent PENDING_REVIEW → IN_REVIEW → deux validations → ACTIVE par `_set_tx_status`. La première demande est envoyée par `_submit_request`, puis une tentative SUCCEEDED est créée, avec payments, un journal financier PAYMENT et PAYMENT_SUCCEEDED, et la demande passe en ACCEPTED puis PAID avec des fonds HELD. Enfin `evidence_submitted_at` est renseigné et l’événement EVIDENCE_SUBMITTED est écrit. Le script vérifie qu’il produit bien l’état attendu par `bo_evidence_queue`. Pourquoi : l’ancien script utilisait VALIDATED, `_simulate_token_issue`, PAID_LOCKED et EVIDENCE_SUBMITTED.

### Vérifications

- `npx tsc -p tsconfig.json --noEmit` : OK (e2e inclus).
- `npx vitest run` : 7 fichiers, 49 tests, tous réussis.
- `npx next build` : OK.
- `npx playwright test` contre le projet de développement : 25 réussis, 4 ignorés (captures, seulement avec E2E_CAPTURE=1), 0 échec. Une exécution à blanc de `seed-evidence.sql` terminée par un rollback a aussi réussi.

### Points ouverts

- @diaspay/domain (`review.ts`) : `DisputeOutcomeCode` et `disputeDecisionError` en sont encore aux anciennes issues. Le web ne les utilise plus ; il faudra les aligner dans le paquet.
- Si une exécution e2e est interrompue avant `cleanup()`, les réglages des modules ne sont pas rétablis. Il faut alors les remettre à la main (platform_review NEVER ; EDUCATION, HEALTH et RENT en DIRECT).
- Les captures (`zz-capture.spec.ts`) n’ont pas été exécutées.

## Passe 2 (X4 à X6) : adaptations minimales

Aucun écran nouveau. L’enrôlement (X4), le devis et le détail des frais (X5) n’ont pas d’interface avant le lot Y.

### Application mobile

- `src/app/need/details.tsx` (étape « détails » de l’assistant) : le champ du bénéficiaire suit `beneficiaryMode` du module (X6, K13). NAME : « Bénéficiaire » (nom), comme avant ; REFERENCE_ONLY (santé) : « Référence du patient » (majuscules, 16 caractères au plus) et une aide « un code ou des initiales, jamais le nom » ; NONE : aucun champ.
- `src/app/need/recap.tsx` : la ligne « Bénéficiaire » devient « Référence du patient » pour la santé, et disparaît pour un module sans bénéficiaire.
- `src/app/tx/[id].tsx` (détail) et `src/app/pay/[trancheId].tsx` (paiement) : la référence du patient remplace le nom quand le dossier en a une ; aucune ligne si ni nom ni référence.
- `src/app/(tabs)/scan.tsx` : la ligne « Bénéficiaire » n’apparaît que si un nom existe (santé : aucun nom).
- `src/state/api.ts` : dans le simulateur, le compte de démonstration est enrôlé N2 (X4), pour que l’assistant reste utilisable dans tous les rôles. Sur Supabase, le niveau vient du serveur ; un compte N0 qui initie une demande reçoit le message `err_ENROLMENT_REQUIRED`.
- `src/i18n/messages.ts` (français et anglais, apostrophes typographiques) :
  - X4 : `err_ENROLMENT_REQUIRED` (remplace `err_INITIATION_NOT_ALLOWED`), `err_PROFILE_PROTECTED`, `err_ENROLMENT_PENDING`, `err_ALREADY_ENROLLED`, `err_SELF_REVIEW`, `err_CASE_CLOSED`, `err_NOT_CLAIMED`, `err_ALREADY_CLAIMED`, `err_KYC_PENDING`, `err_AUDIT_IMMUTABLE`, `err_LIMITS_NOT_CONFIGURED`, `err_LIMIT_EXCEEDED`.
  - X5 : `err_QUOTE_UNAVAILABLE`, `err_QUOTE_INVALID`, `err_QUOTE_USED`, `err_QUOTE_EXPIRED`, `err_QUOTE_FROZEN`, `err_REFUND_NOT_PENDING`.
  - X6 : `err_BENEFICIARY_NAME_NOT_ALLOWED`, `err_BENEFICIARY_REFERENCE_INVALID`, `err_BENEFICIARY_REFERENCE_REQUIRED`, `err_DOCUMENT_KIND_NOT_ALLOWED`, les messages d’étape `need_BENEFICIARY_NAME_NOT_ALLOWED`, `need_BENEFICIARY_REFERENCE_INVALID`, `need_BENEFICIARY_REFERENCE_REQUIRED`, et les libellés `beneficiaryReference`, `beneficiaryReferenceHint`.
- Écran de paiement : inchangé. `payTranche` demande un devis dans la devise de la demande, puis accepte et paie (X5) ; le détail des frais sera affiché au lot Y.
- Tests : `test/wizard.test.ts` (santé : référence du patient, devis seul).

### Bureau de contrôle (web)

- `src/i18n/fr.ts` : mêmes codes d’erreur que ci-dessus, en français (`frErrors` est un `Record<ErrorCode>`).
- Aucun autre changement de code. Les écrans d’enrôlement et de médiation sont prévus au lot Y.
- Tests de bout en bout : `e2e/fixtures.ts` (dossier santé : référence et devis seul), `e2e/litiges.spec.ts` (remboursement REQUESTED).
