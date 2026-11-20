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

-- ===================== T3 : simulateur du partenaire de paiement (0033) =====================
-- Fonctions appelées avec les droits du propriétaire (t.admin) : aucune n’est exécutable par anon ni authenticated.
-- Paye la demande seq 1 du dossier (payeur), range la tentative sous p_key.
create function t.start_pay(p_tx uuid, p_key text) returns void language plpgsql as $$
begin
  perform t.submit_health(p_tx, 'tr_' || p_key);
  perform t.login('fda00000-0000-4000-8000-000000000001');
  insert into t.res select p_key, start_payment((select id from tranches where tx_id = p_tx), 'lota-t3-' || p_key || '-0001');
  perform t.admin();
end $$;
create function t.attempt(p_key text) returns payment_attempts language sql as $$
  select * from payment_attempts where id = (select (v->>'id')::uuid from t.res where k = p_key)
$$;
create function t.req_status(p_key text) returns text language sql as $$
  select status::text from tranches where id = (select v from t.ids where k = 'tr_' || p_key)
$$;
create function t.events(p_key text) returns bigint language sql as $$
  select count(*) from webhook_events where event_id like 'simsvc-' || (select v->>'id' from t.res where k = p_key) || '-%'
$$;

select t.check(exists (select 1 from payment_partner_keys where provider = 'SIMULATED' and dev_only),
  'T3 : clé du simulateur présente, marquée dev_only');
select t.check(exists (select 1 from cron.job where jobname = 'diaspay-payment-simulator' and active),
  'T3 : tâche planifiée diaspay-payment-simulator active (mock_mode)');
update app_config set value = 'SUCCESS' where key = 'sim_payment_scenario';

-- ---------- Délai : une tentative trop récente n’est pas traitée ----------
update app_config set value = '600' where key = 'sim_payment_delay_seconds';
select t.start_pay('fda10000-0000-4000-8000-000000000011', 'sOk');
select t.check((t.attempt('sOk')).status = 'INITIATED' and t.req_status('sOk') = 'ACCEPTED', 'T3 : après start_payment : tentative INITIATED, demande ACCEPTED (paiement en cours)');
select payment_simulator_tick();
select t.check((t.attempt('sOk')).status = 'INITIATED' and t.events('sOk') = 0, 'T3 : délai non écoulé : la tâche ne touche pas la tentative');
update app_config set value = '0' where key = 'sim_payment_delay_seconds';

-- ---------- SUCCESS (défaut), par la tâche planifiée ----------
select payment_simulator_tick();
select t.check((t.attempt('sOk')).status = 'CONFIRMED' and t.req_status('sOk') = 'PAID', 'T3 : SUCCESS : tentative CONFIRMED, demande PAID');
select t.check((select signature_valid and result = 'APPLIED' from webhook_events
                 where event_id = 'simsvc-' || (select v->>'id' from t.res where k = 'sOk') || '-PAYMENT_SUCCEEDED'),
  'T3 : SUCCESS : événement à identifiant stable, signature vérifiée valide, appliqué par apply_payment_event');
select t.check((select count(*) from ledger_journals where attempt_id = (t.attempt('sOk')).id and kind = 'PAYMENT') = 1,
  'T3 : SUCCESS : une seule écriture de paiement au journal financier');
select t.check((select simulate_payment_attempt((t.attempt('sOk')).id) ->> 'step') = 'DONE' and t.events('sOk') = 1,
  'T3 : tentative terminée : le simulateur ne renvoie plus rien');

-- ---------- Scénario FAILURE : refus du partenaire ----------
update app_config set value = 'FAILURE' where key = 'sim_payment_scenario';
select t.start_pay('fda10000-0000-4000-8000-000000000012', 'sKo');
insert into t.res select 'rKo', simulate_payment_attempt((t.attempt('sKo')).id);
select t.check((t.attempt('sKo')).status = 'FAILED' and (t.attempt('sKo')).error_code = 'SIMULATED_DECLINE', 'T3 : refus du partenaire : tentative refusée (SIMULATED_DECLINE)');
select t.check(t.req_status('sKo') <> 'PAID' and not exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'tr_sKo') and event = 'REQUEST_PAID')
           and not exists (select 1 from ledger_journals where attempt_id = (t.attempt('sKo')).id),
  'T3 : refus du partenaire : demande non payée, aucune écriture financière');

-- ---------- LATE : « en attente », puis succès après le délai ----------
update app_config set value = 'LATE' where key = 'sim_payment_scenario';
update app_config set value = '600' where key = 'sim_payment_late_seconds';
select t.start_pay('fda10000-0000-4000-8000-000000000013', 'sLate');
select t.check(simulate_payment_attempt((t.attempt('sLate')).id) ->> 'step' = 'PENDING' and (t.attempt('sLate')).status = 'PENDING'
           and t.req_status('sLate') = 'ACCEPTED', 'T3 : LATE : d’abord PENDING, demande toujours en cours (ACCEPTED)');
select t.check(simulate_payment_attempt((t.attempt('sLate')).id) ->> 'step' = 'WAITING' and (t.attempt('sLate')).status = 'PENDING',
  'T3 : LATE : délai non écoulé : rien de plus');
update app_config set value = '0' where key = 'sim_payment_late_seconds';
select payment_simulator_tick();
select t.check((t.attempt('sLate')).status = 'CONFIRMED' and t.req_status('sLate') = 'PAID' and t.events('sLate') = 2,
  'T3 : LATE : succès après le délai (tâche planifiée), demande PAID, deux événements');

-- ---------- DUPLICATE : le même événement reçu deux fois ----------
update app_config set value = 'DUPLICATE' where key = 'sim_payment_scenario';
select t.start_pay('fda10000-0000-4000-8000-000000000014', 'sDup');
insert into t.res select 'rDup', simulate_payment_attempt((t.attempt('sDup')).id);
select t.check((select v #>> '{results,0,result}' from t.res where k = 'rDup') = 'APPLIED'
           and (select v #>> '{results,1,result}' from t.res where k = 'rDup') = 'DUPLICATE',
  'T3 : DUPLICATE : premier appliqué, second reconnu comme doublon');
select t.check(t.events('sDup') = 1 and t.req_status('sDup') = 'PAID'
           and (select count(*) from ledger_journals where attempt_id = (t.attempt('sDup')).id and kind = 'PAYMENT') = 1
           and (select count(*) from audit_log where tranche_id = (select v from t.ids where k = 'tr_sDup') and event = 'REQUEST_PAID') = 1
           and (select count(*) from payments where tranche_id = (select v from t.ids where k = 'tr_sDup')) = 1,
  'T3 : DUPLICATE : un seul effet (un événement, un paiement, une écriture, un REQUEST_PAID)');

-- ---------- OUT_OF_ORDER : succès, puis un « en attente » périmé ----------
update app_config set value = 'OUT_OF_ORDER' where key = 'sim_payment_scenario';
select t.start_pay('fda10000-0000-4000-8000-000000000015', 'sOoo');
insert into t.res select 'rOoo', simulate_payment_attempt((t.attempt('sOoo')).id);
select t.check((select v #>> '{results,1,result}' from t.res where k = 'rOoo') = 'IGNORED'
           and (select v #>> '{results,1,error}' from t.res where k = 'rOoo') = 'STALE_EVENT',
  'T3 : OUT_OF_ORDER : l’événement périmé est ignoré (STALE_EVENT)');
select t.check((t.attempt('sOoo')).status = 'CONFIRMED' and t.req_status('sOoo') = 'PAID', 'T3 : OUT_OF_ORDER : tentative CONFIRMED, demande PAID');

-- ---------- Signature : vérifiée, jamais contournée ----------
update app_config set value = 'SUCCESS' where key = 'sim_payment_scenario';
select t.start_pay('fda10000-0000-4000-8000-000000000016', 'sSig');
insert into t.res select 'rawSig', to_jsonb(jsonb_build_object('provider', 'SIMULATED', 'eventId', 'lota-forged-0001', 'occurredAt', '2026-11-19T10:00:00.000Z',
  'payload', jsonb_build_object('type', 'PAYMENT_SUCCEEDED', 'idempotencyKey', (t.attempt('sSig')).idempotency_key,
    'amountMinor', (t.attempt('sSig')).amount_minor, 'currency', (t.attempt('sSig')).currency))::text);
select t.check(receive_payment_webhook((select v #>> '{}' from t.res where k = 'rawSig'), repeat('0', 64)) ->> 'result' = 'INVALID_SIGNATURE',
  'T3 : signature fausse : INVALID_SIGNATURE');
select t.check((t.attempt('sSig')).status = 'INITIATED' and t.req_status('sSig') = 'ACCEPTED'
           and (select not signature_valid and result = 'INVALID_SIGNATURE' from webhook_events where event_id = 'lota-forged-0001'),
  'T3 : signature fausse : enregistrée, jamais appliquée (valeurs relues)');
select t.check(receive_payment_webhook(replace((select v #>> '{}' from t.res where k = 'rawSig'), 'lota-forged-0001', 'lota-forged-0002'),
                 _sim_sign((select v #>> '{}' from t.res where k = 'rawSig'))) ->> 'result' = 'INVALID_SIGNATURE',
  'T3 : signature d’un autre corps : INVALID_SIGNATURE');
select t.check(receive_payment_webhook(replace((select v #>> '{}' from t.res where k = 'rawSig'), 'lota-forged-0001', 'lota-signed-0003'), null) ->> 'result' = 'INVALID_SIGNATURE',
  'T3 : signature absente : INVALID_SIGNATURE');
select t.check(receive_payment_webhook(replace((select v #>> '{}' from t.res where k = 'rawSig'), '"SIMULATED"', '"TRUSTPAYWAY"'), repeat('0', 64)) ->> 'result' = 'INVALID_SIGNATURE',
  'T3 : fournisseur sans clé : INVALID_SIGNATURE');
select t.hint($$select receive_payment_webhook('pas du json', 'x')$$, 'VALIDATION', 'T3 : corps illisible refusé');
select t.hint($$select simulate_payment_attempt(gen_random_uuid())$$, 'PAYMENT_NOT_FOUND', 'T3 : tentative inconnue refusée');
update app_config set value = 'INCONNU' where key = 'sim_payment_scenario';
select t.hint($$select simulate_payment_attempt((t.attempt('sSig')).id)$$, 'VALIDATION', 'T3 : scénario inconnu refusé');
update app_config set value = 'SUCCESS' where key = 'sim_payment_scenario';

-- ---------- Hors mock_mode : rien ----------
update app_config set value = 'false' where key = 'mock_mode';
select t.check(payment_simulator_tick() = 0 and (t.attempt('sSig')).status = 'INITIATED' and t.events('sSig') = 0,
  'T3 : hors mock_mode : la tâche ne fait rien (tentative intacte)');
select t.hint($$select simulate_payment_attempt((t.attempt('sSig')).id)$$, 'SIMULATOR_DISABLED', 'T3 : hors mock_mode : appel direct refusé');
update app_config set value = 'true' where key = 'mock_mode';
select payment_simulator_tick();
select t.check((t.attempt('sSig')).status = 'CONFIRMED', 'T3 : mock_mode rétabli : la tâche confirme la tentative');

-- ---------- Droits ----------
select t.check(not exists (select 1 from unnest(array['receive_payment_webhook(text,text)', 'simulate_payment_attempt(uuid)', 'payment_simulator_tick()',
                                                    '_sim_sign(text)', '_sim_send(uuid,text)', '_sim_setting(text,text)']) f
                          where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')),
  'T3 : aucune fonction du simulateur ni du point d’entrée n’est exécutable par anon ou authenticated');
select t.check(not has_table_privilege('authenticated', 'payment_partner_keys', 'SELECT') and not has_table_privilege('anon', 'payment_partner_keys', 'SELECT'),
  'T3 : clé du partenaire illisible par anon et authenticated');
select t.login('fda00000-0000-4000-8000-000000000001');
select t.fails($$select payment_simulator_tick()$$, 'T3 : payeur connecté : tâche du simulateur refusée');
select t.fails($$select simulate_payment_attempt((select (v->>'id')::uuid from t.res where k = 'sSig'))$$, 'T3 : payeur connecté : simulation refusée');
select t.fails($$select secret from payment_partner_keys$$, 'T3 : payeur connecté : clé du partenaire illisible');
select t.admin();

-- ===================== T6 : événements des libellés de suivi (0034) =====================
select t.submit_health('fda10000-0000-4000-8000-000000000021', 'trV');
insert into t.ids select 'docV', id from documents where tx_id = 'fda10000-0000-4000-8000-000000000021' limit 1;
select t.check((select payer_documents_viewed_at from transactions where id = 'fda10000-0000-4000-8000-000000000021') is null
           and (select first_viewed_at from tranches where id = (select v from t.ids where k = 'trV')) is null,
  'T6 : demande soumise : ni ouverture ni consultation par le payeur (« Soumise »)');
-- L’initiateur consulte une pièce : rien pour le payeur.
select t.login('fda00000-0000-4000-8000-000000000006');
select get_document_access((select v from t.ids where k = 'docV'));
select t.admin();
select t.check((select payer_documents_viewed_at from transactions where id = 'fda10000-0000-4000-8000-000000000021') is null,
  'T6 : consultation par l’initiateur : payer_documents_viewed_at reste vide');
-- « Reçue par le payeur » : mark_received, payeur seulement, une seule fois.
select t.login('fda00000-0000-4000-8000-000000000006');
select t.hint($$select mark_received((select v from t.ids where k = 'trV'))$$, 'PAYER_ONLY', 'T6 : mark_received refusé à l’initiateur');
select t.login('fda00000-0000-4000-8000-000000000001');
select mark_received((select v from t.ids where k = 'trV'));
select mark_received((select v from t.ids where k = 'trV'));
select t.admin();
select t.check((select first_viewed_at from tranches where id = (select v from t.ids where k = 'trV')) is not null
           and (select count(*) from audit_log where tranche_id = (select v from t.ids where k = 'trV') and event = 'REQUEST_VIEWED') = 1,
  'T6 : ouverture par le payeur : first_viewed_at posé, REQUEST_VIEWED journalisé une seule fois');
-- « En cours de vérification » : première consultation d’une pièce par le payeur.
select t.login('fda00000-0000-4000-8000-000000000001');
select get_document_access((select v from t.ids where k = 'docV'));
select t.admin();
select t.check((select payer_documents_viewed_at from transactions where id = 'fda10000-0000-4000-8000-000000000021') is not null,
  'T6 : consultation d’une pièce par le payeur : payer_documents_viewed_at posé (déclencheur sur DOCUMENT_VIEWED)');
update transactions set payer_documents_viewed_at = '2026-01-01T00:00:00Z' where id = 'fda10000-0000-4000-8000-000000000021';
select t.login('fda00000-0000-4000-8000-000000000001');
select get_document_access((select v from t.ids where k = 'docV'));
select t.admin();
select t.check((select payer_documents_viewed_at from transactions where id = 'fda10000-0000-4000-8000-000000000021') = '2026-01-01T00:00:00Z'::timestamptz,
  'T6 : seule la première consultation compte (date inchangée)');
-- Écriture directe par une partie : sans effet (RLS), valeur relue.
select t.login('fda00000-0000-4000-8000-000000000001');
select t.check(t.n_updated($$update transactions set payer_documents_viewed_at = null where id = 'fda10000-0000-4000-8000-000000000021'$$) = 0,
  'T6 : payer_documents_viewed_at : écriture directe par le payeur sans effet (0 ligne)');
select t.admin();
select t.check((select payer_documents_viewed_at from transactions where id = 'fda10000-0000-4000-8000-000000000021') is not null, 'T6 : valeur relue inchangée');
select t.check(not has_function_privilege('anon', '_note_payer_document_view()', 'EXECUTE')
           and not has_function_privilege('authenticated', '_note_payer_document_view()', 'EXECUTE')
           and not has_function_privilege('anon', 'mark_received(uuid)', 'EXECUTE'),
  'T6 : droits : déclencheur et mark_received fermés à anon');

-- ===================== Fin =====================
-- ---------- Résumé ----------
do $$
declare total int; bad int;
begin
  select count(*), count(*) filter (where not ok) into total, bad from t.results;
  if bad > 0 then raise exception 'ECHEC : % vérification(s) sur %', bad, total; end if;
  raise notice 'RESULTAT : % vérifications, toutes réussies', total;
end $$;
rollback;
