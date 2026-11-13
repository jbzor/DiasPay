# Décisions du projet DiasPayQR

Choix délégués par le client au prestataire. Chaque décision reste révisable par le client.

---

## D1 — Téléphone du payeur

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** : validé par le client. Le champ « Téléphone du payeur » reste à l’étape 2 (Détails) de la création d’un besoin quand le créateur est demandeur. Le payeur sera invité à financer le besoin.
- **Mise en œuvre** : `packages/domain/src/need.ts` (code `PAYER_PHONE_REQUIRED`), `apps/mobile/src/app/need/details.tsx`.

## D2 — Pièces requises de la vague 1

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** : les valeurs proposées au lot 3 sont confirmées.

| Verticale | Pièces |
|---|---|
| Santé | Devis ou facture proforma (obligatoire) ; pièce d’identité du bénéficiaire (obligatoire) ; certificat médical (facultatif) |
| Scolarité | Attestation d’inscription (obligatoire) ; échéancier de l’école (facultatif) |
| Loyer | Bail (obligatoire) ; dernière quittance (facultatif) |

- **Fichiers** : jusqu’à 3 fichiers par type de pièce (une pièce d’identité se photographie recto et verso), 10 Mo chacun, JPEG, PNG ou PDF. Une pièce est « fournie » dès qu’un fichier est envoyé. Le validateur juge de la suffisance ; l’application ne le fait pas.
- **Hors décision** : Agro, Immobilier et Terrain restent « À CONFIRMER » (vague 2).
- **Mise en œuvre** : `packages/domain/src/documents.ts` (`REQUIRED_DOCUMENTS`, `MAX_FILES_PER_KIND`, erreur `TOO_MANY_FILES`).

## D3 — Textes d’aide du plan de paiement (étape 4)

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** : les textes rédigés au lot 3 sont remplacés par ceux-ci, et aucune autre formulation n’est conservée.

| Clé | Français | Anglais |
|---|---|---|
| `plan.help.single` | Un seul paiement du montant total. | One single payment of the full amount. |
| `plan.help.partial` | Divisez le paiement en plusieurs parts, par exemple un acompte puis le solde. Chaque part est payée, confirmée et débloquée séparément. | Split the payment into several parts, for example a deposit then the balance. Each part is paid, confirmed and released separately. |
| `plan.help.installments` | Répartissez le paiement sur plusieurs dates que vous choisissez. Chaque tranche est payée, confirmée et débloquée séparément. | Spread the payment over several dates you choose. Each installment is paid, confirmed and released separately. |
| `plan.help.recurring` | Un paiement identique à intervalle régulier, par exemple chaque mois pour un loyer. | An identical payment at regular intervals, for example monthly for rent. |
| `plan.sum.ok` | Somme des tranches : {sum} / {total} | Sum of installments: {sum} / {total} |
| `plan.sum.under` | Il reste {gap} à répartir. | {gap} left to allocate. |
| `plan.sum.over` | Dépassement de {gap}. | Over by {gap}. |
| `plan.note` | Chaque tranche est payée, confirmée puis débloquée séparément. | Each installment is paid, confirmed, then released separately. |

- **Mise en œuvre** : `apps/mobile/src/i18n/messages.ts` (les clés pointées sont écrites `plan_help_single`, etc., les dictionnaires n’utilisant que des identifiants simples).

## D4 — Politique d’abandon d’un dossier

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** :
  - Brouillon jamais soumis : supprimé définitivement, avec ses pièces (il n’a jamais été audité).
  - Dossier rejeté : le créateur peut le **corriger** (retour en brouillon) ou l’**abandonner** : il passe à `CANCELLED`, sa trace et son journal sont conservés. Il apparaît sous « Clôturées » avec le libellé « Abandonné ».
  - Dossier soumis ou en validation : ni supprimable ni annulable dans la vague 1.
  - Aucun dossier ayant une ligne d’audit n’est jamais effacé.
- **Mise en œuvre** : statut `CANCELLED` et transition `REJECTED → CANCELLED` (payeur, demandeur) dans `packages/domain/src/txMachine.ts` ; `abandonRejected` et `deleteDraft` dans `packages/api-client/src/mockApi.ts`.

## D5 — Verrouillage après trois codes SMS erronés

- **Date** : 11 novembre 2026
- **Statut** : décidé par le chef de projet, révisable
- **Constat** : le cahier (US-01) demande de bloquer un numéro 15 minutes après trois codes erronés. Supabase Auth ne le fait pas : il limite le débit des demandes et des vérifications (`rate_limit_otp`, `rate_limit_verify`, par heure et par adresse IP) et répond `otp_expired` (« Token has expired or is invalid ») aussi bien pour un code erroné que pour un code expiré, sans compter les essais.
- **Décision** : pour le pilote, on s’appuie sur la limite de débit de Supabase, sans fonction serveur supplémentaire. Correspondance dans `packages/api-client/src/supabase/errors.ts` (`toAuthError`) :
  - `otp_expired` avant l’expiration locale du code (300 s après la demande) → `OTP_WRONG`, après → `OTP_EXPIRED` ;
  - `over_sms_send_rate_limit` → `OTP_RESEND_TOO_SOON` ;
  - `over_request_rate_limit` ou HTTP 429 → `OTP_LOCKED`, sans heure de déblocage (Supabase ne la donne pas).
- **Conséquences** : l’écran n’affiche plus « Il vous reste N essai(s) » ni l’heure de déblocage en mode Supabase (messages `otpWrongNoCount` et `otpLockedLater`). Le simulateur garde le comportement du cahier (3 essais, 15 minutes).
- **Pour revenir au cahier** : une fonction serveur (Edge Function) qui compte les échecs par numéro avant d’appeler la vérification, ou un fournisseur SMS qui verrouille lui-même. À décider avant la mise en production.

## D6 — Contrôles automatiques du bureau de contrôle

- **Date** : 11 novembre 2026
- **Statut** : décidé par le chef de projet
- **Décision** : seuls les contrôles réellement calculables sont automatiques (fonction SQL `dossier_checks`, migration 0006) :
  - pièces obligatoires présentes, selon `required_documents` (miroir de `REQUIRED_DOCUMENTS`) ; pour une verticale sans liste (vague 2), au moins une pièce ;
  - prestataire vérifié (annuaire `providers.verified`) ;
  - doublon possible : même payeur, même prestataire, même montant, dossier créé dans les 30 jours ;
  - somme des tranches égale au total.

  Chaque contrôle renvoie `OK`, `ATTENTION` ou `ECHEC` et un détail. Un doublon possible n’empêche pas d’approuver : il alerte.
- **Contrôle humain** : la cohérence du montant avec les pièces n’est **pas** automatique. Case à cocher « J’ai vérifié que le montant correspond aux pièces », obligatoire avant d’approuver, exigée aussi par la base (`decide_tx(…, p_amount_checked)`, code `AMOUNT_NOT_CHECKED`), enregistrée avec la validation (`validations.amount_checked`) et journalisée.
- **Écart avec la maquette** : la maquette (écran « Back-office : validation ») montre « Montant cohérent avec la promesse » parmi les contrôles automatiques. L’application suit D6.

## D7 — Connexion du personnel

- **Date** : 11 novembre 2026
- **Statut** : décidé par le chef de projet
- **Décision** : adresse e-mail et mot de passe, plus un second facteur par application d’authentification (TOTP, Supabase Auth MFA), obligatoire pour les validateurs et les administrateurs quand `app_config.require_staff_mfa = 'true'` (production ; `false` en développement). Les comptes du personnel sont créés par un administrateur dans le tableau de bord Supabase (pas d’inscription publique au bureau de contrôle) et reçoivent leur rôle de plateforme par SQL.
- **Mise en œuvre** :
  - `is_validator()` et `is_admin()` exigent un jeton `aal2` quand la clé vaut `true` : toutes les politiques RLS et fonctions du personnel en héritent (interface et API).
  - Le proxy du bureau de contrôle (`apps/web/src/proxy.ts`) applique la même règle. Il demande aussi le second facteur à quiconque en a inscrit un, même quand il n’est pas exigé.
  - Procédure de création de compte : `docs/backoffice.md`.

## D8 — Prise en charge d’un dossier

- **Date** : 11 novembre 2026
- **Statut** : décidé par le chef de projet
- **Décision** : quand un validateur ouvre un dossier `SUBMITTED`, il le prend en charge. La transition `SUBMITTED → IN_REVIEW` est jouée automatiquement par `claim_dossier` et journalisée à son nom. Un dossier déjà `IN_REVIEW` reste ouvert aux autres validateurs, comme l’exige la double validation. Un validateur partie au dossier ne le prend pas en charge (RG-03) : il le voit en lecture seule.

---

# Lot X — fondations du cahier d’extension (passe 1 : X1 à X3)

Principe : tant que le client n’a pas tranché, le comportement par défaut ne change pas. Les choix ci-dessous sont ceux que le prompt du lot laissait ouverts ; ils sont révisables au kickoff. Le document d’analyse `ALIGNEMENT-CAHIER-EXTENSION.md` (questions K1 à K14) n’était pas disponible dans l’espace de travail : seules les questions citées par le prompt (K1, K2, K3) sont référencées ici.

## X-0 — Organisation des migrations du lot X

- **Date** : 12 novembre 2026
- **Décision** : `0007_lotx_enums.sql` (valeurs d’enum : `INFO_REQUESTED`, `REJECTED`, `IMMEDIATE`) et `0008_lotx.sql` (X1 à X3) sont appliquées sur le projet de développement à la fin de la passe 1. Comme une migration appliquée n’est jamais modifiée, la passe 2 ajoute **une migration par tâche**, appliquée à la fin de sa tâche : `0009_lotx_x4.sql`, `0010_lotx_x5.sql`, `0011_lotx_x6.sql`, `0012_lotx_x7.sql` (au lieu d’un seul `0009_lotx_p2.sql` annoncé à la passe 1 : un fichier unique aurait dû être modifié après son application, ou appliqué d’un bloc sans commit par tâche). Leur test est un nouveau fichier, `supabase/tests/04_lotx_p2.sql` (et sa variante éditeur), plutôt que la suite de `03_lotx.sql`, qui reste celui de la passe 1.

## X-1 — Sécurité du TrustLink

- **Date** : 12 novembre 2026
- **Choisi** :
  - **Plus aucun lien** : partage, copie, enregistrement du QR et adresse du lien retirés de l’écran du jeton ; route `t/[reference]`, rejeu d’un lien après connexion, `buildLink`, `parseDeepLink` et `EXPO_PUBLIC_LINK_BASE` supprimés. Seul lien interne : `diaspay://tranche/<identifiant de tranche>` (`parseInternalLink`, `+native-intent.tsx`) ; toute autre adresse est ignorée. Le build web garde ses routes adressables par URL (outil de développement), toujours derrière la session et la RLS.
  - **QR** : affiché au payeur connecté seulement, pour sa tranche **payée** (`PAID_LOCKED`) ; le bouton « Afficher le QR » d’une tranche à payer est retiré (écart visible, voir le compte rendu). Capture d’écran interdite sur iOS et Android (`expo-screen-capture`). Avec `eqr_image_enabled = 'false'`, la référence reste affichée (non sélectionnable) pour la saisie manuelle par le prestataire.
  - **Lecture du jeton réservée au payeur** (RLS de `tranche_tokens`) : avant, toutes les parties le lisaient, donc le prestataire pouvait confirmer sans le QR du payeur.
  - **Même réponse** pour une référence inconnue et un dossier étranger : `resolve_reference_info` renvoie `null` (traduit en `UNKNOWN_REFERENCE` par le client) au lieu de lever une erreur, pour que l’échec soit enregistré (une erreur annulerait l’enregistrement). `confirm_by_reference` lève `UNKNOWN_REFERENCE` dans les deux cas, sans enregistrer l’échec, mais applique la limite.
  - **Limitation** : `app_config.reference_failure_limit = 10` par utilisateur et par heure glissante ; `security_events` (ajout seul, lecture par le personnel) ne garde que les 4 premiers caractères de la référence tentée ; `SUSPICIOUS_ACTIVITY` écrit une fois au seuil.
  - **Révocation** : par l’initiateur (créateur du dossier) tant que la tranche n’est pas payée, ou par un administrateur non partie à tout moment ; motif obligatoire ; le jeton révoqué est conservé (clé primaire propre, un seul jeton actif par tranche). `reissue_token` révoque puis émet une nouvelle référence, jamais journalisée. Le rejet d’une demande révoque aussi le jeton.
  - **Ouverture** : `mark_received` ne journalise que la première ouverture (`REQUEST_VIEWED`), quel que soit l’état de la tranche.
  - **Gabarits externes** : trois familles (`PAYMENT_REQUEST_RECEIVED`, `REQUEST_UPDATED`, `PAYMENT_UPDATED`), français et anglais, sans aucun paramètre ; l’e-mail et WhatsApp ajoutent « DiasPay ne vous envoie jamais de lien de paiement… ». Aucun canal externe n’est encore branché.
- **Reste à décider** : `eqr_image_enabled` en production ; signature cryptographique réelle et vérification hors ligne (TrustEngine) ; durée de validité définitive des jetons ; fournisseur SMS, e-mail, WhatsApp. État détaillé : `docs/specs/trustlink-security.md`.

## X-2 — Décisions du payeur (serveur et domaine, sans écran)

- **Date** : 12 novembre 2026
- **Choisi** :
  - Transitions passées **uniquement** par `request_info`, `answer_info` et `reject_request` (motif de 3 à 2000 caractères) ; `transition_tranche` les refuse (`TRANSITION_FORBIDDEN`).
  - Une demande d’informations n’est possible que si le payeur **n’est pas** l’initiateur (sinon personne ne pourrait répondre) ; l’initiateur est le créateur du dossier (demandeur, ou prestataire en X3).
  - Le motif d’un rejet est conservé comme message `NOTE` ; `REJECTED` est terminal et compte pour la clôture. Le retour à `AWAITING_PAYMENT` après une réponse n’envoie pas de nouvelle alerte `PAYMENT_READY` (l’alerte est `INFO_ANSWERED`).
  - Destinataires : `INFO_REQUESTED`, `INFO_ANSWERED`, `REQUEST_REJECTED` aux autres parties que l’auteur ; alertes sans texte ni montant.
  - Pièces d’une réponse : documents de la tranche, insérés par l’initiateur pendant `INFO_REQUESTED` (politiques `docs_insert_info`, `dossiers_insert_info`) ; `answerInfo` de l’API ne prend que le texte (l’envoi des pièces viendra avec l’écran, lot Y).
  - Mode `IMMEDIATE` : ajouté, **aucun type de besoin ne l’utilise** (K1) ; testé en basculant temporairement `RENT` dans la transaction annulée du test SQL, et dans le domaine (`paymentOutcome`).
- **Reste à décider** : expiration d’une tranche en `INFO_REQUESTED` (aujourd’hui : aucune) ; effet d’un rejet sur les tranches suivantes (aujourd’hui : seule la tranche rejetée est close, un jalon suivant reste bloqué car il attend une tranche débloquée) ; flux par défaut (K1) et validation par défaut (K2).

## X-3 — Demandes initiées par un prestataire ou un tiers

- **Date** : 12 novembre 2026
- **Choisi** :
  - `profiles.can_initiate_requests` : **enrôlement provisoire**, faux par défaut, modifiable seulement par un administrateur (déclencheur `guard_profile`, comme `platform_role`). L’enrôlement réel (niveaux de vérification) sera défini au kickoff (K3).
  - Rôle explicite du brouillon `creatorRole` (`NeedDraft`, stocké avec le brouillon) ; `createDraft({ vertical, creatorRole })` dans l’API est un raccourci de `saveDraft`. **Sans rôle explicite, rien ne change** : demandeur si le profil l’est, sinon payeur. Un profil « prestataire » sans rôle explicite crée donc en payeur, comme le serveur le faisait déjà ; le simulateur, qui le refusait, est aligné.
  - Rôle `PROVIDER` : autorisation obligatoire (`INITIATION_NOT_ALLOWED`), payeur désigné par téléphone (invitation s’il n’a pas de compte, rattachement à l’inscription), jamais soi-même (`SELF_PAYER`), payeur exigé à la soumission ; le nom du prestataire est celui du profil du créateur ; un prestataire n’agit sur un brouillon que s’il l’a créé.
  - `PAYMENT_REQUEST_RECEIVED` est envoyé au payeur **à la soumission** (dès que les contrôles existants passent), avant la validation du bureau de contrôle, qui reste obligatoire (aucun changement de K2). Un payeur sans compte ne reçoit rien ; il retrouve la demande à son inscription.
  - Aucun écran : l’assistant de création garde sa forme (la variante « je suis prestataire » viendra au lot Y).
- **Reste à décider** : politique d’enrôlement et niveaux de vérification (K3) ; tiers non prestataire ; notification d’un payeur invité après son inscription.

## X-4 — TrustVault : empreintes et consultations

- **Date** : 12 novembre 2026
- **Choisi** :
  - **Empreinte** : `documents.content_hash` (SHA-256, 64 caractères hexadécimaux, normalisée en minuscules) et `hash_algo` (`SHA-256`), calculées sur l’appareil avant l’envoi (`expo-crypto` 58 sur les octets lus par `expo-file-system`, WebCrypto sur le web), enregistrées par `add_document` (paramètre facultatif `p_hash`, même signature d’appel sans empreinte) ; le simulateur reçoit la même fonction dans l’application. **Immuables** : aucune modification, ni ajout après coup sur une pièce enregistrée sans empreinte (`HASH_IMMUTABLE`).
  - **Empreinte facultative côté serveur** tant que le réglage `require_content_hash` vaut `false` (défaut) : les versions déjà installées de l’application et les tests existants envoient des pièces sans empreinte. L’application, elle, en envoie toujours une. À passer à `true` avant la production (liste de contrôle).
  - **Réutilisation (TrustProof)** : `document_reuse(hash, tx)` compte les **autres dossiers soumis** (brouillons exclus) contenant la même empreinte. Une partie n’interroge qu’une empreinte d’une pièce qu’elle voit (sinon `NOT_FOUND`, même réponse qu’une empreinte inconnue) et ne reçoit qu’un nombre ; le personnel reçoit aussi les références courtes. Contrôle `DOCUMENT_REUSED` (ATTENTION, sans blocage) dans `dossier_checks`, détail : type de pièce et références. Une même pièce d’identité réutilisée par le même payeur déclenche aussi l’alerte : c’est voulu, le validateur juge.
  - **Consultations** : `get_document_access` journalise `DOCUMENT_VIEWED` (acteur, rôle, pièce ; horodatage de la ligne) pour toute partie et le personnel, puis le stockage autorise la lecture du fichier 2 minutes (même mécanisme que le lot 5). **Changement voulu** : une partie ne lit plus un fichier d’un dossier soumis sans consultation journalisée. Exception : le brouillon jamais audité de son créateur (non journalisé, sinon il deviendrait insupprimable, décision D4).
  - **Immuabilité** : déclencheur sur `documents` : ni modification ni suppression (`DOCUMENT_LOCKED`) hors brouillon ou dossier rejeté, sauf une pièce de réponse pendant `INFO_REQUESTED` ; la suppression du dossier lui-même et la réinitialisation de démonstration restent possibles. Les fichiers du bucket étaient déjà protégés (aucune politique de mise à jour, suppression limitée aux brouillons jamais audités).
  - Aucun écran mobile n’affiche aujourd’hui une pièce déjà envoyée ; `documentUrl` passe désormais par `get_document_access`, et le back-office garde `open_document` (lot 5, même journal).
- **Reste à décider** : passage de `require_content_hash` à `true` ; durée de conservation des pièces et des journaux de consultation (exigence 5.3) ; chiffrement applicatif des pièces au repos (aujourd’hui : chiffrement du stockage Supabase) ; contrôle de réutilisation entre payeurs différents seulement, si les alertes sur les pièces d’identité gênent le bureau.

## X-5 — Fondations des paiements

- **Date** : 12 novembre 2026
- **Choisi** :
  - **Aucun appel à TrustPayWay.** `PaymentPort` v2 dans le domaine (`createPayment`, `getPaymentStatus`, `refund`, `verifyWebhook`, `parseWebhook`) ; un adaptateur simulé qui répond par des **événements signés** (HMAC-SHA256), appliqués par le même chemin que ceux du partenaire, dans le simulateur (`PaymentEngine`) comme sur le serveur (`demo_settle_payment` → `apply_payment_event`, mock_mode).
  - **Paiement de l’application** : `payTranche` passe désormais par `start_payment` puis par l’événement simulé, au lieu de `simulate_tranche_system(…, 'PAID_LOCKED')` (toujours disponible pour les tests existants). Résultat visible identique (tranche payée, fonds bloqués). Clé d’idempotence : une par écran de paiement (nouvel essai, double appui : jamais un second paiement).
  - **Tentatives** : clé unique de 8 à 200 caractères ; au plus une tentative en cours ou réussie par tranche ; fournisseur `app_config.payment_provider` (`SIMULATED`). Seul le payeur paie (`PAYER_ONLY`).
  - **Événements** : `apply_payment_event` réservée au rôle `service_role` (ni `anon`, ni `authenticated`) ; la signature est vérifiée par l’appelant, une signature invalide est enregistrée sans être appliquée ; la fonction répond toujours, sans exception, pour que l’événement reste enregistré.
  - **Journal** : plan de comptes minimal à faire valider (`docs/specs/ledger.md`) ; équilibre par devise vérifié par une contrainte différée ; lignes immuables ; remboursements par contrepassation ; versement au prestataire écrit au déblocage par un déclencheur sur `release_events` (tous les déclencheurs de déblocage sont couverts).
  - **Remboursements** : administrateur non partie, jamais au-delà du payé, idempotents ; une tranche débloquée n’est pas remboursable par cette voie. **Le litige tranché en faveur du payeur ne crée pas de remboursement** (comportement inchangé) : le rapprochement le signale.
  - **Rapprochement** : vue `v_reconciliation` (personnel), onze codes d’écart, mêmes règles dans le simulateur.
- **Reste à décider** : validation du plan de comptes et des frais ; expiration d’une tentative sans réponse ; lien entre litige et remboursement ; fonction Edge de réception des webhooks de TrustPayWay et schéma de signature ; écran de rapprochement pour le bureau de contrôle.

## X-6 — Types de besoin configurables (noyau et modules)

- **Date** : 12 novembre 2026
- **Choisi** :
  - **`request_modules`** : code, libellés et descriptions (français, anglais), activé, vague, mode de déblocage, délai de contestation, double validation, `platform_review`, plusieurs payeurs, pièces requises (JSON : type, obligatoire, nombre maximal de fichiers, libellés), ordre d’affichage. Amorcée avec les valeurs actuelles ; **la migration vérifie** qu’elles coïncident avec `release_rules`, `required_documents` et `open_verticals` avant de les remplacer, et s’arrête sinon. Écriture réservée aux administrateurs (RLS) ; un module se contrôle à l’écriture (types de pièce, 1 à 10 fichiers, libellés).
  - **Colonne `transactions.vertical` conservée** (nom inchangé), passée de l’enum `vertical` à `text` avec une clé étrangère vers `request_modules(code)`. L’enum `vertical` reste en base, inutilisé, pour le retour arrière. Les vues du bureau (`bo_dossiers`, `bo_evidence_queue`, `bo_disputes`) sont recréées à l’identique à partir de leur définition en base.
  - **`release_rules` et `required_documents` deviennent des vues** sur `request_modules` ; les anciennes tables sont **renommées** (`_release_rules_0003`, `_required_documents_0005`), pas supprimées. `app_config.open_verticals` n’est plus lu : l’ouverture est `request_modules.enabled`.
  - **Réversible** : `supabase/rollbacks/0011_lotx_x6_down.sql` (refuse si un dossier utilise un module ajouté depuis). Testé dans une transaction annulée sur le jeu de données du projet de développement augmenté de 300 dossiers synthétiques (tous types, huit statuts) : application, retour arrière, puis comparaison (303 dossiers, règles, pièces et ouverture identiques) et tests 00 à 03 verts.
  - **`platform_review`** : `needs_platform_review(tx)` et, à la soumission, `ALWAYS` = file du bureau (inchangé), `NEVER` = validation automatique par le système (`SUBMITTED → VALIDATED`, journal `AUTO_VALIDATED`, sans ligne de validation), `RISK_BASED` = automatique sauf montant au seuil de double validation, **première demande validée** du créateur, ou doublon (même règle que le contrôle `DUPLICATE`). **Double validation toujours appliquée** : un dossier qui exige deux validateurs (module ou seuil) va toujours au bureau, quel que soit le mode. **Tous les modules restent `ALWAYS`.**
  - **Client** : `listModules()` ; l’assistant lit la liste des types, les pièces requises (et leur nombre maximal de fichiers), la règle de déblocage du récapitulatif et les libellés dans les modules, avec les valeurs du code tant que la liste n’est pas chargée. `RELEASE_RULES`, `REQUIRED_DOCUMENTS` et `VERTICALS` restent les valeurs par défaut du simulateur et des tests (`DEFAULT_MODULES`), comparées par test à l’amorçage SQL.
  - Changements de comportement voulus, invisibles avec les modules par défaut : un code de type de besoin bien formé inconnu de l’application est accepté (un module peut s’ajouter par des données) ; le simulateur répond `VERTICAL_UNAVAILABLE` (comme le serveur) au lieu de `VALIDATION` pour un type fermé.
- **Reste à décider** : valeurs de `platform_review` par module (K2) ; écran d’administration des modules (back-office) ; filtre « Verticale » du back-office encore limité aux six types connus ; suppression de l’enum `vertical` et des tables renommées une fois le retour arrière jugé inutile.

## X-7 — Structure multi-payeurs (préparation, sans interface)

- **Date** : 12 novembre 2026
- **Choisi** :
  - `transaction_parties` : identifiant propre (`id`, clé primaire) au lieu de (transaction, rôle) ; unicité (transaction, utilisateur, rôle) et (transaction, téléphone invité, rôle). **Un seul demandeur et un seul prestataire** par dossier, comme avant (index unique sur le rôle hors payeur), pour que rien ne change hors des payeurs.
  - Second payeur : **déclencheur de contrainte** (`_check_multiple_payers`, `MULTIPLE_PAYERS_NOT_ALLOWED`), qui lit `request_modules.multiple_payers` (faux partout). Il s’applique à toute écriture, y compris hors des politiques RLS. Aucune fonction ni API ne propose d’ajouter un payeur (pas d’interface) ; la règle du domaine (`checkAddPayer`) est prête pour la phase 2.
  - Retour arrière : `supabase/rollbacks/0012_lotx_x7_down.sql`, à jouer avant celui de 0011 ; la chaîne 0012 puis 0011 est testée dans une transaction annulée (jeu de données du développement, puis tests 00 à 03).
  - Suite (contributions, cible, clôture, surplus, anonymat) : brouillon `docs/specs/multi-payers.md`.
- **Reste à décider** : tout ce que liste `docs/specs/multi-payers.md` (types concernés, parts, échéance non atteinte, anonymat, litiges).

---

# Lot X version 2 — refonte du noyau après le kickoff

Le prompt « Lot X (version 2) » remplace le premier lot X. Modèle cible : `docs/specs/modele-cible-v2.md` (décisions K1 à K14). Le document `ALIGNEMENT-CAHIER-EXTENSION.md` n’a pas été fourni : `docs/alignement-cahier-extension.md` n’existe pas.

## X0-v2 — Reprise de l’ancien lot X, migrations

- **Date** : 12 novembre 2026
- **Choisi** :
  - L’ancien lot X (0007 à 0012) est appliqué et conservé : jamais modifié. La version 2 continue la numérotation : `0013_lotx2_enums.sql` (valeurs d’enum seulement, fichier séparé), `0014_lotx2_core.sql` (X2), `0015_lotx2_x1.sql` (compléments X1, qui dépendent du mode de règlement), `0016_lotx2_x3.sql` (X3), puis `0017_lotx2_fixes.sql`, `0018_lotx2_fixes2.sql` et `0019_lotx2_fixes3.sql` (défauts de 0014 trouvés en mettant les tests et les écrans à jour ; 0014 étant appliquée, elle n’est pas retouchée). 0019 : un remboursement intégral décidé par un litige sur des fonds encore bloqués (CONDITIONAL) les marque rendus (RETURNED), pour qu’ils ne puissent plus être libérés au prestataire. Commits par tâche : X2, puis X1, puis X3 (X1 dépend du mode de règlement de X2).
  - Ancien X1 : conservé ; ancien X2 (`INFO_REQUESTED`, `REJECTED`) : conservé avec la table 3.2 ; `IMMEDIATE` → `settlement_mode = DIRECT` (voir X2-v2) ; `platform_review` : défaut `NEVER` ; `can_initiate_requests` : conservé jusqu’à X4 (enrôlement).
  - Écrans : adaptations minimales listées dans `docs/lotx2-adaptations-ecrans.md`.
  - Tests : 00 à 04 mis à jour volontairement, avec un nouveau test `05_lotx2_p1.sql` (et sa variante éditeur) pour la passe 1. Chaque contrôle modifié, remplacé ou ajouté est listé avec sa raison dans `docs/lotx2-controles-sql.md`.

## X2-v2 — Le noyau : opérations, demandes, états, règlement direct (K1, K2, K5, K6, K7)

- **Date** : 12 novembre 2026
- **Choisi** :
  - **Statuts** exactement ceux des sections 3.1 et 3.2. PostgreSQL ne retire pas une valeur d’enum : les anciennes valeurs (SUBMITTED, VALIDATED, TOKEN_ISSUED, IN_PROGRESS, DISPUTED pour l’opération ; PLANNED, AWAITING_PAYMENT, PAID_LOCKED, CONFIRMED, RELEASED, EVIDENCE_SUBMITTED, DISPUTED pour la demande ; IMMEDIATE) restent dans les types, mais des contraintes (`transactions_status_v2`, `tranches_status_v2`, `tranches_no_immediate`, `request_modules_no_immediate`) les refusent, et le TypeScript ne les connaît plus. `IN_REVIEW` est gardé comme sous-état de la revue (prise en charge D8) : la section 5 du modèle le prévoit.
  - **Données de développement converties**, pas effacées (aucune donnée de production) : correspondance de la section 5 (PLANNED → DRAFT, AWAITING_PAYMENT → SUBMITTED, payée → PAID avec `funds_state`, opération en cours → ACTIVE, rejetée → CANCELLED, litiges → dossiers RESOLVED avec issue). Plus sûr qu’un `demo_reset()` : les comptes de démonstration gardent leurs dossiers.
  - **Soumission** : `submit_operation` (et `transition_tx(…,'SUBMITTED')`, gardée comme alias pour les appels existants). Mêmes contrôles qu’avant, plus un payeur obligatoire pour toute opération. NEVER → ACTIVE (`AUTO_ACTIVATED`, auteur : l’initiateur qui soumet) ; sinon PENDING_REVIEW. L’activation soumet les demandes dues (RG-12 conservée). Plus de jeton d’opération ni d’étapes « système » simulées (`auto_issue_token` n’est plus lu).
  - **Revue par le bureau** : file du lot 5 inchangée côté interface (`bo_dossiers` : PENDING_REVIEW et IN_REVIEW). Approbation → ACTIVE (alerte `TX_VALIDATED`) ; rejet → **CANCELLED** avec motif (alerte `TX_REJECTED`). **D4 remplacée** pour ce parcours : plus de correction d’une opération rejetée (l’initiateur en crée une nouvelle) ; l’abandon devient l’annulation par l’initiateur (`cancelOperation`, DRAFT ou ACTIVE → CANCELLED ; en ACTIVE avec une demande payée, seules les demandes restantes sont annulées et l’opération se clôt).
  - **Mode de règlement** : `transactions.settlement_mode`, recopié du module à la création du brouillon. Vague 1 (Scolarité, Santé, Loyer) en DIRECT ; vague 2 (Agro, Immobilier, Terrain) en CONDITIONAL, avec leurs règles de libération en données. En DIRECT : paiement → PAID, versement au prestataire au journal (`DIRECT_PAYMENT`), reçu immédiat, ni jeton, ni scan, ni délai de contestation. En CONDITIONAL : PAID avec `funds_state = HELD`, puis confirmation (scan du prestataire, ou payeur en PAYER_CONFIRM : `confirm_service`), preuves (`submit_evidence`, décision du bureau), libération (`approve_release`, délai écoulé, ou litige) → RELEASED ; `funds_state = RETURNED` si les fonds reviennent au payeur. `confirmed_at` et `evidence_submitted_at` remplacent les anciens statuts.
  - **Paiement** (en attendant `accept_and_pay` en X5) : `start_payment` passe la demande SUBMITTED → ACCEPTED ; l’événement du partenaire la passe à PAID, ou la rend payable (ACCEPTED → SUBMITTED) si toutes les tentatives échouent. Un remboursement versé passe PAID → REFUNDED (`refunded_minor`, partiel ou total).
  - **Litige distinct** : statuts OPEN (ouverture), AWAITING_RESPONSE (le bureau demande une précision : `request_dispute_response`), IN_MEDIATION (la partie adverse a répondu, ou une partie a complété : `respond_dispute`, `add_dispute_message`), RESOLVED (avec une issue). Le modèle ne fixe pas les transitions entre ces statuts : celles-ci sont un choix à valider. Avant paiement (SUBMITTED, INFO_REQUESTED, ACCEPTED) : `on_hold`, opération SUSPENDED (le paiement et la demande d’informations répondent `REQUEST_ON_HOLD`) ; issue NO_ACTION seulement, qui lève la suspension. Après paiement : statut inchangé ; issues de remboursement (remboursement lié, contrepassation) ou, en CONDITIONAL avec fonds bloqués, FUNDS_RELEASED / FUNDS_RETURNED. Un litige en cours bloque la libération automatique.
  - **Suspension pour fraude** : `suspend_operation` et `lift_suspension` (personnel non partie), sans écran.
  - **Expiration** : `expire_due_requests` (pg_cron, toutes les heures), selon `request_modules.request_expiry_days` : point ouvert, aucune valeur, donc aucune expiration aujourd’hui.
  - **Alertes** : demande soumise → `PAYMENT_READY` si le payeur est l’initiateur, `PAYMENT_REQUEST_RECEIVED` sinon (au payeur seul) ; paiement exécuté → `REQUEST_PAID` (nouvelle) ; confirmation et libération en CONDITIONAL → `TRANCHE_CONFIRMED`, `TRANCHE_RELEASED` (sauf libération décidée par un litige : `DISPUTE_RESOLVED` seule, 0017).
  - **Vue `payment_requests`** (lecture seule) et colonnes du modèle (`target_amount_minor`, `scheduled_for` générées depuis `amount_minor` et `due_date`, `currency` recopiée de l’opération) ; le TypeScript parle de `PaymentRequest` (`Tranche` reste un alias).
  - **Domaine** : `operationMachine`, `paymentRequestMachine` (chaque transition permise et refusée, par acteur, testée ; parité avec les tables SQL testée), `conditionalRelease`, `disputes`.
  - **Journal en DIRECT** : le paiement est aussitôt versé (journaux PAYMENT puis RELEASE). Un remboursement intégral laisse alors `PARTNER_CASH` à −montant et `DUE_TO_PROVIDER` à +montant pour la demande, ce qui se lit « le prestataire doit rendre la somme ». Le journal reste équilibré. Cette lecture est à valider avec le plan de comptes (`docs/specs/ledger.md`), qui sera revu en X5.
- **Reste à décider** : transitions entre statuts de litige ; durée d’expiration par module ; seuil `RISK_BASED` ; plan de comptes en DIRECT (rétrofacturation). Voir `docs/open-parameters.md`.

## X1-v2 — Compléments de sécurité du TrustLink et du QR (K4)

- **Date** : 12 novembre 2026
- **Choisi** : l’ancien X1 est conservé. `eqr_image_enabled` vaut désormais `false` (QR retiré du parcours par défaut ; code conservé pour CONDITIONAL). Résolution d’une référence : le payeur, l’initiateur, et le prestataire **en CONDITIONAL seulement** (la confirmation par scan l’exige) ; même réponse pour « inconnue » et « pas partie ». Les jetons de demande n’existent qu’en CONDITIONAL : émis à la soumission, réémission refusée en DIRECT (`NO_TOKEN`, 0018).
- **Reste à décider** : l’image du QR en CONDITIONAL ; QR dynamique du commerçant (interface plus tard, schéma en X3).

## X3-v2 — Décisions du payeur, jeton de présentation (K4, K6)

- **Date** : 12 novembre 2026
- **Choisi** :
  - `request_info` (SUBMITTED → INFO_REQUESTED), `answer_info` (→ SUBMITTED), `reject_request` : fonctions du premier lot, statuts v2.
  - **`accept_plan`** : le payeur accepte le principe du plan, une fois (idempotente), ce qui n’autorise aucun paiement à l’avance. L’action est journalisée et l’alerte `PLAN_ACCEPTED` part aux autres parties. Elle est aussi possible quand l’opération est suspendue.
  - **Jeton de présentation** : `presentation_tokens` ne conserve que l’empreinte SHA-256 de la référence. La référence (32 caractères hexadécimaux) n’est renvoyée qu’à l’émission et jamais journalisée.
    - Émission par l’initiateur, pour une demande soumise. Chaque émission révoque les jetons précédents non pris (rotation). `revoke_presentation_tokens` révoque explicitement.
    - Prise en charge à usage unique. Elle lie la demande à l’utilisateur connecté : le payeur invité par téléphone, ou un payeur encore inconnu. Elle renvoie un résumé minimal (nom de l’initiateur, montant, devise) et n’autorise aucun paiement.
    - Refus explicites : expiré (`TOKEN_EXPIRED`), révoqué (`TOKEN_REVOKED`), déjà pris (`TOKEN_USED`).
    - Référence inconnue, demande déjà liée à un autre payeur, ou prise en charge par l’initiateur lui-même : réponse nulle, et l’échec compte pour la limitation (`TOO_MANY_ATTEMPTS`).
    - Durée de vie : réglage `presentation_token_ttl_seconds`, point ouvert. La valeur 90 est posée en développement seulement (mock_mode) ; sans réglage, l’émission répond `NOT_CONFIGURED`.
  - **Initiation par un prestataire** : inchangée (`can_initiate_requests`) jusqu’à X4 (niveaux d’enrôlement).
  - Aucun écran nouveau. `acceptPlan` est exposé par l’API ; le jeton de présentation ne l’est pas encore (interface du lot Y).
- **Reste à décider** : durée de vie et rotation du QR de présentation (avec le partenaire et en test) ; affichage obligatoire du nom du commerçant, du montant puis des frais avant toute autorisation (lot Y, X5 pour les frais).

