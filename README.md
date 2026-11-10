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

## Variable `EXPO_PUBLIC_DEMO`
En développement (`__DEV__`), ou si `EXPO_PUBLIC_DEMO=1` au moment du build, l'application affiche :
- le sélecteur de profil de démonstration (payeur / prestataire) dans l'onglet Profil ;
- le rappel du code de simulation sur l'écran de saisie du code.

```
EXPO_PUBLIC_DEMO=1 pnpm --filter @diaspay/mobile exec expo export --platform web
```

En dehors de ces cas, le profil de démonstration suit le rôle choisi à l'inscription : payeur → payeur, prestataire → prestataire, demandeur → payeur (en attendant les écrans dédiés).

## Variables d’environnement
| Variable | Rôle | Défaut |
|---|---|---|
| `EXPO_PUBLIC_DEMO` | `1` : affiche le sélecteur de profil et le code OTP de simulation (voir plus haut) | `__DEV__` seulement |
| `EXPO_PUBLIC_DEMO` (strictement `1`) | Lot 3 : boutons « Simuler : valider » et « Simuler : rejeter (motif) » sur un dossier en validation (absents en simple développement) | absent |
| `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` | Probabilité (0 à 1) d’échec simulé de l’envoi d’une pièce, pour tester la reprise | `0` (désactivé) |
| `EXPO_PUBLIC_LINK_BASE` | Hôte (ou URL de base) des DiasPay Links `https://<hôte>/t/<référence>` ; aucun domaine n’est figé dans le code | `links.diaspay.example` (domaine réservé, sans site réel : lien de développement) |

```
EXPO_PUBLIC_LINK_BASE=liens.mondomaine.org pnpm --filter @diaspay/mobile start
```

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

Les deux appareils ont chacun leur propre jeu de données simulé : pour que l’étape 3 trouve la tranche payée, il faut que le téléphone ait lui aussi payé la tranche 2 (profil payeur, puis profil prestataire), car le mock vit dans l’application et non sur un serveur partagé. Le serveur (lot 4) supprimera cette contrainte.

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

**Démonstration** (build avec `EXPO_PUBLIC_DEMO=1`) : créer un besoin de santé daté de cette semaine, le soumettre, ouvrir le dossier « En validation », « Simuler : valider » → la tranche passe « À payer » et le parcours de paiement et d’eQR du lot 2 s’enchaîne. Pour le rejet : « Simuler : rejeter (motif) », puis « Corriger » et « Soumettre le dossier ». Les dossiers soumis vivent dans la simulation en mémoire (perdus au redémarrage) ; seuls les brouillons sont persistés.

## Écrans livrés
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
- `packages/domain` : codec eQR. `packages/api-client` : jetons, `resolveReference`, `confirmByReference` (chaque erreur, usage unique) et parcours complet payer → jeton → confirmer.

## À venir
Authentification réelle (Supabase Auth), stockage réel des pièces et code de secours (lot 4), jalons et preuves pour Agro, Immobilier et Terrain (vague 2), photo de profil, dépôt de preuve, reçu, notifications, back-office (lot 5).

## Règle d'or
Tout changement de statut passe par les fonctions de `@diaspay/domain`. Le serveur (SQL puis TrustEngine) applique les mêmes règles.
