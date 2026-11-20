# DiasPayQR — Cartographie des cas d’usage

Nov 17, 2026 · @jb.nzudie

## Objet et statut

Ce document répond au livrable 1 (« une cartographie exhaustive des cas d’usage ») de la section 7 du cahier d’extension. **C’est une version de travail, soumise au Dr Dongmo pour validation écrite.** Elle remplace l’analyse d’alignement du début du projet, devenue périmée.

Pour chaque cas, elle indique l’initiateur, les acteurs secondaires, la phase où le Dr l’a placé (section 6 du cahier), les briques du noyau commun qu’il mobilise et son état de construction au 17 novembre 2026. Les cas du pilote reçoivent en plus une fiche complète selon la grille de la section 7. Les autres fiches seront produites phase par phase.

Sources : cahier d’extension (sections 2 à 7), message du Dr (cas 1 et 2), réponses écrites aux questions K1 à K14, état du code (`master`, migrations 0001 à 0031).

## En bref

**Quinze des 25 cas d’usage ont déjà une base dans le code ; dix n’ont encore rien. Le pilote proposé en couvre six.**

- **Phase 1 du Dr** : quatre cas (demande par un tiers, décision du payeur, achat en magasin, contestations simples) ; tous les quatre ont une base, aucun n’a encore ses écrans définitifs.
- **Phase 2** : douze cas ; huit ont une base (souvent la structure seule, sans interface).
- **Phase 3** : trois cas ; un seul a une base (international : devis de change et frais).
- **Hors des phases du Dr** : six cas qu’il n’a classés nulle part ; nous proposons une phase pour chacun.

Le noyau commun demandé par le Dr \[Cahier §4\] est en place pour l’essentiel : identités et niveaux, rôles, demandes, justificatifs, TrustToken et DiasPay Link, décision du payeur, paiement idempotent, remboursements, litiges, notifications internes, journal d’audit. Manquent encore les témoins, les canaux de notification externes et l’analytique.

## La carte

**La phase 1 du Dr est entièrement amorcée ; la phase 2 l’est aux deux tiers, souvent par la seule structure ; la phase 3 et les cas hors phase restent largement à construire.**

&#91;embedded content: 25 cas d’usage · par phase du Dr et par état de construction\]

Un fond grisé signifie qu’une base existe dans le code (règles, structures, parfois des écrans), pas que le cas est terminé : le tableau suivant précise ce qui manque pour chacun.

## Les 25 cas, un par ligne

**Chaque cas réutilise le même noyau ; ce qui change d’un cas à l’autre, c’est l’initiateur, les pièces exigées et le mode de règlement.** « Base » signifie que des règles ou des structures existent dans le code ; « écrans » que l’utilisateur peut s’en servir.

| N° | Cas | Initiateur | Acteurs secondaires | Phase du Dr | État au 17 nov. 2026 |
| --- | --- | --- | --- | --- | --- |
| 1 | Demande de paiement par un prestataire ou un tiers | Prestataire, particulier, proche | Payeur, témoin | 1 | Base complète (niveaux N1/N2, pièces, soumission, jeton) ; écran de création existant, initiation par un prestataire sans écran |
| 2 | Réception et décision du payeur | Payeur | Demandeur, partenaire de paiement | 1 | Base complète (quatre actions, devis, frais) ; espace de vérification sans écran |
| 3 | Paiement chez un commerçant | Commerçant | Client, partenaire de paiement | 1 | QR de présentation côté serveur ; ni écran, ni produits, ni caisses |
| 4 | Paiement à distance et achats en ligne | Site marchand | Client, développeurs externes | 2 | Rien (API, SDK, bac à sable) |
| 5 | Paiement conditionnel et séquestre | Vendeur | Acheteur, partenaire habilité | 2 | Mode conditionnel complet côté serveur (fonds conservés, confirmation, libération) ; types de besoin désactivés ; aucun partenaire habilité |
| 6 | Paiement par étapes d’une prestation | Entrepreneur | Client, expert ou témoin | 2 | Plans en tranches et preuves de jalon ; pas de vue consolidée du budget |
| 7 | Paiement partagé entre plusieurs payeurs | Demandeur | Contributeurs | 2 | Structure des contributions ; pas d’interface |
| 8 | Paiements récurrents et abonnements | Bénéficiaire | Payeur | 2 | Plans récurrents avec autorisation à chaque échéance ; mandats absents |
| 9 | Factures et services essentiels | Organisme créancier | Payeur | Non classé | Rien |
| 10 | Frais médicaux | Établissement de santé (proche au pilote) | Payeur | 2 | Type « Santé » avec données minimales, initié par un proche ; enrôlement des hôpitaux (N3) sans écran |
| 11 | Frais scolaires | École (parent au pilote) | Parent, sponsor | 2 | Type « Scolarité », initié par un proche ; enrôlement des écoles (N3) sans écran |
| 12 | Loyers et gestion locative | Gestionnaire, propriétaire | Locataire | Non classé | Type « Loyer », initié par un proche ; pas de gestion locative |
| 13 | Paiements internationaux | Prestataire au Cameroun | Payeur à l’étranger, Amzara | 3 | Devis de change, frais, total débité ; seule la parité EUR/XAF ; KYC simulé |
| 14 | Paiement avec preuve de livraison | Commerçant | Livreur, client | 2 | Rien |
| 15 | Remboursements, avoirs, annulations | Commerçant, administrateur | Client, partenaire | 2 | Remboursements totaux et partiels, liés et contrepassés, exécutés à la main ; pas d’avoirs |
| 16 | Contestation, litiges, arbitrage | Payeur | Demandeur, médiateur | 1 (simple), 3 (arbitrage) | Dossier distinct, médiation, décision ; ni délais ni appel |
| 17 | Cotisations associatives | Trésorier | Membres | 2 | Rien |
| 18 | Dons et financement participatif | Porteur de projet | Contributeurs | 3 | Rien |
| 19 | Dépenses d’entreprise | Collaborateur | Directeur financier, fournisseur | 2 | Rien |
| 20 | Paiements entre particuliers | Particulier | Particulier | Non classé | Demande d’un particulier N1 possible ; pas d’acceptation contractuelle distincte |
| 21 | Autorisation préalable d’un tiers (délégation) | Payeur | Délégué | Non classé | Rien |
| 22 | Paiement d’urgence | Demandeur | Payeur | Non classé | Rien |
| 23 | Transactions immobilières | Vendeur, intermédiaire habilité | Acheteur, notaire | 2 | Types « Immobilier » et « Terrain » en mode conditionnel, désactivés |
| 24 | Marchés et contrats publics | Entreprise titulaire | Administration | 3 | Rien |
| 25 | Vérification des preuves par des tiers de confiance | Payeur ou demandeur | Témoin | Non classé | Rien (prévu en passe 3) |

## Les fonctions transversales

**Quatre des six fonctions transversales du cahier ont une base ; le TrustScore et l’analytique, placés par le Dr en phase 3, n’ont pas commencé.**

| Fonction \[Cahier §3\] | État | Ce qui manque |
| --- | --- | --- |
| A. TrustScore | Rien | Phase 3 ; distinguer identité vérifiée, réputation et risque de fraude |
| B. TrustVault (coffre des preuves) | Empreinte cryptographique de chaque pièce, détection de la réutilisation d’une même pièce, pièces immuables après soumission, consultations journalisées | Empreinte rendue obligatoire avant la production ; vidéos, signatures, confirmations de livraison |
| C. TrustTimeline (chronologie) | Journal d’audit chaîné, en ajout seul ; événements horodatés dont « TrustToken généré » | Écran de chronologie ; événement d’envoi des messages externes |
| D. TrustNotify (notifications) | Notifications internes ; messages externes fixes sans lien | Aucun canal branché (SMS, e-mail, WhatsApp) ; notifications urgentes |
| E. TrustDispute (litiges) | Dossier distinct, échanges, médiation, décision, remboursement lié | Délais, appel, écran de médiation |
| F. TrustAnalytics | Rien | Phase 3 |

## Fiches des cas du pilote

**Les six cas du pilote se ramènent à trois parcours : la demande familiale (cas 1, avec les volets familiaux des cas 10, 11 et 12), la décision du payeur (cas 2) et l’achat en magasin (cas 3).** Chaque parcours est décrit selon les douze rubriques exigées par la section 7 du cahier.

| Rubrique | Demande familiale (cas 1, 10, 11, 12) | Décision du payeur (cas 2) | Achat en magasin (cas 3) |
| --- | --- | --- | --- |
| Acteur initiateur | Proche au Cameroun, enrôlé N1 | Payeur (N0 ou plus) | Commerçant enrôlé N2 |
| Acteurs secondaires | Payeur de la diaspora ; établissement bénéficiaire ; témoin facultatif | Demandeur ; partenaire de paiement ; bureau en cas de litige | Client ; partenaire de paiement |
| Préconditions | Numéro du payeur connu ; type de besoin actif | Demande soumise ; payeur connecté ; jeton actif ; plafonds configurés | Commerçant N2 ; client inscrit sur DiasPay |
| Scénario nominal | Crée le besoin (montant, objet, bénéficiaire, pièces), le soumet ; le jeton est émis ; le payeur reçoit un message fixe | Ouvre le DiasPay Link, examine, accepte et paie avec biométrie ; l’événement signé du partenaire rend la demande payée ; reçu | Crée la demande et affiche le QR de présentation ; le client scanne, voit le nom du commerçant et le montant, puis décide comme au cas 2 |
| Scénarios alternatifs | Informations demandées puis réponse ; annulation avant paiement ; échéancier (une demande par échéance) ; expiration, si une durée est fixée | Demande d’informations ; rejet motivé ; contestation (avant paiement : opération suspendue) ; échec du paiement, puis nouvel essai | QR expiré ou déjà utilisé ; client invité par téléphone : seul le titulaire du numéro peut prendre la demande ; annulation par le commerçant |
| Justificatifs obligatoires | Scolarité : attestation d’inscription · Santé : devis ou facture et référence minimale du patient · Loyer : bail | Aucun : le payeur juge des pièces | Détail des produits ou services (à préciser avec la proposition K8) |
| Règles métier | Pièces exigées avant soumission ; aucun nom de patient ; montants entiers en FCFA ; somme des échéances égale au total | Seul le payeur accepte ; montant, bénéficiaire, frais et total affichés avant l’accord ; plafonds du niveau | QR à usage unique et de courte durée ; le scan lie la demande sans autoriser le paiement |
| Statuts | Brouillon, soumise, informations demandées, annulée, expirée | Soumise, acceptée, payée, rejetée, remboursée | Ceux de la demande |
| Événements déclencheurs | Soumission ; date d’échéance (soumission automatique 7 jours avant) ; réponse aux informations | Décision du payeur ; événement signé du partenaire | Scan ; décision du client ; événement du partenaire |
| Interactions avec le moteur de paiement | Aucune avant la décision du payeur | Devis, tentative idempotente, événement signé, journal à double entrée | Comme au cas 2 |
| Exigences de sécurité | Identité vérifiée affichée, nom figé dès N1 ; aucun lien externe ; pièces immuables et empreinte | Session et biométrie ; jeton actif ; résolution réservée aux parties ; authentification renforcée selon le risque (à venir) | QR renouvelé en continu ; liaison réservée au bon client ; nom et montant toujours affichés |
| Critères de validation | Le payeur voit la demande et ses pièces ; un étranger n’en apprend rien ; une pièce déjà utilisée ailleurs est signalée | Aucune personne ne peut déclarer un paiement ; un double paiement est impossible ; le reçu porte la référence | Un QR photographié ne permet pas de prendre une demande déjà liée ; rien n’est payé sans la décision du client |

**État** : les règles des trois parcours sont en place côté serveur et testées sur le projet de développement. Les écrans de la décision du payeur et de l’achat en magasin restent à concevoir (lot Y) ; aucun test n’a encore été fait sur téléphone.

## Six cas sans phase : notre proposition

**La section 6 du cahier ne place pas six cas ; nous proposons une phase pour chacun, à confirmer par le Dr.**

| N° | Cas | Phase proposée | Pourquoi |
| --- | --- | --- | --- |
| 25 | Tiers de confiance (témoins) | **1** | Le message du Dr le place dans le parcours du cas 1 (étape 3) ; il conditionne la confiance du payeur à distance et les paiements par étapes |
| 12 | Loyers et gestion locative | **1** pour la demande familiale de loyer, **2** pour la gestion locative | Le loyer est déjà un type de besoin du pilote ; la gestion des baux, cautions et impayés est un module à part |
| 20 | Paiements entre particuliers | **2** | La demande d’un particulier N1 existe déjà ; l’acceptation contractuelle distincte, exigée par le cahier, est à construire |
| 22 | Paiement d’urgence | **2** | Demande une notification urgente et une vérification renforcée d’identité, qui supposent les canaux externes et l’authentification selon le risque |
| 21 | Délégation de paiement | **2** | Repose sur les mandats, que le Dr place en phase 2 (réponse à K6) |
| 9 | Factures et services essentiels | **3** | Suppose des API avec les organismes créanciers, comme l’écosystème de partenaires de la phase 3 |

## À valider par le Dr

**Quatre décisions de périmètre sont attendues du Dr ; elles fixent ce que le pilote montrera.**

- [x] **Périmètre du pilote (proposition K11)** : demande familiale (scolarité, santé, loyer), décision du payeur, échéances, un commerçant simple. C’est une partie de sa phase 1, qui compte douze priorités ; le reste de la phase 1 viendrait ensuite.
- [x] **Commerçant simple (proposition K8)** : un commerçant, sans gestion de produits, de caisses ni de points de vente au pilote, alors que le cas 3 les prévoit.
- [x] **Phase proposée pour les six cas non classés**, en particulier les témoins en phase 1.
- [x] **Volets familiaux en phase 1** pour la santé, la scolarité et le loyer, avant les modules dédiés aux établissements (phase 2).

Les fiches des autres cas, selon la même grille, seront produites phase par phase, au moment où chaque cas entrera en conception.

### Sources

Cahier d’extension fonctionnelle de DiasPayQR (sections 2 à 7) · Message du Dr préparant le kickoff (cas 1 et 2) · Réponses écrites du Dr aux questions K1 à K14 · Dépôt DiasPay (`master`, migrations 0001 à 0031) · Livrables 4, 6, 7 et 8.
