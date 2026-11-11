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
