# Liste de contrôle avant publication

À dérouler pour chaque build destiné aux stores (App Store, Google Play) ou à la production web.

1. **Le mode démonstration est désactivé.** `EXPO_PUBLIC_DEMO` et `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` ne sont pas définis dans l’environnement du build. Contrôle automatique : un build de production (`!__DEV__`) avec `EXPO_PUBLIC_DEMO=1` affiche un écran bloquant « Build non conforme » et journalise l’anomalie (`apps/mobile/src/lib/releaseGuard.ts`). `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1` ne sert qu’aux builds internes de démonstration et aux captures de conformité.
2. `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` n’est pas défini (pas d’échec d’envoi simulé).
3. `EXPO_PUBLIC_LINK_BASE` désigne le domaine réservé des DiasPay Links, et les fichiers `apple-app-site-association` et `assetlinks.json` sont publiés (voir README, lot 2).
4. `EXPO_PUBLIC_HELP_URL` et `EXPO_PUBLIC_TERMS_URL` pointent vers les pages publiées du centre d’aide et des conditions.
5. `pnpm -r test`, `pnpm --filter @diaspay/mobile typecheck` et `pnpm --filter @diaspay/mobile exec expo export --platform web` passent.
6. Le numéro de version (`expo.version` dans `app.json`) a été incrémenté ; l’écran Profil › À propos l’affiche.
7. Une photo envoyée depuis un téléphone réel (localisation activée) ne contient pas de coordonnées GPS (`exiftool -gps:all <fichier>` : aucune ligne).

## Serveur Supabase (lot 4)

8. **Projet de production distinct** du projet de développement. `app_config.mock_mode = 'false'` y est fixé **avant** d’appliquer la migration 0005 :
   ```sql
   insert into app_config(key, value) values ('mock_mode', 'false') on conflict (key) do update set value = 'false';
   select value from app_config where key = 'mock_mode';   -- false
   ```
9. **Aucune fonction `demo_*` exécutable.** 0005 ne les crée que si `mock_mode = 'true'` ; vérification :
   ```sql
   select proname from pg_proc where proname like 'demo\_%';   -- aucune ligne
   ```
   Si une ligne apparaît (projet passé en production après coup), la supprimer : `drop function demo_review(uuid, boolean, text), demo_resolve_dispute(uuid, text, text), demo_reset();`. Même avec `mock_mode = 'false'`, elles répondent `DEMO_DISABLED` ; `simulate_*` aussi.
10. **Aucune clé `service_role`** dans le dépôt, l’application ou une variable `EXPO_PUBLIC_*` : `git grep -nE "service_role|sb_secret_" -- ':!docs' ':!supabase'` ne renvoie que des commentaires ; `EXPO_PUBLIC_SUPABASE_ANON_KEY` est la clé publique (`sb_publishable_…`). L’application refuse au démarrage une clé de service (`assertPublicKey`).
11. **`EXPO_PUBLIC_DEMO` absent** de l’environnement EAS de production ; `EXPO_PUBLIC_API=supabase`.
12. **Migrations rejouées dans l’ordre sur un projet vierge**, test de fumée vert : nouveau projet, `supabase link`, `scripts/db.sh push` (0001 à la dernière), puis `scripts/db.sh test` sur ce projet de **test** (jamais la production : les tests créent des utilisateurs fictifs, dans une transaction annulée). Résultat attendu : chaque fichier « toutes réussies ».
13. **Authentification** : `sms_test_otp` vide (aucun numéro de test), fournisseur SMS réel configuré, `sms_otp_exp = 300`. Ne jamais lancer `supabase config push` depuis `supabase/config.toml` vers la production (il contient les numéros de test).
14. **Seed non exécuté** en production (`supabase/seed.sql` refuse de toute façon si `mock_mode <> 'true'`). Les validateurs et l’administrateur réels reçoivent leur rôle par une requête nominative de l’exploitant.
15. **pg_cron actif** : `select jobname, schedule, active from cron.job;` liste `diaspay-release-due-tranches` (`*/10 * * * *`) et `diaspay-activate-due-tranches` (`0 6 * * *`).
16. **Décision D5** revue (verrouillage après trois codes erronés) : voir `docs/decisions.md`.
