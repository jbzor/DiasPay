-- =====================================================================
-- DiasPay : migration 0007 (lot X) — valeurs d’enum seulement.
-- Fichier séparé : PostgreSQL interdit d’utiliser une valeur d’enum ajoutée dans la même transaction.
-- Utilisées par 0008_lotx.sql. Ne change aucun comportement à elle seule.
-- =====================================================================

-- Décisions du payeur (X2) : demande d’informations complémentaires, rejet de la demande.
alter type tranche_status add value if not exists 'INFO_REQUESTED';
alter type tranche_status add value if not exists 'REJECTED';

-- Paiement direct (X2.6) : aucun type de besoin ne l’utilise tant que le client n’a pas tranché (K1).
alter type release_mode add value if not exists 'IMMEDIATE';
