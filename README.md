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

## Écrans livrés
- **Lot 1** : lancement, présentation (3 pages), connexion par téléphone, code OTP, profil initial, activation de la biométrie, déconnexion. Refonte visuelle : listes à filets, libellés de statut à point, contrôle segmenté.
- **v0.1** : accueil, transactions (filtres), détail avec tranches, paiement (biométrie si disponible), litige, confirmation prestataire (saisie de la référence), profil (langue FR/EN), alertes (vide).

## Tests
- `packages/domain` : règles et machines d'états.
- `packages/api-client` : `MockApi`, `MockAuth` (numéro invalide, bon et mauvais code, verrouillage puis déverrouillage, expiration, renvoi trop tôt, profil, biométrie, déconnexion).
- `packages/ui-tokens` : contraste WCAG de chaque paire texte/fond.
- `apps/mobile` : parité des dictionnaires FR/EN (mêmes clés, aucune valeur vide, aucune apostrophe droite), minuteur `m:ss`, numéro, initiales, saisie du code, orientation au démarrage.

## À venir
Authentification réelle (Supabase Auth) et code de secours (lot 4), écran TrustToken/eQR et scan caméra (lot 2), création d'un besoin (lot 3), photo de profil, dépôt de preuve, reçu, notifications, back-office (lot 5).

## Règle d'or
Tout changement de statut passe par les fonctions de `@diaspay/domain`. Le serveur (SQL puis TrustEngine) applique les mêmes règles.
