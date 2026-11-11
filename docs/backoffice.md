# Bureau de contrôle (back-office web)

Application Next.js 16 (App Router, TypeScript strict) dans `apps/web`, utilisée par les **validateurs** et les **administrateurs**, au-dessus du même projet Supabase que l’application mobile. Elle couvre quatre écrans :

- Dossiers à valider (BO1)
- Preuves de jalons (BO6)
- Litiges (BO7, réservé aux administrateurs)
- Journal d’audit (BO5)

Toutes les requêtes partent avec le jeton de l’utilisateur connecté. La sécurité repose sur la RLS et sur les fonctions SQL de la migration `0006_lot5.sql`, jamais sur l’interface.

## Commandes

```bash
pnpm --filter @diaspay/web dev            # http://localhost:3000
pnpm --filter @diaspay/web build          # next build (vérifie aussi le typage)
pnpm --filter @diaspay/web start          # sert la construction
pnpm --filter @diaspay/web test           # tests unitaires (vitest)
pnpm --filter @diaspay/web typecheck
pnpm --filter @diaspay/web e2e            # Playwright, contre le projet de développement (voir plus bas)
```

## Variables d’environnement

Fichier `apps/web/.env.local` (jamais versionné ; modèle : `apps/web/.env.example`).

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet, par exemple `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé **publique** (`sb_publishable_…` ou clé `anon`). Une clé de service est refusée au démarrage (`assertPublicKey`). |

**Aucune clé `service_role`** dans le navigateur, le dépôt ou une variable `NEXT_PUBLIC_*`. Le bureau de contrôle n’en a pas besoin : il n’en utilise aucune, même côté serveur.

Pour les tests de bout en bout, le fichier `.env.local` **à la racine** contient aussi :
- `E2E_STAFF_PASSWORD` : mot de passe des comptes du personnel de test, 12 caractères minimum ;
- les accès à la base déjà utilisés par `scripts/db.sh`.

## Sécurité

Le proxy (`apps/web/src/proxy.ts`, nouveau nom du « middleware » depuis Next.js 16) traite chaque navigation :

- **CSP stricte**, avec un nonce par requête : aucun script ni style en ligne autorisé en production. Les connexions sont limitées au projet Supabase (`https` et `wss`), et `frame-ancestors 'none'` empêche tout affichage dans un cadre.
- **Session `@supabase/ssr`** rafraîchie à chaque navigation. L’identité est vérifiée par `getClaims()`.
- **Règles d’accès** (`apps/web/src/lib/access.ts`) :
  - aucune session : renvoi à `/connexion` ;
  - rôle de plateforme autre que `VALIDATOR` ou `ADMIN` : `/acces-refuse` ;
  - second facteur exigé mais non validé (jeton `aal1`) : `/connexion/second-facteur` ;
  - un validateur qui ouvre `/litiges` est refusé.

En-têtes fixes, posés sur toutes les réponses par `next.config.ts` :
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- `Strict-Transport-Security`

Tests associés :
- `apps/web/test/security.test.ts` et `e2e/security.spec.ts`, ce dernier contre la construction réelle et sans aucune violation de CSP ;
- `apps/web/test/build-secrets.test.ts`, qui vérifie qu’aucune clé secrète ne figure dans `.next/static`.

La base applique les mêmes refus, indépendamment de l’interface :
- `is_validator()` et `is_admin()` exigent `aal2` quand le second facteur est requis ;
- les vues `bo_*` sont vides pour tout autre compte ;
- les décisions se font par fonctions SQL.

Une pièce n’est lisible dans le stockage qu’après une consultation journalisée (`open_document`), pendant 2 minutes : le temps de créer une URL signée de 60 secondes.

## Créer un compte du personnel (décision D7)

Il n’y a pas d’inscription au bureau de contrôle : un administrateur crée chaque compte, nominatif.

1. Tableau de bord Supabase : **Authentication → Users → Add user → Create new user**.
   - Saisir l’adresse e-mail professionnelle et un mot de passe provisoire d’au moins 12 caractères.
   - Cocher « Auto Confirm User ».
   - Ou bien utiliser « Send invitation » : la personne choisit elle-même son mot de passe.
2. Attribuer le rôle de plateforme, dans l’éditeur SQL. Le rôle ne peut pas être modifié par l’utilisateur lui-même (déclencheur `guard_profile`).
   ```sql
   update profiles set full_name = 'Prénom Nom', platform_role = 'VALIDATOR'   -- ou 'ADMIN'
   where id = (select id from auth.users where email = 'prenom.nom@exemple.org');
   select p.full_name, p.platform_role from profiles p join auth.users u on u.id = p.id where u.email = 'prenom.nom@exemple.org';
   ```
3. Transmettre l’adresse du bureau de contrôle. À la première connexion, la personne inscrit son second facteur (voir la section suivante).
4. Retrait d’un accès :
   ```sql
   update profiles set platform_role = 'USER' where id = (select id from auth.users where email = '…');
   ```
   Puis, dans le tableau de bord : **Users → … → Delete user**, ou au minimum **Log out user**.

Une personne du personnel ne doit jamais être partie à un dossier qu’elle traite. La base l’en empêche de toute façon (RG-03 et RG-09).

## Second facteur (TOTP)

- **Supabase** : Authentication → Multi-Factor (ou Management API) : « TOTP » activé en inscription et en vérification. C’est le réglage par défaut, vérifié sur le projet de développement (`mfa_totp_enroll_enabled = true`, `mfa_totp_verify_enabled = true`).
- **Exigence** : `app_config.require_staff_mfa`.
  - `'false'` en développement.
  - **`'true'` en production** :
    ```sql
    insert into app_config(key, value) values ('require_staff_mfa', 'true') on conflict (key) do update set value = 'true';
    ```
  - Avec `'true'`, un jeton sans second facteur n’ouvre aucun droit du personnel, ni par l’interface ni par l’API.
- **Première connexion** : l’écran « Activer le second facteur » affiche un QR code, fourni par Supabase Auth sous forme d’image SVG, et la clé en clair. La personne la scanne avec Google Authenticator, Microsoft Authenticator, 1Password, etc., puis saisit un premier code.
- **Connexions suivantes** : mot de passe, puis code à 6 chiffres. Quiconque a inscrit un facteur doit le présenter, même quand l’exigence est désactivée.
- **Téléphone perdu** : un administrateur supprime le facteur dans le tableau de bord (Users → l’utilisateur → Factors → Delete). La personne en inscrit un nouveau à la connexion suivante.

## Déploiement sur Vercel

1. **Projet** : importer le dépôt dans Vercel.
   - **Root Directory** : `apps/web` (Vercel détecte pnpm et le monorepo).
   - **Framework** : Next.js.
   - **Build Command** : `pnpm --filter @diaspay/web build`, ou laisser la valeur par défaut depuis `apps/web`.
   - **Install Command** : `pnpm install --frozen-lockfile`.
   - **Node.js** : 22 ou plus (supabase-js 2.119 exige Node 22).
2. **Variables** (Settings → Environment Variables) : seulement `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - En production, ce sont celles du projet Supabase de production.
   - Les environnements *Preview* pointent vers le projet de développement, jamais vers la production.
3. **Domaine** : **à définir**, par exemple `controle.<domaine DiasPay>`, avec HTTPS imposé (HSTS déjà posé).
   - L’ajouter dans Supabase : Authentication → URL Configuration, dans **Site URL** et **Redirect URLs** (`https://<domaine>/auth/confirm`), pour les liens de réinitialisation du mot de passe.
4. **Protection** recommandée : *Vercel Authentication* ou une liste d’adresses IP autorisées sur les environnements *Preview*.
5. **Après le déploiement** :
   - vérifier les en-têtes (`curl -sI https://<domaine>/connexion`) ;
   - se connecter avec un compte du personnel ;
   - vérifier l’exigence du second facteur.

## Rotation des clés

| Secret | Où | Procédure |
|---|---|---|
| Clé publique (`sb_publishable_…`) | Vercel, `apps/web/.env.local`, application mobile | Supabase → Project Settings → API Keys → créer une nouvelle clé publique. La mettre dans Vercel, puis redéployer. Mettre à jour l’application mobile (nouvelle version). Désactiver l’ancienne clé une fois les deux déployés. |
| Clé secrète ou `service_role` | Nulle part dans le bureau de contrôle ni dans l’application | Si elle a fui : régénérer immédiatement (API Keys → Secret keys, ou JWT secret en mode historique), puis vérifier les journaux d’accès. |
| Mot de passe de la base (`SUPABASE_DB_PASSWORD`) | `.env.local` à la racine (outils de développement) | Project Settings → Database → Reset database password, puis mettre à jour `.env.local`. |
| Jeton d’accès personnel (`SUPABASE_ACCESS_TOKEN`) | `.env.local` à la racine | Account → Access Tokens : révoquer, en créer un nouveau. |
| Mots de passe du personnel | Personnes | Réinitialisation par « Mot de passe oublié », ou par l’administrateur (Users → Send password recovery). |
| `E2E_STAFF_PASSWORD` | `.env.local` à la racine (développement) | Changer la valeur, puis `scripts/db.sh seed-staff` (met à jour les comptes de test). |

Fréquence recommandée : à chaque départ d’une personne ayant eu accès aux secrets, et au minimum une fois par an.

## Tests de bout en bout (Playwright)

**Prérequis**, sur le projet de **développement** :
- `mock_mode = 'true'` et `require_staff_mfa = 'false'` ;
- `scripts/db.sh seed` (validateurs de démonstration, prestataires, `auto_issue_token`) ;
- `scripts/db.sh seed-staff` (comptes du personnel de test) ;
- Chrome installé (canal `chrome`).

```bash
pnpm --filter @diaspay/web build
pnpm --filter @diaspay/web e2e
```

Comptes de test (`supabase/seed-staff.sql`, mot de passe `E2E_STAFF_PASSWORD`) :

| Compte | Rôle |
|---|---|
| `validateur.a@diaspay.test` | Validateur |
| `validateur.b@diaspay.test` | Validateur |
| `administrateur@diaspay.test` | Administrateur |
| `validateur.partie@diaspay.test` | Validateur, aussi payeur de dossiers de test (+33 6 39 98 00 14) |
| `utilisateur@diaspay.test` | Utilisateur ordinaire |

Les dossiers sont créés comme par l’application mobile, avec les numéros réservés aux tests (+33 6 39 98 00 11 à 13, code 123456), puis supprimés par `demo_reset`.

Pendant quelques secondes, le test du second facteur passe `require_staff_mfa` à `'true'` sur le projet de développement. Il remet toujours la valeur à `'false'`, même en cas d’échec. Ne pas lancer la suite pendant une démonstration sur ce projet.

## Écarts avec la maquette

- **D6** : la maquette range « Montant cohérent avec la promesse » parmi les contrôles automatiques. C’est un contrôle humain : case « J’ai vérifié que le montant correspond aux pièces », obligatoire avant d’approuver.
- **Preuves** : la maquette affiche « Pièce lisible » en contrôle automatique. La lisibilité n’est pas calculable : le contrôle automatique est « Preuve déposée ». Le décompte « page 1 sur 4 » d’un PDF n’est pas affiché, car l’aperçu utilise le lecteur PDF du navigateur.
- **Filtres** : verticale, statut, recherche et tri par ancienneté sur l’écran des dossiers ; filtre « Ouverts / Résolus » sur l’écran des litiges. La maquette ne les montre pas : ils sont demandés par le cahier.
- **Libellés des contrôles** selon le résultat : « Pièces complètes » ou « Pièces obligatoires manquantes », « Doublon possible à vérifier » ou « Aucun doublon ».
- **Acteurs du journal** : le rôle suit chaque nom, par exemple « Validateur A (validateur) ». La maquette n’affiche pas le rôle du personnel.
