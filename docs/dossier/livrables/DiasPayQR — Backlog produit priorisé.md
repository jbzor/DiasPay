# DiasPayQR — Backlog produit priorisé

Nov 17, 2026 · @jb.nzudie

## Objet et statut

Ce document répond au livrable 12 (« le backlog produit priorisé ») de la section 7 du cahier d’extension. **C’est une version de travail, soumise au Dr Dongmo pour validation écrite.** Il ordonne le travail restant jusqu’au pilote, puis la phase 2, et sépare ce que l’équipe peut faire seule de ce qui dépend du client ou des partenaires.

Aucune date n’y figure : l’enchaînement dépend de validations et d’accès que l’équipe ne maîtrise pas. Sources : cahier d’extension (sections 6 et 7, priorités commerciales), réponses écrites aux questions K1 à K14, livrables 1, 4, 6, 7 et 8, état du code au 17 novembre 2026.

## En bref

**Le pilote proposé couvre déjà dix des douze priorités de la phase 1 du Dr ; il en réduit deux : le commerce (un commerçant simple) et le paiement réel, qui attend l’accès à TrustPayWay.** La réduction proposée (K11) est donc plus étroite qu’il n’y paraît.

Les trois prochains jalons dépendent du Dr : valider ces livrables de la vague 1, valider les maquettes du lot Y, puis donner l’accès aux comptes et aux partenaires. Entre-temps, l’équipe avance sur ce qui ne dépend que d’elle : la passe 3 (témoins, simulateur de paiement), les livrables de la vague 2 et la conception des écrans.

## Feuille de route jusqu’au pilote

**Trois couloirs avancent en parallèle ; celui du client fixe le rythme des deux autres.**

&#91;embedded content: feuille de route jusqu’au pilote · 3 couloirs, 4 étapes\]

L’équipe peut mener la passe 3 et préparer la vague 2 sans attendre ; le code du lot Y attend les maquettes validées, et le pilote attend l’accès aux comptes et aux partenaires.

## Le backlog jusqu’au pilote

**Quatorze éléments, classés par ordre de priorité : d’abord ce qui débloque le Dr, puis ce qui sécurise, puis ce qui se voit.** La priorité suit l’ordre du projet : sécurité et conformité, alignement avec les documents du client, exactitude, puis rapidité.

| Rang | Élément | Contenu | Dépend de | État |
| --- | --- | --- | --- | --- |
| 1 | Validation de la vague 1 | Livrables 1, 4, 6, 7, 8 et 12 ; propositions K8 et K11 ; choix listés en fin de chaque document | Dr | Livrables prêts |
| 2 | Passe 3, ouverture | Réémission refusée sur une demande terminée ; tests du jeton après paiement et remboursement | — | À lancer |
| 3 | Passe 3, TrustVault | Empreinte obligatoire des pièces, parité simulateur et serveur | — | À lancer |
| 4 | Passe 3, témoins | Deux voies de désignation, identité, consentement, conflits d’intérêts, déclaration distincte d’une certification \[Cahier, cas 25\] | Validation de la vague 1 (droits du témoin) | À lancer |
| 5 | Passe 3, simulateur de paiement | Scénarios du partenaire (succès, échec, retard, doublon, désordre) ; suite de contrat étendue | — | À lancer |
| 6 | Vague 2 des livrables | 5 (modèle de données), 9 (architecture d’intégration), 3 (séquences), 2 (UML), 13 (critères d’acceptation) | Vague 1 validée | À produire |
| 7 | Conception du lot Y (livrable 11) | Espace de vérification du payeur, initiation par un prestataire, tableau de bord aux libellés du Dr, enrôlement, échéancier, devis et frais, commerçant simple, témoins, files du bureau | Vague 1 validée | À produire |
| 8 | Validation des maquettes | Écrans du lot Y | Dr | — |
| 9 | Lot Y, code | Écrans conçus ; rôle tiré de l’opération et non du profil | Maquettes validées | — |
| 10 | Authentification selon le risque | Seuils, parcours, application aux paiements | Valeurs du client | À spécifier |
| 11 | Livrables 10 et 14 | Documentation des API ; plan de tests fonctionnels et de sécurité | Lot Y | — |
| 12 | Lot 6, environnement pilote | Intégration continue, builds de test, déploiement du back-office, notifications push, canaux SMS et e-mail | Comptes et fournisseurs du client | Bloqué |
| 13 | Préparation de la production | Plafonds, barème, durées, mode simulé désactivé, second facteur du personnel imposé, conservation des données | Client, partenaires, atelier juridique | Bloqué |
| 14 | Arrimage au partenaire de paiement | Adaptateur TrustPayWay et Amzara, bac à sable, rapprochement | Documentation et bac à sable des partenaires | Bloqué |

Les tests sur téléphone réel accompagnent chaque élément à partir du rang 2 ; aucun n’a encore été fait.

## La phase 1 du Dr et le pilote proposé

**Sur les douze priorités de la phase 1 \[Cahier §6\], le pilote en couvre dix entièrement et deux en partie.** C’est ce que la proposition K11 demande au Dr de valider.

| Priorité de la phase 1 | Au pilote | Ce qui reste après |
| --- | --- | --- |
| 1. Demande de paiement documentée | Oui | — |
| 2. Réception et vérification par le payeur | Oui | — |
| 3. TrustToken et TrustLink | Oui, signature simulée | Signature réelle (TrustEngine, phase 2) |
| 4. Gestion des justificatifs | Oui | Empreinte rendue obligatoire |
| 5. Notifications sécurisées | Oui : internes et messages externes sans lien | Dépend d’un fournisseur SMS et e-mail |
| 6. Paiements via TrustPayWay | **En partie** : chemin complet sur simulateur | Paiement réel, dès la documentation et le bac à sable |
| 7. Paiements commerçants | **En partie** : un commerçant simple (K8) | Produits, caisses, points de vente, historique des ventes |
| 8. Paiements familiaux | Oui (scolarité, santé, loyer) | — |
| 9. Gestion des échéanciers | Oui, autorisation à chaque échéance | Mandats (phase 2) |
| 10. Historique et reçus | Oui | — |
| 11. Contestations simples | Oui | Délais, appel (à définir) |
| 12. Tableau de bord demandeur et payeur | Oui, aux libellés du Dr | — |

## Ce qui dépend du client et des partenaires

**Sans ces éléments, le pilote peut être montré sur simulateur, mais pas ouvert à de vrais utilisateurs.** Aucun d’entre eux ne peut être remplacé par une valeur inventée.

| Élément attendu | De qui | Ce qu’il débloque |
| --- | --- | --- |
| Validation écrite des livrables de la vague 1 | Dr | Passe 3 (témoins), vague 2, conception du lot Y |
| Documentation et bac à sable de TrustPayWay et d’Amzara | Partenaires, via le Dr | Paiement réel, rapprochement, frais et taux réels |
| Partenaire de vérification d’identité (KYC) | Dr | Enrôlement réel N1 et N2 |
| Comptes Apple Developer et Google Play | Dr | Builds de test et publication |
| Nom de domaine, fournisseur SMS, service d’e-mail | Dr | Connexion par SMS en production, messages externes |
| Plafonds par niveau, barème des frais, durées (demandes, QR de présentation, devis), seuils de l’authentification renforcée | Dr, partenaires | Paiements hors développement (aujourd’hui refusés) |
| Atelier juridique : agrément, KYC et lutte anti-blanchiment, données de santé, conservation, consentements | Dr, conseil juridique | Ouverture au public |
| Validation des maquettes du lot Y | Dr | Code du lot Y |

## Après le pilote

**La phase 2 suit les trois priorités commerciales du Dr : après le paiement familial, le paiement conditionnel avec preuve de réalisation, puis le paiement fractionné à plusieurs contributeurs.** Les autres cas de la phase 2 viennent ensuite.

| Ordre | Groupe | Cas | Ce qui existe déjà |
| --- | --- | --- | --- |
| 1 | Paiement conditionnel avec preuve de réalisation | 5 séquestre, 6 par étapes, 14 preuve de livraison, 23 immobilier | Mode conditionnel complet côté serveur ; preuves de jalon ; manque un partenaire habilité à conserver les fonds |
| 2 | Paiement fractionné et multi-contributeurs | 7 paiement partagé, 17 cotisations | Structure des contributions |
| 3 | Paiements récurrents et délégation | 8 mandats, 21 délégation | Échéanciers avec autorisation à chaque échéance |
| 4 | Modules des établissements | 10 hôpitaux, 11 écoles, 12 gestion locative | Types de besoin et niveau N3 côté serveur |
| 5 | Entreprises et remboursements avancés | 19 dépenses d’entreprise, 15 avoirs | Remboursements totaux et partiels |
| 6 | Particuliers et urgence | 20 entre particuliers, 22 urgence | Demande d’un particulier N1 |
| 7 | Ouverture aux plateformes | 4 API, SDK et bac à sable marchand | — |

**Phase 3** (rappel du cahier) : TrustScore, TrustVault avancé, TrustAnalytics, arbitrage et médiation, marchés publics (24), financement participatif (18), séquestre avancé, international (13), factures et services essentiels (9, proposé), écosystème de partenaires, intelligence artificielle d’analyse des pièces.

## À valider par le Dr

**Trois décisions de priorité sont attendues.**

- [x] **Périmètre du pilote (K11)** : dix priorités de la phase 1 entièrement, deux en partie (commerce simple, paiement réel dès l’accès au partenaire).
- [x] **Ordre de la phase 2** : conditionnel avec preuve de réalisation d’abord, puis fractionné, conformément aux priorités commerciales du cahier.
- [x] **Témoins dans la passe 3**, avant le lot Y, pour que les écrans les intègrent dès leur conception.

### Sources

Cahier d’extension fonctionnelle de DiasPayQR (sections 6 et 7, priorités commerciales) · Réponses écrites du Dr aux questions K1 à K14 · Livrables 1, 4, 6, 7 et 8 · Dépôt DiasPay (`master`, étiquette `pre-passe3`).
