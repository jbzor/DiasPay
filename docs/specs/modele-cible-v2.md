# Modèle cible v2 — après le kickoff

Spécification de travail (pas une mise à jour du cahier des charges). Elle traduit les décisions K1 à K14 en un modèle de données, des machines d'états et des règles. Le lot X révisé l'implémente.

## 1. Décisions retenues et leur effet

| Décision | Effet sur le modèle |
|---|---|
| K1 Paiement direct par défaut, séquestre en phases 2 et 3 | Champ `settlement_mode` (`DIRECT` ou `CONDITIONAL`) sur l'opération. **Tous les modules de la vague 1 passent en `DIRECT`.** Le blocage, la confirmation par le prestataire et le délai de contestation actuels ne servent plus que pour `CONDITIONAL` |
| K2 Le payeur décide ; témoin facultatif ; le bureau ne valide pas chaque demande | `platform_review` vaut `NEVER` par défaut. Le bureau traite l'enrôlement, les signalements de fraude et la médiation. Le témoin ne bloque le paiement que si le payeur l'a configuré comme condition |
| K3 Enrôlement N0 à N3 avec plafonds | `profiles.enrolment_level`, dossiers d'enrôlement, plafonds par niveau (valeurs à fournir, **non inventées**) |
| K4 QR en présentiel, dynamique, jamais un lien | Jeton de présentation à courte durée de vie. Le QR n'ouvre qu'une référence opaque dans l'application, après authentification. Le sens de scan s'inverse : c'est le payeur qui scanne l'écran du commerçant |
| K5 Trois niveaux de statuts + litige distinct | Opération, demande de paiement, tentative de paiement ; le litige devient un dossier séparé et **n'est plus un statut** |
| K6 Autorisation du payeur à chaque échéance | Le payeur accepte le principe du plan (une fois), puis autorise chaque échéance ; chaque échéance garde son identifiant, son jeton et ses preuves |
| K7 Un paiement exécuté reste exécuté | La contestation après paiement ouvre un litige ; l'issue passe par un remboursement lié à l'original, avec contrepassation comptable. Avant paiement, la contestation suspend la demande |
| K9 Demande parent et contributions dès la phase 1 | Table `contributions` dès maintenant ; une demande à payeur unique a une contribution du montant total |
| K10 Devise canonique = celle de la demande | Cotations de change figées avec source et horodatage, détail des frais affiché avant autorisation |
| K12 Couche d'adaptation et simulateur TrustPayWay | `PaymentPort` v2, événements entrants, simulateur au même chemin de traitement que le vrai partenaire |
| K13 Données de santé minimales | Pour le type « Santé » du pilote : facture ou devis seulement, et une **référence** minimale du patient ; **plus de pièce d'identité du bénéficiaire ni de certificat médical** |

Ces décisions remplacent D6 (contrôles automatiques comme étape de la validation systématique) et D8 (prise en charge d'un dossier) pour le flux par défaut. D7 (second facteur du personnel), D5 et D2 sont conservées, D2 étant corrigée pour la santé.

## 2. Entités

**Opération** (table `transactions` conservée) : un dossier parent, par exemple un échéancier ou un projet.

| Champ | Rôle |
|---|---|
| `module_code` | Type de besoin (donnée configurable, voir lot X) |
| `settlement_mode` | `DIRECT` (défaut) ou `CONDITIONAL` |
| `status` | Voir section 3.1 |
| `accepted_at`, `accepted_by` | Le payeur a accepté le principe du plan (K6) |
| `initiator_id` | L'initiateur : demandeur, prestataire ou tiers enrôlé |

**Demande de paiement** (table `tranches` conservée ; **le nom SQL ne change pas** pour ne pas réécrire toutes les fonctions, une vue `payment_requests` en lecture seule la reflète, et le code TypeScript parle de `PaymentRequest`) :

| Champ | Rôle |
|---|---|
| `target_amount_minor`, `currency` | Montant canonique de la demande, dans sa devise |
| `scheduled_for`, `expires_at` | Échéance prévue et date d'expiration |
| `status` | Voir section 3.2 |
| `on_hold` | Vrai tant qu'un litige est ouvert **avant** paiement (suspend sans changer le statut financier) |
| `refunded_minor` | Montant déjà remboursé (qualifie « Remboursée » partiellement ou totalement) |
| `funds_state` | `NONE` en `DIRECT` ; en `CONDITIONAL` : `HELD`, `RELEASED`, `RETURNED` (remplace les anciens statuts `PAID_LOCKED`, `CONFIRMED`, `RELEASED`) |
| `first_viewed_at` | Première ouverture par le payeur |

**Contribution** (`contributions`, nouvelle) : (demande, payeur ou invité, montant, statut `PENDING`, `CONFIRMED`, `FAILED`, `REFUNDED`). Une demande est payée quand la somme des contributions confirmées atteint son montant cible. En phase 1, il n'y a qu'une contribution du montant total, créée quand le payeur accepte et paie.

**Tentative de paiement** (`payment_attempts`, nouvelle) : (contribution, clé d'idempotence unique, fournisseur, statut `INITIATED`, `PENDING`, `CONFIRMED`, `FAILED`, devise et montant débités, cotation de change, détail des frais, référence du partenaire, dates). Une demande peut avoir plusieurs tentatives.

**Cotation de change** (`fx_quotes`) : devises, taux, **source**, horodatage, expiration courte, frais par poste (service, change, moyen de paiement), total débité. Conservée pour chaque paiement.

**Litige** (`disputes` conservée, redéfinie) : dossier distinct rattaché à une demande. Statuts `OPEN`, `AWAITING_RESPONSE`, `IN_MEDIATION`, `RESOLVED`. Issues : `NO_ACTION`, `REFUND_FULL`, `REFUND_PARTIAL`, et en `CONDITIONAL` `FUNDS_RELEASED` ou `FUNDS_RETURNED`. Messages et pièces dans `dispute_messages`. Un litige **ne modifie jamais** le statut financier d'une demande payée.

**Remboursement** (`refunds`, nouveau) : lié à la tentative et à la demande d'origine, montant, motif, statut `REQUESTED`, `EXECUTED`, `FAILED`, auteur, référence du partenaire. Jamais au-delà du montant payé moins les remboursements déjà faits. Pour le pilote, l'exécution est **manuelle** (un administrateur saisit la référence du partenaire), et l'écriture de contrepassation est posée automatiquement.

**Enrôlement** : `profiles.enrolment_level` (`N0` à `N3`), `enrolment_cases` (profil, niveau demandé, pièces, statut `SUBMITTED`, `IN_REVIEW`, `APPROVED`, `REJECTED`, relecteur, dates), `enrolment_limits` (plafonds par niveau, **valeurs fournies par le client et le conseil juridique, aucune valeur par défaut inventée**).

**Témoin** (`witnesses`) : (demande, utilisateur ou invité, statut `INVITED`, `ACCEPTED`, `DECLINED`, `CONFIRMED`, `PARTIAL`, `ANOMALY`, `REFUSED`, déclaration, pièces, conflit d'intérêts déclaré, `blocking`). `blocking` n'est vrai que si le payeur l'a configuré ainsi. Une déclaration est affichée comme telle, jamais comme une certification.

**Événements de la TrustTimeline** (journal chaîné existant) : notification envoyée, demande reçue, demande consultée, pièce consultée, information demandée, réponse, témoin sollicité, déclaration de témoin, acceptation, tentative de paiement (chaque changement), paiement confirmé, remboursement, litige (chaque changement), suspension. « Notification envoyée », « reçue » et « en vérification » sont des **événements**, pas des statuts (K5).

## 3. Machines d'états

### 3.1 Opération

| De | Vers | Acteur | Condition |
|---|---|---|---|
| `DRAFT` | `ACTIVE` | initiateur, ou système | À la soumission si `platform_review = NEVER` ; sinon `PENDING_REVIEW` |
| `DRAFT` | `PENDING_REVIEW` | initiateur | Module avec `platform_review` ≠ `NEVER` ou règle de risque (statut **facultatif**, hors liste K5, à valider) |
| `PENDING_REVIEW` | `ACTIVE` ou `CANCELLED` | personnel (bureau) | Revue de risque |
| `ACTIVE` | `SUSPENDED` | système | Litige ouvert avant paiement, ou blocage pour fraude par le bureau |
| `SUSPENDED` | `ACTIVE` | personnel | Levée de la suspension |
| `ACTIVE` | `CLOSED` | système | Toutes les demandes sont dans un état final |
| `DRAFT`, `ACTIVE` | `CANCELLED` | initiateur | Aucune demande payée (sinon, annulation des demandes restantes seulement) |

### 3.2 Demande de paiement

| De | Vers | Acteur | Remarque |
|---|---|---|---|
| `DRAFT` | `SUBMITTED` | initiateur, ou système à la date prévue | La demande devient visible du payeur |
| `SUBMITTED` | `INFO_REQUESTED` | payeur | Motif obligatoire |
| `INFO_REQUESTED` | `SUBMITTED` | initiateur | Réponse, pièces éventuelles |
| `SUBMITTED` | `ACCEPTED` | payeur | Action « Accepter et payer » ; crée la contribution et la tentative. Impossible si `on_hold`, si une condition de témoin est en attente, ou si le plafond du niveau est dépassé |
| `ACCEPTED` | `PAID` | système | Tentative `CONFIRMED` et somme des contributions suffisante |
| `ACCEPTED` | `SUBMITTED` | système | Toutes les tentatives échouées : le payeur peut réessayer |
| `SUBMITTED`, `INFO_REQUESTED` | `REJECTED` | payeur | Motif obligatoire, final |
| `DRAFT`, `SUBMITTED`, `INFO_REQUESTED` | `CANCELLED` | initiateur | Avant paiement |
| `SUBMITTED`, `INFO_REQUESTED` | `EXPIRED` | système | À `expires_at` |
| `PAID` | `REFUNDED` | système | Remboursement exécuté ; `refunded_minor` indique partiel ou total |

`PAID` et `REFUNDED` ne changent jamais à cause d'un litige. En `CONDITIONAL`, `funds_state` évolue ensuite selon les conditions de libération (ancienne logique de confirmation et de délai).

### 3.3 Tentative de paiement

`INITIATED → PENDING → CONFIRMED` ou `FAILED`, uniquement par des événements du partenaire (ou du simulateur) passant par le même chemin. Une tentative `CONFIRMED` est finale.

## 4. Sécurité du lien et du QR (K4)

- **Aucun lien de paiement ne quitte l'application.** Les canaux externes envoient un texte fixe sans adresse, sans nom ni montant.
- **Jeton de présentation** (`presentation_tokens`) : référence opaque, durée de vie courte (valeur configurable, point ouvert), rotation continue côté commerçant, **une seule prise en charge** (`claim`) ; la prise en charge **lie** la demande à l'utilisateur connecté, mais ne vaut pas autorisation de payer.
- À la prise en charge, l'application affiche **toujours** le nom du commerçant et le montant avant toute autorisation, puis le détail des frais et le total débité.
- Révocation immédiate possible ; limitation des tentatives ; événements suspects journalisés.

## 5. Compatibilité avec l'existant

| Existant | Devenir |
|---|---|
| Statuts de transaction `SUBMITTED`, `IN_REVIEW`, `VALIDATED`, `TOKEN_ISSUED`, `IN_PROGRESS`, `DISPUTED` | Remplacés par la section 3.1 ; `IN_REVIEW`, `VALIDATED` ne servent plus qu'au parcours `PENDING_REVIEW` |
| Statuts de tranche `PLANNED`, `AWAITING_PAYMENT` | `DRAFT` (programmée) et `SUBMITTED` |
| `PAID_LOCKED`, `CONFIRMED`, `RELEASED`, `EVIDENCE_SUBMITTED` | Deviennent `PAID` + `funds_state` et conditions de libération (`CONDITIONAL` seulement) |
| `DISPUTED` (statut de tranche) | Supprimé ; dossier de litige distinct |
| `release_mode`, `contest_hours`, double validation | Conservés pour `CONDITIONAL` et `platform_review` |
| Scan du prestataire après paiement (lot 2) | Conservé pour `CONDITIONAL` uniquement ; le scan du **payeur** sur l'écran du commerçant est un nouveau parcours (lot ultérieur) |
| File de validation du back-office (lot 5) | Ne reçoit plus que les dossiers `PENDING_REVIEW` ; les nouvelles files (enrôlements, signalements, médiation) sont à concevoir |
| Journal d'audit chaîné, RLS, stockage privé, alertes, temps réel | Conservés |

**Données de développement** : aucune donnée de production n'existe. La migration peut convertir au mieux ou, plus simplement, s'accompagner d'un `demo_reset()` ; décris le choix dans l'ADR.

## 6. Points encore ouverts (à ne pas inventer)

1. **Plafonds par niveau** (par opération, par jour, par mois) : valeurs du client, du partenaire de paiement et du conseil juridique.
2. **Durée de vie et fréquence de rotation du QR de présentation** (par exemple de 30 à 120 secondes) : à fixer avec le partenaire et en test.
3. **Durée d'expiration d'une demande** par module.
4. **Seuil du mode `RISK_BASED`** (montant, première demande d'un initiateur) : à définir avec le bureau.
5. **Rétrofacturation** : possible selon le réseau de la carte, impossible sur certains rails (mobile money) ; les conditions générales doivent fixer délais et recours.
6. **Durées de conservation des données** (en particulier santé) : atelier juridique.
7. **Disponibilité des cotations de change** auprès du partenaire (la taux figé suppose que l'API le permette).
