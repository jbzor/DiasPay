# 03 — Règles métier, fonctionnalités et parcours

**Version du 17 novembre 2026** (après le lot X-C). Les documents du client font foi (hiérarchie des sources : `04_PROJECT_DECISIONS.md` §1). Ce document traduit ces documents en règles ; `docs/specs/modele-cible-v2.md` du dépôt en est la version technique. Étiquettes de source : `[CAHIER]`, `[MESSAGE]`, `[INSTIT.]`, `[DR ÉCRIT]`, `[NOUS]`.

## 1. Principe et périmètre

> On ne paie pas une personne ou un compte : on paie une **opération identifiée, documentée, vérifiable, autorisée et traçable**. Le payeur doit savoir **pourquoi** il paie, **à qui**, **sur quelles preuves**, **qui l'a autorisé** et **comment** le paiement a été exécuté. `[CAHIER §1, §8]`

**Responsabilités** `[MESSAGE cas 2 C]` : DiasPayQR crée, documente, authentifie et vérifie les demandes (TrustToken, TrustLink) ; DiasPay est l'environnement transactionnel et l'interface ; TrustPayWay orchestre et exécute le paiement (mobile money MTN et Orange, cartes, comptes locaux) ; Amzara donne accès aux moyens internationaux. DiasPayQR **ne détient jamais de fonds**.

**Deux portes d'entrée** `[INSTIT.]` : **PAYQR** pour le paiement **en présentiel** chez un marchand vérifié (MerchantID, QR dynamique intégrant le montant) ; **DiasPayQR** pour le paiement **documenté, surtout à distance** (TrustToken, eQR logique, DiasPay Link). Le « jeton de présentation » de notre schéma (0016) est une brique de PAYQR.

**Phases du client** `[CAHIER §6]` :

| Phase | Contenu |
|---|---|
| 1 — MVP commercial | Demande documentée ; réception et vérification par le payeur ; TrustToken et TrustLink ; justificatifs ; notifications sécurisées ; paiements via TrustPayWay ; **paiements commerçants** ; paiements familiaux ; échéanciers ; historique et reçus ; contestations simples ; tableau de bord demandeur et payeur |
| 2 — Extension | Conditionnels ; par étapes ; partagés ; récurrents ; scolaires ; médicaux ; immobiliers ; preuve de livraison ; entreprises ; associations ; remboursements avancés ; API et SDK marchands |
| 3 — Écosystème | TrustScore ; TrustVault avancé ; TrustAnalytics ; arbitrage et médiation ; institutionnels ; crowdfunding ; escrow avancé ; interopérabilité internationale ; partenaires et développeurs ; IA |

**Priorités commerciales du Dr** `[CAHIER, fin]` : (1) paiement familial avec justificatifs ; (2) paiement conditionnel avec preuve de réalisation ; (3) paiement fractionné et multi-contributeurs.

**Pilote proposé** (K11, réduction de la phase 1, **à faire valider**) : paiement familial avec justificatifs (scolarité, santé, loyer) + échéances + un commerçant simple (K8).

## 2. Modèle des statuts

### 2.1 Trois niveaux et un dossier de litige (K5, délégué par le Dr)

| Niveau | Statuts |
|---|---|
| **Opération** (dossier parent : échéancier, projet ; table `transactions`) | `DRAFT`, `PENDING_REVIEW` (facultatif, revue de risque, hors liste du Dr), `IN_REVIEW` (sous-état de la revue), `ACTIVE`, `SUSPENDED`, `CLOSED`, `CANCELLED` |
| **Demande de paiement** (échéance ; table `tranches`, vue `payment_requests`) | `DRAFT` (y compris « programmée »), `SUBMITTED`, `INFO_REQUESTED`, `ACCEPTED`, `PAID`, `REFUNDED` (partiel ou total via `refunded_minor`), `REJECTED`, `EXPIRED`, `CANCELLED` |
| **Tentative de paiement** (`payment_attempts`) | `INITIATED`, `PENDING`, `CONFIRMED`, `FAILED` |
| **Litige** (`disputes`), dossier distinct | `OPEN`, `AWAITING_RESPONSE`, `IN_MEDIATION`, `RESOLVED` ; issues `NO_ACTION`, `REFUND_FULL`, `REFUND_PARTIAL`, et en `CONDITIONAL` `FUNDS_RELEASED`, `FUNDS_RETURNED`. Transitions internes choisies par l'assistant : **à valider** |

En `CONDITIONAL`, `funds_state` (`HELD`, `RELEASED`, `RETURNED`) suit la conservation des fonds par le partenaire ; en `DIRECT`, il vaut `NONE`.

### 2.2 Transitions de la demande de paiement

`DRAFT → SUBMITTED` (initiateur, ou système à la date prévue) ; `SUBMITTED → INFO_REQUESTED` (payeur, motif obligatoire) ; `INFO_REQUESTED → SUBMITTED` (initiateur, réponse) ; `SUBMITTED → ACCEPTED` (payeur, « Accepter et payer » : crée la contribution et la tentative ; refusé si suspension, témoin bloquant en attente, plafond dépassé, devis invalide, demande échue, jeton révoqué) ; `ACCEPTED → PAID` (système, tentative confirmée et contributions suffisantes) ; `ACCEPTED → SUBMITTED` (système, toutes les tentatives échouées) ; `SUBMITTED | INFO_REQUESTED → REJECTED` (payeur, motif obligatoire, final) ; `DRAFT | SUBMITTED | INFO_REQUESTED → CANCELLED` (initiateur, avant paiement) ; `SUBMITTED | INFO_REQUESTED → EXPIRED` (système) ; `PAID → REFUNDED` (système, remboursement exécuté).

**Un litige ne modifie jamais le statut financier d'une demande payée** `[CAHIER cas 16]`. Avant paiement, il pose `on_hold` et suspend l'opération.

## 3. Libellés de suivi demandés par le Dr

Le Dr liste 13 statuts de suivi pour le tableau de bord du demandeur et délègue leur définition précise `[MESSAGE cas 1 étape 6]`. Pour un échéancier, il demande aussi de suivre les échéances payées, impayées, **en retard** ou contestées `[MESSAGE cas 1]`. Correspondance **proposée** `[NOUS]`, à faire valider avec le livrable 6 :

| Libellé du Dr | Déduit de |
|---|---|
| Brouillon | Demande `DRAFT` |
| Soumise | `SUBMITTED`, avant l'envoi de la notification |
| Notification envoyée | `SUBMITTED` + événement de notification |
| Reçue par le payeur | `SUBMITTED` + `first_viewed_at` (événement « demande reçue ») |
| En cours de vérification | `SUBMITTED` + consultation d'au moins une pièce par le payeur (événement « pièce consultée ») |
| Informations complémentaires demandées | `INFO_REQUESTED` |
| En attente de validation | Témoin bloquant en attente, ou opération en `PENDING_REVIEW` / `IN_REVIEW` |
| Acceptée | `ACCEPTED` (acceptation enregistrée) |
| Paiement en cours | `ACCEPTED` avec une tentative `INITIATED` ou `PENDING` |
| Payée | `PAID` |
| Contestée | Litige non `RESOLVED` sur la demande ; statut financier inchangé |
| Rejetée | `REJECTED` |
| Expirée | `EXPIRED` |
| *Ajouts nécessaires* : Annulée, Remboursée | `CANCELLED` ; `REFUNDED` (partiel ou total) |
| *Échéancier* : En retard | Échéance dont la date est passée, non payée et non finale (**à modéliser**, indicateur calculé, pas un statut) |

## 4. TrustToken et DiasPay Link (TrustLink)

**Règle du client** : chaque demande et chaque échéance a son **propre TrustToken et son propre TrustLink**, générés à la soumission `[CAHIER §1, cas 3, cas 8, §3.C ; MESSAGE cas 1 étape 4]`. Le TrustToken est l'« identité numérique » de l'opération `[INSTIT.]`. **Aucune image de QR** n'est nécessaire pour les demandes : c'est un mécanisme électronique de référencement et de vérification `[MESSAGE cas 1 étape 4]`. Le nom institutionnel du TrustLink est **DiasPay Link** `[INSTIT.]`.

| Règle | Source | État |
|---|---|---|
| Un jeton par demande, émis à la soumission, **quel que soit le mode de règlement**, sans condition de réglage | `[CAHIER §1, cas 8]` | Fait (0028, 0031) |
| Le TrustLink n'existe et ne s'ouvre **que dans l'application**, après authentification ; il ouvre l'espace de vérification de la demande | `[MESSAGE cas 2 A]`, `[INSTIT. DiasPay §6]` | Serveur prêt ; espace de vérification : lot Y |
| Les canaux externes n'envoient qu'un texte fixe sans lien, nom ni montant | `[MESSAGE]`, `[CAHIER §3.D]` | Fait et testé |
| Référence de 18 caractères hexadécimaux, affichée groupée par 4 ; aucune donnée sensible | `[NOUS]` | Fait |
| Révocation (initiateur avant paiement, administrateur non partie à tout moment), réémission, révocation automatique à chaque statut final de la demande et à l'annulation de l'opération | `[CAHIER 5.1]` | Fait, dans les deux modes |
| Validité : **jusqu'au paiement, le jeton suit l'échéance de la demande, dans les deux modes** (vide tant qu'aucune durée n'est fixée) ; en `CONDITIONAL`, `token_ttl_days` (7) court à partir du paiement, pour la confirmation | `[CAHIER 5.1]` ; règle `[NOUS]` | Fait (0028, 0031) |
| Résolution par le payeur et l'initiateur seulement (le prestataire aussi en `CONDITIONAL`) ; même réponse pour une référence inconnue ou étrangère ; plus de 10 échecs par heure → refus et événement suspect | `[CAHIER 5.1]` | Fait |
| Un jeton révoqué ou absent bloque le paiement (`TOKEN_REVOKED`) | `[CAHIER 5.1]` | Fait |
| Signature cryptographique réelle (`kid`, clés publiques) | `[CAHIER 5.1]` | **Simulée** jusqu'au TrustEngine (phase 2) |
| QR d'image (`DPQ1:<référence>:<kid>:<signature>`) | `[NOUS]`, lot 2 | Conservé pour `CONDITIONAL` derrière `eqr_image_enabled` (`false`) |
| **QR de présentation PAYQR** : jeton opaque à rotation, usage unique, qui lie la demande au payeur sans autoriser le paiement ; nom du commerçant et montant affichés avant toute autorisation | `[INSTIT. PAYQR]`, K4, `[CAHIER 5.2]` | Schéma SQL (0016) ; liaison au payeur invité corrigée (0026) ; pas de client |

## 5. Acteurs, enrôlement, témoins

### 5.1 Acteurs

Demandeur ou initiateur (particulier, ami, famille, commerçant, prestataire, établissement) ; payeur ; bénéficiaire final s'il diffère du demandeur `[MESSAGE cas 1 étape 2]` ; témoin ou tiers de confiance ; administrateur ou médiateur `[CAHIER cas 16]` ; bureau de contrôle (enrôlement des institutions, fraude, médiation, revue de risque facultative) ; partenaires (TrustPayWay, Amzara, KYC). Rôles **par opération** + rôles de plateforme (`USER`, `VALIDATOR`, `ADMIN`). Un validateur ou administrateur n'est jamais partie au dossier qu'il traite (RG-03, RG-09 ; `[CAHIER 5.2]` séparation des fonctions).

### 5.2 Enrôlement (K3)

| Niveau | Exigences | Peut |
|---|---|---|
| N0 | Téléphone (ou e-mail) vérifié, automatique | Payer (dans les plafonds de N0) |
| N1 | Pièce d'identité + selfie, partenaire KYC | Initier une demande en particulier |
| N2 | N1 du représentant, RCCM, NIU, justificatif d'activité ; KYC + revue interne | Initier en commerçant ou prestataire |
| N3 | Documents légaux, mandat ; revue manuelle du bureau | Initier en institution (hôpital, école…) |

Le niveau, le numéro de téléphone (recopié du numéro vérifié) et, **à partir de N1, le nom** ne sont jamais modifiables par leur titulaire : le payeur voit l'identité vérifiée du demandeur `[MESSAGE cas 2 B]`, `[CAHIER 5.1]`. Pièces d'identité dans le bucket privé `identity`, consultations journalisées. **Plafonds par niveau non fournis** : sans plafond, tout paiement est refusé hors développement (`LIMITS_NOT_CONFIGURED`). Le cahier exige une **vérification renforcée** en cas d'urgence `[CAHIER cas 22]` et une **MFA selon le risque** `[CAHIER 5.2]` : seuils à définir.

### 5.3 Témoins (passe 3, non implémentés)

| Règle | Source |
|---|---|
| Deux voies : le **payeur désigne** un témoin ; le **demandeur sollicite** un témoin parmi des personnes **préalablement approuvées par le payeur** | `[CAHIER cas 25]`, `[MESSAGE cas 1 étape 3]` |
| Le témoin peut confirmer, confirmer partiellement, signaler une anomalie, refuser, joindre ses propres justificatifs | `[CAHIER cas 25]` |
| Invitation sécurisée, vérification de son identité, consentement explicite, plusieurs témoins possibles, conflits d'intérêts gérés, historique | `[CAHIER cas 25]` |
| Sa déclaration est **toujours une déclaration**, jamais une certification ni une expertise | `[CAHIER cas 25]`, K14 |
| Facultatif ; **bloquant seulement si le payeur l'a configuré** | K2 ; règle de blocage : `[NOUS]` |
| Peut valider l'avancement d'une étape (expert, architecte) | `[CAHIER cas 6, cas 25]` |

## 6. Justificatifs (TrustVault)

| Module | Pièces (O = obligatoire, F = facultative) | Source |
|---|---|---|
| Santé | Devis ou facture proforma (O, sensible) + **référence minimale du patient** (code ou initiales, jamais un nom complet) | K13, `[CAHIER cas 10]` |
| Scolarité | Attestation d'inscription (O) ; échéancier de l'école (F). Le Dr cite aussi le nom de l'établissement et l'identité de l'élève | D2, `[MESSAGE cas 1]` |
| Loyer | Bail (O) ; dernière quittance (F) | D2 |
| Agro, Immobilier, Terrain (vague 2, désactivés) | Une pièce (O), valeurs provisoires | À définir avec le client et le notaire |

Jusqu'à **3 fichiers par type**, **10 Mo** chacun, JPEG, PNG ou PDF ; photos réencodées (GPS retiré, vérifié sur le web, **à vérifier sur téléphone**) ; **empreinte SHA-256** calculée par le client et figée par la base ; détection de la **réutilisation d'une même pièce** sans fuite `[CAHIER innov. C]` ; pièces d'une demande soumise **immuables** ; chaque consultation est journalisée. Le payeur juge de la suffisance des pièces : l'application ne le fait pas.

## 7. Paiement, devises, remboursements, litiges

- Paiement déclenché **seulement** quand le payeur clique sur « Payer » après examen `[MESSAGE cas 2 C]`. Résultat reçu par **événement du partenaire** (signature vérifiée, idempotent, tolérant à l'ordre inversé) et répercuté automatiquement sur la demande et dans les notifications.
- Idempotence : clé unique par tentative ; au plus une tentative en cours ou confirmée par contribution `[CAHIER 5.2]`.
- Devise de la demande canonique (FCFA en phase 1) ; montant indicatif dans la devise du payeur ; taux, source, frais (service, change, moyen de paiement) et total débité **affichés avant autorisation** `[CAHIER cas 13]` ; devis figé, à usage unique. Seule la parité EUR/XAF est posée en développement ; aucun taux USD inventé (`QUOTE_UNAVAILABLE`) ; sans barème, aucun frais.
- Journal financier **à double entrée**, miroir des mouvements du partenaire ; contrepassation, jamais de modification ; rapprochement automatique `[CAHIER 5.2]`.
- Remboursement : jamais au-delà de « payé moins déjà remboursé » ; total ou partiel ; lié à la transaction d'origine `[CAHIER cas 15]` ; exécution **manuelle** au pilote (`mark_refund_executed`).
- Litige : motif, preuves, réponse du demandeur, échanges contradictoires, médiation, décision motivée, journal non altérable `[CAHIER cas 16]`. Délais de réponse et appel : **à définir**.

## 8. Plans de paiement

Types : `SINGLE`, `PARTIAL` (≥ 2 tranches, montants libres), `INSTALLMENTS` (2 à 12 tranches, montants égaux modifiables), `RECURRING` (hebdomadaire, mensuel, trimestriel ; 2 à 60 échéances). Les montants variables du prêt immobilier cité par le Dr (75 000, 75 000, 70 000… 45 000) relèvent de `PARTIAL` ou d'`INSTALLMENTS` modifié `[MESSAGE cas 1]`. Chaque échéance garde son identifiant, son jeton et ses preuves `[CAHIER cas 8]`. Somme des tranches = montant total (RG-01) ; dates croissantes ; montants entiers en unités mineures (FCFA sans décimales). Une échéance datée est soumise automatiquement avant sa date (RG-12, `activation_lead_days` = 7) ; l'opération est close quand toutes ses demandes sont finales (RG-13).

## 9. Notifications

Créées côté serveur à partir du journal ; elles stockent l'événement, traduit à l'affichage. Gabarits externes (SMS, e-mail, WhatsApp) **fixes, sans lien, sans montant, sans nom** ; l'e-mail et WhatsApp rappellent que DiasPay n'envoie jamais de lien de paiement `[CAHIER §3.D]`. Le cahier prévoit aussi une **notification urgente** pour les demandes prioritaires `[CAHIER cas 22]` (non prévu au pilote).

## 10. Parcours

**Livrés dans l'application mobile** (lots 1 à 4, adaptés a minima au modèle v2) : langue, présentation, connexion par téléphone, code, profil, biométrie ; création d'un besoin en 6 étapes ; liste et détail des opérations ; paiement ; litige (ouverture, suivi) ; reçu et export PDF ; alertes ; profil ; sécurité.

**Livré au back-office** (lot 5) : connexion avec second facteur ; file de revue (`PENDING_REVIEW` seulement depuis la v2) ; preuves de jalons ; litiges ; journal d'audit avec vérification de la chaîne et export CSV.

**À concevoir (lot Y), dans l'ordre des priorités du Dr** :
1. **Espace de vérification du payeur**, ouvert par le DiasPay Link : identité du demandeur, montant, objet, prestation, justificatifs, validations de témoins, historique ; quatre actions (accepter et payer, demander des informations, contester, rejeter) ; détail des frais et du total ; validation biométrique `[MESSAGE cas 2 B]`, `[INSTIT. DiasPay §6]`.
2. **Initiation d'une demande par un prestataire ou un tiers enrôlé** `[MESSAGE cas 1]`.
3. **Tableau de bord du demandeur et du payeur** avec les libellés du §3 `[CAHIER phase 1 n° 12]`.
4. Enrôlement (N1 à N3), acceptation de l'échéancier, devis et frais.
5. Commerçant simple et QR dynamique PAYQR (selon K8).
6. Témoins.
7. Back-office : files d'enrôlement, de signalements et de médiation.

## 11. Conventions

- Un payeur unique avec une contribution du montant total en phase 1 ; structure multi-contributeurs prête (K9).
- Invitation par téléphone, rattachée automatiquement à l'inscription du numéro ; le numéro du profil n'est pas modifiable par son titulaire ; unicité sur le numéro normalisé.
- Brouillon jamais audité : supprimé définitivement ; dossier audité : jamais effacé (D4).
- « L'étranger au dossier » ne voit ni ne devine l'existence d'une demande ou d'un jeton.
- Dates seules (AAAA-MM-JJ) : attention aux décalages de fuseau.

## 12. Les 25 cas d'usage

Cartographie dans `ALIGNEMENT-CAHIER-EXTENSION.md` §4, **datée d'avant les réponses écrites du Dr et l'ancien lot X**. Elle sera remplacée par le livrable 1 (cartographie exhaustive) de la vague 1.
