# Journal financier et paiements (brouillon pour le kickoff)

État au 12 novembre 2026 (lot X, X5). Ce document propose un plan de comptes minimal et décrit les règles déjà en place. **Il doit être validé par le client et son expert-comptable** avant l’arrimage à TrustPayWay.

## Principe

DiasPay ne détient pas de fonds : le partenaire de paiement (TrustPayWay) encaisse, bloque, verse et rembourse. Le journal de DiasPay est un **miroir à double entrée** des mouvements du partenaire. Il sert à prouver ce qui a été reçu, ce qui reste dû et ce qui a été remboursé, et à le rapprocher des relevés du partenaire.

## Plan de comptes proposé

| Code | Nature | Libellé | Sens |
|---|---|---|---|
| `PARTNER_CASH` | actif | Fonds chez le partenaire de paiement | augmente au débit (encaissement), diminue au crédit (versement, remboursement) |
| `DUE_TO_PROVIDER` | passif | Dû aux prestataires | augmente au crédit (paiement reçu), diminue au débit (déblocage, remboursement demandé) |
| `REFUNDS_PAYABLE` | passif | Remboursements à effectuer | augmente au crédit (remboursement demandé), diminue au débit (remboursement versé ou refusé) |
| `FEES` | produit | Frais | au crédit, si des frais sont prélevés au paiement (aujourd’hui : aucun) |

Chaque ligne porte la devise de la transaction (`XAF`, `EUR`, `USD`). Il n’y a pas de conversion : un journal ne mélange jamais deux devises.

## Écritures

| Événement | Journal | Débit | Crédit |
|---|---|---|---|
| Paiement confirmé par le partenaire (`PAYMENT_SUCCEEDED`) | `PAYMENT` | `PARTNER_CASH` montant + frais | `DUE_TO_PROVIDER` montant ; `FEES` frais |
| Tranche débloquée (`release_events`, quel que soit le déclencheur) | `RELEASE` | `DUE_TO_PROVIDER` reste dû | `PARTNER_CASH` reste dû |
| Remboursement demandé (`request_refund`) | `REFUND_REQUESTED` | `DUE_TO_PROVIDER` montant | `REFUNDS_PAYABLE` montant |
| Remboursement versé (`REFUND_SUCCEEDED`) | `REFUND_SETTLED` | `REFUNDS_PAYABLE` montant | `PARTNER_CASH` montant |
| Remboursement refusé (`REFUND_FAILED`) | `REFUND_REVERSED` | `REFUNDS_PAYABLE` montant | `DUE_TO_PROVIDER` montant |

Les trois journaux de remboursement sont des **contrepassations** : ils portent `reverses_journal_id` (le journal `PAYMENT` d’origine) et ne modifient jamais une écriture existante. Une tranche intégralement remboursée ramène chaque compte à zéro pour cette tranche.

## Invariants (appliqués par la base, testés)

- **Équilibre** : pour chaque journal et chaque devise, total des débits = total des crédits, et au moins deux lignes (contrainte différée `ledger_entries_balanced`, code `LEDGER_UNBALANCED`).
- **Une ligne = un sens** : débit ou crédit strictement positif, jamais les deux.
- **Immuabilité** : aucune modification ni suppression d’un journal ou d’une ligne (`LEDGER_IMMUTABLE`), même par le propriétaire de la base. Seule la réinitialisation de démonstration (`mock_mode`) efface.
- **Écriture par le serveur seulement** : aucun droit d’écriture pour `anon` ni `authenticated` ; lecture réservée au personnel.

## Tentatives, idempotence, événements

- `payment_attempts` : une ligne par demande de paiement, clé d’idempotence **unique**. Au plus une tentative en cours ou réussie par tranche (index unique partiel). `start_payment` rejoué avec la même clé renvoie la même tentative, sans nouveau paiement ; l’application garde une clé par écran de paiement.
- `webhook_events` : chaque événement du partenaire est enregistré tel que reçu, unique par (fournisseur, identifiant). `apply_payment_event` (réservée au rôle `service_role`) :
  - même identifiant → `DUPLICATE` et résultat d’origine ;
  - signature invalide (vérifiée par l’appelant avec `PaymentPort.verifyWebhook`) → `INVALID_SIGNATURE`, enregistré, jamais appliqué ;
  - même paiement annoncé deux fois → `IGNORED` (`ALREADY_APPLIED`) ;
  - ordre inversé : un état plus ancien reçu après l’état final (`PAYMENT_PENDING` après `PAYMENT_SUCCEEDED`) → `IGNORED` (`STALE_EVENT`) ; un état final contradictoire → `REJECTED` (`CONTRADICTS_FINAL_STATE`) ;
  - montant ou devise différents, tentative inconnue → `REJECTED`.
  La fonction répond toujours (pas d’exception) pour que l’événement reste enregistré.
- Paiement réussi alors que la tranche n’est plus à payer (demande rejetée entre-temps) : l’argent est reçu, la tranche ne bouge pas, l’événement porte `TRANCHE_NOT_AWAITING` et le rapprochement le signale.

## Règlement direct (lot X version 2)

En `DIRECT` (par défaut, K1), le paiement confirmé est aussitôt versé au prestataire : un journal `PAYMENT` puis un journal `RELEASE`. Un remboursement ultérieur, issu d’un litige ou d’une décision d’administrateur, passe par `REFUND_REQUESTED` puis `REFUND_SETTLED`. Pour la demande, `DUE_TO_PROVIDER` termine alors au crédit et `PARTNER_CASH` au débit négatif : la somme est due par le prestataire (rétrofacturation). Le journal reste équilibré. Le traitement comptable et les recours, selon le rail de paiement, sont des points ouverts : `docs/open-parameters.md`, ligne 5.

## Remboursements

`request_refund(tranche, montant, clé, motif)` : administrateur non partie. Jamais au-delà du montant payé (`REFUND_EXCEEDS_PAID`) : un remboursement partiel puis le reste sont acceptés, rien au-delà. Même clé : même remboursement (jamais deux). Une tranche déjà débloquée n’est pas remboursable par cette voie (`NOT_REFUNDABLE`) : les fonds ont été versés au prestataire.

La décision d’un litige « remboursement du payeur » (lot 4) annule toujours la tranche **sans** créer de remboursement : le rapprochement signale `CANCELLED_NOT_REFUNDED` jusqu’à ce qu’un administrateur demande le remboursement. Lier les deux est une décision à prendre avec TrustPayWay.

## Rapprochement

Vue `v_reconciliation` (personnel seulement) : une ligne par tentative, avec les montants du journal et la liste `issues` :

| Code | Écart |
|---|---|
| `SUCCEEDED_WITHOUT_EVENT` | tentative réussie sans événement du partenaire appliqué |
| `SUCCEEDED_WITHOUT_LEDGER` | tentative réussie sans écriture de paiement |
| `LEDGER_WITHOUT_SUCCESS` | écriture de paiement pour une tentative non réussie |
| `LEDGER_AMOUNT_MISMATCH` | montant au journal différent du montant de la tentative |
| `TRANCHE_NOT_PAID` | argent reçu, tranche toujours à payer, rejetée ou expirée |
| `PAID_WITHOUT_ATTEMPT` | tranche payée sans aucune tentative réussie |
| `RELEASED_NOT_IN_LEDGER` | tranche débloquée sans versement au journal |
| `CANCELLED_NOT_REFUNDED` | tranche annulée, paiement non remboursé |
| `REFUNDED_TRANCHE_OPEN` | paiement remboursé en totalité, tranche toujours ouverte |
| `REFUND_EXCEEDS_PAID` | remboursements engagés au-delà du montant payé |
| `EVENT_REJECTED` | événement correctement signé mais rejeté (à examiner) |

Le simulateur applique les mêmes règles (`PaymentEngine.reconciliation`, même liste dans le même ordre, vérifié par test).

## Partenaire

`PaymentPort` v2 (`@diaspay/domain`) : `createPayment`, `getPaymentStatus`, `refund`, `verifyWebhook`, `parseWebhook`. L’adaptateur simulé (`SimulatedPaymentAdapter`) répond « en cours », puis envoie des événements signés (HMAC-SHA256) traités par le même chemin que ceux du partenaire. Sur le serveur, `demo_settle_payment` (mock_mode) fabrique l’événement simulé et appelle `apply_payment_event` : aucun court-circuit.

## À décider

- Plan de comptes : validation comptable ; comptes par partenaire et par devise si plusieurs partenaires (aujourd’hui : un compte par code, la devise sur la ligne).
- Frais : qui les paie (payeur, prestataire), quand, et sur quel compte.
- Délai d’expiration d’une tentative en cours sans réponse du partenaire (aujourd’hui : aucune ; `PAYMENT_FAILED` la clôt).
- Effet automatique d’un litige tranché en faveur du payeur (remboursement).
- Fréquence et format du rapprochement avec les relevés de TrustPayWay.
- Signature des webhooks de TrustPayWay (schéma, rotation des secrets), dans une fonction Edge qui appellera `apply_payment_event`.
