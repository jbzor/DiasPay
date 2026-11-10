# Décisions du projet DiasPayQR

Choix délégués par le client au prestataire. Chaque décision reste révisable par le client.

---

## D1 — Téléphone du payeur

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** : validé par le client. Le champ « Téléphone du payeur » reste à l’étape 2 (Détails) de la création d’un besoin quand le créateur est demandeur. Le payeur sera invité à financer le besoin.
- **Mise en œuvre** : `packages/domain/src/need.ts` (code `PAYER_PHONE_REQUIRED`), `apps/mobile/src/app/need/details.tsx`.

## D2 — Pièces requises de la vague 1

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** : les valeurs proposées au lot 3 sont confirmées.

| Verticale | Pièces |
|---|---|
| Santé | Devis ou facture proforma (obligatoire) ; pièce d’identité du bénéficiaire (obligatoire) ; certificat médical (facultatif) |
| Scolarité | Attestation d’inscription (obligatoire) ; échéancier de l’école (facultatif) |
| Loyer | Bail (obligatoire) ; dernière quittance (facultatif) |

- **Fichiers** : jusqu’à 3 fichiers par type de pièce (une pièce d’identité se photographie recto et verso), 10 Mo chacun, JPEG, PNG ou PDF. Une pièce est « fournie » dès qu’un fichier est envoyé. Le validateur juge de la suffisance ; l’application ne le fait pas.
- **Hors décision** : Agro, Immobilier et Terrain restent « À CONFIRMER » (vague 2).
- **Mise en œuvre** : `packages/domain/src/documents.ts` (`REQUIRED_DOCUMENTS`, `MAX_FILES_PER_KIND`, erreur `TOO_MANY_FILES`).

## D3 — Textes d’aide du plan de paiement (étape 4)

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** : les textes rédigés au lot 3 sont remplacés par ceux-ci, et aucune autre formulation n’est conservée.

| Clé | Français | Anglais |
|---|---|---|
| `plan.help.single` | Un seul paiement du montant total. | One single payment of the full amount. |
| `plan.help.partial` | Divisez le paiement en plusieurs parts, par exemple un acompte puis le solde. Chaque part est payée, confirmée et débloquée séparément. | Split the payment into several parts, for example a deposit then the balance. Each part is paid, confirmed and released separately. |
| `plan.help.installments` | Répartissez le paiement sur plusieurs dates que vous choisissez. Chaque tranche est payée, confirmée et débloquée séparément. | Spread the payment over several dates you choose. Each installment is paid, confirmed and released separately. |
| `plan.help.recurring` | Un paiement identique à intervalle régulier, par exemple chaque mois pour un loyer. | An identical payment at regular intervals, for example monthly for rent. |
| `plan.sum.ok` | Somme des tranches : {sum} / {total} | Sum of installments: {sum} / {total} |
| `plan.sum.under` | Il reste {gap} à répartir. | {gap} left to allocate. |
| `plan.sum.over` | Dépassement de {gap}. | Over by {gap}. |
| `plan.note` | Chaque tranche est payée, confirmée puis débloquée séparément. | Each installment is paid, confirmed, then released separately. |

- **Mise en œuvre** : `apps/mobile/src/i18n/messages.ts` (les clés pointées sont écrites `plan_help_single`, etc., les dictionnaires n’utilisant que des identifiants simples).

## D4 — Politique d’abandon d’un dossier

- **Date** : 10 novembre 2026
- **Statut** : décidé, révisable par le client
- **Décision** :
  - Brouillon jamais soumis : supprimé définitivement, avec ses pièces (il n’a jamais été audité).
  - Dossier rejeté : le créateur peut le **corriger** (retour en brouillon) ou l’**abandonner** : il passe à `CANCELLED`, sa trace et son journal sont conservés. Il apparaît sous « Clôturées » avec le libellé « Abandonné ».
  - Dossier soumis ou en validation : ni supprimable ni annulable dans la vague 1.
  - Aucun dossier ayant une ligne d’audit n’est jamais effacé.
- **Mise en œuvre** : statut `CANCELLED` et transition `REJECTED → CANCELLED` (payeur, demandeur) dans `packages/domain/src/txMachine.ts` ; `abandonRejected` et `deleteDraft` dans `packages/api-client/src/mockApi.ts`.
