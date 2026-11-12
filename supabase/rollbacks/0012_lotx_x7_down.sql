-- =====================================================================
-- Retour arrière de 0012_lotx_x7.sql (structure multi-payeurs) : à n’exécuter qu’en cas de besoin, à la main, dans une
-- transaction, AVANT celui de 0011. Restaure la clé primaire (transaction, rôle). Refuse si un dossier a deux parties de
-- même rôle (plusieurs payeurs d’un module autorisé).
-- =====================================================================
do $$
begin
  if exists (select 1 from transaction_parties group by tx_id, role having count(*) > 1) then
    raise exception 'Retour arrière impossible : un dossier a plusieurs parties de même rôle';
  end if;
end $$;
drop trigger if exists transaction_parties_multiple_payers on transaction_parties;
drop function if exists _check_multiple_payers();
drop index if exists transaction_parties_one_per_role;
drop index if exists transaction_parties_tx;
alter table transaction_parties drop constraint if exists transaction_parties_tx_user_role;
alter table transaction_parties drop constraint if exists transaction_parties_tx_phone_role;
alter table transaction_parties drop constraint if exists transaction_parties_pkey;
alter table transaction_parties add constraint transaction_parties_pkey primary key (tx_id, role);
alter table transaction_parties drop column if exists id;
