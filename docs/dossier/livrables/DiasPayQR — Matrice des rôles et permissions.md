# DiasPayQR — Matrice des rôles et permissions

Nov 17, 2026 · @jb.nzudie

## Objet et statut

Ce document répond au livrable 4 (« la matrice des rôles et permissions ») de la section 7 du cahier d’extension. **C’est une version de travail, soumise au Dr Dongmo pour validation écrite.** Elle décrit les droits tels que la base les impose au 17 novembre 2026 (`master`, migrations 0001 à 0031) ; ce qui reste à construire est signalé.

Sources : cahier d’extension (cas 1, 2, 16, 21, 25 ; §5.1 à §5.3), message du Dr (cas 1 et 2), réponses écrites aux questions K2, K3 et K14, et les livrables 6, 7 et 8 déjà produits.

## En bref

**Les droits d’une personne dépendent d’abord de sa place dans chaque dossier, pas de son profil : la même personne peut être payeur dans une opération et demandeur dans une autre.** Trois couches se combinent :

| Couche | Ce qu’elle décide | Valeurs |
| --- | --- | --- |
| Rôle dans l’opération | Ce qu’on peut faire sur ce dossier précis | Initiateur, demandeur, payeur, prestataire ; témoin à venir |
| Rôle de plateforme | Ce que le personnel peut faire sur les dossiers des autres | Utilisateur, validateur, administrateur |
| Niveau d’enrôlement | Ce qu’un utilisateur a le droit d’initier, et ses plafonds | N0 à N3 |

Trois règles s’appliquent partout. **Une personne étrangère au dossier ne voit rien et ne peut rien deviner** : même réponse qu’un dossier inexistant. **Un membre du personnel n’agit jamais sur un dossier dont il est partie** \[Cahier §5.2, séparation des fonctions\]. **Un visiteur non connecté n’a aucun droit**, ni en lecture ni en action.

## Les acteurs

**Huit acteurs, dont deux externes ; chacun le devient par un geste précis, jamais par une simple déclaration.**

| Acteur | Qui | Comment on le devient | Condition |
| --- | --- | --- | --- |
| Initiateur | Celui qui crée la demande : particulier, prestataire, commerçant, établissement | En créant le brouillon | N1 pour demander en particulier, N2 en commerçant ou prestataire, N3 en institution |
| Payeur | Celui qui examine et décide | Invité par son numéro de téléphone, rattaché à l’inscription de ce numéro ; ou créateur de son propre besoin | N0 suffit ; ses plafonds s’appliquent |
| Prestataire | Le bénéficiaire du paiement (école, hôpital, bailleur, fournisseur) | Désigné dans la demande | À préciser : doit-il être enrôlé ? |
| Témoin | Un tiers qui déclare ce qu’il a constaté | Désigné par le payeur, ou sollicité par le demandeur parmi des personnes approuvées par le payeur \[Cahier, cas 25\] ; \[Message, cas 1 étape 3\] | Identité vérifiée, consentement explicite ; **pas encore construit** |
| Validateur | Membre du bureau de contrôle | Désigné par la direction de DiasPay ; aujourd’hui créé par script, sans écran de gestion | Jamais partie au dossier traité |
| Administrateur | Responsable de la plateforme ; tranche les litiges | Désigné par la direction de DiasPay ; aujourd’hui créé par script | Jamais partie au dossier traité |
| Partenaire de paiement | TrustPayWay, et Amzara pour l’international | Contrat ; échange d’événements signés | Agit sur les tentatives de paiement seulement |
| Partenaire KYC | Vérifie les pièces d’identité | Contrat | Non désigné à ce jour |

## Qui peut faire quoi

**Seul le payeur décide du paiement ; seul l’initiateur modifie sa demande avant paiement ; le personnel n’intervient que sur l’opération et les litiges, et jamais sur un dossier dont il est partie.** « Validateur » et « administrateur » s’entendent toujours non parties au dossier. Une personne étrangère au dossier ne peut rien faire, et ne l’apprend pas.

| Action | Initiateur | Payeur | Prestataire | Témoin (à venir) | Validateur | Administrateur |
| --- | --- | --- | --- | --- | --- | --- |
| Créer et modifier un brouillon | Oui, selon son niveau | Oui, pour son propre besoin | Oui s’il initie (N2) | Non | Non | Non |
| Soumettre, annuler avant paiement | Oui | Non | Non | Non | Non | Non |
| Répondre à une demande d’informations | Oui | Non | Non | Non | Non | Non |
| Ouvrir le DiasPay Link, résoudre la référence | Oui | Oui | En mode conditionnel seulement | À décider | Non | Non |
| Demander des informations, rejeter | Non | Oui | Non | Non | Non | Non |
| Accepter le principe d’un échéancier | Non | Oui | Non | Non | Non | Non |
| Accepter et payer | Non | Oui, avec biométrie, dans ses plafonds | Non | Non | Non | Non |
| Désigner un témoin | Le solliciter, parmi les personnes approuvées par le payeur | Oui | Non | — | Non | Non |
| Déclarer (confirmer, signaler une anomalie) | Non | Non | Non | Oui | Non | Non |
| Confirmer la réception (mode conditionnel) | Non | Non | Oui, par scan | Non | Non | Non |
| Révoquer ou réémettre le jeton | Oui, avant paiement | Non | Non | Non | Non | Oui (réémission bientôt refusée sur une demande terminée) |
| Contester (ouvrir un litige) | Oui | Oui | À préciser | Non | Non | Non |
| Répondre dans un litige | Oui | Oui | À préciser | Non | Non | Non |
| Demander une précision dans un litige | Non | Non | Non | Non | Non | Oui |
| Trancher un litige, exécuter un remboursement | Non | Non | Non | Non | Non | Oui |
| Revue de risque d’une opération | Non | Non | Non | Non | Oui | Oui |
| Suspendre ou lever la suspension | Non | Non | Non | Non | Oui | Oui |
| Décider d’un enrôlement N3 | Non | Non | Non | Non | Oui | Oui |

Le paiement d’une demande, lui, n’est jamais déclaré par une personne : il résulte d’un événement signé du partenaire de paiement.

## Qui voit quoi

**Les parties voient leur dossier ; le personnel voit seulement ce que sa mission exige, et chaque ouverture d’une pièce est journalisée** \[Cahier §5.3\]. Les pièces ne sont jamais servies par une adresse permanente : chaque ouverture passe par une autorisation de courte durée (2 minutes pour le personnel).

| Donnée | Parties au dossier | Témoin (à venir) | Validateur | Administrateur |
| --- | --- | --- | --- | --- |
| Demande : montant, objet, statut, chronologie | Oui | Ce qui concerne sa déclaration | Si l’opération est en revue ou suspendue | En litige, et pour les remboursements |
| Justificatifs | Oui, chaque ouverture journalisée | À décider | En revue, ouverture journalisée | En litige, ouverture journalisée |
| Pièces sensibles (santé : devis, référence minimale du patient) | Oui, journalisé | Non | En revue seulement | En litige seulement |
| Pièces d’identité de l’enrôlement | Le titulaire seul | Non | Pour décider d’un enrôlement | Pour décider d’un enrôlement |
| Identité affichée (nom, numéro, niveau) | Celle des autres parties de son dossier | Celle des parties qui le concernent | Oui | Oui |
| Référence du TrustToken | Payeur et initiateur ; prestataire en mode conditionnel | À décider | Non | Non |
| Journal d’audit | Sa propre chronologie | Non | Oui, lecture et export | Oui, lecture et export |
| Événements de sécurité (tentatives suspectes) | Non | Non | Oui | Oui |
| Réglages de la plateforme | Lecture des réglages publics une fois connecté | Idem | Idem | Idem |

Aucune donnée de santé n’est demandée au-delà du devis ou de la facture et d’une référence minimale du patient (code ou initiales), tant que l’atelier juridique n’a pas eu lieu (K13).

## Le personnel : séparation des fonctions

**Le personnel n’exécute jamais un paiement et n’agit jamais sur un dossier dont il est partie ; la base refuse l’action (`VALIDATOR_IS_PARTY`) au lieu de se fier à l’interface** \[Cahier §5.2\].

- **Validateur** : revue de risque d’une opération (avec la case « montant vérifié » obligatoire), suspension pour fraude et levée, décision d’enrôlement N3. Code refusé à un utilisateur ordinaire : `VALIDATOR_ONLY`.
- **Administrateur** : tout ce que fait un validateur, plus la médiation et la décision des litiges, l’exécution manuelle des remboursements au pilote et la révocation d’un jeton à tout moment. Code refusé aux autres : `ADMIN_ONLY`.
- **Authentification du personnel** : e-mail, mot de passe et code à usage unique d’une application d’authentification (TOTP), quand le réglage `require_staff_mfa` est actif. **Il vaut « faux » par défaut : il doit être activé avant la production.**
- **Traçabilité** : chaque décision du personnel est motivée, horodatée et écrite dans le journal d’audit chaîné, qui n’accepte que des ajouts.
- **Pas d’écran de gestion du personnel** : les comptes sont créés par script ; un écran sera nécessaire avant l’ouverture au public.

## Niveaux d’enrôlement

**Le niveau décide de ce qu’un utilisateur peut initier et des montants qu’il peut payer ; il n’est jamais modifiable par son titulaire.** Le cahier demande que l’identité et, « selon le niveau de risque », les justificatifs soient vérifiés \[Message, cas 1 étape 1\] ; le découpage en quatre niveaux est notre proposition (K3).

| Niveau | Vérification | Peut initier | Qui vérifie | Effet sur l’identité affichée |
| --- | --- | --- | --- | --- |
| N0 | Numéro de téléphone (ou e-mail) vérifié, automatique | Rien ; peut payer et créer son propre besoin en payeur | Automatique | Numéro figé ; nom modifiable |
| N1 | Pièce d’identité et selfie | Une demande en particulier | Partenaire KYC (simulé aujourd’hui) | Nom et numéro figés |
| N2 | N1 du représentant, RCCM, NIU, justificatif d’activité | Une demande en commerçant ou prestataire | Partenaire KYC et revue interne | Nom et numéro figés |
| N3 | Documents légaux, mandat | Une demande en institution (hôpital, école…) | Revue manuelle du bureau | Nom et numéro figés |

**Plafonds** : chaque niveau aura des plafonds de paiement, par jour et par mois civils. **Aucune valeur n’a été fournie** : hors développement, tout paiement est donc refusé (`LIMITS_NOT_CONFIGURED`) tant que le client et ses partenaires ne les ont pas fixées.

## Écarts entre cette matrice et le code

**Le serveur applique déjà l’essentiel de la matrice ; les écarts portent sur ce qui n’est pas encore construit et sur un défaut de l’application mobile.**

| Écart | Effet | Traitement prévu |
| --- | --- | --- |
| L’application déduit le rôle de l’utilisateur de son **profil**, et non de sa place dans chaque opération | Un payeur qui est aussi demandeur ailleurs peut voir des écrans inadaptés ; le serveur, lui, refuse toute action non permise | Lot Y |
| Témoins absents | Aucune déclaration de tiers possible | Passe 3 |
| Pas d’authentification multifacteur selon le risque pour les utilisateurs \[Cahier §5.2\] | Biométrie de l’appareil seule | À spécifier, puis lot Y |
| `require_staff_mfa` vaut « faux » par défaut | Second facteur du personnel non imposé | Activation avant production (liste de contrôle et script de préparation) |
| Réémission d’un jeton par un administrateur sur une demande terminée | Jeton actif sur une demande close | Correctif au début de la passe 3 |
| Pas d’écran de gestion du personnel, des enrôlements, des signalements ni de la médiation | Opérations faites par script ou par appel direct | Lot Y (back-office) |
| Délégation de paiement \[Cahier, cas 21\] et comptes d’entreprise \[Cahier, cas 19\] | Non couverts | Phase 2 du cahier |

## À valider par le Dr et paramètres ouverts

**Six questions de droits restent ouvertes, et deux valeurs manquent avant la production.**

### Choix à valider

- [x] **Le prestataire doit-il être enrôlé** pour recevoir un paiement direct ? Notre recommandation : oui, au moins N2 pour un commerçant ou une entreprise, N3 pour un établissement, afin que le payeur paie toujours une identité vérifiée.
- [x] **Le prestataire peut-il contester ou répondre dans un litige** ? Recommandation : répondre oui ; contester, seulement en mode conditionnel.
- [ ] **Le témoin peut-il ouvrir le DiasPay Link et voir les justificatifs** ? Recommandation : il voit la demande et les seules pièces utiles à sa déclaration, chaque ouverture journalisée.
- [x] **Découpage en quatre niveaux d’enrôlement** (N0 à N3) et ce que chacun autorise.
- [x] **Administrateur seul pour trancher un litige et rembourser** ; validateur pour la revue, la suspension et l’enrôlement.
- [x] **Nom figé à partir de N1** ; changement seulement par une nouvelle vérification d’identité.

### Valeurs à fixer

| Paramètre | Qui la fournit | Effet tant qu’elle manque |
| --- | --- | --- |
| Plafonds de paiement par niveau (devise, par jour et par mois) | Client, partenaire, conseil juridique | Tout paiement refusé hors développement |
| Seuils de l’authentification multifacteur selon le risque | Client, partenaire | Biométrie de l’appareil seule |

### Sources

Cahier d’extension fonctionnelle de DiasPayQR (cas 1, 2, 16, 19, 21, 25 ; §5.1 à §5.3) · Message du Dr préparant le kickoff (cas 1 et 2) · Réponses écrites du Dr aux questions K2, K3 et K14 · Dépôt DiasPay : migrations 0005, 0014, 0020, 0021, 0025, 0030 ; `docs/decisions.md` (X4-v2, Xc-4, Xc-8).
