# DiasPayQR — Machine à états des demandes de paiement

Nov 17, 2026 · @jb.nzudie

## Objet et statut

Ce document répond au livrable 6 (« la machine à états des demandes de paiement ») de la section 7 du cahier d’extension. **C’est une version de travail, soumise au Dr Dongmo pour validation écrite.** Elle décrit les statuts tels qu’ils sont imposés par la base au 17 novembre 2026 (`master`, migrations 0001 à 0031) et signale ce qui reste à décider.

Le Dr a demandé que les statuts soient « définis précisément dans le workflow métier » \[Message, cas 1 étape 6\] : c’est l’objet de ce document. Sources : cahier d’extension (cas 1, 8, 15, 16 ; §5.2), message du Dr (cas 1 et 2), réponses écrites aux questions K5 et K7, et la spécification du TrustToken et du DiasPay Link (livrables 7 et 8).

## En bref

**Une demande de paiement passe par neuf statuts au plus ; trois autres niveaux l’entourent : l’opération qui la contient, les tentatives de paiement qui l’exécutent, et le litige éventuel, qui est un dossier à part.**

| Niveau | Ce qu’il représente | Statuts |
| --- | --- | --- |
| Opération | Le dossier : un besoin, un échéancier, un projet | Brouillon, en revue (facultatif), active, suspendue, clôturée, annulée |
| Demande de paiement | Ce que le payeur examine et décide ; une échéance en est une | Brouillon, soumise, informations demandées, acceptée, payée, remboursée, rejetée, expirée, annulée |
| Tentative de paiement | Un essai d’exécution par le partenaire de paiement | Lancée, en attente, confirmée, échouée |
| Litige | Une contestation, instruite à part | Ouvert, en attente de réponse, en médiation, résolu |

Deux règles structurent l’ensemble. **Un paiement exécuté reste exécuté** : un litige ne change jamais le statut d’une demande payée ; un remboursement est une opération nouvelle, liée à la première \[Cahier, cas 16\]. **Seul le payeur fait passer une demande à « acceptée »**, après examen ; le bureau de contrôle n’intervient que sur l’opération (revue de risque facultative, suspension pour fraude) et dans les litiges (K2).

## La demande de paiement en un coup d’œil

**Une demande avance de « brouillon » à « payée » par trois gestes : la soumission par l’initiateur, l’acceptation par le payeur, la confirmation par le partenaire de paiement.** Tous les autres chemins mènent à une fin sans paiement, ou ramènent la demande à « soumise ».

&#91;embedded content: demande de paiement · 9 statuts, 10 transitions\]

La boucle entre « soumise » et « informations demandées » peut se répéter ; celle entre « acceptée » et « soumise » ne joue que si toutes les tentatives de paiement échouent.

## Transitions de la demande, une par une

**Toute transition qui ne figure pas dans ce tableau est refusée par la base**, quel que soit l’appelant ; chaque transition acceptée est horodatée, attribuée à son auteur et écrite dans le journal d’audit chaîné.

| De | Vers | Qui | Conditions et effets | Refus possibles |
| --- | --- | --- | --- | --- |
| Brouillon | Soumise | Initiateur, ou système à la date prévue (7 jours avant l’échéance) | La demande devient visible du payeur ; le TrustToken est émis ; le payeur reçoit un message fixe sans lien | Pièces obligatoires manquantes ; payeur absent ; niveau d’enrôlement insuffisant |
| Soumise | Informations demandées | Payeur | Motif obligatoire ; l’initiateur est prévenu | — |
| Informations demandées | Soumise | Initiateur | Réponse, pièces éventuelles | — |
| Soumise | Acceptée | Payeur (« Accepter et payer ») | Après validation biométrique ; crée la contribution et la tentative de paiement | Opération suspendue ; témoin bloquant en attente ; plafond dépassé (`LIMITS_NOT_CONFIGURED` si aucun plafond) ; devis invalide ; demande échue (`REQUEST_EXPIRED`) ; jeton révoqué (`TOKEN_REVOKED`) |
| Acceptée | Payée | Système | Événement signé du partenaire : tentative confirmée et contributions suffisantes ; en mode direct, le jeton est révoqué | — |
| Acceptée | Soumise | Système | Toutes les tentatives ont échoué ; le payeur peut réessayer | — |
| Soumise, Informations demandées | Rejetée | Payeur | Motif obligatoire ; statut final ; jeton révoqué | — |
| Brouillon, Soumise, Informations demandées | Annulée | Initiateur | Avant tout paiement ; jeton révoqué | — |
| Soumise, Informations demandées | Expirée | Système (contrôle horaire) | À l’échéance de la demande ; aucune durée n’est fixée aujourd’hui, donc aucune demande n’expire | — |
| Payée | Remboursée | Système | Remboursement exécuté par le partenaire ; partiel ou total ; jamais plus que « payé moins déjà remboursé » | — |

**Statuts finaux** : rejetée, expirée, annulée, remboursée ; une demande finale ne revient jamais en arrière. Une demande payée ne peut plus évoluer que vers « remboursée » ; en mode conditionnel, elle attend en outre la libération des fonds par le partenaire.

## L’opération, dossier parent

**Par défaut, une opération soumise devient active immédiatement : la revue par le bureau n’existe que si le type de besoin ou une règle de risque l’exige (aujourd’hui, aucun).** L’opération porte ce qui concerne le dossier entier : suspension, clôture, annulation.

| De | Vers | Qui | Conditions et effets |
| --- | --- | --- | --- |
| Brouillon | Active | Initiateur (soumission) | Revue plateforme réglée sur « jamais » (cas actuel de tous les types) ; les demandes datées sont soumises au fil du calendrier |
| Brouillon | En revue | Initiateur (soumission) | Type de besoin ou règle de risque exigeant une revue ; statut **facultatif**, hors de la liste du Dr |
| En revue | Active | Bureau (personne non partie au dossier) | Revue approuvée ; le bureau la prend d’abord en charge (sous-état « en cours d’examen ») |
| En revue | Annulée | Bureau | Revue refusée, motif obligatoire ; l’initiateur crée une nouvelle opération s’il le souhaite |
| Active | Suspendue | Système ou bureau | Litige ouvert avant paiement, ou suspension pour fraude ; aucune demande ne peut être payée ni ses fonds libérés |
| Suspendue | Active | Bureau | Levée de la suspension ou litige résolu |
| Active | Clôturée | Système | Toutes les demandes sont dans un statut final |
| Brouillon, Active | Annulée | Initiateur | Aucune demande payée ; sinon, seules les demandes restantes sont annulées ; les jetons des demandes annulées sont révoqués |

## Tentatives de paiement et contributions

**Une tentative change de statut uniquement sur un événement signé du partenaire de paiement ; aucune personne, pas même un administrateur, ne peut la marquer payée (la seule exception est le mode démonstration, refusé par le serveur hors développement).** Elle suit le chemin lancée → en attente → confirmée ou échouée ; une tentative confirmée est finale.

- **Contribution** : la part qu’un payeur s’engage à verser sur une demande. En phase 1, une seule contribution du montant total par demande ; la structure à plusieurs contributeurs existe déjà pour la phase 2 (cas 7 du cahier).
- **Idempotence** : chaque tentative porte une clé unique ; au plus une tentative en cours ou confirmée par contribution. Un même événement reçu deux fois, ou dans le désordre, ne produit qu’un seul effet \[Cahier §5.2\].
- **Effet sur la demande** : la demande passe à « payée » quand les contributions confirmées atteignent le montant ; si toutes les tentatives échouent, elle redevient « soumise » et le payeur peut réessayer.
- **Sans partenaire branché** : sur le projet de développement, hors démonstration, une tentative reste « en attente » tant que le simulateur de scénarios n’existe pas (passe 3).

## Le litige, un dossier à part

**Contester une demande ouvre un dossier de litige distinct : avant paiement, il suspend l’opération ; après paiement, il ne touche ni au statut de la demande ni à l’argent déjà versé** \[Cahier, cas 16\]. Les transitions internes du litige ont été choisies par notre équipe : elles sont à valider.

| De | Vers | Qui | Déclencheur |
| --- | --- | --- | --- |
| — | Ouvert | Payeur (ou partie au dossier) | Contestation avec motif et preuves ; avant paiement, l’opération est suspendue |
| Ouvert | En médiation | Partie adverse | Elle répond à la contestation |
| Ouvert, En médiation | En attente de réponse | Bureau (médiateur non partie) | Il demande une précision à une partie |
| En attente de réponse | En médiation | Partie concernée | Elle répond ou complète |
| Tout statut non résolu | Résolu | Administrateur non partie | Décision motivée avec une issue |

**Issues possibles** : aucune action ; remboursement total ; remboursement partiel ; et, en mode conditionnel seulement, libération des fonds au prestataire ou retour au payeur. Un remboursement décidé crée une opération de remboursement liée, exécutée par le partenaire (manuellement au pilote) et contrepassée dans le journal financier.

**Pas encore prévu**, alors que le cahier le demande : délais de réponse, appel ou réexamen \[Cahier, cas 16\]. Ces règles seront proposées avec la passe de médiation (phase 3 du cahier pour l’arbitrage avancé).

## Les 13 libellés de suivi demandés par le Dr

**Les 13 libellés du Dr \[Message, cas 1 étape 6\] seront tous affichés au demandeur ; ils sont calculés à partir des statuts et des événements du journal, si bien qu’aucun ne peut contredire l’état réel.** Plusieurs libellés correspondent au même statut (par exemple « soumise », « notification envoyée », « reçue », « en cours de vérification ») : ce qui les distingue est un événement daté. Correspondance proposée, à valider :

| Libellé du Dr | Calculé à partir de |
| --- | --- |
| Brouillon | Demande en brouillon |
| Soumise | Demande soumise, avant l’envoi du message au payeur |
| Notification envoyée | Demande soumise + événement d’envoi du message |
| Reçue par le payeur | Demande soumise + première ouverture par le payeur |
| En cours de vérification | Demande soumise + au moins une pièce consultée par le payeur |
| Informations complémentaires demandées | Demande en « informations demandées » |
| En attente de validation | Témoin bloquant en attente, ou opération en revue |
| Acceptée | Demande acceptée |
| Paiement en cours | Demande acceptée avec une tentative lancée ou en attente |
| Payée | Demande payée |
| Contestée | Litige non résolu sur la demande (le statut financier, lui, ne change pas) |
| Rejetée | Demande rejetée |
| Expirée | Demande expirée |

**Deux libellés à ajouter**, absents de la liste du Dr mais nécessaires : « Annulée » (demande annulée par l’initiateur) et « Remboursée », partiellement ou totalement.

**Ce qui n’existe pas encore** : l’événement d’envoi du message externe (aucun canal SMS, e-mail ou WhatsApp n’est branché) et l’écran du tableau de bord lui-même (lot Y). La consultation des pièces est déjà journalisée ; l’enregistrement de la première ouverture par le payeur est à vérifier dans le code.

## Échéanciers : payée, impayée, en retard, contestée

**Chaque échéance est une demande à part entière, avec son statut, son TrustToken et ses preuves ; « impayée » et « en retard » sont des indicateurs calculés, pas des statuts.** Le Dr demande de suivre les échéances payées, impayées, en retard ou contestées, avec un historique consolidé de l’opération \[Message, cas 1\] ; l’autorisation du payeur est demandée à chaque échéance (K6).

| Indicateur | Règle proposée |
| --- | --- |
| Payée | L’échéance est payée (ou remboursée en partie, avec la mention) |
| Impayée | L’échéance est soumise ou en attente d’informations, et pas encore payée |
| En retard | Impayée, et sa date d’échéance est passée — **à ajouter** : aucun indicateur ne la calcule aujourd’hui |
| Contestée | Un litige non résolu porte sur l’échéance |
| Programmée | L’échéance est encore en brouillon ; elle sera soumise automatiquement 7 jours avant sa date |

La vue consolidée de l’opération additionne, par devise, le montant total, le payé, le restant et le remboursé, et compte les échéances par indicateur. Elle sera dessinée dans le tableau de bord (lot Y).

## Le TrustToken selon le statut de la demande

**Le jeton est actif tant que la demande peut être payée, et seulement dans ce cas ; il est révoqué dès qu’elle ne peut plus l’être**, sauf en mode conditionnel, où il sert encore à confirmer la réception après paiement. Détail : spécification du TrustToken et du DiasPay Link (livrables 7 et 8).

| Statut de la demande | Mode direct | Mode conditionnel |
| --- | --- | --- |
| Brouillon | Aucun jeton | Aucun jeton |
| Soumise, Informations demandées | Actif | Actif |
| Acceptée | Actif | Actif |
| Payée | Révoqué ; référence conservée sur le reçu | Actif pour la confirmation, avec une durée qui court depuis le paiement ; puis « utilisé » |
| Rejetée, Expirée, Annulée | Révoqué | Révoqué |
| Remboursée | Révoqué | Révoqué (à vérifier dans le code) |

Correctif prévu : aujourd’hui, un administrateur non partie peut réémettre un jeton sur une demande terminée ; la réémission y sera refusée.

## À valider par le Dr et paramètres ouverts

**Cinq choix de notre équipe demandent l’accord du Dr ; deux valeurs restent à fixer : la durée d’expiration des demandes et les délais du litige.**

### Choix à valider

- [x] **Correspondance des 13 libellés** avec les statuts et événements (section « Les 13 libellés »), plus « Annulée » et « Remboursée ».
- [x] **« En retard » calculé**, non stocké : une échéance impayée dont la date est passée.
- [x] **Transitions internes du litige** (ouvert → en médiation → en attente de réponse → résolu), choisies par notre équipe.
- [x] **Revue par le bureau facultative** : par défaut aucune ; une revue refusée annule l’opération, et l’initiateur en crée une nouvelle.
- [x] **Remboursement en mode direct** : l’argent ayant été versé au prestataire, le remboursement lui est réclamé ; la lecture comptable est à confirmer avec le partenaire.

### Valeurs à fixer

| Paramètre | Qui la fournit | Effet tant qu’elle manque |
| --- | --- | --- |
| Durée d’expiration d’une demande, par type de besoin | Client | Aucune demande n’expire |
| Délais de réponse dans un litige, appel ou réexamen | Client, conseil juridique | Aucun délai imposé ; pas de procédure d’appel |

### Sources

Cahier d’extension fonctionnelle de DiasPayQR (cas 1, 7, 8, 15, 16 ; §5.2 ; §7) · Message du Dr préparant le kickoff (cas 1 étape 6, cas 2) · Réponses écrites du Dr aux questions K2, K5, K6 et K7 · Dépôt DiasPay : `docs/specs/modele-cible-v2.md`, `docs/decisions.md` (X2-v2, Xc-6, Xc-7), migrations 0014, 0028 et 0031.
