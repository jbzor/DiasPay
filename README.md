# DiasPay & DiasPayQR

Monorepo pnpm + Turborepo.

- `packages/domain` : types, règles de déblocage, plan de tranches, machines d'états (transaction et tranche). Miroir du schéma SQL v0.2.
- `packages/ui-tokens` : charte validée (couleurs, espacements, contrastes testés).
- `packages/api-client` : contrat `TransactionApi` et implémentation simulée `MockApi` (données de démonstration, minuteur de déblocage automatique). Le TrustEngine remplacera le mock derrière la même interface.
- `apps/mobile` : application Expo (SDK 58, Expo Router, TypeScript). Aperçu web inclus.

## Démarrer
```
pnpm install
pnpm -r test
pnpm --filter @diaspay/mobile typecheck
pnpm --filter @diaspay/mobile start     # puis i (iOS), a (Android) ou w (web), ou scanner le QR avec Expo Go
```

## Écrans livrés (v0.1)
Accueil, Transactions (filtres), Détail avec tranches, Paiement (biométrie si disponible), Litige, Confirmation prestataire (saisie de la référence), Profil (changement de profil de démonstration et de langue FR/EN), Alertes (vide).

## À venir
Scan caméra de l'eQR, écran TrustToken/eQR, connexion OTP, création d'un besoin, dépôt de preuve, reçu, notifications, branchement Supabase.

## Règle d'or
Tout changement de statut passe par les fonctions de `@diaspay/domain`. Le serveur (SQL puis TrustEngine) applique les mêmes règles.
