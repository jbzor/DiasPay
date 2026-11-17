# Sources fonctionnelles du client

Ce document recense les documents du client qui font foi pour DiasPay, et dans quel ordre ils s’appliquent. Il n’en
reproduit pas le contenu : les documents eux-mêmes seront déposés tels quels dans `docs/client/` (voir « Emplacement »).

## Règle

**Les documents du client prévalent sur `docs/specs/modele-cible-v2.md`.** Le modèle cible est notre traduction de
travail des décisions du client, pas une source. En cas de contradiction :

1. on applique le document du client ;
2. on signale l’écart dans le compte rendu du lot ;
3. on le corrige dans le code et dans `docs/specs/modele-cible-v2.md`, avec une entrée dans `docs/decisions.md` qui cite la
   section du document du client.

Exemple : Xc-7 (jeton en règlement direct). Le lot X v2 avait suivi le modèle cible ; le cahier d’extension exigeait un
TrustToken pour chaque demande (exigence 5.1) : le cahier a prévalu.

## Documents du client

| Document | Ce qu’il fixe (d’après les références du dépôt) | Où il est cité dans le dépôt | Emplacement |
|---|---|---|---|
| (1) Cahier d’extension fonctionnelle | Les exigences fonctionnelles et les cas d’usage : TrustToken et TrustLink de chaque paiement (section 1, cas 3 et 8, section 3.C, exigence 5.1) ; parcours d’authentification (US-01) | `docs/decisions.md` (D5, Xc-7) ; `docs/release-checklist.md` | `docs/client/` |
| (2) Message du Dr | Point de vue du client sur le terrain de la santé (contexte de K13) | non cité nommément dans le dépôt | `docs/client/` |
| (3) Dossier institutionnel | Présentation du projet et de ses partenaires | non cité nommément dans le dépôt | `docs/client/` |
| (4) Réponses écrites aux questions K1 à K14 (kickoff) | Les décisions de cadrage : paiement direct par défaut (K1), décision du payeur et bureau hors du flux par défaut (K2), enrôlement N0 à N3 (K3), QR en présentiel (K4), statuts et litige distinct (K5), autorisation à chaque échéance (K6), paiement exécuté irréversible (K7), contributions (K9), devise (K10), adaptateur de paiement (K12), données de santé minimales (K13) | `docs/specs/modele-cible-v2.md` §1 ; entrées X*-v2 de `docs/decisions.md` | `docs/client/` |

Les questions K8, K11 et K14 n’ont pas d’effet décrit dans `docs/specs/modele-cible-v2.md` : leurs réponses sont à
reprendre depuis le document du client quand un lot les concerne. Le document d’analyse `ALIGNEMENT-CAHIER-EXTENSION.md`
(questions K1 à K14) n’a jamais été fourni au dépôt (voir `docs/decisions.md`, lot X).

## Hiérarchie entre les documents du client

**Fixée par Jean-Baptiste (chef de projet), 17 novembre 2026.** Les documents du client font foi dans cet ordre :

1. **Cahier d’extension fonctionnelle** ;
2. **Message du Dr** ;
3. **Dossier institutionnel** ;
4. **Réponses écrites aux questions K1 à K14**.

Règle pour les réponses K : une réponse K s’applique quand elle **précise un point que le cahier laisse ouvert**. Si elle
**contredit** le cahier, l’écart est **signalé au Dr** et n’est jamais tranché en silence : ni dans le code, ni dans un
document, tant que le Dr n’a pas répondu.

Tous ces documents prévalent sur `docs/specs/modele-cible-v2.md`. En dessous viennent `docs/decisions.md` (nos choix là
où le client n’a rien fixé), puis `docs/open-parameters.md` (valeurs qui restent à fournir par le client et ne
s’inventent pas).

## Emplacement des documents

- **`docs/client/`** : dossier prévu pour les documents du client, à remplir par Jean-Baptiste.
- **En attendant** : projet claude.ai « DiasPayQR ».

## À compléter

- Déposer les documents du client dans `docs/client/`, avec leur date de version (Jean-Baptiste).
- Les réponses K8, K11 et K14 : à reprendre depuis le document du client quand un lot les concerne.
