-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 08_lota.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
-- Test du lot A (application branchée sur Supabase) : migrations 0032 et suivantes. Même format que 07_lotxc.sql :
-- utilisateurs fictifs, rôles réels (authenticated, anon, service_role), tout est annulé à la fin (ROLLBACK),
-- le résumé échoue au moindre FAIL. La RLS filtre en silence : un UPDATE interdit est vérifié par le nombre de
-- lignes touchées (t.n_updated) ET par la valeur relue, jamais par la seule absence d’erreur.
-- Prérequis : 0001 à 0032 appliquées, app_config.mock_mode = 'true' (projet de développement).
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
 ('fda00000-0000-4000-8000-000000000001','33625570001'),   -- payeur
 ('fda00000-0000-4000-8000-000000000002','237625570002'),  -- prestataire (partie aux dossiers)
 ('fda00000-0000-4000-8000-000000000006','33625570006'),   -- demandeur N1 (initiateur)
 ('fda00000-0000-4000-8000-000000000007','33625570007');   -- administrateur non partie
update profiles set primary_role = 'REQUESTER', enrolment_level = 'N1', full_name = 'Demandeur A (test)' where id = 'fda00000-0000-4000-8000-000000000006';
update profiles set primary_role = 'PROVIDER', full_name = 'Clinique A (test)' where id = 'fda00000-0000-4000-8000-000000000002';
update profiles set platform_role = 'ADMIN', full_name = 'Administrateur A (test)' where id = 'fda00000-0000-4000-8000-000000000007';
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');

-- Demande santé (DIRECT) d’un demandeur N1, payeur désigné par son numéro (compte existant : il devient partie).
create function t.health_request(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', 'HEALTH', 'creatorRole', 'REQUESTER', 'counterpartyPhone', '+33625570001',
    'amountMinor', '180000', 'currency', 'XAF', 'purpose', 'Soins (test A)', 'beneficiaryReference', 'RM-12',
    'desiredDate', to_char(current_date + 10, 'YYYY-MM-DD'), 'planType', 'SINGLE',
    'provider', jsonb_build_object('name', 'Clinique A (test)', 'invitedPhone', '+237625570002'),
    'tranches', jsonb_build_array(jsonb_build_object('label', 'Soins', 'amountMinor', '180000')))
$$;
grant execute on function t.health_request(uuid) to authenticated;
-- Création et soumission par le demandeur ; l’identifiant de la demande est rangé sous p_key.
create function t.submit_health(p_tx uuid, p_key text) returns void language plpgsql as $$
begin
  perform t.login('fda00000-0000-4000-8000-000000000006');
  perform save_draft(t.health_request(p_tx));
  perform add_document(p_tx, 'QUOTE', p_tx::text || '/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
  perform submit_operation(p_tx);
  perform t.admin();
  insert into t.ids select p_key, id from tranches where tx_id = p_tx;
end $$;
grant execute on function t.submit_health(uuid, text) to authenticated;

-- ===================== T2 : jeton après une demande terminée (0032) =====================
select t.submit_health('fda10000-0000-4000-8000-000000000001', 'trA');
insert into t.res select 'refA', to_jsonb(reference) from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and revoked_at is null;
select t.check((select user_id from transaction_parties where tx_id = 'fda10000-0000-4000-8000-000000000001' and role = 'PAYER')
             = 'fda00000-0000-4000-8000-000000000001', 'T2 : le payeur désigné par son numéro est partie au dossier');

-- Avant paiement : l’administrateur non partie peut toujours réémettre (comportement conservé).
select t.login('fda00000-0000-4000-8000-000000000007');
select t.check(reissue_token((select v from t.ids where k = 'trA'), 'Réémission avant paiement') ->> 'tokenId' is not null,
  'T2 : demande soumise : l’administrateur non partie réémet');
select t.admin();
delete from t.res where k = 'refA';
insert into t.res select 'refA', to_jsonb(reference) from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and revoked_at is null;

-- Paiement direct par le payeur, confirmé par le partenaire simulé (démonstration).
select t.login('fda00000-0000-4000-8000-000000000001');
insert into t.res select 'aA', start_payment((select v from t.ids where k = 'trA'), 'lota-t2-pay-0001');
select demo_settle_payment((select (v->>'id')::uuid from t.res where k = 'aA'));
select t.admin();
select t.check((select status from tranches where id = (select v from t.ids where k = 'trA')) = 'PAID'
           and exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'trA') and event = 'REQUEST_PAID'),
  'T2 : demande payée (DIRECT), REQUEST_PAID journalisé');
select t.check(not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and revoked_at is null),
  'T2 : DIRECT payée : aucun jeton actif');
select t.check(not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and used_at is not null),
  'T2 : DIRECT : used_at reste vide sur tous les jetons de la demande');

-- Résolution après paiement : TOKEN_REVOKED pour le payeur et pour l’initiateur.
select t.login('fda00000-0000-4000-8000-000000000001');
select t.hint($$select resolve_reference_info((select v #>> '{}' from t.res where k = 'refA'))$$, 'TOKEN_REVOKED',
  'T2 : après paiement direct, le payeur reçoit TOKEN_REVOKED');
select t.login('fda00000-0000-4000-8000-000000000006');
select t.hint($$select resolve_reference_info((select v #>> '{}' from t.res where k = 'refA'))$$, 'TOKEN_REVOKED',
  'T2 : après paiement direct, l’initiateur reçoit TOKEN_REVOKED');
-- Réémission refusée : initiateur (règle existante) et administrateur non partie (nouvelle règle).
select t.hint($$select reissue_token((select v from t.ids where k = 'trA'), 'Nouveau jeton')$$, 'NOT_REVOCABLE',
  'T2 : initiateur : réémission refusée sur une demande payée (inchangé)');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.hint($$select reissue_token((select v from t.ids where k = 'trA'), 'Nouveau jeton')$$, 'REQUEST_CLOSED',
  'T2 : administrateur non partie : réémission refusée sur une demande payée en DIRECT');
select t.admin();
select t.check(not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and revoked_at is null)
           and not exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'trA') and event = 'TOKEN_REISSUED'
                            and id > (select max(id) from audit_log where tranche_id = (select v from t.ids where k = 'trA') and event = 'REQUEST_PAID')),
  'T2 : aucun jeton actif ni réémission journalisée après le refus (valeurs relues)');
insert into t.res select 'revokedA', to_jsonb(count(*)) from audit_log where tranche_id = (select v from t.ids where k = 'trA') and event = 'TOKEN_REVOKED';

-- Remboursement total par l’administrateur : « remboursée », toujours aucun jeton actif, aucune révocation en double.
select t.login('fda00000-0000-4000-8000-000000000007');
insert into t.ids select 'rfA', (request_refund((select v from t.ids where k = 'trA'), 180000, 'lota-t2-refund-0001', 'Remboursement test A')->>'id')::uuid;
select demo_settle_refund((select v from t.ids where k = 'rfA'));
select t.admin();
select t.check((select status from tranches where id = (select v from t.ids where k = 'trA')) = 'REFUNDED', 'T2 : demande remboursée');
select t.check(not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and revoked_at is null),
  'T2 : remboursée : aucun jeton actif');
select t.check((select count(*) from audit_log where tranche_id = (select v from t.ids where k = 'trA') and event = 'TOKEN_REVOKED')
             = (select (v #>> '{}')::int from t.res where k = 'revokedA'),
  'T2 : passage à « remboursée » : aucune entrée TOKEN_REVOKED en double');
select t.check(not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'trA') and used_at is not null),
  'T2 : remboursée : used_at toujours vide');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.hint($$select reissue_token((select v from t.ids where k = 'trA'), 'Nouveau jeton')$$, 'REQUEST_CLOSED',
  'T2 : administrateur non partie : réémission refusée sur une demande remboursée');

-- Demande rejetée par le payeur, puis opération annulée : réémission refusée.
select t.submit_health('fda10000-0000-4000-8000-000000000002', 'trB');
select t.login('fda00000-0000-4000-8000-000000000001');
select reject_request((select v from t.ids where k = 'trB'), 'Montant non convenu');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.hint($$select reissue_token((select v from t.ids where k = 'trB'), 'Nouveau jeton')$$, 'REQUEST_CLOSED',
  'T2 : administrateur non partie : réémission refusée sur une demande rejetée');
select t.submit_health('fda10000-0000-4000-8000-000000000003', 'trC');
select t.login('fda00000-0000-4000-8000-000000000006');
select transition_tx('fda10000-0000-4000-8000-000000000003', 'CANCELLED');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.hint($$select reissue_token((select v from t.ids where k = 'trC'), 'Nouveau jeton')$$, 'REQUEST_CLOSED',
  'T2 : administrateur non partie : réémission refusée sur une demande annulée');
-- Demande échue (statut posé hors rôle, comme le ferait expire_due_requests).
select t.submit_health('fda10000-0000-4000-8000-000000000004', 'trD');
update tranches set status = 'EXPIRED' where id = (select v from t.ids where k = 'trD');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.hint($$select reissue_token((select v from t.ids where k = 'trD'), 'Nouveau jeton')$$, 'REQUEST_CLOSED',
  'T2 : administrateur non partie : réémission refusée sur une demande expirée');
select t.admin();
select t.check(not exists (select 1 from tranche_tokens where tranche_id in (select v from t.ids where k in ('trB','trC','trD')) and revoked_at is null),
  'T2 : rejetée, annulée, expirée : aucun jeton actif après les refus (valeurs relues)');

-- CONDITIONAL : la réémission reste permise pendant la confirmation (payée, fonds bloqués).
update request_modules set enabled = true where code = 'AGRO';
select t.login('fda00000-0000-4000-8000-000000000001');
select save_draft(jsonb_build_object('id', 'fda10000-0000-4000-8000-000000000005', 'vertical', 'AGRO', 'creatorRole', 'PAYER',
    'amountMinor', '100000', 'currency', 'XAF', 'purpose', 'Intrants (test A)', 'planType', 'SINGLE',
    'provider', jsonb_build_object('name', 'Coopérative A (test)', 'invitedPhone', '+237625570002'),
    'tranches', jsonb_build_array(jsonb_build_object('label', 'Livraison', 'amountMinor', '100000', 'dueDate', to_char(current_date + 2, 'YYYY-MM-DD')))));
select add_document('fda10000-0000-4000-8000-000000000005', 'SUPPORTING_DOCUMENT', 'fda10000-0000-4000-8000-000000000005/SUPPORTING_DOCUMENT/a.pdf', 'a.pdf', 'application/pdf', 1000);
select submit_operation('fda10000-0000-4000-8000-000000000005');
select t.admin();
insert into t.ids select 'trE', id from tranches where tx_id = 'fda10000-0000-4000-8000-000000000005';
select t.login('fda00000-0000-4000-8000-000000000001');
insert into t.res select 'aE', start_payment((select v from t.ids where k = 'trE'), 'lota-t2-pay-0002');
select demo_settle_payment((select (v->>'id')::uuid from t.res where k = 'aE'));
select t.admin();
select t.check((select status = 'PAID' and funds_state = 'HELD' from tranches where id = (select v from t.ids where k = 'trE')),
  'T2 : CONDITIONAL : demande payée, fonds bloqués');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.check(reissue_token((select v from t.ids where k = 'trE'), 'Réémission pendant la confirmation') ->> 'tokenId' is not null,
  'T2 : CONDITIONAL en confirmation : l’administrateur non partie réémet (permis)');
-- Fonds rendus au payeur (posé hors rôle) : la demande est terminée, la réémission est refusée.
select t.admin();
update tranches set funds_state = 'RETURNED' where id = (select v from t.ids where k = 'trE');
select t.login('fda00000-0000-4000-8000-000000000007');
select t.hint($$select reissue_token((select v from t.ids where k = 'trE'), 'Nouveau jeton')$$, 'REQUEST_CLOSED',
  'T2 : CONDITIONAL, fonds rendus : réémission refusée');
select t.admin();
select t.check(not has_function_privilege('anon', 'reissue_token(uuid, text)', 'EXECUTE')
           and not has_function_privilege('authenticated', '_token_reissue_closed(uuid)', 'EXECUTE'),
  'T2 : droits : reissue_token fermé à anon, _token_reissue_closed fermé à authenticated');

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
