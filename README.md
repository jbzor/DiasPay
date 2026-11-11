# DiasPay & DiasPayQR

Monorepo pnpm + Turborepo.

- `packages/domain` : types, règles de déblocage, plan de tranches, machines d'états (transaction et tranche). Miroir du schéma SQL v0.2.
- `packages/ui-tokens` : charte validée (couleurs, points de statut, espacements, contrastes testés).
- `packages/api-client` : contrats `TransactionApi` et `AuthApi`, implémentations simulées `MockApi` (données de démonstration, minuteur de déblocage automatique) et `MockAuth` (connexion par code OTP). Le TrustEngine et Supabase Auth les remplaceront derrière les mêmes interfaces.
- `apps/mobile` : application Expo (SDK 58, Expo Router, TypeScript). Aperçu web inclus.

## Démarrer
```
pnpm install
pnpm -r test
pnpm --filter @diaspay/mobile typecheck
pnpm --filter @diaspay/mobile start     # puis i (iOS), a (Android) ou w (web), ou scanner le QR avec Expo Go
pnpm --filter @diaspay/mobile ios       # ouvre directement le simulateur iOS
pnpm --filter @diaspay/mobile exec expo export --platform web
```

## Parcours de démarrage (lot 1)
| Situation | Parcours |
|---|---|
| Première ouverture | Lancement → présentation (3 pages) → connexion → code → profil → biométrie → accueil |
| Présentation déjà vue, pas de session | Lancement → connexion |
| Session avec profil | Lancement → accueil |
| Session sans profil (abandon en cours) | Lancement → profil → biométrie → accueil |

- **Code OTP de simulation : `123456`** (constante `MOCK_OTP_CODE`, désactivable avec `new MockAuth({ code: null })`). Le code expire après 5 minutes, le renvoi est possible au bout de 60 secondes, trois codes erronés bloquent le numéro 15 minutes.
- La session, la langue et le drapeau « présentation vue » sont enregistrés avec `expo-secure-store` sur iOS et Android. Sur le web, ils sont gardés en mémoire : un rechargement de la page repart de la présentation.
- Les onglets et les écrans de transaction sont protégés (`Stack.Protected`) : un utilisateur déconnecté est renvoyé au lancement, y compris par lien profond.
- La langue choisie sur le lancement, la connexion ou le profil s'applique à tous les écrans et survit au redémarrage.

## Mode démonstration (`EXPO_PUBLIC_DEMO`)
- En développement (`__DEV__`) ou avec `EXPO_PUBLIC_DEMO=1` : rappel du code OTP de simulation sur l’écran de saisie du code.
- Avec `EXPO_PUBLIC_DEMO=1` seulement : en bas de l’onglet Profil, sélecteur de profil de démonstration (payeur / prestataire) et bouton **« Réinitialiser les données de démonstration »** ; boutons « Simuler : valider / rejeter » sur un dossier en validation ; « Simuler : remettre au prestataire / rembourser le payeur » sur un litige en cours.
- **Garde de production** : un build de production (`!__DEV__`) avec `EXPO_PUBLIC_DEMO=1` affiche un écran bloquant « Build non conforme » et journalise l’anomalie. Un build interne de démonstration ou de captures le déclare explicitement avec `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1` (jamais pour les stores : voir `docs/release-checklist.md`).

```
EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1 pnpm --filter @diaspay/mobile exec expo export --platform web
```

**Réinitialisation** : « Réinitialiser les données de démonstration » remplace transactions, alertes, journal, litiges et brouillons par le jeu initial et efface l’instantané enregistré.

En dehors de ces cas, le profil de démonstration suit le rôle choisi à l'inscription : payeur → payeur, prestataire → prestataire, demandeur → payeur (en attendant les écrans dédiés).

## Variables d’environnement
| Variable | Rôle | Défaut |
|---|---|---|
| `EXPO_PUBLIC_API` | `mock` : simulateur sur l’appareil ; `supabase` : projet Supabase (lot 4) | `mock` |
| `EXPO_PUBLIC_SUPABASE_URL` | URL du projet Supabase (mode `supabase`) | vide |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Clé **publique** du projet (`sb_publishable_…`). Jamais la clé `service_role` : l’application la refuse | vide |
| `EXPO_PUBLIC_DEMO` | `1` : outils de démonstration (voir « Mode démonstration ») ; le rappel du code OTP s’affiche aussi en développement | absent |
| `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` | `1` : autorise le mode démonstration dans un build de production interne (démonstration, captures). Jamais pour les stores | absent |
| `EXPO_PUBLIC_HELP_URL` | Adresse du centre d’aide (Profil › Centre d’aide) ; vide → « Bientôt disponible » | vide |
| `EXPO_PUBLIC_TERMS_URL` | Adresse des conditions et de la confidentialité (Profil) ; vide → « Bientôt disponible » | vide |
| `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` | Probabilité (0 à 1) d’échec simulé de l’envoi d’une pièce, pour tester la reprise | `0` (désactivé) |
| `EXPO_PUBLIC_LINK_BASE` | Hôte (ou URL de base) des DiasPay Links `https://<hôte>/t/<référence>` ; aucun domaine n’est figé dans le code | `links.diaspay.example` (domaine réservé, sans site réel : lien de développement) |

```
EXPO_PUBLIC_LINK_BASE=liens.mondomaine.org pnpm --filter @diaspay/mobile start
```

## Serveur Supabase (lot 4)

Mise en place complète : `docs/supabase-setup.md`. Codes d’erreur : `docs/error-codes.md`. Contrôles avant publication : `docs/release-checklist.md`.

- **Choix à la racine** : `EXPO_PUBLIC_API=supabase` dans `apps/mobile/.env.local` (copier `.env.example`). Les écrans ne connaissent que `TransactionApi` / `AuthApi` ; supabase-js n’est importé que dans `packages/api-client/src/supabase/`.
- **Serveur** : migrations `supabase/migrations/0001` à `0005` ; 0005 ajoute codes d’erreur stables, brouillons serveur (`save_draft`), invitations, prestataires, limites des pièces, notifications, reçu, litige, démonstration (`mock_mode` seulement) et pg_cron.
- **Authentification** : SMS (code de 6 chiffres, 300 s). Session chiffrée sur l’appareil (clé AES dans SecureStore, session chiffrée dans AsyncStorage). Supabase ne verrouille pas après 3 codes erronés : décision D5.
- **Données** : crochets react-query (`apps/mobile/src/state/queries.ts`) communs au simulateur et à Supabase ; temps réel (Realtime, RLS) qui invalide les requêtes ; cache conservé hors connexion avec bandeau « Hors connexion » ; brouillons tamponnés sur l’appareil et synchronisés à chaque étape.
- **Pièces** : bucket privé `dossiers`, chemin `<tx>/<type>/<uuid>.<ext>`, envoi par URL signée avec progression, consultation par URL signée de 60 s.
- **Types** : `pnpm db:types` régénère `packages/api-client/src/supabase/database.types.ts` (jamais édité à la main).

```
pnpm db:test           # tests SQL sur le projet lié (00_smoke, 01_lot4)
pnpm test:supabase     # suite de contrat contre le simulateur et le projet Supabase de développement
```

## Bureau de contrôle (lot 5)

Application web Next.js 16 dans `apps/web`, pour les validateurs et les administrateurs. Elle s’appuie sur le même projet Supabase, avec la migration `0006_lot5.sql`. Ses quatre écrans :

- Dossiers à valider (double validation, case « J’ai vérifié que le montant correspond aux pièces », motif obligatoire au rejet) ;
- Preuves de jalons ;
- Litiges (administrateurs) ;
- Journal d’audit (chaîne vérifiée, export CSV).

Connexion par e-mail et mot de passe, avec un second facteur TOTP exigé en production (D7).

```bash
cp apps/web/.env.example apps/web/.env.local     # URL et clé publique du projet
pnpm --filter @diaspay/web dev                   # http://localhost:3000
```

Variables, comptes du personnel, second facteur, déploiement Vercel, rotation des clés et tests Playwright : voir [`docs/backoffice.md`](docs/backoffice.md). Décisions D6 à D8 : [`docs/decisions.md`](docs/decisions.md).

## TrustToken, eQR et scan (lot 2)
**Format de l’eQR** : `DPQ1:<référence>:<kid>:<signature>`, et rien d’autre (ni montant, ni nom, ni objectif).
- `référence` : 18 caractères hexadécimaux, insensibles à la casse (affichée `4F9A-2C71-B8E0-1D3C-A9`) ;
- `kid` : identifiant de clé, `SIMULATED` en simulation ;
- `signature` : texte sans `:` ; `SIMULATED.<hex>` en simulation (la vraie signature Ed25519 et la vérification hors ligne viennent à la vague 2).

Le codec (`encodeEqr`, `decodeEqr`, `formatReference`, `normalizeReference`, `parseDeepLink`) est dans `packages/domain/src/eqr.ts`. Le QR est dessiné en noir sur blanc quel que soit le thème, correction d’erreur M, marge de silence de 4 modules. Il est calculé avec `qrcode-generator` (JavaScript pur) et dessiné avec `react-native-svg`.

**Jeton** : une tranche qui n’est plus « prévue » a un jeton, valable 7 jours (`TOKEN_VALIDITY_HOURS`, configurable dans `MockApi`), à usage unique. Erreurs de `confirmByReference` : `UNKNOWN_REFERENCE`, `NOT_A_PARTY`, `PROVIDER_ONLY`, `TOKEN_USED`, `DEVICE_TIME_INVALID` (heure de l’appareil à plus de 5 minutes dans le futur), `TOKEN_EXPIRED`, `NOT_PAID`, `WRONG_MODE`.

**Liens profonds** : `diaspay://t/<référence>` et `https://<hôte>/t/<référence>`.
| Utilisateur | État de la tranche | Destination |
|---|---|---|
| Payeur | À payer | Écran de paiement |
| Prestataire | Payée et verrouillée | Onglet Scanner, feuille de confirmation |
| Partie à la transaction | Autre état | Détail de la transaction, avec un message d’état |
| Non connecté | — | Connexion ; le lien est mémorisé puis rejoué après l’authentification (en mémoire : perdu si l’application est fermée en cours d’inscription) |
| Référence inconnue, expirée ou hors transaction | — | Écran d’information avec retour à l’accueil |

**Liens universels (iOS) et App Links (Android) : à faire au lot de production.** Rien n’est configuré ni inventé ici : seul le schéma `diaspay://` fonctionne. Il faudra : choisir et réserver le domaine ; publier `/.well-known/apple-app-site-association` (identifiant d’équipe Apple et `com.diaspay.app`, chemin `/t/*`) et `/.well-known/assetlinks.json` (empreinte SHA-256 du certificat de signature de `com.diaspay.app`) ; déclarer `ios.associatedDomains` et les `android.intentFilters` (avec `autoVerify`) dans `app.json` ; renseigner `EXPO_PUBLIC_LINK_BASE`.

**Caméra** : sur le web, le scan par caméra n’est pas proposé (saisie manuelle de la référence seulement). Si l’autorisation est refusée, un écran l’explique et renvoie aux réglages ; la saisie manuelle reste toujours disponible.

### Parcours de démonstration
1. Ordinateur : `pnpm --filter @diaspay/mobile start`, touche `w`. Profil payeur, Transactions → Scolarité, tranche 2 « Afficher le QR ».
2. Payer la tranche (« Payer »), puis revenir sur « Afficher le QR » : le statut est « Payée ».
3. Téléphone (Expo Go) : profil prestataire (Profil → profil de démonstration), onglet Scanner, viser le QR affiché à l’écran de l’ordinateur.
4. « Confirmer la prestation » : la tranche passe à « Confirmée » avec son délai de contestation. Un second scan du même QR est refusé (« déjà utilisé »).

Les deux appareils ont chacun leur propre jeu de données simulé : pour que l’étape 3 trouve la tranche payée, il faut que le téléphone ait lui aussi payé la tranche 2 (profil payeur, puis profil prestataire), car le mock vit dans l’application et non sur un serveur partagé. En mode `EXPO_PUBLIC_API=supabase` (lot 4), les deux téléphones partagent le même serveur : la contrainte disparaît.

## Création d’un besoin (lot 3)
**Parcours** : Accueil → « Nouveau besoin » (payeur ou demandeur ; caché pour un prestataire) → six étapes, chacune bloquée tant qu’elle est invalide :
1. **Type** : Scolarité, Santé, Loyer (vague 1). Agro, Immobilier et Terrain sont visibles mais « Bientôt disponible ».
2. **Détails** : montant (séparateurs selon la langue ; FCFA sans décimale, EUR et USD 2 au plus), devise, objectif (3 à 500 caractères), bénéficiaire, date souhaitée (facultative, pas dans le passé). Un **demandeur** indique aussi le **téléphone du payeur** (ajout absent de la maquette G2, à valider par le client).
3. **Prestataire** : recherche (insensible à la casse et aux accents) parmi les prestataires vérifiés de la verticale, ou invitation par téléphone.
4. **Plan de paiement** : unique, partiel (acompte et solde, au moins 2 tranches), échelonné (2 à 12 tranches, montants égaux, reste sur la dernière), récurrent (hebdomadaire, mensuel ou trimestriel, 2 à 60 échéances). La somme est contrôlée à l’écran et par le serveur simulé.
5. **Justificatifs** : appareil photo, galerie ou document ; JPG, PNG ou PDF, 10 Mo maximum ; images compressées (côté long 2000 px, JPEG 0,8) ; progression, reprise après échec, suppression.
6. **Récapitulatif** : règle de déblocage en clair, « Soumettre le dossier » ou « Enregistrer le brouillon ».

**Brouillons** : enregistrés automatiquement (500 ms après chaque saisie, immédiatement à chaque changement d’étape) avec AsyncStorage, y compris sur le web. Ils apparaissent en tête de « Transactions » (« Brouillon », étape atteinte), se rouvrent à la dernière étape et se suppriment après confirmation. Un brouillon appartient à l’utilisateur connecté. Une pièce dont le fichier local a disparu au rechargement est marquée « à rajouter ».

**Suivi** : un dossier soumis passe « En validation » (non modifiable). Rejeté, il affiche son motif et un bouton « Corriger » qui le rouvre en brouillon (RG : `REJECTED → DRAFT`), puis se soumet à nouveau. Validé, il émet son jeton et active la première tranche si son échéance tombe dans les 7 jours (RG-12), sinon elle reste « Prévue ». Les événements « dossier validé » et « dossier rejeté » sont préparés dans le simulateur (`MockApi.listEvents()`) pour les alertes du lot suivant.

**Pièces requises — à confirmer avec le client** (`packages/domain/src/documents.ts`, marquées `À CONFIRMER`) :

| Verticale | Obligatoire | Facultatif |
|---|---|---|
| Santé | Devis ou facture proforma ; pièce d’identité du bénéficiaire | Certificat médical |
| Scolarité | Attestation d’inscription | Échéancier de l’école |
| Loyer | Bail | Dernière quittance |
| Agro, Immobilier, Terrain | Pièce justificative (provisoire, vague 2) | — |

**Démonstration** (build avec `EXPO_PUBLIC_DEMO=1`) : créer un besoin de santé daté de cette semaine, le soumettre, ouvrir le dossier « En validation », « Simuler : valider » → la tranche passe « À payer » et le parcours de paiement et d’eQR du lot 2 s’enchaîne. Pour le rejet : « Simuler : rejeter (motif) », puis « Corriger » et « Soumettre le dossier ». Depuis le lot 3 bis, les dossiers soumis et leur historique survivent au redémarrage (voir plus bas).

## Lot 3 bis : décisions, alertes, litiges, reçus
- **Décisions** : `docs/decisions.md` (D1 téléphone du payeur, D2 pièces requises et jusqu’à 3 fichiers par pièce, D3 textes d’aide du plan, D4 abandon d’un dossier). Liste de contrôle avant publication : `docs/release-checklist.md`.
- **Abandon (D4)** : un dossier rejeté se corrige ou s’abandonne (`CANCELLED`, visible sous « Clôturées » avec le libellé « Abandonné », journal conservé). Un brouillon jamais soumis se supprime ; une correction ou un dossier soumis, non.
- **Alertes** : chaque étape (validation, rejet, paiement prêt, confirmation, déblocage, litige ouvert ou résolu) crée une alerte et une ligne du journal. L’alerte stocke l’événement, pas un texte : changer de langue traduit les alertes déjà reçues.
- **Journal d’audit chaîné** : SHA-256 (`@noble/hashes`), une chaîne par transaction (`packages/domain/src/audit.ts`, format documenté dans le fichier). Le reçu affiche « Journal d’audit vérifié » seulement si la chaîne se vérifie réellement.
- **Reçu** : « Exporter en PDF » génère le PDF depuis un modèle HTML aux couleurs de la charte (`expo-print`) puis le partage (`expo-sharing`). Sur le web, le reçu s’ouvre dans un onglet et la boîte d’impression du navigateur propose « Enregistrer en PDF ».
- **Persistance de la simulation** : transactions, alertes, journal et litiges sont enregistrés (AsyncStorage, anti-rebond de 500 ms) dans un instantané versionné, rechargé au démarrage ; un instantané d’une autre version est ignoré.
- **Photos** : toute image est réencodée avant l’envoi (redessinée dans un nouveau fichier), ce qui retire ses métadonnées EXIF, dont les coordonnées GPS. Vérifié sur l’export web ; à vérifier sur téléphone (voir `docs/release-checklist.md`).
- **Conformité au design** : `docs/design-conformity.md` et `pnpm capture` (captures de tous les écrans mobiles dans `docs/captures/`).

## Police
**Inter** (graisses 400, 500, 600, 700), chargée avec `expo-font` depuis `@expo-google-fonts/inter` ; l’écran de lancement reste affiché tant qu’elle n’est pas prête. Licence : **SIL Open Font License 1.1** (copyright The Inter Project Authors), compatible avec une application commerciale ; le paquet `@expo-google-fonts/inter` est sous licence MIT. Le texte de la licence est fourni dans `node_modules/@expo-google-fonts/inter/LICENSE_FONT`. Sur Android 9 et antérieur, seule la graisse normale est chargée (limite de la plateforme).

## Écrans livrés
- **Lot 3 bis** : Alertes (liste groupée par jour et état vide), Profil, Sécurité, Suivi de litige (en cours et résolu), Reçu (PDF et partage), modification du profil ; écrans des lots 1 à 3 alignés sur la maquette v5.
- **Lot 3** : assistant « Nouveau besoin » en six étapes, brouillons, confirmation d’envoi, suivi du dossier (examen, rejet et correction), revue simulée.
- **Lot 2** : écran TrustToken (eQR, DiasPay Link, partage, copie, enregistrement de l’image), scan par caméra avec feuille de confirmation, liens profonds.
- **Lot 1** : lancement, présentation (3 pages), connexion par téléphone, code OTP, profil initial, activation de la biométrie, déconnexion. Refonte visuelle : listes à filets, libellés de statut à point, contrôle segmenté.
- **v0.1** : accueil, transactions (filtres), détail avec tranches, paiement (biométrie si disponible), litige, confirmation prestataire (saisie de la référence), profil (langue FR/EN), alertes (vide).

## Tests
- `packages/domain` : règles et machines d'états.
- `packages/api-client` : `MockApi`, `MockAuth` (numéro invalide, bon et mauvais code, verrouillage puis déverrouillage, expiration, renvoi trop tôt, profil, biométrie, déconnexion).
- `packages/ui-tokens` : contraste WCAG de chaque paire texte/fond.
- `apps/mobile` : parité des dictionnaires FR/EN (mêmes clés, aucune valeur vide, aucune apostrophe droite, messages d’erreur du scan), minuteur `m:ss`, numéro, initiales, saisie du code, orientation au démarrage, machine d’états du scan (anti-rebond, chaque erreur, succès), décompte d’expiration, matrice du QR, destination des liens profonds.
- Lot 3 : `packages/domain` (schémas par étape, montants, plans et fins de mois, pièces requises, limites de fichier, RG-12), `packages/api-client` (prestataires, brouillons par utilisateur, envoi de pièces, soumission et chaque erreur, revue simulée, correction et nouvelle soumission), `apps/mobile` (réducteur de l’assistant, reprise, sauvegarde différée, pièces au rechargement).
- Lot 3 bis : `packages/domain` (statut `CANCELLED`, 3 fichiers par pièce, journal chaîné : chaîne valide, ligne modifiée, ligne supprimée, chaîne vide ; décision de litige), `packages/api-client` (alertes par événement, litiges, reçus, abandon, suppression, pièces multiples, persistance et instantané périmé, préférences, parcours complet avec reçu valide puis falsification détectée), `apps/mobile` (regroupement des alertes, libellés et parité, état du litige, formateur et modèle du reçu, garde de production).
- Lot 4 : `packages/domain` (table des codes d’erreur confrontée au SQL, au code et à la documentation ; litige réservé à l’administrateur), `packages/api-client` (conversion des lignes et des erreurs, codes OTP de Supabase, refus de la clé de service, **suite de contrat** commune au simulateur et à Supabase), `apps/mobile` (une traduction par code d’erreur, fusion des brouillons locaux et serveur), `supabase/tests` (00_smoke : 67 vérifications, 01_lot4 : 117).
- Lot 5 :
  - `packages/domain` : règles de décision du bureau, miroir de `decide_tx` (case du montant, motif).
  - `packages/ui-tokens` : contraste des couleurs du bureau.
  - `apps/web` :
    - tests unitaires : règles d’accès, en-têtes de sécurité, charte générée sans couleur recopiée, dictionnaire (apostrophes, table des erreurs affichées), durées relatives, montants, empreintes abrégées, CSV, libellés du journal, aucune clé secrète dans la construction ;
    - tests Playwright : connexion, second facteur, validation simple et double, rejet, doublon, pièce journalisée, preuves, litiges, journal, export, clavier, en-têtes.
  - `supabase/tests` : `02_lot5`, 132 vérifications. Variantes pour l’éditeur SQL : `*_editor.sql`.
- `packages/domain` : codec eQR. `packages/api-client` : jetons, `resolveReference`, `confirmByReference` (chaque erreur, usage unique) et parcours complet payer → jeton → confirmer.

## À venir
Code de secours, confirmation hors connexion, verrouillage OTP côté serveur (D5), jalons et preuves pour Agro, Immobilier et Terrain (vague 2), photo de profil, dépôt de preuve, ajout de pièces à un litige, vraies notifications push, back-office (lot 5).

## Règle d'or
Tout changement de statut passe par les fonctions de `@diaspay/domain`. Le serveur (SQL puis TrustEngine) applique les mêmes règles.
