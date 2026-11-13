# Mise en place de Supabase

Guide pour un projet de **développement**. La production suit le même ordre, sans les numéros de test ni le seed (voir `docs/release-checklist.md`).

## 1. Prérequis

- Un projet Supabase créé au nom du client. Projet de développement actuel : `ihyyjenmqadzwqctisbz` (région us-west-2, PostgreSQL 17).
- Supabase CLI (`brew install supabase/tap/supabase`), testé avec 2.121.
- `psql` : `brew install libpq` (le script l’utilise depuis `/opt/homebrew/opt/libpq/bin` s’il n’est pas dans le `PATH`).
- Python 3 (encodage du mot de passe dans l’URL de connexion).

## 2. Variables

Copier `.env.example` :

| Fichier | Contenu | Secret |
|---|---|---|
| `.env.local` (racine) | `SUPABASE_ACCESS_TOKEN` (Account > Access Tokens, compte propriétaire du projet), `SUPABASE_DB_PASSWORD` (Project Settings > Database) | oui |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_API`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (clé « publishable ») | non (public) |

Les deux fichiers sont ignorés par Git. **La clé `service_role` n’est jamais utilisée** : ni dans le dépôt, ni dans l’application, ni dans une variable `EXPO_PUBLIC_*`. Pour les builds EAS, déclarer les variables publiques comme variables d’environnement EAS.

## 3. Lier le dépôt et appliquer les migrations

```
set -a; . ./.env.local; set +a
supabase link --project-ref <ref>
scripts/db.sh push      # migrations non encore appliquées, dans l’ordre
scripts/db.sh test      # supabase/tests/00_smoke.sql (67 vérifications), 01_lot4.sql…
```

`scripts/db.sh` passe par le **pooler en mode session** (`supabase/.temp/pooler-url`) : la connexion directe `db.<ref>.supabase.co` n’est joignable qu’en IPv6 sur l’offre gratuite, et la CLI s’y bloque sans message.

**Projet où le schéma a été appliqué à la main** (cas du projet de développement : tables présentes, aucun historique de migrations) : vérifier d’abord avec `scripts/db.sh test` que le schéma est conforme, puis enregistrer l’historique sans rien rejouer :

```
supabase migration repair --status applied 0001 0002 0003 0004 --db-url "<url du pooler avec mot de passe>"
```

## 4. Authentification par téléphone

Réglages du projet hébergé (tableau de bord > Authentication > Sign In / Providers > Phone, ou API de gestion `PATCH /v1/projects/<ref>/config/auth`) :

| Réglage | Valeur | Champ de l’API |
|---|---|---|
| Connexion par téléphone | activée | `external_phone_enabled` |
| Validité du code SMS | **300 s** (cahier US-01) | `sms_otp_exp` |
| Fournisseur SMS | Twilio, identifiants **factices** en développement : aucun SMS réel | `sms_provider`, `sms_twilio_*` |
| Numéros de test | les six numéros ci-dessous et trois numéros réservés aux tests automatisés, code `123456` | `sms_test_otp` (`33639980001=123456,…`) |
| Fin de validité des numéros de test | 30/06/2027 (à avancer avant la mise en service) | `sms_test_otp_valid_until` |

Un fournisseur SMS doit être activé même si seuls les numéros de test sont utilisés. La validité du code n’est pas réglable dans `supabase/config.toml` ; les autres réglages y sont reproduits pour le développement local (`supabase start`) et `supabase config push`. **Ne jamais pousser `[auth.sms.test_otp]` en production.**

Limite de débit : Supabase limite les demandes et vérifications de code (`rate_limit_otp`, `rate_limit_verify`, 30 par heure et par défaut) mais ne verrouille pas un numéro après trois codes erronés. Écart avec US-01 assumé pour le pilote : décision D5, `docs/decisions.md`.

## 5. Comptes de démonstration

Numéros de la tranche 06 39 98, réservée à la fiction ; code fixe `123456`. Dans l’application, saisir l’indicatif `+33` et le numéro national.

| Rôle | Numéro | Création |
|---|---|---|
| Payeur | +33 6 39 98 00 01 | à la première connexion |
| Demandeur | +33 6 39 98 00 02 | à la première connexion |
| Prestataire | +33 6 39 98 00 03 | à la première connexion |
| Validateur A | +33 6 39 98 00 04 | `scripts/db.sh seed` (rôle `VALIDATOR`) |
| Validateur B | +33 6 39 98 00 05 | `scripts/db.sh seed` (rôle `VALIDATOR`) |
| Administrateur | +33 6 39 98 00 06 | `scripts/db.sh seed` (rôle `ADMIN`) |
| Tests de contrat (payeur, demandeur, tiers) | +33 6 39 98 00 11, 12, 13 | à la première exécution des tests ; jamais utilisés à la main |

`supabase/seed.sql` crée les comptes de plateforme comme le fait l’authentification (utilisateur et identité « phone ») puis attribue leur rôle ; il refuse de s’exécuter si `app_config.mock_mode` n’est pas `'true'`. Point d’attention constaté sur le projet réel : les colonnes de jetons de `auth.users` doivent valoir `''` et non `NULL`, sinon la connexion échoue (« Database error finding user »).

## 6. Vérifier

```
scripts/db.sh test
```

Résultat attendu : `RESULTAT : 67 vérifications, toutes réussies` pour `00_smoke.sql` (et chaque fichier de test suivant entièrement réussi). Les scripts de test s’exécutent dans une transaction annulée (`ROLLBACK`) ; ils créent des utilisateurs fictifs : jamais sur la production.

## 7. Lancer l’application sur Supabase

```
cp .env.example apps/mobile/.env.local      # puis renseigner l’URL et la clé publique
# apps/mobile/.env.local : EXPO_PUBLIC_API=supabase (EXPO_PUBLIC_DEMO=1 pour les actions « Simuler »)
pnpm --filter @diaspay/mobile start
```

Les actions de démonstration (« Simuler : valider / rejeter », décision de litige, réinitialisation, paiement simulé) n’apparaissent que si `EXPO_PUBLIC_DEMO=1` **et** si le serveur est en `mock_mode` ; sinon le serveur les refuse (`DEMO_DISABLED`).

## 8. Tests de contrat

```
pnpm test:supabase
```

La même suite (`packages/api-client/test/contract/contract.ts`) s’exécute contre le simulateur (toujours, dans `pnpm -r test`) et contre `SupabaseApi` quand `SUPABASE_TEST_URL` et `SUPABASE_TEST_ANON_KEY` sont définis (`pnpm test:supabase` les lit dans `apps/mobile/.env.local`). Comptes : numéros réservés +33 6 39 98 00 11 à 13 ; leurs dossiers sont effacés à la fin (`demo_reset`, mock_mode uniquement). Résultat du 11 novembre 2026 : 8 + 8 tests réussis. Lot X (12 novembre 2026) : 11 + 11 (jeton révoqué et réémis, décisions du payeur, demande initiée par un prestataire). Passe 2 : X4, 12 + 12 (empreinte, réutilisation, consultation journalisée) ; X5, 13 + 13 (paiement idempotent par le chemin des événements) ; X6, 14 + 14 (types de besoin lus dans les modules, vague 2 refusée). Lot X version 2, passe 1 (12 novembre 2026) : 17 + 17 (parcours direct de bout en bout, annulation par l’initiateur, litige avant et après paiement, statuts du modèle cible). Un seul écart assumé ajouté : `refundSettlement` (voir le tableau ci-dessous). Le compte +33 6 39 98 00 12 est aussi autorisé à initier une demande en prestataire (`seed.sql`). Chaque passage enregistre une à deux résolutions échouées par compte (`security_events`, en ajout seul) : au-delà d’une dizaine de passages dans la même heure, les résolutions de ces comptes reçoivent `TOO_MANY_ATTEMPTS` jusqu’à ce que la fenêtre d’une heure soit écoulée.

## 9. Écarts assumés entre le simulateur et le serveur

| Sujet | Simulateur (`MockApi`) | Serveur (`SupabaseApi`) |
|---|---|---|
| Après la soumission | `IN_REVIEW` immédiatement | reste `SUBMITTED` : seul un validateur passe en `IN_REVIEW` (ou `demo_review`) |
| Identifiant du dossier soumis | nouvel identifiant `tx-…` | identifiant du brouillon conservé |
| Correction d’un dossier rejeté | nouveau brouillon lié (`correctionOf`) | même identifiant (`correctionOf` = id) |
| Isolation des dossiers | un profil de démonstration à la fois (payeur / prestataire) | RLS par utilisateur, invitations rattachées à l’inscription |
| Verrouillage OTP | 3 essais, 15 minutes (US-01) | limite de débit Supabase, sans nombre d’essais (D5) |
| Déblocage automatique | minuterie dans l’application (30 s) | pg_cron toutes les 10 minutes ; activation des tranches à 06:00 UTC |
| Identifiant d’une pièce | celui choisi par l’application | attribué par le serveur (`add_document`) |
| Annuaire des prestataires | jeu de démonstration intégré | table `providers` (seed : 15 prestataires fictifs à Yaoundé et Douala) |
| Nom du payeur sur une transaction | connu du simulateur | non exposé dans la liste (profils protégés par RLS) ; présent sur le reçu (`get_receipt`) |
| Rôles au dossier (lot X) | le créateur garde son rôle de création ; pour tout autre dossier, le profil de démonstration courant (payeur par défaut). Aucun rapprochement par numéro de téléphone | parties réelles (`transaction_parties`), payeur désigné par son numéro, invitation rattachée à l’inscription |
| Destinataires des alertes du lot X | une seule liste d’alertes pour tous les profils | `INFO_REQUESTED`, `INFO_ANSWERED`, `REQUEST_REJECTED` aux autres parties que l’auteur ; `PAYMENT_REQUEST_RECEIVED` au payeur seul |
| Échecs de résolution d’une référence (lot X) | comptés en mémoire, par utilisateur, perdus au redémarrage | `security_events`, en ajout seul ; plus de 10 échecs dans l’heure : `TOO_MANY_ATTEMPTS`, événement `SUSPICIOUS_ACTIVITY` |
| Échec à la confirmation (`confirmByReference`) | non compté, comme le serveur | non compté : l’erreur annule la transaction qui l’enregistrerait (la limite s’applique quand même) |
| Pièces jointes à une réponse (lot X) | non simulées | documents de la tranche, déposés par l’initiateur pendant `INFO_REQUESTED` (`docs_insert_info`, `dossiers_insert_info`) |
| Administrateur (révocation après paiement) | absent du simulateur | `revoke_token` et `reissue_token` par un administrateur non partie, à tout moment |
| Empreinte d’une pièce (lot X, X4) | dans l’application : même fonction que le serveur (`expo-crypto`) ; dans les tests sans fichier : empreinte de l’URI (`uriHasher`) | calculée par le client, revérifiée (format) et figée par la base |
| Pièces d’un dossier soumis (X4) | gardées dans l’instantané du brouillon soumis ; consultation journalisée dans le journal du simulateur | table `documents` (immuable après soumission), lecture du fichier après `get_document_access` seulement |
| Réutilisation d’un justificatif (X4) | compte les dossiers soumis du simulateur | compte tous les dossiers soumis du serveur ; le personnel voit aussi les références (`document_reuse`) |
| Paiement (X5) | `PaymentEngine` et `SimulatedPaymentAdapter` en mémoire (conservés dans l’instantané) ; événements signés et vérifiés | `start_payment`, `demo_settle_payment` → `apply_payment_event` (mock_mode) ; tables `payment_attempts`, `webhook_events` |
| Journal financier et rapprochement (X5) | `PaymentEngine.journals`, `reconciliation()` (non exposés par l’API) | `ledger_*`, `v_reconciliation` (personnel) |
| Remboursements (X5) | `PaymentEngine.requestRefund` (tests du domaine) ; pas d’administrateur dans le simulateur | `request_refund`, `demo_settle_refund` (administrateur non partie) |
| Types de besoin (X6) | `DEFAULT_MODULES` (ou l’option `modules`) ; aucun administrateur pour en ajouter | table `request_modules`, écriture par un administrateur |
| Revue par le bureau (X6) | même décision (`platformReviewDecision`) ; doublon : même créateur, même montant, même prestataire (par son nom), 30 jours | `_platform_review` : même payeur (compte ou numéro invité), même prestataire (annuaire ou nom), 30 jours |
| Plusieurs payeurs (X7) | non modélisé (un profil de démonstration à la fois) ; règle du domaine `checkAddPayer` testée seule | déclencheur `_check_multiple_payers` sur `transaction_parties` |

| Noyau v2 : soumission (lot X v2) | `submitNeed` : ACTIVE directement (NEVER), ou PENDING_REVIEW selon l’option `modules` | `submit_operation` : idem, selon `request_modules.platform_review` |
| Remboursement après un litige (lot X v2) | versé aussitôt par le partenaire simulé : la demande passe en REFUNDED | remboursement PENDING jusqu’à l’événement du partenaire (`demo_settle_refund` ou TrustPayWay) : la demande reste PAID (drapeau de contrat `refundSettlement`) |
| Revue par le bureau (lot X v2) | `simulateReview` sur PENDING_REVIEW ou IN_REVIEW | `demo_review` (mock_mode) ou `claim_dossier` puis `decide_tx` |
| Jeton de présentation (lot X v2, X3) | non simulé (aucune interface) | `issue_presentation_token`, `claim_presentation_token` |
| Rôles au dossier (lot X v2) | toujours déduits du créateur et du profil de démonstration | `transaction_parties` ; l’initiateur (`initiator_id`) peut ne pas être partie |