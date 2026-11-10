# Liste de contrôle avant publication

À dérouler pour chaque build destiné aux stores (App Store, Google Play) ou à la production web.

1. **Le mode démonstration est désactivé.** `EXPO_PUBLIC_DEMO` et `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE` ne sont pas définis dans l’environnement du build. Contrôle automatique : un build de production (`!__DEV__`) avec `EXPO_PUBLIC_DEMO=1` affiche un écran bloquant « Build non conforme » et journalise l’anomalie (`apps/mobile/src/lib/releaseGuard.ts`). `EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1` ne sert qu’aux builds internes de démonstration et aux captures de conformité.
2. `EXPO_PUBLIC_UPLOAD_FAILURE_RATE` n’est pas défini (pas d’échec d’envoi simulé).
3. `EXPO_PUBLIC_LINK_BASE` désigne le domaine réservé des DiasPay Links, et les fichiers `apple-app-site-association` et `assetlinks.json` sont publiés (voir README, lot 2).
4. `EXPO_PUBLIC_HELP_URL` et `EXPO_PUBLIC_TERMS_URL` pointent vers les pages publiées du centre d’aide et des conditions.
5. `pnpm -r test`, `pnpm --filter @diaspay/mobile typecheck` et `pnpm --filter @diaspay/mobile exec expo export --platform web` passent.
6. Le numéro de version (`expo.version` dans `app.json`) a été incrémenté ; l’écran Profil › À propos l’affiche.
7. Une photo envoyée depuis un téléphone réel (localisation activée) ne contient pas de coordonnées GPS (`exiftool -gps:all <fichier>` : aucune ligne).
