# Liste de contrôle avant publication

À dérouler pour chaque build destiné aux stores (App Store, Google Play) ou à la production web.

1. **Le mode démonstration est désactivé.** `EXPO_PUBLIC_DEMO` et `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` ne sont pas définis dans l’environnement du build. Contrôle automatique : un build de production (`!__DEV__`) avec `EXPO_PUBLIC_DEMO=1` affiche un écran bloquant « Build non conforme » et journalise l’anomalie (`apps/mobile/src/lib/releaseGuard.ts`). `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1` ne sert qu’aux builds internes de démonstration et aux captures de conformité.
2. `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` n’est pas défini (pas d’échec d’envoi simulé).
3. **Aucun lien ouvrable de l’extérieur** (lot X) : `app.json` ne déclare ni `ios.associatedDomains` ni `android.intentFilters` ; aucun fichier `apple-app-site-association` ni `assetlinks.json` n’est publié pour l’application (`pnpm --filter @diaspay/mobile test` vérifie l’absence de route `/t/` et de partage).
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

## Bureau de contrôle (lot 5)

17. **Second facteur exigé** en production : `select value from app_config where key = 'require_staff_mfa';` renvoie `true`. Si ce n’est pas le cas :
    ```sql
    insert into app_config(key, value) values ('require_staff_mfa', 'true') on conflict (key) do update set value = 'true';
    ```
    TOTP doit être activé dans Supabase Auth (inscription et vérification).
18. **Comptes du personnel nominatifs** : aucun compte partagé, aucun compte `@diaspay.test`, `seed-staff.sql` jamais exécuté. Le script refuse de toute façon si `mock_mode <> 'true'`. Vérification :
    ```sql
    select u.email, p.full_name, p.platform_role from profiles p join auth.users u on u.id = p.id where p.platform_role <> 'USER' order by 3, 1;
    ```
    Chaque ligne correspond à une personne identifiée.
19. **Aucune clé `service_role` dans le build web** :
    - Vercel ne définit que `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`, et cette dernière est la clé publique.
    - Après `pnpm --filter @diaspay/web build`, `pnpm --filter @diaspay/web test` inclut le contrôle de `.next/static` : ni `sb_secret_`, ni JWT `service_role`.
20. **Aucun numéro de test actif** en production : `sms_test_otp` vide dans Supabase Auth (voir aussi le point 13). Les numéros +33 6 39 98 00 11 à 14 n’existent que sur le projet de développement.
21. `auto_issue_token` absent ou `'false'` en production : sans `mock_mode`, il est sans effet, et le jeton relève du TrustEngine.
22. **Domaine du bureau de contrôle** déclaré dans Supabase Auth (Site URL et Redirect URLs, `…/auth/confirm`). En-têtes vérifiés : `curl -sI https://<domaine>/connexion` doit montrer la CSP à nonce, `X-Frame-Options: DENY` et `Referrer-Policy: no-referrer`.
23. **`supabase/seed-evidence.sql` jamais exécuté** en production. Il refuse de toute façon si `mock_mode <> 'true'`.
24. **Longueur minimale des mots de passe** : dans Supabase Auth, `password_min_length` est à 12 (6 par défaut). Le bureau de contrôle impose déjà 12 caractères lors d’une réinitialisation.

## Fondations du cahier d’extension (lot X)

25. **Aucun gabarit de notification externe ne contient d’adresse** : `pnpm --filter @diaspay/domain test` (test d’architecture de `notificationTemplates.ts` : ni lien, ni domaine, ni référence, ni chiffre, ni paramètre). Tout envoi SMS, e-mail ou WhatsApp passe par `externalNotification()`, jamais par un texte libre.
26. **`eqr_image_enabled` décidé** par le client et fixé en production :
    ```sql
    select value from app_config where key = 'eqr_image_enabled';   -- 'true' (QR affiché au payeur) ou 'false' (référence seule)
    ```
27. **Limitation des résolutions** : `select value from app_config where key = 'reference_failure_limit';` renvoie `10` ; le personnel surveille `security_events` (`SUSPICIOUS_ACTIVITY`).
28. **`can_initiate_requests`** n’est accordé qu’à des comptes enrôlés par un administrateur (`select count(*) from profiles where can_initiate_requests;`), en attendant la politique d’enrôlement (K3).
29. **Mode `IMMEDIATE` non utilisé** tant que le client n’a pas tranché (K1) : `select vertical from release_rules where release_mode = 'IMMEDIATE';` ne renvoie aucune ligne.
30. **Empreinte des pièces obligatoire** : `select value from app_config where key = 'require_content_hash';` renvoie `true` (toutes les versions de l’application en circulation envoient l’empreinte). Contrôle : `select count(*) from documents where content_hash is null and created_at > now() - interval '30 days';` est nul.
31. **Consultations journalisées** : une partie ne lit un fichier du bucket `dossiers` qu’après `get_document_access` (politique `dossiers_read`) ; `supabase/tests/04_lotx_p2.sql` passe sur l’environnement de recette.
32. **Idempotence et rapprochement testés** sur l’environnement de recette : `supabase/tests/04_lotx_p2.sql` (même clé, événement en double, hors d’ordre, signature invalide, journal équilibré et immuable, remboursement partiel puis total) et `select count(*) from v_reconciliation where cardinality(issues) > 0;` examiné par le personnel (connecté).
33. **`apply_payment_event` réservée au service** : `select has_function_privilege('authenticated', 'apply_payment_event(text, text, boolean, jsonb)', 'execute');` renvoie `false`. La fonction Edge qui reçoit les webhooks de TrustPayWay vérifie leur signature avant de l’appeler.
34. **`demo_settle_payment` et `demo_settle_refund` refusées** en production (`mock_mode = 'false'` : `DEMO_DISABLED`) ; `payment_provider` vaut le partenaire réel.
35. **`platform_review` décidé** pour chaque type de besoin (K2) : `select code, platform_review from request_modules order by display_order;`. Par défaut, `ALWAYS` partout. Un module `NEVER` ou `RISK_BASED` ne dispense jamais de la double validation.
36. **Retour arrière de 0011 décidé** : tant que `supabase/rollbacks/0011_lotx_x6_down.sql` peut servir, garder l’enum `vertical` et les tables `_release_rules_0003`, `_required_documents_0005` ; ne pas ajouter de module en production avant d’y avoir renoncé (le retour arrière refuse un dossier d’un module ajouté).
37. **Un seul payeur partout** tant que la phase 2 n’est pas livrée : `select count(*) from request_modules where multiple_payers;` est nul.

## Noyau v2 (lot X version 2)

38. **Paramètres ouverts résolus ou explicitement acceptés** : chaque ligne de `docs/open-parameters.md` a une valeur fournie, ou une décision écrite d’accepter le comportement prudent (refus, revue, absence d’expiration). En production, `presentation_token_ttl_seconds` n’a pas la valeur de développement sans décision.
39. **Règlement direct par défaut vérifié** : `select code, settlement_mode, platform_review from request_modules order by display_order;` correspond aux décisions K1 et K2 ; `supabase/tests/05_lotx2_p1.sql` passe sur l’environnement de recette.
40. **Aucun ancien statut en base** : `select count(*) from tranches where status::text in ('PLANNED','AWAITING_PAYMENT','PAID_LOCKED','CONFIRMED','RELEASED','EVIDENCE_SUBMITTED','DISPUTED');` est nul (les contraintes l’imposent).

41. **Enrôlement prêt** (X4) : aucune ligne `dev_only` dans `enrolment_limits` (`select count(*) from enrolment_limits where dev_only;` est nul) ; plafonds saisis ou refus prudent accepté par écrit ; `kyc_simulated_result` absent (`select count(*) from app_config where key = 'kyc_simulated_result';` est nul) ; adaptateur KYC réel choisi et branché sur `apply_kyc_result` (rôle service) ; bucket `identity` privé.
