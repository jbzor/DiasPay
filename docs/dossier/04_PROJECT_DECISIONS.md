# 04 — Décisions du projet

**Version du 17 novembre 2026** (lot X-C terminé et fusionné). Remplace la version du 13 novembre. Changements principaux : (1) il n'y a **pas eu de kickoff**, le Dr étant indisponible ; K1 à K14 sont **nos propositions**, auxquelles le Dr a **répondu par écrit** ; (2) chaque décision porte désormais sa **source** ; (3) l'état réel du dépôt (audit du 16 novembre) est pris en compte ; (4) le **TrustToken est rétabli pour toute demande**, y compris en paiement direct.

## 1. Hiérarchie des sources

En cas de contradiction, la source la plus haute l'emporte, et l'écart est signalé.

| Rang | Source | Étiquette | Où |
|---|---|---|---|
| 1 | **Cahier d'extension fonctionnelle** du Dr (25 cas, fonctions transversales A à F, exigences 5.1 à 5.4, phases, 14 livrables, innovations A à E) | `[CAHIER §…]` | `CAHIER_D_EXTENSION_FONCTIONNELLE…pdf` |
| 2 | **Message du Dr** préparant le kickoff (cas 1 et 2, sécurité du TrustLink, décision du payeur, rôle de TrustPayWay et Amzara) | `[MESSAGE …]` | Conversation ; texte à verser en connaissance |
| 3 | **Dossier institutionnel** Diaspora Business Hub 237 (cycle DiasPayQR, PAYQR, DiasPay, moteurs du Trust Operating System) | `[INSTIT. …]` | `Diaspora_Business_Hub_237_Document_Général_.md` |
| 4 | **Réponses écrites du Dr** à nos propositions K1 à K14 | `[DR ÉCRIT]` | **Texte non versé au dossier** : à ajouter en connaissance et dans `docs/client/` |
| 5 | **Nos choix** (chef de projet sur délégation, ou assistant de code quand le prompt laissait un choix) | `[NOUS]` | `docs/decisions.md` du dépôt |

Hiérarchie **fixée par Jean-Baptiste** et reprise dans `docs/sources-client.md` du dépôt. Une réponse K s'applique pleinement quand elle **précise** un point que le cahier laisse ouvert ; si elle **contredit** le cahier, l'écart est signalé au Dr, jamais tranché en silence. Tous ces documents prévalent sur `docs/specs/modele-cible-v2.md`.

Règle : un choix `[NOUS]` n'est légitime que là où les sources 1 à 4 se taisent ou délèguent. Il reste révisable et doit être présenté au Dr comme tel.

Légende de statut : **Actif**, **Remplacé** (par quoi), **Ouvert**, **En cours** (lot X-C).

## 2. Exigences du client (non négociables)

| Exigence | Source | État dans le code (audit du 16 nov.) |
|---|---|---|
| On paie une **opération** identifiée, documentée, vérifiable, autorisée, traçable | `[CAHIER §1]`, `[INSTIT. DiasPayQR §3]` | Respecté (noyau v2) |
| DiasPayQR **ne détient jamais de fonds** ; séquestre par un partenaire habilité | `[CAHIER cas 5, attention]`, `[INSTIT.]` | Respecté (fonds simulés chez le partenaire) |
| **Aucun TrustLink exploitable** par WhatsApp, SMS ou e-mail ; seulement une invitation à ouvrir l'application | `[MESSAGE cas 2 A]`, `[CAHIER §3.D]` | Respecté et testé (X1) |
| **Un TrustToken et un TrustLink par demande et par échéance**, générés à la soumission ; pas d'image de QR nécessaire pour les demandes | `[CAHIER §1, cas 3, cas 8, §3.C]`, `[MESSAGE cas 1 étape 4]`, `[INSTIT. « identité numérique de chaque opération »]` | **Respecté depuis X-C** (0028, 0031) ; l'écart de 0014 et 0018 est corrigé |
| TrustLink : signé, durée contrôlée, révocable, anti-rejeu, anti-substitution, intégrité, authentification avant action sensible, anti-hameçonnage | `[CAHIER 5.1]` | Partiel : signature **simulée** (TrustEngine en phase 2) ; le reste est en place |
| Identité du demandeur affichée au payeur = identité vérifiée | `[MESSAGE cas 2 B]`, `[CAHIER 5.1]` (substitution) | Respecté depuis X-C : nom et numéro figés à partir de N1 (0025, 0030) |
| Sécurité des paiements : **MFA selon le risque**, confirmation du montant et du bénéficiaire, idempotence, signatures des partenaires, rapprochement, journal à double entrée, contrepassations, séparation administration/exécution | `[CAHIER 5.2]` | Partiel : tout le serveur existe sauf la **MFA selon le risque** côté utilisateur (biométrie de l'appareil seulement) |
| Protection des données : chiffrement, accès, consultations journalisées, consentements, conservation | `[CAHIER 5.3]` | Partiel : pas de consentements, aucune durée de conservation |
| Résilience : modularité, API documentées, webhooks sécurisés, asynchrone, reprise, surveillance, sauvegardes | `[CAHIER 5.4]` | Partiel |
| Une contestation **n'annule ni ne bloque** un paiement déjà exécuté | `[CAHIER cas 16]` | Respecté (K7) |
| Un témoin fait une **déclaration**, jamais une certification ; un score n'est jamais une preuve ; l'IA n'autorise jamais seule | `[CAHIER cas 25, §3.A, innov. E]` | Témoins absents (passe 3) |
| La présence de justificatifs n'est pas une certification juridique (foncier) | `[CAHIER cas 23]` | À reprendre dans les textes de l'interface |
| L'urgence ne supprime jamais les contrôles | `[CAHIER cas 22]` | Non concerné pour l'instant |
| Pas de dépendance à un seul prestataire de paiement | `[CAHIER innov., point essentiel]` | Respecté (ports et adaptateurs) |
| Un noyau commun et des modules, pas 25 applications | `[CAHIER §4]` | Respecté (`request_modules`) |

## 3. Décisions d'architecture et de pile

| Décision | Source | Statut |
|---|---|---|
| TypeScript partout, monorepo pnpm + Turborepo ; React Native + Expo (mobile), Next.js (back-office) ; Flutter écarté (Dart non partageable avec le web) | `[NOUS]` | Actif |
| Supabase en phase 1, puis TrustEngine Node/TS (phase 2) | `[NOUS]` ; cohérent avec `[INSTIT. Trust Engine®]` | Actif ; TrustEngine non démarré |
| Front d'abord sur données simulées, TrustEngine ensuite, arrimage à TrustPayWay plus tard | **Décision du client** (WhatsApp, 2 nov.) | Actif |
| Ports et adaptateurs (`PaymentPort`, `KycPort`, `LedgerPort`, `NotificationPort`) | `[NOUS]` ; répond à `[CAHIER innov., point essentiel]` | Actif ; adaptateurs **simulés seulement** |
| Comptes Apple, Google, Supabase, Vercel **au nom du client** | `[NOUS]` | Actif ; comptes Apple/Google en attente |
| Fonds chez un partenaire agréé (cantonnement) | `[CAHIER cas 5]` | Actif ; **à confirmer par écrit avec TrustPayWay et un conseil juridique** |

## 4. Propositions K1 à K14 (réponses écrites du Dr)

Les questions K1 à K14 figurent dans `ALIGNEMENT-CAHIER-EXTENSION.md` §6, avec nos recommandations. Le Dr y a répondu par écrit ; plusieurs réponses reprennent ou précisent nos recommandations (K6 : mandat en **phase 2** et non 3 ; K7 : remboursement volontaire, médiation, rétrofacturation selon le réseau, rails irréversibles). La colonne « Appui » indique le passage des documents du client qui fonde chaque décision.

| # | Décision | Appui dans les documents du client | Nature | Statut |
|---|---|---|---|---|
| K1 | **Paiement direct** après vérification du payeur par défaut ; séquestre (`CONDITIONAL`) pour les modules conditionnels, en phases 2–3 | `[MESSAGE cas 2 C]` paiement déclenché quand le payeur clique ; `[CAHIER cas 5, phase 2]` ; `[INSTIT. DiasImmo]` « immédiat, échelonné ou séquestre » | Conforme | Actif, implémenté |
| K2 | Le **payeur** décide ; témoin facultatif ; le bureau ne valide pas chaque demande (enrôlement, fraude, médiation) | `[MESSAGE cas 2 B]` les quatre actions ; `[CAHIER cas 16]` médiateur en litige seulement | Conforme. « Témoin bloquant seulement si le payeur le configure » : `[NOUS]` (texte muet) | Actif, implémenté (`platform_review = NEVER`) |
| K3 | Enrôlement **N0 à N3**, plafonds par niveau | `[MESSAGE cas 1 étape 1]` enrôlé, certifié, justificatifs « selon le niveau de risque » ; `[CAHIER cas 13]` limites, KYC/AML ; `[INSTIT. PAYQR]` KYC/KYB des marchands | Principe conforme ; découpage N0–N3 : `[NOUS]` | Actif, implémenté (0020) ; plafonds non fournis |
| K4 | Aucun lien externe ; **QR dynamique du commerçant** en présentiel, référence opaque à courte durée, ouverte dans l'application après authentification ; nom du commerçant et montant toujours affichés avant autorisation | `[MESSAGE cas 1 étape 4]` pas d'image de QR pour les demandes ; `[INSTIT. PAYQR §3]` « QR dynamique intégrant le montant », MerchantID ; `[CAHIER 5.2]` confirmation du montant et du bénéficiaire | Conforme. Le QR du présentiel relève de **PAYQR**, pas des demandes DiasPayQR | Actif ; schéma SQL seulement (0016), sans client |
| K5 | Trois niveaux de statuts (opération, demande, tentative) ; litige distinct ; « notification envoyée », « reçue », « en vérification » sont des événements | `[MESSAGE cas 1 étape 6]` 13 statuts, « à définir précisément dans le workflow métier » | **Délégué** ; condition : le tableau de bord affiche les libellés du Dr (voir `03` §3) | Actif, implémenté ; libellés à faire valider (livrable 6) |
| K6 | Phase 1 : autorisation du payeur **à chaque échéance** ; acceptation du principe du plan sans autorisation anticipée ; phase 2 : mandat de prélèvement | `[CAHIER cas 8, point important]` ; `[MESSAGE cas 1]` échéancier | Conforme | Actif, implémenté (`accept_plan`) |
| K7 | Un paiement exécuté **reste exécuté** ; litige distinct ; remboursement = nouvelle opération liée avec contrepassation ; avant exécution, la contestation suspend ; médiation et remboursements manuels au pilote | `[CAHIER cas 16, cas 15, 5.2]` | Conforme | Actif, implémenté |
| K8 | Comptes d'organisation hors phase 1, **sauf un commerçant simple** | `[CAHIER phase 1 n° 7]` « paiements commerçants » ; cas 3 : caisses, points de vente, produits ; « gestion des entreprises » en phase 2 | **Réduction de notre part** du périmètre commerçant de la phase 1 | Actif, **à faire valider explicitement** |
| K9 | Structure « demande parent + contributions » dès la phase 1, sans interface | `[CAHIER cas 7, phase 2]` ; priorité n° 3 du Dr | Conforme (anticipation) | Actif, implémenté (0021) |
| K10 | Devise de la demande canonique (FCFA) ; montant indicatif, taux, frais affichés avant autorisation ; taux figé fourni par le partenaire | `[CAHIER cas 13]` | Conforme ; « taux figé » : `[NOUS]` | Actif, implémenté (0021) ; taux USD et barème non fournis |
| K11 | Pilote : paiement familial avec justificatifs (scolarité, santé, loyer) + échéances + un commerçant | `[CAHIER phase 1]` : 12 priorités | **Réduction de notre part** de la phase 1 | Actif, **à faire valider explicitement** |
| K12 | Couche d'adaptation et simulateur de TrustPayWay ; bac à sable réel sur le chemin critique | `[CAHIER innov., point essentiel ; cas 4 sandbox]` | Conforme | Actif ; simulateur en place, scénarios en passe 3 |
| K13 | Santé : stocker le strict nécessaire (devis ou facture, référence minimale du patient) avant l'atelier juridique | `[CAHIER cas 10]` « référence du patient, avec les protections nécessaires », « gestion stricte » | Conforme | Actif, implémenté (0022) |
| K14 | Témoin : déclaration distincte d'une certification | `[CAHIER cas 25]` | Conforme | Actif ; témoins non implémentés (passe 3) |

**Bilan** : onze décisions sur quatorze sont fidèles aux documents du client ; K5 est une délégation explicite ; **K8 et K11 réduisent la phase 1 du Dr** et doivent lui être présentées comme telles.

## 5. Décisions de chef de projet et de l'assistant de code

### 5.1 Cahier v1.0 et lots 1 à 5

| Réf. | Décision | Source | Statut |
|---|---|---|---|
| D1 | Champ « Téléphone du payeur » quand un demandeur crée le besoin | `[NOUS]`, validé par le client | Actif |
| D2 | Pièces requises par type, jusqu'à 3 fichiers par type | `[NOUS]` | Actif pour scolarité et loyer ; **santé remplacée par K13** |
| D3 | Textes d'aide du plan de paiement | `[NOUS]` | Actif ; le texte « payée, confirmée puis débloquée » ne correspond plus au paiement direct (à corriger au lot Y) |
| D4 | Politique d'abandon : brouillon jamais audité supprimé ; dossier audité jamais effacé | `[NOUS]` | Actif. **Partie « dossier rejeté corrigé »** remplacée en X2-v2 : une opération rejetée par la revue passe à `CANCELLED`, l'initiateur en crée une nouvelle |
| D5 | Pas de verrouillage après 3 codes SMS erronés (limite de débit Supabase) | `[NOUS]` | Actif ; simulateur aligné (X-C T9). Tension possible avec `[CAHIER 5.2]` : à revoir avec la MFA selon le risque |
| D6 | Contrôles automatiques limités au calculable ; case humaine « montant vérifié » | `[NOUS]` | Actif **pour la revue de risque** seulement |
| D7 | Personnel : e-mail + mot de passe + TOTP quand `require_staff_mfa = 'true'` | `[NOUS]` | Actif ; **valeur par défaut `false`** (0006), à imposer en production |
| D8 | Prise en charge automatique d'un dossier soumis | `[NOUS]` | Remplacée (plus de validation systématique) ; `IN_REVIEW` gardé comme sous-état de la revue |
| Lot 4 | Codes d'erreur stables (`hint`) ; litige tranché par un administrateur ; brouillons en UUID ; variante « éditeur » des tests SQL | `[NOUS]` | Actif |
| Lot 5 | `decide_tx` exige `p_amount_checked` ; pièces ouvertes 2 min après consultation journalisée | `[NOUS]` | Actif (revue de risque) |

### 5.2 Ancien lot X (0007 à 0012) et lot X v2 (0013 à 0023)

L'ancien lot X a été **exécuté en entier** avant la v2 ; ses migrations sont conservées. Détail : `docs/decisions.md` du dépôt (X-0 à X-7, X0-v2 à X6-v2).

| Réf. | Décision | Source | Statut |
|---|---|---|---|
| X-1 / X1-v2 | Plus aucun lien partageable ; seul lien interne `diaspay://tranche/<id>` ; gabarits externes sans paramètre ; révocation ; limitation à 10 échecs par heure ; capture d'écran bloquée | `[MESSAGE cas 2 A]`, `[CAHIER 5.1]` | Actif |
| X1-v2 | Jetons de demande **seulement en `CONDITIONAL`** | `[NOUS]` (assistant) | **Remplacé** par Xc-7 : un jeton pour toute demande (`[CAHIER §1, cas 8]`) |
| X-4 | TrustVault : empreinte SHA-256 calculée par le client, figée par la base ; `document_reuse` sans fuite ; contrôle `DOCUMENT_REUSED` | `[CAHIER §3.B, innov. C]` | Actif ; `require_content_hash = false` (à passer à `true` avant production) |
| X-7 | Structure multi-payeurs (`transaction_parties`) | `[CAHIER cas 7]` | Actif (préparation) |
| X2-v2 | Statuts v2 imposés par contraintes ; données de développement **converties** ; `submit_operation` ; `suspend_operation` / `lift_suspension` pour la fraude | `[NOUS]` dans le cadre de K1, K2, K5 | Actif |
| X2-v2 | **Transitions entre statuts de litige** (OPEN, AWAITING_RESPONSE, IN_MEDIATION, RESOLVED) choisies par l'assistant | `[NOUS]` ; `[CAHIER cas 16]` fixe les fonctionnalités, pas les transitions | **À valider** (livrable 6) |
| X2-v2 | Lecture comptable d'un remboursement en `DIRECT` : le prestataire doit rendre la somme | `[NOUS]` | **À valider** avec le partenaire |
| X3-v2 | Jeton de présentation : seule l'empreinte est stockée, usage unique, rotation, durée de vie non fixée | `[NOUS]` dans le cadre de K4 | Actif ; liaison au payeur invité corrigée (Xc-5) |
| X4-v2 | Un payeur reste N0 ; N1 pour initier en demandeur, N2 en prestataire ; plafonds par jour et mois civils UTC | `[NOUS]` dans le cadre de K3 | Actif ; période des plafonds à valider |
| X5-v2 | Seule la parité EUR/XAF en développement ; aucun taux USD inventé ; sans barème, aucun frais ; conversion arrondie au supérieur ; remboursements manuels au pilote | `[NOUS]` | Actif |
| X6-v2 | `request_modules` ; santé minimale ; preuve de jalon acceptée (0023) ; **colonne `vertical` conservée** (pas de `module_code`) | `[NOUS]` | Actif (dette de nommage acceptée) |

### 5.3 Lot X-C (terminé, fusionné dans `master` le 17 novembre, commit `bf09e37`, étiquette `pre-passe3`)

Détail : `docs/decisions.md` du dépôt, section « Lot X-C » (Xc-2 à Xc-9).

| Tâche | Décision | Source |
|---|---|---|
| T2 | Le client n'appelle plus `demo_settle_payment` hors démonstration | Audit R1 |
| T3, T4 | Plus d'écriture directe non contrôlée sur `transactions` et `profiles` ; `submit_operation` recalcule le mode de règlement ; numéro de téléphone protégé | Audit R2, R3 ; `[CAHIER 5.1 substitution de destinataire]` |
| T5 | La prise en charge du jeton de présentation compare le numéro du payeur invité | Audit R5 ; `[CAHIER 5.1]` |
| T6 | Pas de libération automatique pour une opération suspendue ; demande échue non payable | Audit R6, J1 |
| T7 | **TrustToken pour toute demande**, émis à la soumission (`TOKEN_ISSUED`), réémission et révocation en `DIRECT`, paiement refusé sans jeton actif (`TOKEN_REVOKED`), révocation à l'annulation de l'opération (défaut corrigé, déclencheur unique) | `[CAHIER §1, cas 3, cas 8, §3.C, 5.1]` |
| T7 | **Validité** : jusqu'au paiement, le jeton suit l'échéance de la demande, **dans les deux modes** (vide tant qu'aucune durée d'expiration n'est fixée) ; `token_ttl_days` ne court qu'à partir du paiement, pour la confirmation en `CONDITIONAL` (avant : 7 jours dès la soumission, ce qui bloquait la confirmation d'une demande payée tard) | `[CAHIER 5.1]` |
| T7 | **`auto_issue_token` supprimé** (lu par une seule fonction morte depuis 0014) | Nettoyage |
| T8 | Nom du profil (`full_name`) **figé à partir de N1** ; réécrire le même nom reste permis ; les fonctions serveur (KYC) ne sont pas concernées | `[MESSAGE cas 2 B]`, `[CAHIER 5.1]` |
| T8 | `anon` sans aucun droit sur les fonctions (y compris déclencheurs et `rls_auto_enable`, retiré seulement s'il existe) ni sur `app_config` ; droits par défaut de `postgres` corrigés ; contrôle générique dans `00_smoke` | `[CAHIER 5.3]` ; règle du projet |
| T9 | Image du QR masquée si le réglage manque ; build de boutique bloqué sans `EXPO_PUBLIC_API=supabase` (`mock` bloqué aussi) ; route orpheline retirée ; `MockAuth` aligné sur D5 ; `scripts/prod-readiness.sql` | Audit |
| T10 | `docs/sources-client.md` (hiérarchie des sources) ; documents périmés mis à jour | Règle du projet |

## 6. Décisions remplacées (à ne pas réutiliser)

| Ancien | Remplacé par | Effet |
|---|---|---|
| Validation systématique par le bureau (H2, D6/D8 comme étape) | K2 | La file du back-office ne reçoit que `PENDING_REVIEW` |
| Blocage généralisé des fonds, confirmation par scan du prestataire, délai de contestation par défaut (H3, RG-07, RG-08) | K1 | Ne vaut plus que pour `CONDITIONAL` |
| `DISPUTED` comme statut de demande | K5, K7 | Refusé par contrainte (0014) |
| Partage de lien, QR partageable, liens universels `https://…/t/<réf>`, schéma `diaspay://t/<réf>` | `[MESSAGE cas 2 A]` | Supprimés (0008) ; reste une déclaration orpheline dans `_layout.tsx` (X-C T9) |
| **Suppression du TrustToken en paiement direct** (X1-v2, 0014, 0018) | `[CAHIER §1, cas 8]` | Rétabli (0028) |
| `token_ttl_days` courant dès la soumission en `CONDITIONAL` | Échéance de la demande jusqu'au paiement (0031) | — |
| Réglage `auto_issue_token` | Supprimé (0031) | — |
| Politiques `tx_update_draft` (écriture directe d'un brouillon) | `save_draft` seul chemin (0024) | — |
| `IMMEDIATE` (ancien mode de déblocage) | `settlement_mode = DIRECT` | Refusé par contrainte |
| `can_initiate_requests` | Niveaux N0–N3 (X4-v2) | Colonne supprimée (0020) |
| `platform_review = ALWAYS` (ancien X6) | `NEVER` par défaut | — |
| D2 pour la santé | K13 | Pièce d'identité et certificat médical retirés |
| « Purpose Locked Money » lu comme un blocage temporel des fonds | Affectation des fonds à un objet ou une étape documentés `[INSTIT. DiasImmo, DiasMortgage]` | Verrouillage seulement en `CONDITIONAL` |
| « K1 à K14 décidées au kickoff » (dossier du 13 nov.) | Propositions écrites, réponses écrites du Dr ; **aucun kickoff** | Le présent document |
| Report de la documentation (cahier v2, UML, spécifications…) | `[CAHIER §7]` : 14 livrables attendus | Livrables planifiés en trois vagues (`05` §7) |

## 7. Écarts connus entre le code et les documents du client

| # | Écart | Source | Traitement |
|---|---|---|---|
| 1 | ~~Pas de TrustToken en paiement direct~~ | `[CAHIER §1, cas 8]` | **Résolu** (X-C T7) |
| 2 | Témoins absents ; la voie « sollicité par le demandeur parmi des personnes approuvées par le payeur » n'est pas spécifiée | `[MESSAGE cas 1 étape 3]`, `[CAHIER cas 25]` | Passe 3 (X8), spécification à compléter |
| 3 | Pas de MFA selon le risque pour l'utilisateur ; validation biométrique de la transaction à vérifier | `[CAHIER 5.2]`, `[INSTIT. DiasPay §6]` | Livrables 4 et 7–8, puis lot Y |
| 4 | Statut d'échéance « en retard » absent ; 13 libellés du Dr non affichés | `[MESSAGE cas 1 étape 6]` | Livrable 6, lot Y |
| 5 | Aucun écran pour l'initiation par un prestataire, l'espace de vérification du payeur, l'enrôlement, le devis et les frais, `accept_plan`, le commerçant | `[MESSAGE cas 1, cas 2]`, `[CAHIER phase 1]` | Lot Y (après conception) |
| 6 | Pas d'accès web pour le payeur alors que le cahier envisage l'accès « au domaine officiel » | `[CAHIER §3.D]` | Question de périmètre (livrable 12) |
| 7 | Consentements et durées de conservation absents | `[CAHIER 5.3]` | Atelier juridique |
| 8 | Signature réelle des jetons absente | `[CAHIER 5.1]` | TrustEngine (phase 2) |

## 8. Points encore ouverts

| # | Point | Dépend de |
|---|---|---|
| 1 | Plafonds par niveau, devise et période (civile ou glissante) | Client, partenaire, conseil juridique |
| 2 | Durée de vie et rotation du QR de présentation | Partenaire, essais |
| 3 | Durée d'expiration d'une demande, par module | Client |
| 4 | Seuil du mode `RISK_BASED` | Bureau |
| 5 | Rétrofacturation, délais, recours selon le rail | Partenaire, conseil juridique |
| 6 | Durées de conservation (santé, pièces d'identité, journaux de consultation) | Atelier juridique |
| 7 | Cotations de change (taux figé possible ? taux USD ?), durée d'un devis, barème des frais | TrustPayWay |
| 8 | Seuils de la **MFA selon le risque** | Client, partenaire |
| 9 | **K8** (périmètre commerçant) et **K11** (périmètre du pilote) | Client |
| 10 | Transitions entre statuts de litige ; lecture comptable du remboursement en direct | Client (livrable 6), partenaire |
| 11 | Le prestataire désigné par un payeur doit-il être enrôlé ? | Client |
| 12 | Statut facultatif `PENDING_REVIEW` (hors liste du Dr) | Client |
| 13 | Fournisseurs SMS et e-mail ; nom de domaine ; comptes Apple et Google | Client |
| 14 | Documentation et bac à sable TrustPayWay et Amzara ; partenaire KYC | Client, partenaires |
| 15 | Teinte d'erreur distincte du rouge de marque (`#9B1C1C` proposée) | Client |
