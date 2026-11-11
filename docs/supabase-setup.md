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
| Numéros de test | les six numéros ci-dessous, code `123456` | `sms_test_otp` (`33639980001=123456,…`) |
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

`supabase/seed.sql` crée les comptes de plateforme comme le fait l’authentification (utilisateur et identité « phone ») puis attribue leur rôle ; il refuse de s’exécuter si `app_config.mock_mode` n’est pas `'true'`. Point d’attention constaté sur le projet réel : les colonnes de jetons de `auth.users` doivent valoir `''` et non `NULL`, sinon la connexion échoue (« Database error finding user »).

## 6. Vérifier

```
scripts/db.sh test
```

Résultat attendu : `RESULTAT : 67 vérifications, toutes réussies` pour `00_smoke.sql` (et chaque fichier de test suivant entièrement réussi). Les scripts de test s’exécutent dans une transaction annulée (`ROLLBACK`) ; ils créent des utilisateurs fictifs : jamais sur la production.
