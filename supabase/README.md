# Base de données DiasPay (Supabase / PostgreSQL)

Quatre migrations à appliquer **dans l'ordre**, une par fichier :

| Fichier | Contenu |
|---|---|
| `0001_base_v0_1.sql` | Schéma de base : transactions, parties, documents, validations, jetons, paiements, journal d'audit chaîné, machine d'états, RLS |
| `0002_v0_2_enums.sql` | Valeurs d'enum de la v0.2. **Doit être un fichier séparé** : PostgreSQL interdit d'utiliser une valeur d'enum ajoutée dans la même transaction |
| `0003_v0_2_tranches.sql` | Tranches, règles de déblocage par verticale, double validation, litiges, jetons de tranche, tâches planifiées |
| `0004_v0_3_fixes.sql` | Correctifs trouvés en exécutant réellement les migrations, et décision D4 (abandon d'un dossier) |

## Appliquer

**Supabase CLI** (recommandé) : copier `migrations/` dans `supabase/migrations/` du dépôt, puis `supabase db reset` en local ou `supabase db push` sur un projet distant.

**Éditeur SQL du tableau de bord** : coller et exécuter les fichiers un par un, dans l'ordre, chacun dans une exécution séparée.

Utiliser d'abord un projet de **test**.

## Vérifier : test de fumée

`tests/00_smoke.sql` crée sept utilisateurs fictifs (demandeur, payeur, prestataire, deux validateurs, administrateur, étranger), joue le cycle complet avec les vrais rôles `authenticated` et `anon`, vérifie les droits, l'isolation (RLS), le journal d'audit, la double validation, les litiges et la décision D4, puis **annule tout** (`ROLLBACK`).

```
scripts/db.sh test
# ou : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/00_smoke.sql
```

Résultat attendu : `RESULTAT : 67 vérifications, toutes réussies`. Au moindre échec, le script se termine par `ECHEC : n vérification(s)` et un code de sortie non nul, donc utilisable en intégration continue. Avec Supabase en local : l'URL est affichée par `supabase status`.

Le script crée des lignes dans `auth.users` : ne l'exécute jamais sur une base de production.

## Ce que cette vérification couvre, et ce qu'elle ne couvre pas

Couvert, exécuté sur PostgreSQL 16 avec un schéma Supabase émulé (`tests/local-postgres-stubs.sql`) : les quatre migrations dans l'ordre (une transaction par fichier), la réexécution de la 0004, et les 67 vérifications du test de fumée.

**Non couvert** : le vrai service d'authentification, le vrai stockage de fichiers, le temps réel et `pg_cron`. Ils seront validés avec un vrai projet Supabase au lot 4.

## Exécution sur le vrai projet (lot 4, 11 novembre 2026)

Projet de développement `ihyyjenmqadzwqctisbz`, **PostgreSQL 17.11** (l’émulation utilisait PostgreSQL 16).

- **État trouvé** : les migrations 0001 à 0004 avaient déjà été appliquées à la main (éditeur SQL) : 20 tables, `has_audit`, `disputes.reason_code`, bucket `dossiers`, aucune donnée, **aucun historique de migrations**. Le test de fumée a été exécuté tel quel : **67 vérifications, toutes réussies** ; le schéma est conforme. L’historique a ensuite été enregistré sans rien rejouer (`supabase migration repair --status applied 0001 0002 0003 0004`).
- **`pg_cron` n’était pas installé** sur le projet : les tâches planifiées de la 0003 n’étaient pas actives (installé et planifié par la migration 0005).
- **Défaut du test, pas du schéma** : la vérification « profils créés automatiquement » comptait *tous* les profils (`count(*) = 7`) et échouait dès qu’un vrai compte existait. Elle ne compte plus que les sept utilisateurs du test. Résultat après correction, avec les comptes de démonstration présents : 67 vérifications, toutes réussies.
- Aucune autre différence entre l’émulation et Supabase n’a été constatée par le test de fumée.

Commandes : `scripts/db.sh test`, `scripts/db.sh push`, `scripts/db.sh seed` (voir `docs/supabase-setup.md`).

## Migration 0005 (lot 4) : ce que l’application attend du serveur

Appliquée le 11 novembre 2026 sur le projet de développement (`scripts/db.sh push`). Test : `tests/01_lot4.sql`, **117 vérifications, toutes réussies** ; test de fumée toujours à **67/67**.

- **Codes d’erreur stables** dans `hint` (`_err`), sur toutes les fonctions publiques redéfinies : table dans `docs/error-codes.md`.
- **Brouillons côté serveur** : `save_draft(jsonb)` (création ou mise à jour en une transaction : dossier, parties, tranches), `get_draft`, `get_drafts`, `delete_draft`. Un brouillon peut être partiel : `purpose`, `amount_minor` et `currency` ne sont plus `NOT NULL` en `DRAFT` (contrainte `tx_complete_unless_draft`) ; l’état brut de l’assistant est conservé dans `draft_data`.
- **Soumission** : `transition_tx` vérifie désormais, comme le domaine, la verticale ouverte (`app_config.open_verticals`, vague 1), les pièces obligatoires D2 (`required_documents`) et ignore les pièces archivées.
- **Invitations** : un payeur ou un prestataire invité par numéro est rattaché à la création de son profil (comparaison sur les chiffres seuls : l’authentification enregistre `33639980001`, l’application envoie `+33639980001`).
- **Prestataires** : table `providers` (lecture authentifiée, écriture administrateur), `search_providers` insensible à la casse et aux accents (`extensions.unaccent`).
- **Pièces** : `add_document`, `remove_document` (suppression si le dossier n’a jamais été audité, archivage `deleted_at` sinon), limites en base (3 par type, 10 Mo, JPEG / PNG / PDF) et sur le bucket, politiques de suppression.
- **Notifications** créées par un déclencheur sur `audit_log` (sept types), `payload jsonb` ; le client ne peut modifier que `read_at`.
- **Lecture** : `get_receipt`, `get_dispute`, `resolve_reference_info`.
- **Démonstration** : `demo_review`, `demo_resolve_dispute`, `demo_reset`, créées seulement si `mock_mode = 'true'` au moment de la migration, et refusées (`DEMO_DISABLED`) dès que `mock_mode` ne l’est plus. `demo_reset` est la seule exception à l’ajout seul du journal d’audit (drapeau de transaction et `mock_mode`).
- **pg_cron** installé : `release_due_tranches()` toutes les 10 minutes, `activate_due_tranches()` chaque jour à 06:00 UTC.

Constats sur le projet réel pendant la mise au point :
- Les **privilèges par défaut** de Supabase donnent `EXECUTE` à `anon` sur toute nouvelle fonction : chaque fonction de 0005 est explicitement retirée à `public` et `anon` (vérifié par le test).
- Le test de fumée a été mis en conformité avec D2 et la vague 1 (types de pièces `ENROLMENT_CERTIFICATE`, `SUPPORTING_DOCUMENT`, pièce d’identité du bénéficiaire en santé ; terrain ouvert le temps du test). Ses vérifications sont inchangées.
- Le bucket `dossiers` n’avait aucune limite de taille ni de type : fixées par 0005.

## Défauts corrigés par la migration 0004

Trouvés en exécutant les migrations 0001 à 0003, qui n'avaient jamais été exécutées :

1. **pgcrypto introuvable.** Sur Supabase, `digest()` et `gen_random_bytes()` vivent dans le schéma `extensions`, que les fonctions `SECURITY DEFINER` (`search_path = public`) ne voient pas. Conséquence : toute soumission de dossier, l'émission des jetons et le journal d'audit échouaient. Remplacé par `sha256()` et `gen_random_uuid()`, natifs ; les empreintes calculées sont identiques.
2. **Le créateur ne pouvait pas ajouter les parties de son propre brouillon** : la politique d'insertion relisait la transaction, que la politique de lecture lui cachait tant qu'il n'était pas partie.
3. **Un validateur ou un administrateur ne pouvait pas modifier son profil** (la politique exigeait `platform_role = 'USER'`). Remplacé par un déclencheur qui protège le rôle de plateforme et le statut KYC.
4. **Le code de motif de litige choisi dans l'application n'avait pas de colonne** : ajout de `disputes.reason_code`, et `open_dispute` accepte un code.
5. **Décision D4** : transition `REJECTED → CANCELLED` ajoutée ; un brouillon jamais audité est supprimable par son créateur ; un dossier audité ne l'est jamais (`has_audit`).
6. Colonnes `profiles.primary_role` et `profiles.push_enabled` pour les préférences de l'application.

## Règle pour la suite

Ne jamais modifier une migration déjà appliquée : toute évolution est une nouvelle migration numérotée, avec son test dans `tests/`.
