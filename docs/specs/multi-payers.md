# Plusieurs payeurs pour une même demande (brouillon pour le kickoff)

État au 12 novembre 2026 (lot X, X7). Ce document décrit ce qui est en place et propose la suite pour la phase 2. **Rien n’est visible dans l’application** : aucun type de besoin n’autorise aujourd’hui plusieurs payeurs.

## En place (migration 0012)

- `transaction_parties` a un identifiant propre. Une même personne ne peut pas avoir deux fois le même rôle dans un dossier : unicité (transaction, utilisateur, rôle) et (transaction, téléphone invité, rôle).
- Un dossier a toujours **un seul demandeur et un seul prestataire**, comme avant (index unique sur le rôle, hors payeur).
- Un **second payeur** n’est accepté que si le type de besoin l’autorise (`request_modules.multiple_payers`). C’est **faux partout** ; sinon le serveur refuse avec le code `MULTIPLE_PAYERS_NOT_ALLOWED`, quelle que soit la voie d’écriture.
- `has_role`, `is_party` et les politiques d’accès lisent les mêmes lignes qu’avant : un payeur supplémentaire serait partie au dossier, avec les droits d’un payeur.
- Retour arrière : `supabase/rollbacks/0012_lotx_x7_down.sql`. Il refuse de s’exécuter si un dossier a déjà plusieurs payeurs.

## À prévoir en phase 2

### Contributions

Une table `contributions` porterait une ligne par payeur et par tranche : payeur, montant promis, montant payé, état, tentative de paiement (`payment_attempts`), date.

Chaque contribution suivrait le même chemin que les paiements actuels :
- clé d’idempotence ;
- événement du partenaire ;
- écriture au journal financier (journal `PAYMENT` par contribution).

### Montant à atteindre

Chaque tranche garde son montant. Elle passe à « payée » quand la somme des contributions réussies l’atteint.

Points à trancher :
- **Contributions** : libres, ou réparties d’avance (par part ou par montant).
- **Minimum** : un montant minimal par contribution, ou non.
- **Payeur principal** : faut-il un payeur qui complète le reste ?

### Clôture automatique

Si la cible n’est pas atteinte à l’échéance :
- **Option A** : prolonger.
- **Option B** : rembourser chaque contribution (contrepassation, comme `request_refund`).
- **Option C** : laisser le payeur principal compléter.

Le journal et le rapprochement couvrent déjà les remboursements partiels. Le délai et l’option restent à choisir.

### Surplus

Une contribution qui dépasserait le reste serait refusée avant le paiement : on demande au partenaire le montant restant.

Si un surplus arrive malgré tout (paiements simultanés) :
- il est remboursé automatiquement à la dernière contribution ;
- le rapprochement signale l’écart d’ici là.

### Anonymat entre contributeurs

Chaque contributeur verrait :
- le montant atteint ;
- le nombre de contributions ;
- sa propre contribution.

Il ne verrait **ni le nom ni le montant** des autres, sauf accord explicite de chacun. Cela suppose une politique d’accès propre aux contributions et, dans l’application, des écrans dédiés (lot Y).

Le demandeur et le prestataire verraient le total. Le personnel verrait le détail.

### Notifications

Chaque événement envoie une alerte sans montant ni nom (même règle que les gabarits externes du lot X) :
- invitation à contribuer ;
- cible atteinte ;
- échéance proche ;
- remboursement.

## Questions pour le kickoff

1. Quels types de besoin ouvrent plusieurs payeurs ? Exemples : collecte familiale pour des soins, scolarité partagée.
2. Contributions libres ou parts fixées par le demandeur ?
3. Que faire si la cible n’est pas atteinte à l’échéance ?
4. L’anonymat entre contributeurs est-il la règle ?
5. Un contributeur peut-il ouvrir un litige seul, et sur quelle part ?
