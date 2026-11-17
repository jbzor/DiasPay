-- =====================================================================
-- DiasPay : migration 0012 (lot X, passe 2, X7) — structure multi-payeurs (préparation, sans interface).
-- À appliquer SUR 0001 à 0011. Ne modifie aucune migration précédente. Réversible : supabase/rollbacks/0012_lotx_x7_down.sql.
-- Test : supabase/tests/04_lotx_p2.sql (partie X7). Suite prévue (phase 2) : docs/specs/multi-payers.md.
--
--  1. transaction_parties : identifiant propre (clé primaire) au lieu de (transaction, rôle) ; unicité (transaction, utilisateur,
--     rôle) et (transaction, téléphone invité, rôle) ; un seul payeur… sauf module autorisé, et toujours un seul demandeur et un
--     seul prestataire (comportement observable inchangé).
--  2. Un second payeur n’est accepté que si le module a multiple_payers = true (faux partout) :
--     déclencheur de contrainte, code stable MULTIPLE_PAYERS_NOT_ALLOWED.
-- has_role, is_party et les politiques existantes lisent toujours les mêmes lignes : rien à changer.
-- =====================================================================

-- ---------- X7.1 Clé primaire propre et contraintes d’unicité ----------
alter table transaction_parties add column if not exists id uuid not null default gen_random_uuid();
alter table transaction_parties drop constraint if exists transaction_parties_pkey;
alter table transaction_parties add constraint transaction_parties_pkey primary key (id);
alter table transaction_parties drop constraint if exists transaction_parties_tx_user_role;
alter table transaction_parties add constraint transaction_parties_tx_user_role unique (tx_id, user_id, role);
alter table transaction_parties drop constraint if exists transaction_parties_tx_phone_role;
alter table transaction_parties add constraint transaction_parties_tx_phone_role unique (tx_id, invited_phone, role);
-- Demandeur, prestataire, système : toujours un seul par dossier (comme l’ancienne clé primaire).
create unique index if not exists transaction_parties_one_per_role on transaction_parties(tx_id, role) where role <> 'PAYER';
create index if not exists transaction_parties_tx on transaction_parties(tx_id, role);

-- ---------- X7.2 Second payeur : seulement si le module l’autorise ----------
create or replace function _check_multiple_payers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'PAYER'
     and exists (select 1 from transaction_parties p where p.tx_id = new.tx_id and p.role = 'PAYER' and p.id <> new.id)
     and not coalesce((select m.multiple_payers from transactions t join request_modules m on m.code = t.vertical where t.id = new.tx_id), false) then
    perform _err('MULTIPLE_PAYERS_NOT_ALLOWED', 'Un seul payeur pour ce type de besoin');
  end if;
  return null;
end $$;
drop trigger if exists transaction_parties_multiple_payers on transaction_parties;
create constraint trigger transaction_parties_multiple_payers after insert or update of role, tx_id on transaction_parties
  for each row execute function _check_multiple_payers();

revoke all on function _check_multiple_payers() from public, anon, authenticated;
