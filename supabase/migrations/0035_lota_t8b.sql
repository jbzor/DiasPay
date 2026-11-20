-- Lot A (T8b) : draft_data n’est plus lisible par les parties (cahier des charges §5.3).
--
-- draft_data est la saisie brute de l’initiateur : elle contient les numéros des autres parties (counterpartyPhone,
-- provider.invitedPhone). La politique tx_read laisse chaque partie lire la ligne de l’opération, et les droits par
-- défaut de Supabase donnaient la lecture de toutes les colonnes : un payeur pouvait lire draft_data (même si le client
-- ne la demande plus depuis T5). Désormais :
--   - anon et authenticated lisent toutes les colonnes de transactions SAUF draft_data (droits par colonne) ;
--   - l’initiateur lit son propre brouillon par get_draft / get_drafts (SECURITY DEFINER, existantes depuis 0005,
--     réservées au créateur, aucun droit pour anon) ;
--   - la publication temps réel n’envoie plus draft_data (liste de colonnes).
-- Conséquence à retenir : une colonne ajoutée plus tard à transactions n’est PAS lisible par authenticated tant qu’elle
-- n’est pas accordée explicitement (grant select (col) on transactions to authenticated). Le test 08_lota (T8b) vérifie
-- que toutes les colonnes sauf draft_data restent lisibles.
-- Tests : supabase/tests/08_lota.sql (section T8b).

do $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
    from pg_attribute
   where attrelid = 'public.transactions'::regclass and attnum > 0 and not attisdropped and attname <> 'draft_data';
  execute 'revoke select on table public.transactions from anon, authenticated';
  execute format('grant select (%s) on table public.transactions to anon, authenticated', cols);

  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions') then
    execute 'alter publication supabase_realtime drop table public.transactions';
    execute format('alter publication supabase_realtime add table public.transactions (%s)', cols);
  end if;
end $$;

-- get_draft et get_drafts : jamais pour anon (déjà le cas, réaffirmé).
revoke execute on function get_draft(uuid), get_drafts() from public, anon;
grant execute on function get_draft(uuid), get_drafts() to authenticated;
