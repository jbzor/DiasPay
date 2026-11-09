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

## Écrans livrés
- **Lot 2** : écran TrustToken (eQR, DiasPay Link, partage, copie, enregistrement de l’image), scan par caméra avec feuille de confirmation, liens profonds.
- **Lot 1** : lancement, présentation (3 pages), connexion par téléphone, code OTP, profil initial, activation de la biométrie, déconnexion. Refonte visuelle : listes à filets, libellés de statut à point, contrôle segmenté.
- **v0.1** : accueil, transactions (filtres), détail avec tranches, paiement (biométrie si disponible), litige, confirmation prestataire (saisie de la référence), profil (langue FR/EN), alertes (vide).

## Tests
- `packages/domain` : règles et machines d'états.
- `packages/api-client` : `MockApi`, `MockAuth` (numéro invalide, bon et mauvais code, verrouillage puis déverrouillage, expiration, renvoi trop tôt, profil, biométrie, déconnexion).
- `packages/ui-tokens` : contraste WCAG de chaque paire texte/fond.
- `apps/mobile` : parité des dictionnaires FR/EN (mêmes clés, aucune valeur vide, aucune apostrophe droite, messages d’erreur du scan), minuteur `m:ss`, numéro, initiales, saisie du code, orientation au démarrage, machine d’états du scan (anti-rebond, chaque erreur, succès), décompte d’expiration, matrice du QR, destination des liens profonds.
- `packages/domain` : codec eQR. `packages/api-client` : jetons, `resolveReference`, `confirmByReference` (chaque erreur, usage unique) et parcours complet payer → jeton → confirmer.

## À venir
Authentification réelle (Supabase Auth) et code de secours (lot 4), création d'un besoin (lot 3), photo de profil, dépôt de preuve, reçu, notifications, back-office (lot 5).

## Règle d'or
Tout changement de statut passe par les fonctions de `@diaspay/domain`. Le serveur (SQL puis TrustEngine) applique les mêmes règles.
