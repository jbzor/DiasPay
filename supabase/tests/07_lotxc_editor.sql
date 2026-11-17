-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 07_lotxc.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
-- Test du lot X-C (corrections avant la passe 3) : migrations 0024 et suivantes. Même format que 06_lotx2_p2.sql :
-- utilisateurs fictifs, rôles réels (authenticated, anon, service_role), tout est annulé à la fin (ROLLBACK),
-- le résumé échoue au moindre FAIL. La RLS filtre en silence : un UPDATE interdit est vérifié par le nombre de
-- lignes touchées (t.n_updated) ET par la valeur relue, jamais par la seule absence d’erreur.
-- Prérequis : 0001 à 0024 appliquées, app_config.mock_mode = 'true' (projet de développement).
begin;
create schema t;
create table t.results (n serial primary key, ok boolean not null, label text not null);
create function t.check(ok boolean, label text) returns void language plpgsql security definer as $$
begin
  insert into t.results(ok, label) values (coalesce(ok,false), label);
  raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, label;
end $$;
create function t.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;
create function t.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function t.fails(sql text, label text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin execute sql; exception when others then ok := true; end;
  perform t.check(ok, label);
end $$;
create function t.hint(sql text, expected text, label text) returns void language plpgsql as $$
declare h text; m text;
begin
  begin execute sql; exception when others then get stacked diagnostics h = pg_exception_hint, m = message_text; end;
  if h is distinct from expected then raise notice '   attendu %, obtenu % (%)', expected, coalesce(h, 'aucune erreur'), m; end if;
  perform t.check(h is not distinct from expected, label || ' [' || expected || ']');
end $$;
create function t.j(sql text) returns jsonb language plpgsql as $$
declare r jsonb; begin execute sql into r; return r; end $$;
create function t.n_updated(sql text) returns int language plpgsql as $$
declare n int; begin execute sql; get diagnostics n = row_count; return n; end $$;
create function t.ok(sql text, label text) returns void language plpgsql as $$
declare m text;
begin
  begin execute sql; exception when others then get stacked diagnostics m = message_text; end;
  if m is not null then raise notice '   erreur inattendue : %', m; end if;
  perform t.check(m is null, label);
end $$;
create table t.ids (k text primary key, v uuid);
create table t.res (k text primary key, v jsonb);
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users(id, phone) values
 ('fdc00000-0000-4000-8000-000000000001','33625560001'),   -- payeur, créateur des brouillons
 ('fdc00000-0000-4000-8000-000000000002','237625560002');  -- prestataire (partie aux dossiers, complice des falsifications T3)
update profiles set primary_role = 'PROVIDER', full_name = 'Clinique X-C (test)' where id = 'fdc00000-0000-4000-8000-000000000002';
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');

-- Brouillon santé prêt à soumettre (module HEALTH : REFERENCE_ONLY, DIRECT, devis obligatoire).
create function t.health_draft(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', 'HEALTH', 'creatorRole', 'PAYER',
    'amountMinor', '180000', 'currency', 'XAF', 'purpose', 'Soins (test X-C)', 'beneficiaryReference', 'RM-12',
    'desiredDate', to_char(current_date + 10, 'YYYY-MM-DD'), 'planType', 'SINGLE',
    'provider', jsonb_build_object('name', 'Clinique X-C (test)', 'invitedPhone', '+237625560002'),
    'tranches', jsonb_build_array(jsonb_build_object('label', 'Soins', 'amountMinor', '180000')))
$$;
grant execute on function t.health_draft(uuid) to authenticated;

-- ===================== T3 : brouillons d’opération (R2) =====================
-- ---------- Structure ----------
select t.check(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transactions' and policyname = 'tx_update_draft'),
  'T3 : la politique tx_update_draft est supprimée (aucune écriture directe des brouillons)');

-- ---------- Écriture directe par le créateur : silencieusement sans effet (RLS) ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000001'))$$, 'T3 : brouillon créé par save_draft');
select t.check(t.n_updated($$update transactions set beneficiary_name = 'Rose Mbarga' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : nom du bénéficiaire : écriture directe sans effet (0 ligne)');
select t.check((select beneficiary_name from transactions where id = 'fdc10000-0000-4000-8000-000000000001') is null, 'T3 : nom inchangé (null)');
select t.check(t.n_updated($$update transactions set settlement_mode = 'CONDITIONAL' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : mode de règlement : écriture directe sans effet (0 ligne)');
select t.check((select settlement_mode from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'DIRECT', 'T3 : mode de règlement inchangé (DIRECT)');
select t.check(t.n_updated($$update transactions set initiator_id = 'fdc00000-0000-4000-8000-000000000002' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : initiateur : écriture directe sans effet (0 ligne)');
select t.check((select initiator_id from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'fdc00000-0000-4000-8000-000000000001',
  'T3 : initiateur inchangé (créateur)');
select t.check(t.n_updated($$update transactions set status = 'CLOSED' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : statut : écriture directe sans effet (0 ligne)');
select t.check(t.n_updated($$update transactions set purpose = 'Détourné' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : motif : écriture directe sans effet (0 ligne)');
select t.check((select status from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'DRAFT'
           and (select purpose from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'Soins (test X-C)',
  'T3 : statut et motif inchangés');
-- save_draft reste le chemin légitime.
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000001') || '{"beneficiaryReference":"RM-13"}')$$, 'T3 : save_draft modifie toujours le brouillon');
select t.check((select beneficiary_reference from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'RM-13', 'T3 : référence mise à jour par save_draft');

-- ---------- Soumission d’un brouillon falsifié (données antérieures à 0024, posées hors RLS) ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select add_document('fdc10000-0000-4000-8000-000000000001', 'QUOTE', 'fdc10000-0000-4000-8000-000000000001/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
-- Nom falsifié sur un module REFERENCE_ONLY (K13) : refusé.
select t.admin();
update transactions set beneficiary_name = 'Rose Mbarga' where id = 'fdc10000-0000-4000-8000-000000000001';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$select submit_operation('fdc10000-0000-4000-8000-000000000001')$$, 'BENEFICIARY_NAME_NOT_ALLOWED',
  'T3 : soumission refusée : nom falsifié sur un module à référence seule');
-- Mode de règlement falsifié : la soumission le recalcule depuis le module.
select t.admin();
update transactions set beneficiary_name = null, settlement_mode = 'CONDITIONAL' where id = 'fdc10000-0000-4000-8000-000000000001';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select submit_operation('fdc10000-0000-4000-8000-000000000001')$$, 'T3 : soumission acceptée après correction du nom');
select t.check((select settlement_mode from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'DIRECT'
           and (select status from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'ACTIVE',
  'T3 : mode de règlement recalculé depuis le module (DIRECT), opération active');
-- Initiateur falsifié : refusé pour le complice (INITIATOR_MISMATCH) comme pour le créateur (INITIATOR_ONLY).
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000002'))$$, 'T3 : second brouillon créé');
select add_document('fdc10000-0000-4000-8000-000000000002', 'QUOTE', 'fdc10000-0000-4000-8000-000000000002/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select t.admin();
update transactions set initiator_id = 'fdc00000-0000-4000-8000-000000000002' where id = 'fdc10000-0000-4000-8000-000000000002';
select t.login('fdc00000-0000-4000-8000-000000000002');
select t.hint($$select submit_operation('fdc10000-0000-4000-8000-000000000002')$$, 'INITIATOR_MISMATCH',
  'T3 : soumission par l’initiateur falsifié refusée');
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$select submit_operation('fdc10000-0000-4000-8000-000000000002')$$, 'INITIATOR_ONLY',
  'T3 : soumission par le créateur dépossédé refusée (il n’est plus l’initiateur)');
select t.admin();
update transactions set initiator_id = created_by where id = 'fdc10000-0000-4000-8000-000000000002';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select submit_operation('fdc10000-0000-4000-8000-000000000002')$$, 'T3 : initiateur rétabli : la soumission passe (le brouillon était sain par ailleurs)');
select t.admin();

-- ===================== Fin =====================
-- ---------- Résumé (éditeur SQL) ----------
-- Le résultat est rendu par une erreur, toujours levée : elle s’affiche dans l’éditeur et annule tout le test.
do $$
declare total int; bad int; failed text;
begin
  select count(*), count(*) filter (where not ok), string_agg(n || '. ' || label, ' | ' order by n) filter (where not ok)
    into total, bad, failed from t.results;
  if bad > 0 then raise exception 'ECHEC : % vérification(s) sur % : %', bad, total, failed; end if;
  raise exception 'RESULTAT : % vérifications, toutes réussies (test annulé : rien n’est conservé)', total;
end $$;
