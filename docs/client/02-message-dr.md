# 02-message-dr.md

Excellent point de départ, Jean-Baptiste.

Je te propose que nous organisions une réunion de kickoff technique et fonctionnelle afin de passer en revue les documents et les maquettes proposés, de confronter nos compréhensions et de nous assurer que nous sommes parfaitement alignés sur la vision, l'architecture fonctionnelle et les différents cas d'usage de DiasPayQR.

L'objectif est de couvrir l'ensemble des scénarios opérationnels avant le démarrage du développement, afin d'éviter de devoir revoir ultérieurement des fonctionnalités structurantes.

À première vue, j'ai identifié au moins deux cas d'usage importants qui ne semblent pas encore apparaître dans les maquettes soumises.

 *1. CAS D'USAGE N° 1 : INITIATION D'UNE DEMANDE DE PAIEMENT PAR UN PRESTATAIRE OU UN TIERS* 

Il s'agit probablement du cas d'usage le plus fréquent et qui, à lui seul, justifie une grande partie de la raison d'être de DiasPayQR.

Le principe est simple : une personne qui souhaite recevoir un paiement doit pouvoir initier une demande de paiement documentée, vérifiable et traçable à destination d'un payeur.

Voici le parcours fonctionnel envisagé :

Étape 1 : Enrôlement du demandeur

- Le prestataire ou demandeur doit être préalablement enrôlé et certifié dans DiasPay.
- Il peut s'agir d'une entreprise, d'un commerçant, d'un prestataire de services, mais également d'un particulier, d'un ami ou d'un membre de la famille.
- Son identité et, selon le niveau de risque, ses justificatifs doivent être vérifiés.

Étape 2 : Constitution de la demande de paiement

Le demandeur renseigne :

- Le montant sollicité.
- L'objet de la demande.
- La nature du bien, du service ou de la prestation concernée.
- L'identité du bénéficiaire final, si différente du demandeur.
- Les éventuelles informations complémentaires.

Il doit ensuite joindre les preuves correspondant à la nature de la demande : photographies, factures, reçus, documents administratifs, attestations, justificatifs de scolarité, etc.

Étape 3 : Validation éventuelle par un témoin

Il serait intéressant d'intégrer une fonctionnalité permettant, lorsque cela est nécessaire, de désigner un tiers de confiance.

Par exemple, un ami, un membre de la famille ou toute autre personne préalablement approuvée par le payeur pourrait être sollicité pour confirmer que la prestation ou l'opération déclarée a effectivement eu lieu.

Cette validation constituerait un élément supplémentaire du dispositif de confiance.

Étape 4 : Soumission et génération du dispositif de confiance

Une fois le dossier constitué, le demandeur clique sur « SOUMETTRE LA DEMANDE DE PAIEMENT ».

Le système génère alors un eQR logique constitué de deux éléments :

- Un TrustToken.
- Un TrustLink associé à la demande de paiement.

Attention : il n'est pas nécessaire de générer une image physique de QR Code. Nous avons besoin d'un mécanisme électronique de référencement et de vérification reposant sur le TrustToken et le TrustLink.

Étape 5 : Notification du payeur

Le payeur est informé qu'une demande de paiement lui a été adressée.

La notification peut être transmise par WhatsApp, SMS ou email, mais elle ne doit pas contenir directement un lien de paiement exploitable. Nous reviendrons sur cette exigence de sécurité dans le deuxième cas d'usage.

Étape 6 : Suivi de la demande

Le demandeur doit disposer d'un tableau de bord lui permettant de suivre en temps réel l'évolution de sa demande :

- Brouillon.
- Soumise.
- Notification envoyée.
- Reçue par le payeur.
- En cours de vérification.
- Informations complémentaires demandées.
- En attente de validation.
- Acceptée.
- Paiement en cours.
- Payée.
- Contestée.
- Rejetée.
- Expirée.

Les statuts devront être définis précisément dans le workflow métier.

Exemple concret : demande de frais de scolarité

Un parent ou un proche au Cameroun sollicite 30 000 FCFA auprès d'un membre de sa famille établi à l'étranger pour payer la scolarité de son enfant.

Au lieu d'envoyer simplement un message WhatsApp accompagné d'une demande d'argent, il crée une demande de paiement dans DiasPayQR.

Il doit notamment fournir :

- Le nom de l'établissement scolaire.
- L'identité de l'élève.
- La facture ou le reçu de scolarité.
- Tout autre justificatif pertinent.

Le membre de la diaspora reçoit une notification, se connecte à DiasPay, consulte la demande et examine les justificatifs avant de décider de payer ou non.

C'est précisément l'un des problèmes que DiasPayQR doit résoudre : permettre à la diaspora et à toute personne qui effectue des transferts d'argent de ne plus payer à l'aveugle, sans justificatifs ni traçabilité de l'utilisation des fonds.

Autre scénario à modéliser : remboursements échelonnés d'un prêt immobilier

Il faut également prévoir les demandes de paiement récurrentes ou échelonnées.

Prenons l'exemple d'un investissement immobilier financé par un prêt dont le remboursement est effectué progressivement :

- Mois 1 : 75 000 FCFA.
- Mois 2 : 75 000 FCFA.
- Mois 3 : 70 000 FCFA.
- ...
- Mois N : 45 000 FCFA.

Comment DiasPayQR doit-il gérer ce type d'opération ?

Je suggère de conceptualiser un mécanisme de plan de paiement ou échéancier, permettant :

- De créer une opération principale.
- De définir les différentes échéances.
- De générer une demande de paiement distincte pour chaque échéance.
- D'associer les justificatifs nécessaires à chaque paiement.
- De suivre les échéances payées, impayées, en retard ou contestées.
- De disposer d'un historique consolidé de l'ensemble de l'opération.

Il faut donc réfléchir à la distinction entre une demande de paiement ponctuelle et une demande inscrite dans un échéancier.

 *2. CAS D'USAGE N° 2 : RÉCEPTION ET TRAITEMENT D'UNE DEMANDE DE PAIEMENT PAR LE PAYEUR* 

C'est le deuxième parcours fondamental.

Le payeur reçoit une notification lui indiquant qu'une demande de paiement a été initiée à son intention.

A. Une exigence fondamentale : la sécurité du TrustLink

Je souhaite insister particulièrement sur ce point.

Le TrustEngine et le Trust Operating System doivent intégrer un mécanisme robuste permettant de garantir l'authenticité des TrustLinks générés par DiasPayQR.

Nous devons absolument éviter les risques de confusion entre :

- Un véritable TrustLink généré par DiasPayQR.
- Un faux lien fabriqué par des hackers ou des escrocs.
- Un lien redirigeant vers un faux site imitant DiasPay.
- Un lien malveillant destiné à infecter le terminal du payeur ou à dérober ses données personnelles et bancaires.

Ma recommandation : le TrustLink ne doit jamais être transmis directement au payeur par WhatsApp, SMS ou email.

Ce qui est envoyé à travers ces canaux est uniquement une notification l'invitant à se connecter à son compte DiasPay pour consulter une nouvelle demande de paiement.

C'est exclusivement à l'intérieur de l'environnement sécurisé de DiasPay que le payeur retrouve la demande, son TrustToken et le TrustLink authentique correspondant.

Il peut alors cliquer sur ce dernier pour déclencher le processus de vérification et de traitement de la demande.

Il faudra notamment prévoir :

- L'authentification des TrustLinks.
- La vérification de l'intégrité du TrustToken.
- La protection contre la falsification et la réutilisation frauduleuse des liens.
- La gestion de leur expiration et de leur révocation.
- Une traçabilité complète des consultations et des opérations.
- Des mécanismes de détection des comportements suspects.

L'objectif est de faire du TrustLink un véritable mécanisme de confiance et non un simple lien hypertexte.

B. Vérification et décision du payeur

Une fois connecté à DiasPay et après avoir ouvert la demande correspondante, le payeur accède à un espace de vérification présentant :

- L'identité du demandeur.
- Le montant sollicité.
- L'objet de la demande.
- Les informations relatives à la prestation ou à l'opération.
- L'ensemble des justificatifs soumis.
- Les éventuelles validations effectuées par un tiers de confiance.
- L'historique et les informations complémentaires disponibles.

Après examen, le payeur doit pouvoir effectuer plusieurs actions :

1. ACCEPTER ET PAYER.
2. DEMANDER DES INFORMATIONS COMPLÉMENTAIRES.
3. CONTESTER LA DEMANDE.
4. REJETER LA DEMANDE.

Chaque décision doit être enregistrée et traçable dans le système.

C. Déclenchement du paiement : interconnexion DiasPay – TrustPayWay – Amzara

C'est uniquement lorsque le payeur clique sur « PAYER » que DiasPay déclenche le processus de paiement proprement dit.

À ce stade, DiasPayQR passe le relais à l'infrastructure de paiement DiasPay, qui invoque TrustPayWay.

TrustPayWay constitue notre passerelle d'orchestration des paiements et est interconnecté à Amzara, notamment pour permettre aux utilisateurs de la diaspora d'effectuer des paiements à partir de cartes bancaires internationales et de comptes bancaires étrangers.

L'architecture doit également permettre de prendre en charge les moyens de paiement accessibles au Cameroun, notamment :

- MTN Mobile Money.
- Orange Money.
- Cartes bancaires.
- Comptes bancaires locaux.
- Autres moyens de paiement compatibles avec TrustPayWay.

Il est donc important de bien distinguer les responsabilités :

- DiasPayQR : création, documentation, authentification et vérification des demandes de paiement à travers le mécanisme TrustToken/TrustLink.
- DiasPay : environnement transactionnel et financier dans lequel s'inscrit l'opération.
- TrustPayWay : orchestration et exécution du paiement à travers les différents moyens de paiement connectés.
- Amzara : infrastructure partenaire permettant notamment l'accès aux moyens de paiement internationaux.

Une fois le paiement exécuté, son résultat doit être automatiquement répercuté dans DiasPayQR afin de mettre à jour le statut de la demande et de notifier les parties concernées.

---

3. CE QUE JE SOUHAITE QUE NOUS VALIDIONS LORS DE LA RÉUNION DE KICKOFF

Au-delà de ces deux cas d'usage, je souhaite que nous prenions le temps de valider ensemble :

1. L'ensemble des acteurs et leurs rôles dans DiasPayQR.
2. Les différents parcours utilisateurs (demandeur, prestataire, payeur, témoin et administrateur).
3. Le cycle de vie complet d'une demande de paiement.
4. La structure et le fonctionnement du TrustToken et du TrustLink.
5. Le mécanisme de gestion des justificatifs et des preuves.
6. Le système de contestation et de résolution des litiges.
7. La gestion des paiements récurrents et des échéanciers.
8. L'intégration technique entre DiasPayQR, DiasPay, TrustPayWay et Amzara.
9. Les exigences de cybersécurité, d'authentification et de protection des données.
10. Les tableaux de bord, notifications et mécanismes de traçabilité.

DiasPayQR doit apporter une réponse concrète à une problématique majeure : permettre à un payeur de savoir précisément POURQUOI il paie, À QUI il paie, SUR QUELLES PREUVES repose la demande et COMMENT le paiement a été exécuté.

C'est cette philosophie qui doit guider nos choix fonctionnels et techniques.

Je préfère donc que nous prenions le temps nécessaire pour verrouiller ensemble la conception avant de lancer le développement proprement dit.