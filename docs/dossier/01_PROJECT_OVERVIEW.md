# 01 — Présentation du projet

**Date du dossier** : 13 novembre 2026. **Convention de fiabilité** utilisée dans tout le dossier :

| Étiquette | Sens |
|---|---|
| **[CONFIRMÉ]** | Résultat rapporté par l'utilisateur à partir de son environnement (comptes rendus de l'assistant de code local) ou fait lu dans un document fourni |
| **[DÉCIDÉ]** | Décision prise dans la conversation (par le client, ou par moi comme chef de projet sur délégation) |
| **[DEMANDÉ]** | Spécifié dans un prompt que j'ai écrit ; **le résultat n'a pas été vu** par moi |
| **[PRODUIT PAR MOI]** | Livrable que j'ai créé et que j'ai pu vérifier dans mon propre environnement |
| **[HYPOTHÈSE]** | Déduction non vérifiée |
| **[INCONNU]** | Information à laquelle je n'ai pas eu accès |

## 1. Le projet en une phrase

**PAYQR® et DiasPayQR®** forment, au sein de l'écosystème **Diaspora Business Hub 237**, une plateforme de **paiement par preuve (Proof-Based Payment®)** : un paiement n'est plus envoyé « en blanc » mais associé à une opération identifiée, documentée, vérifiable, autorisée et traçable, afin que le payeur sache **pourquoi** il paie, **à qui**, **sur quelles preuves**, **qui l'a autorisé** et **comment** le paiement a été exécuté. [CONFIRMÉ : cahier d'extension du client]

## 2. Contexte métier

- **Client / porteur** : le **Dr Samuel Dongmo**, Président du HCCE et de la COFIDIAS. [CONFIRMÉ]
- **Écosystème** : Diaspora Business Hub 237, plateforme financière intégrée de la diaspora camerounaise, organisée en quatre univers : **Payer** (PAYQR, DiasPayQR, DiasContrib, DiasTontine), **Investir** (DiasVenture, DiasAsset, DiasImmo, AgroDiaspora, AgroDiaspora Marketplace, Diaspora Bonds 237), **Protéger** (DiasAssur, DiasEmergency, DiasHomeCare, DiasMortgage), **Préparer l'avenir** (DiasSave, DiasRetire, DiasEdu, DiasYouth, DiasAuto). [CONFIRMÉ : `Diaspora_Business_Hub_237_Document_Général_.md`, lu en début de dossier]
- **Rôle des briques** (d'après le dossier institutionnel) :
  - **DiasPay®** : super application financière de la diaspora (« portefeuille numérique de confiance »).
  - **PAYQR®** : plateforme universelle d'acceptation et d'orchestration des paiements **marchands par QR code**, avec identifiant de marchand vérifié (paiements de **proximité**).
  - **DiasPayQR®** : paiement par preuve, surtout à **distance** (diaspora vers le Cameroun). Cycle décrit : besoin → dossier transactionnel → justificatifs → **TrustToken®** → **eQR®** → **DiasPay Link®** → validation des parties → exécution via TrustPayway → archivage dans le **TrustPayway Ledger®**.
  - **TrustPayway®** : moteur de paiement et d'orchestration, **partenaire externe**. **Amzara®** : partenaire de tokenisation d'actifs et d'accès aux moyens de paiement internationaux (cartes, comptes étrangers).
  - Le dossier institutionnel cite aussi un **Trust Operating System®** et des « moteurs » (le résumé initial parlait de 15 ; la section d'intégration de DiasPayQR en liste **14** : Identity, Merchant, Transaction, Trust, Governance, Risk, Compliance, Payment, Escrow, Proof, Smart Contract, Trust Ledger, Analytics, API Gateway ; « 15 plateformes » n'apparaît que dans l'infographie finale). [VÉRIFIÉ le 16 nov.]
- **Problème adressé** : transferts sans justificatifs fiables, faux besoins, détournements, absence de suivi, paiements sans contrat ni devis, travaux non réalisés, double financement, litiges. [CONFIRMÉ : dossier institutionnel]
- **Purpose Locked Money®** : argent **affecté à un objectif documenté**. ⚠ Au début du projet j'ai interprété cela comme un **blocage temporel des fonds** (verrouillage puis déblocage). Le cahier d'extension et le message du Dr établissent que le flux de base est le **paiement direct après vérification du payeur** ; le blocage conditionnel (séquestre) est un cas à part. Voir `04_PROJECT_DECISIONS.md` (K1).

## 3. Équipe et rôles de travail

| Personne / entité | Rôle |
|---|---|
| **Jean-Baptiste** (l'utilisateur) | Prestataire de développement, lead front-end (mobile + web), « Lead Developer DiasPay » dans le cahier du client. Fait le lien avec le client, exécute les prompts localement, valide |
| **Dr Samuel Dongmo** | Client. Valide le périmètre, la charte, les maquettes ; a délégué plusieurs décisions au prestataire |
| **« L'assistant » / Claude Code local** | Outil de code de l'utilisateur, qui **exécute les prompts que je rédige** et renvoie des comptes rendus. Je n'y ai pas accès |
| **Moi (Claude, dans ce projet)** | Chef de projet technique, architecte, concepteur d'écrans et rédacteur de documents. Je **n'écris pas le code de l'application** : depuis la demande de l'utilisateur, je fournis des **prompts** que son assistant exécute. Je relis les comptes rendus |
| **TrustPayway (DG), Amzara** | Partenaires. Aucune documentation d'API ni bac à sable reçus à ce jour [CONFIRMÉ : demande de la doc encore ouverte] |
| **Conseil juridique, partenaire KYC, fournisseur de SMS** | Non désignés à ce jour [INCONNU] |

## 4. Objectifs

1. Livrer d'abord le **front-end** (mobile puis web) sur données simulées, puis la couche intermédiaire **TrustEngine**, puis l'arrimage au backend de TrustPayway. [CONFIRMÉ : décision du client par WhatsApp le 2 novembre 2026]
2. Construire un **noyau transactionnel commun** et des **modules métiers configurables** (pas 25 applications). [CONFIRMÉ : cahier d'extension]
3. Ne **jamais détenir de fonds** : le paiement et, le cas échéant, le séquestre sont exécutés par un partenaire habilité. [CONFIRMÉ]

## 5. Périmètre

**Cahier d'extension du client (25 cas d'usage, 6 fonctions transversales, 3 phases)** : voir `ALIGNEMENT-CAHIER-EXTENSION.md` (dans `artefacts/`). Priorités du client :
1. Paiement familial avec justificatifs. 2. Paiement conditionnel avec preuve de réalisation. 3. Paiement fractionné et multi-contributeurs.

**Pilote proposé (K11)** : paiement familial avec justificatifs (scolarité, santé, loyer) + échéances + **un commerçant pilote**. [PROPOSITION écrite, à laquelle le Dr a répondu par écrit ; c'est une **réduction de sa phase 1** (12 priorités), à lui présenter comme telle]

**Source de vérité** : les documents du client, dans l'ordre fixé par Jean-Baptiste (cahier d'extension, message du Dr, dossier institutionnel, réponses écrites aux K) ; voir `04_PROJECT_DECISIONS.md` §1.

**Hors périmètre actuel** : paiement réel (dépend de TrustPayway), TrustEngine, signature cryptographique réelle des jetons, mandats de prélèvement, API/SDK marchands, TrustScore, TrustAnalytics, crowdfunding, marchés publics.

## 6. Utilisateurs et parties prenantes

| Acteur | Description | Statut dans le produit |
|---|---|---|
| Payeur (diaspora) | Examine la demande et ses preuves, décide, paie | Serveur prêt (quatre actions, TrustToken) ; espace de vérification à concevoir (lot Y) |
| Demandeur / initiateur | Particulier, prestataire, commerçant ou institution enrôlé qui initie une demande de paiement | Partiellement ; enrôlement N0 à N3 côté serveur (X4) |
| Prestataire / bénéficiaire | Hôpital, école, bailleur, fournisseur, notaire | Partiel |
| Témoin / tiers de confiance | Désigné par le payeur, ou sollicité par le demandeur parmi des personnes approuvées par le payeur ; déclaration, jamais certification | Schéma et API demandés (X8), sans interface |
| Bureau de contrôle (personnel) | **Ne valide plus chaque demande** : enrôlement des institutions, signalements de fraude, médiation des litiges ; revue de risque facultative | Back-office web livré (lot 5), à réorienter |
| Administrateur | Tranche des litiges, gère les remboursements manuels du pilote | Partiel |
| Partenaires externes | TrustPayway, Amzara, partenaire KYC | Non branchés (simulateurs) |

## 7. Chronologie utile

| Date (2026) | Événement |
|---|---|
| 2 nov. | Décision du client : démarrer le front-end puis le TrustEngine, arrimage TrustPayway plus tard |
| ~7–9 nov. | Cahier des charges v1.0 rédigé puis validé par le client ; maquettes validées |
| 9–13 nov. | Lots 1 à 5 exécutés par l'assistant de l'utilisateur ; lot 3 bis ; lot 4 (Supabase) ; lot 5 (back-office) |
| après lot 5 | Réception du **cahier d'extension** du client ; analyse d'alignement ; **kickoff impossible** (indisponibilité du Dr) ; questions K1 à K14 soumises par écrit, **réponses écrites du Dr** |
| 13 nov. | Passe 2 du lot X v2 terminée ; passe 3 (X7 à X9) non lancée |
| 16 nov. | Audit en lecture seule du dépôt ; nouveau projet Claude ; dossier réaligné sur les documents du client ; lot X-C lancé |
| 17 nov. | Lot X-C terminé ; `lotX` fusionnée dans `master` (`bf09e37`, étiquette `pre-passe3`) |

Les dates exactes de la réception du cahier et des réponses écrites du Dr ne sont pas connues : **[INCONNU]**.
