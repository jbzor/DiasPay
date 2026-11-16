# DiasPay : état du code au 16 novembre 2026

Branche `lotX` (`b31f68e`), 14 commits d’avance sur `master`, non fusionnée, sans dépôt distant. Migrations 0001 à 0023. Rapport complet : `docs/etat-des-lieux/ETAT-DES-LIEUX.md`.

## Livré

- **Noyau v2** (0013, 0014, 0017 à 0019) :
  - statuts de l’opération : DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED ;
  - statuts de la demande : DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED ;
  - `settlement_mode`, litige distinct, `platform_review` à NEVER ; machines du domaine identiques aux tables SQL.
- **X1** : aucun lien partageable, révocation, limitation des tentatives, réponse identique pour une référence inconnue ou étrangère, QR désactivé (0015), protection contre la capture d’écran.
- **X3** : `request_info`, `answer_info`, `reject_request`, `accept_plan`.
- **X4** : enrôlement N0 à N3, KYC simulé (0020).
- **X5** : paiements idempotents, journal à double entrée, devis de change, contributions, `accept_and_pay`, remboursements (0010, 0021).
- **X6** : `request_modules` ; santé réduite au devis et à une référence du patient (0022, 0023).
- **API** : 42 méthodes, présentes dans le simulateur et dans Supabase.
- **i18n** : 646 clés en français et en anglais, parité complète.

## Partiel ou absent

- Le jeton de présentation n’existe qu’en SQL (0016) : aucun client.
- Aucun écran pour l’enrôlement, le devis, les frais ou l’acceptation de l’échéancier.
- Les ports de paiement et de KYC n’ont qu’un adaptateur simulé.
- Pas de `module_code` : le lien reste `vertical`. La table `tranches` n’est exposée que par la vue `payment_requests`.
- X7 à X9 : les empreintes de pièces existent déjà (0009, passe 1) ; ni témoins, ni simulateur de scénarios.

## Tests

- `pnpm -r test` : **483 réussis, 1 ignoré, 0 échec**.
- Typecheck : 0 erreur ; builds web et Expo web : réussis.
- Non exécutés : tests SQL (785 contrôles), contrat Supabase, Playwright (29 tests).

## Cinq écarts

1. **X1.8** : le client affiche le QR si le réglage `eqr_image_enabled` manque.
2. **D5** : `MockAuth` verrouille après 3 codes ; `SupabaseAuth` est conforme.
3. **D7** : `require_staff_mfa` vaut `false` par défaut.
4. **X6** : pas de `module_code`, et les tables archivées restent.
5. **X1.2** : déclaration orpheline `t/[reference]` dans `_layout.tsx`.

## Cinq risques

1. **Le paiement échoue hors `mock_mode`.** `SupabaseApi` appelle `demo_settle_payment`, qui lève DEMO_DISABLED.
2. **Contournement de `save_draft` (à confirmer).** La politique `tx_update_draft` permet de modifier n’importe quelle colonne d’un brouillon, y compris le nom d’un patient (K13).
3. **Téléphone modifiable (à confirmer).** `profiles_self_update` ne protège pas `phone` : un utilisateur pourrait se faire désigner comme contrepartie à la place d’un autre.
4. **Valeurs de développement par défaut.** `mock_mode = true` dès 0001 ; seule la liste de contrôle protège la production.
5. **Libération et jeton de présentation.** `release_due_tranches` libère les fonds d’une opération SUSPENDED. `claim_presentation_token` lie n’importe quel porteur comme payeur quand le payeur n’est connu que par téléphone.

À noter aussi : `app_config` est lisible par `anon`. `Archive.zip` (261 Mo, avec deux `.env.local`) n’est pas ignoré par Git.

## Avant la passe 3

1. Corriger le chemin de paiement réel (risque 1).
2. Restreindre ces deux politiques colonne par colonne, puis ajouter des tests SQL.
3. Corriger `release_due_tranches` et `claim_presentation_token`.
4. Exécuter les tests SQL et Playwright sur le projet de développement ; relever les migrations appliquées et les tâches pg_cron actives.
5. Faire trancher par le client : plafonds, durées de vie, frais, expiration, conservation, second facteur.
6. Fusionner `lotX` ; traiter `Archive.zip` ; mettre à jour les documents périmés.
7. Ajouter les clients et les écrans de l’enrôlement, du devis, de `accept_plan` et du jeton de présentation.
