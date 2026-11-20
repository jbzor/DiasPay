# 05 — État d'avancement au 17 novembre 2026

**Sources** : audit en lecture seule du dépôt (16 novembre, `docs/etat-des-lieux/`), comptes rendus du lot X-C (T1 à T11, 16 et 17 novembre), migrations 0001 à 0023 et documents de `docs/` versés en connaissance. Les migrations 0024 à 0031 ne sont connues que par les comptes rendus.

Étiquettes : `[VÉRIFIÉ]` lu dans le code ou le dépôt ; `[EXÉCUTÉ]` commande lancée par l'assistant de code, avec résultat rapporté ; `[RAPPORTÉ]` affirmé dans un compte rendu, non relu dans le code ; `[INCONNU]`.

## 1. Dépôt

| Élément | État |
|---|---|
| Branche principale | `master` (pas de `main`). **`lotX` fusionnée** sans avance rapide : commit de fusion `bf09e37`, étiquette **`pre-passe3`** `[RAPPORTÉ]` |
| Dépôt distant | **Aucun.** Rien n'est poussé ; le code n'existe que sur la machine de Jean-Baptiste |
| `Archive.zip` | Toujours sur le disque (261 Mo, contient deux `.env.local`) ; ignoré par Git depuis X-C T0 |
| Secrets | Aucun dans les fichiers suivis ni dans l'historique `[VÉRIFIÉ, audit]`. **Rotation non confirmée** du jeton d'accès et du mot de passe exposés dans une ancienne conversation ; contenu des deux `.env.local` non examiné |
| Documentation des sources | `docs/sources-client.md` (hiérarchie fixée par Jean-Baptiste) ; `docs/client/` à remplir |
| Migrations | **0001 à 0031**, toutes appliquées au projet de développement `[RAPPORTÉ]` |

## 2. Projet Supabase de développement (relevé T1, 16 novembre)

| Élément | Valeur |
|---|---|
| PostgreSQL | 17.11 |
| Tâches pg_cron | `activate-due-tranches` (06:00 chaque jour), `expire-due-requests` (minute 15 de chaque heure), `release-due-tranches` (toutes les 10 minutes) |
| Réglages | `mock_mode = true`, `require_staff_mfa = false`, `eqr_image_enabled = false`, `payment_provider = SIMULATED` ; `auto_issue_token` **supprimé** depuis (0031) |
| Profils | 13, dont 9 avec un numéro ; aucun doublon de numéro normalisé |
| Préparation de la production | `scripts/prod-readiness.sql` relève les 4 réglages attendus en développement (`mock_mode`, `require_staff_mfa`, lignes `dev_only`, `fee_schedule` absent) et aucune fonction ouverte à `anon` |

## 3. Fonctionnalités

| Bloc | Contenu | État |
|---|---|---|
| Lots 1 à 5 | Application mobile (démarrage, authentification, création d'un besoin, alertes, profil, sécurité, litige, reçu) ; Supabase ; back-office (connexion + TOTP, file de revue, preuves de jalons, litiges, journal d'audit) | Livrés ; back-office **non déployé** |
| Ancien lot X (0007–0012) | Sécurité du lien, décisions du payeur, TrustVault (empreintes, réutilisation), fondations des paiements, modules, structure multi-payeurs | Livré |
| Lot X v2, passes 1 et 2 (0013–0023) | Noyau v2, compléments X1, `accept_plan`, jeton de présentation (SQL), enrôlement N0–N3, paiements (`accept_and_pay`, contributions, devis, remboursements manuels), santé minimale | Livré |
| **Lot X-C (0024–0031)** | Paiement réel sans fonction de démonstration ; brouillons modifiables par `save_draft` seulement ; numéro de téléphone et, dès N1, nom figés ; prise en charge du jeton de présentation limitée au titulaire du numéro invité ; pas de libération des fonds d'une opération suspendue ; demande échue non payable ; **TrustToken pour toute demande** ; `anon` sans aucun droit ; valeurs sûres côté client | **Livré, fusionné** |
| API | 42 méthodes (simulateur et `SupabaseApi`) ; i18n 646 clés et plus (nouveaux codes `INITIATOR_MISMATCH`, `REQUEST_EXPIRED`) | `[VÉRIFIÉ, audit]` puis `[RAPPORTÉ]` |
| Passe 3 du lot X v2 (X7–X9) | Empreintes existantes (0009) ; ni témoins, ni simulateur de scénarios | **Non lancée ; prompt à réviser** |

**Serveur sans écran** : jeton de présentation, enrôlement, devis et frais, `accept_plan`, TrustToken en `DIRECT`. **Aucun écran** pour l'espace de vérification du payeur, l'initiation par un prestataire, le tableau de bord aux libellés du Dr, le commerçant, les témoins.

## 4. Tests (sur `master`, 17 novembre)

| Suite | Résultat |
|---|---|
| SQL 00 à 07 et variantes éditeur | 94, 130, 143, 115, 140, 45, 119, 90 : **tout passe** `[EXÉCUTÉ]` |
| Contrat (simulateur et Supabase) | 39 sur 39 `[EXÉCUTÉ]` |
| Playwright | 25 réussis, 4 captures ignorées (ne tournent qu'avec `E2E_CAPTURE`) `[EXÉCUTÉ]` |
| `pnpm -r test` | 491 réussis, 1 ignoré `[EXÉCUTÉ]` |
| Typage, build web, export web mobile | 0 erreur, réussis `[EXÉCUTÉ]` |
| **Téléphone réel (iOS, Android)** | **Jamais fait** |

Le pooler Supabase coupe parfois les longues suites SQL : terminer les sessions orphelines et relancer.

## 5. À tester sur téléphone (liste du lot X-C)

1. Paiement sans démonstration : « Paiement en cours de confirmation », sans erreur. Avec `EXPO_PUBLIC_DEMO=1` : la demande passe à payée.
2. Écran du jeton en `DIRECT` : bandeau, sans QR.
3. Code SMS erroné : message sans nombre d'essais.
4. Build de boutique sans `EXPO_PUBLIC_API` (ou avec `mock`) : écran bloqué.
5. Modification du nom : refusée pour un compte N1, acceptée pour un compte N0.
6. Héritage des lots précédents : réencodage des photos (GPS retiré), biométrie, temps réel, reçu PDF.

Hors démonstration, un paiement reste « en cours » sur le projet de développement tant que le simulateur de scénarios (X9) n'existe pas : c'est attendu.

## 6. Risques et dettes restants

| Sujet | Gravité | Traitement prévu |
|---|---|---|
| Pas de dépôt distant | Élevée (perte totale possible) | Jean-Baptiste, immédiatement |
| `mock_mode = true` et `require_staff_mfa = false` par défaut | Importante | Liste de contrôle + `prod-readiness.sql` ; décision de production |
| Plafonds, barème, durées absents → **tout paiement refusé en production** | Voulu | Valeurs du client et des partenaires |
| Rôle de l'interface tiré du profil (`personaForRole`) et non de l'opération | Importante | Lot Y |
| MFA selon le risque absente (`[CAHIER 5.2]`) | Importante | Livrables 4, 7, 8 puis lot Y |
| `_create_refund` suppose une seule tentative confirmée par demande | À traiter avant les contributions multiples | Phase 2 |
| Fonctions créées depuis le tableau de bord (rôle `supabase_admin`) non couvertes par les droits par défaut | Faible (détecté par `00_smoke`) | Vigilance |
| Dette de nommage (`tranches`, `vertical`, valeurs v1 dans les enums, tables archivées) | Mineure | Acceptée |
| GPS des photos et second facteur jamais vérifiés sur appareil | — | Tests sur téléphone |

## 7. Blocages hors développement

| Blocage | Qui |
|---|---|
| Documentation et **bac à sable TrustPayWay et Amzara** ; calendrier | Client, partenaires |
| Partenaire **KYC** | Client |
| **Atelier juridique** (agrément, KYC/AML, notarial, santé, conservation, consentements) | Client |
| Comptes Apple Developer et Google Play, nom de domaine, fournisseur SMS, service e-mail | Client |
| **Valeurs** : plafonds, durées de vie (QR, devis), expiration des demandes, seuil `RISK_BASED`, seuils de MFA, barème, taux | Client, partenaires |
| Validation de **K8** et **K11** (réductions de la phase 1) | Client |

## 8. Prochaines étapes, dans l'ordre

1. **Jean-Baptiste** : créer le dépôt distant privé (au nom du client) et pousser `master` avec `pre-passe3` ; vérifier les deux `.env.local` d'`Archive.zip` et renouveler toute clé sensible, ainsi que le jeton et le mot de passe exposés ; verser dans `docs/client/` et en connaissance le cahier, le **message du Dr** et ses **réponses écrites** ; passer la liste du §5 sur téléphone.
2. **Livrables du cahier, vague 1** (pour validation écrite par le Dr) : 7 et 8 (spécifications du TrustToken et du DiasPay Link) ; 6 (machine à états, libellés du Dr, « en retard ») ; 4 (matrice des rôles et permissions) ; 1 (cartographie des 25 cas) ; 12 (backlog priorisé, avec K8 et K11 présentées comme propositions). Envoi au Dr en PDF.
3. **Passe 3 révisée** du lot X v2 : X7 réduit (`require_content_hash`, parité) ; X8 témoins selon le cas 25 et le message (deux voies, identité, consentement, conflits d'intérêts) ; X9 simulateur de scénarios et contrat étendu.
4. **Vague 2 des livrables** : 5, 9, 3, 2, 13.
5. **Conception du lot Y** (livrable 11), validation, puis code ; livrables 10 et 14.
6. **Lot 6** (intégration continue, environnement pilote, builds de test, déploiement, push) dès que les comptes et le domaine existent.
7. TrustEngine (phase 2), puis arrimage à TrustPayWay.
