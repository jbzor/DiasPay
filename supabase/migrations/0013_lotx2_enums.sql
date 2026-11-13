-- =====================================================================
-- DiasPay : migration 0013 (lot X version 2, noyau après le kickoff) — valeurs d’enum seulement.
-- Fichier séparé : PostgreSQL interdit d’utiliser une valeur d’enum ajoutée dans la même transaction.
-- Utilisées par 0014_lotx2_core.sql. Modèle cible : docs/specs/modele-cible-v2.md (sections 2 et 3).
-- Les anciennes valeurs (SUBMITTED, VALIDATED, TOKEN_ISSUED, IN_PROGRESS, DISPUTED, PLANNED, AWAITING_PAYMENT,
-- PAID_LOCKED, CONFIRMED, RELEASED, EVIDENCE_SUBMITTED, IMMEDIATE…) ne peuvent pas être retirées d’un enum :
-- 0014 les refuse par des contraintes et le TypeScript ne les connaît plus.
-- =====================================================================

-- Opération (section 3.1) : DRAFT, PENDING_REVIEW, IN_REVIEW (prise en charge par le bureau), ACTIVE, SUSPENDED, CLOSED, CANCELLED.
alter type tx_status add value if not exists 'PENDING_REVIEW';
alter type tx_status add value if not exists 'ACTIVE';
alter type tx_status add value if not exists 'SUSPENDED';

-- Demande de paiement (section 3.2) : DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED, EXPIRED, REFUNDED.
alter type tranche_status add value if not exists 'DRAFT';
alter type tranche_status add value if not exists 'SUBMITTED';
alter type tranche_status add value if not exists 'ACCEPTED';
alter type tranche_status add value if not exists 'PAID';
alter type tranche_status add value if not exists 'REFUNDED';

-- Rôle des tables de transitions seulement : l’initiateur de l’opération (transactions.initiator_id), quel que soit son rôle.
-- Jamais enregistré dans transaction_parties (contrainte posée par 0014).
alter type tx_role add value if not exists 'INITIATOR';

-- Mode de règlement de l’opération (K1) : DIRECT (défaut) ou CONDITIONAL (séquestre, phases 2 et 3).
do $$ begin
  if to_regtype('public.settlement_mode') is null then create type settlement_mode as enum ('DIRECT', 'CONDITIONAL'); end if;
end $$;
