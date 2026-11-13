-- Test des migrations 0009 à 0012 (lot X, passe 2 : X4 à X7). Même format que 03_lotx.sql : utilisateurs fictifs, rôles
-- réels (authenticated, anon), tout est annulé à la fin (ROLLBACK), le résumé échoue au moindre FAIL.
-- Prérequis : 0001 à 0016 appliquées (modèle cible v2 : docs/specs/modele-cible-v2.md), app_config.mock_mode = 'true' (projet de développement).
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
create table t.ids (k text primary key, v uuid);
create table t.res (k text primary key, v jsonb);   -- résultat d’un appel, vérifié par une instruction suivante (autre instantané)
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- ---------- Jeu d’essai ----------
insert into auth.users(id, phone) values
 ('fc000000-0000-4000-8000-000000000001','33624440001'),   -- payeur
 ('fc000000-0000-4000-8000-000000000002','33624440002'),   -- demandeur (initiateur)
 ('fc000000-0000-4000-8000-000000000003','237624440003'),  -- prestataire
 ('fc000000-0000-4000-8000-000000000005','237624440005'),  -- administrateur
 ('fc000000-0000-4000-8000-000000000006','33624440006'),   -- étranger
 ('fc000000-0000-4000-8000-000000000007','33624440007');   -- client qui prend en charge un jeton de présentation
update profiles set platform_role = 'ADMIN' where id = 'fc000000-0000-4000-8000-000000000005';
update profiles set primary_role = 'REQUESTER', full_name = 'Jean K. (test)' where id = 'fc000000-0000-4000-8000-000000000002';
update profiles set primary_role = 'PROVIDER' where id = 'fc000000-0000-4000-8000-000000000003';
-- Lot X v2 (X4, 0020) : niveau d’enrôlement réglé ici comme après la revue d’un dossier (N1 requis pour initier en demandeur).
update profiles set enrolment_level = 'N1' where id = 'fc000000-0000-4000-8000-000000000002';
update request_modules set enabled = true where code = 'AGRO';
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');

-- Demande d’un demandeur (initiateur) pour un payeur, avec un prestataire. p_phone : téléphone du payeur.
create function t.op(p_id uuid, p_module text, p_amount int, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', p_module, 'amountMinor', p_amount::text, 'currency', 'XAF', 'purpose', 'Besoin (lot X v2)',
    'beneficiaryName', 'Awa', 'counterpartyPhone', p_phone, 'provider', jsonb_build_object('name', 'Prestataire (lot X v2)', 'invitedPhone', '+237 6 2444 0003'),
    'planType', 'SINGLE', 'tranches', jsonb_build_array(jsonb_build_object('label', 'Unique', 'amountMinor', p_amount::text, 'dueDate', (current_date + 2)::text)))
$$;
create function t.submit(p_id uuid, p_kind text) returns void language plpgsql as $$
begin
  perform t.login('fc000000-0000-4000-8000-000000000002');
  perform add_document(p_id, p_kind, p_id::text || '/' || p_kind || '/x.pdf', 'x.pdf', 'application/pdf', 1000);
  perform submit_operation(p_id);
  perform t.admin();
end $$;
grant execute on function t.op(uuid, text, int, text), t.submit(uuid, text) to authenticated;

-- ===================== Structure et droits =====================
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('submit_operation','accept_plan','issue_presentation_token','claim_presentation_token','revoke_presentation_tokens',
      'confirm_service','submit_evidence','approve_release','request_dispute_response','add_dispute_message','lift_suspension','suspend_operation',
      'resolve_dispute','open_dispute','respond_dispute','get_dispute','get_receipt','start_payment','reissue_token','expire_due_requests')),
  'aucune fonction de 0014 à 0018 exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_set_tx_status','_activate_operation','_submit_request','_platform_review','_resolve_dispute_v2','_create_refund',
      '_token_hash','_party_token','_set_funds_state','_close_operation_if_done','_request_tranche','expire_due_requests','release_due_tranches')),
  'fonctions internes et planifiées non exécutables par authenticated');
select t.check(not has_table_privilege('authenticated', 'presentation_tokens', 'INSERT') and not has_table_privilege('authenticated', 'presentation_tokens', 'UPDATE')
           and not has_table_privilege('anon', 'presentation_tokens', 'SELECT') and not has_table_privilege('authenticated', 'dispute_messages', 'INSERT'),
  'jetons de présentation et messages de litige : aucune écriture par le client, rien pour anon');
select t.check((select value from app_config where key = 'eqr_image_enabled') = 'false', 'X1 : image du QR retirée du parcours par défaut (eqr_image_enabled = false)');
select t.check(exists (select 1 from pg_constraint where conname = 'transactions_status_v2') and exists (select 1 from pg_constraint where conname = 'tranches_status_v2')
           and exists (select 1 from pg_constraint where conname = 'tranches_no_immediate'),
  'statuts du modèle cible imposés par contraintes (anciens statuts et IMMEDIATE refusés)');
select t.check((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'payment_requests')
               = array['id','operation_id','seq','label','target_amount_minor','currency','status','scheduled_for','expires_at','on_hold',
                       'refunded_minor','funds_state','first_viewed_at','paid_at','created_at','updated_at'],
  'vue payment_requests : vocabulaire du modèle cible (section 2)');
-- Le déclencheur de garde est contourné (comme dans les fonctions) : c’est bien la contrainte qui refuse l’ancien statut.
create function t.force_status(p_status text) returns text language plpgsql as $$
declare st text;
begin
  perform set_config('app.via_transition', 'on', true);
  begin
    execute format('update tranches set status = %L where id = (select id from tranches limit 1)', p_status);
  exception when check_violation then get stacked diagnostics st = constraint_name; end;
  perform set_config('app.via_transition', 'off', true);
  return st;
end $$;
select t.check(t.force_status('DISPUTED') = 'tranches_status_v2' and t.force_status('PAID_LOCKED') = 'tranches_status_v2',
  'DISPUTED et les anciens statuts refusés par la contrainte des demandes');
select t.check(exists (select 1 from cron.job where jobname = 'diaspay-expire-due-requests'), 'expiration des demandes planifiée');

-- ===================== X1 : résolution d’une référence (payeur, initiateur ; prestataire en CONDITIONAL) =====================
select t.login('fc000000-0000-4000-8000-000000000002');
select save_draft(t.op('fc300000-0000-4000-8000-00000000000a', 'AGRO', 50000, '+33624440001'));
select t.admin();
select t.submit('fc300000-0000-4000-8000-00000000000a', 'SUPPORTING_DOCUMENT');
insert into t.ids select 'a1', id from tranches where tx_id = 'fc300000-0000-4000-8000-00000000000a';
select t.check((select settlement_mode from transactions where id = 'fc300000-0000-4000-8000-00000000000a') = 'CONDITIONAL'
           and (select status from tranches where id = (select v from t.ids where k = 'a1')) = 'SUBMITTED'
           and exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1') and revoked_at is null),
  'CONDITIONAL : demande soumise avec un jeton');
create table t.refs (k text primary key, v text);
grant all on t.refs to authenticated;
insert into t.refs select 'a1', reference from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1') and revoked_at is null;
select t.login('fc000000-0000-4000-8000-000000000002');
select t.check((resolve_reference_info((select v from t.refs where k = 'a1'))->>'trancheId')::uuid = (select v from t.ids where k = 'a1'), 'l’initiateur résout la référence');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000003');
select t.check(resolve_reference_info((select v from t.refs where k = 'a1')) is not null, 'le prestataire résout en CONDITIONAL (confirmation par scan)');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000006');
select t.check(resolve_reference_info((select v from t.refs where k = 'a1')) is null, 'étranger : même réponse qu’une référence inconnue');
select t.admin();
-- Règlement direct : aucun jeton ; la réémission est refusée (0018) ; un jeton fabriqué n’est pas résolu par le prestataire.
select t.login('fc000000-0000-4000-8000-000000000002');
select save_draft(t.op('fc300000-0000-4000-8000-00000000000b', 'EDUCATION', 60000, '+33624440001'));
select t.admin();
select t.submit('fc300000-0000-4000-8000-00000000000b', 'ENROLMENT_CERTIFICATE');
insert into t.ids select 'b1', id from tranches where tx_id = 'fc300000-0000-4000-8000-00000000000b';
select t.check((select settlement_mode from transactions where id = 'fc300000-0000-4000-8000-00000000000b') = 'DIRECT'
           and not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'b1')), 'DIRECT : aucun jeton de demande');
select t.login('fc000000-0000-4000-8000-000000000002');
select t.hint($$select reissue_token((select v from t.ids where k = 'b1'), 'Réémission')$$, 'NO_TOKEN', 'DIRECT : réémission refusée (0018)');
select t.admin();
select _issue_tranche_token((select v from t.ids where k = 'b1'));
insert into t.refs select 'b1', reference from tranche_tokens where tranche_id = (select v from t.ids where k = 'b1');
select t.login('fc000000-0000-4000-8000-000000000003');
select t.check(resolve_reference_info((select v from t.refs where k = 'b1')) is null, 'DIRECT : le prestataire ne résout pas une référence');
select t.admin();

-- ===================== X3 : acceptation du plan (K6) =====================
select t.login('fc000000-0000-4000-8000-000000000003');
select t.hint($$select accept_plan('fc300000-0000-4000-8000-00000000000b')$$, 'PAYER_ONLY', 'acceptation du plan : payeur seulement');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000006');
select t.hint($$select accept_plan('fc300000-0000-4000-8000-00000000000b')$$, 'TX_NOT_FOUND', 'étranger : opération introuvable');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000001');
select accept_plan('fc300000-0000-4000-8000-00000000000b');
select accept_plan('fc300000-0000-4000-8000-00000000000b');
select t.admin();
select t.check((select accepted_at is not null and accepted_by = 'fc000000-0000-4000-8000-000000000001' from transactions where id = 'fc300000-0000-4000-8000-00000000000b')
           and (select count(*) from audit_log where tx_id = 'fc300000-0000-4000-8000-00000000000b' and event = 'PLAN_ACCEPTED') = 1,
  'plan accepté une fois (idempotent), journalisé');
select t.check((select status from tranches where id = (select v from t.ids where k = 'b1')) = 'SUBMITTED'
           and not exists (select 1 from payment_attempts where tx_id = 'fc300000-0000-4000-8000-00000000000b'),
  'accepter le plan n’autorise aucun paiement : demande toujours soumise, aucune tentative');
select t.check((select count(*) from notifications where tx_id = 'fc300000-0000-4000-8000-00000000000b' and event = 'PLAN_ACCEPTED'
                and user_id in ('fc000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000003')) = 2
           and not exists (select 1 from notifications where tx_id = 'fc300000-0000-4000-8000-00000000000b' and event = 'PLAN_ACCEPTED'
                           and user_id = 'fc000000-0000-4000-8000-000000000001')
           and (select payload - 'type' - 'txId' from notifications where tx_id = 'fc300000-0000-4000-8000-00000000000b' and event = 'PLAN_ACCEPTED' limit 1) = '{}',
  'PLAN_ACCEPTED aux autres parties, sans donnée');

-- ===================== Litige avant paiement : REQUEST_ON_HOLD (0018) =====================
select t.login('fc000000-0000-4000-8000-000000000001');
select open_dispute((select v from t.ids where k = 'b1'), 'Le montant ne correspond pas au devis reçu', 'WRONG_AMOUNT');
select t.admin();
select t.check((select on_hold from tranches where id = (select v from t.ids where k = 'b1'))
           and (select status from tranches where id = (select v from t.ids where k = 'b1')) = 'SUBMITTED'
           and (select status from transactions where id = 'fc300000-0000-4000-8000-00000000000b') = 'SUSPENDED',
  'litige avant paiement : demande suspendue (statut inchangé), opération SUSPENDED');
select t.login('fc000000-0000-4000-8000-000000000001');
select t.hint($$select request_info((select v from t.ids where k = 'b1'), 'Pouvez-vous préciser ?')$$, 'REQUEST_ON_HOLD', 'demande suspendue : pas de demande d’informations');
select t.hint($$select start_payment((select v from t.ids where k = 'b1'), 'cle-v2-hold-01')$$, 'REQUEST_ON_HOLD', 'demande suspendue : pas de paiement');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000005');
select t.hint($$select resolve_dispute((select id from disputes where tranche_id = (select v from t.ids where k = 'b1')), 'REFUND_FULL', 'Remboursement')$$,
  'INVALID_OUTCOME', 'avant paiement : pas d’issue de remboursement');
select resolve_dispute((select id from disputes where tranche_id = (select v from t.ids where k = 'b1')), 'NO_ACTION', 'Montant confirmé par les pièces');
select t.admin();
select t.check(not (select on_hold from tranches where id = (select v from t.ids where k = 'b1'))
           and (select status from transactions where id = 'fc300000-0000-4000-8000-00000000000b') = 'ACTIVE'
           and (select status || ':' || outcome from disputes where tranche_id = (select v from t.ids where k = 'b1')) = 'RESOLVED:NO_ACTION'
           and (select count(*) from dispute_messages where dispute_id = (select id from disputes where tranche_id = (select v from t.ids where k = 'b1'))) = 2,
  'issue NO_ACTION : suspension levée, opération active, messages du litige conservés');

-- ===================== 0019 : remboursement intégral de fonds bloqués =====================
select t.login('fc000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'a1'), 'PAID');
select open_dispute((select v from t.ids where k = 'a1'), 'Marchandise jamais livrée au bénéficiaire', 'NOT_DELIVERED');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000005');
select resolve_dispute((select id from disputes where tranche_id = (select v from t.ids where k = 'a1')), 'REFUND_FULL', 'Livraison non prouvée');
select t.admin();
select t.check((select status::text || ':' || funds_state from tranches where id = (select v from t.ids where k = 'a1')) = 'PAID:RETURNED'
           and (select outcome from disputes where tranche_id = (select v from t.ids where k = 'a1')) = 'REFUND_FULL'
           and exists (select 1 from refunds where tranche_id = (select v from t.ids where k = 'a1') and status = 'PENDING' and amount_minor = 50000),
  'REFUND_FULL sur fonds bloqués : fonds rendus (RETURNED), remboursement lié créé, statut payé inchangé');
select t.check(release_due_tranches() >= 0 and (select funds_state from tranches where id = (select v from t.ids where k = 'a1')) = 'RETURNED',
  'des fonds rendus ne sont jamais libérés ensuite');

-- ===================== X3 : jeton de présentation (K4) =====================
-- Payeur invité par téléphone (sans compte) : la prise en charge lie la demande à l’utilisateur connecté.
select t.login('fc000000-0000-4000-8000-000000000002');
select save_draft(t.op('fc300000-0000-4000-8000-00000000000c', 'RENT', 70000, '+33624449999'));
select t.admin();
select t.submit('fc300000-0000-4000-8000-00000000000c', 'LEASE');
insert into t.ids select 'c1', id from tranches where tx_id = 'fc300000-0000-4000-8000-00000000000c';
select t.check((select value from app_config where key = 'presentation_token_ttl_seconds') = '90', 'durée de vie : valeur de développement (mock_mode)');
select t.login('fc000000-0000-4000-8000-000000000003');
select t.hint($$select issue_presentation_token((select v from t.ids where k = 'c1'))$$, 'INITIATOR_ONLY', 'émission : initiateur seulement');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000002');
insert into t.res values ('k1', issue_presentation_token((select v from t.ids where k = 'c1')));
select t.admin();
select t.check((select v->>'reference' ~ '^[0-9a-f]{32}$' from t.res where k = 'k1')
           and (select token_hash = _token_hash((select v->>'reference' from t.res where k = 'k1')) and token_hash <> (select v->>'reference' from t.res where k = 'k1')
                from presentation_tokens where tranche_id = (select v from t.ids where k = 'c1'))
           and not exists (select 1 from audit_log where tx_id = 'fc300000-0000-4000-8000-00000000000c' and payload::text like '%' || (select v->>'reference' from t.res where k = 'k1') || '%'),
  'référence opaque renvoyée une fois ; seule son empreinte est conservée ; jamais journalisée');
select t.login('fc000000-0000-4000-8000-000000000002');
select t.check(claim_presentation_token((select v->>'reference' from t.res where k = 'k1')) is null, 'l’initiateur ne prend pas en charge sa propre demande');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000007');
insert into t.res values ('c1', claim_presentation_token((select v->>'reference' from t.res where k = 'k1')));
select t.admin();
select t.check((select array_agg(x order by x) from t.res, jsonb_object_keys(v) x where k = 'c1') = array['amountMinor','currency','initiatorName','trancheId','txId']
           and (select v->>'initiatorName' = 'Jean K. (test)' and (v->>'amountMinor')::int = 70000 from t.res where k = 'c1'),
  'prise en charge : résumé minimal (initiateur, montant, devise)');
select t.check(exists (select 1 from transaction_parties where tx_id = 'fc300000-0000-4000-8000-00000000000c' and role = 'PAYER'
                       and user_id = 'fc000000-0000-4000-8000-000000000007')
           and (select status from tranches where id = (select v from t.ids where k = 'c1')) = 'SUBMITTED'
           and not exists (select 1 from payment_attempts where tx_id = 'fc300000-0000-4000-8000-00000000000c'),
  'la demande est liée à l’utilisateur connecté, sans aucun paiement autorisé');
select t.login('fc000000-0000-4000-8000-000000000007');
select t.hint($$select claim_presentation_token((select v->>'reference' from t.res where k = 'k1'))$$, 'TOKEN_USED', 'usage unique : rejeu refusé');
select t.admin();
-- Rotation, révocation, expiration.
select t.login('fc000000-0000-4000-8000-000000000002');
insert into t.res values ('k2', issue_presentation_token((select v from t.ids where k = 'c1')));
insert into t.res values ('k3', issue_presentation_token((select v from t.ids where k = 'c1')));
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000007');
select t.hint($$select claim_presentation_token((select v->>'reference' from t.res where k = 'k2'))$$, 'TOKEN_REVOKED', 'rotation : l’ancien jeton est révoqué');
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000002');
select t.check(revoke_presentation_tokens((select v from t.ids where k = 'c1')) = 1, 'révocation explicite par l’initiateur');
insert into t.res values ('k4', issue_presentation_token((select v from t.ids where k = 'c1')));
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000007');
select t.hint($$select claim_presentation_token((select v->>'reference' from t.res where k = 'k3'))$$, 'TOKEN_REVOKED', 'jeton révoqué refusé');
select t.admin();
update presentation_tokens set expires_at = now() - interval '1 second' where token_hash = _token_hash((select v->>'reference' from t.res where k = 'k4'));
select t.login('fc000000-0000-4000-8000-000000000007');
select t.hint($$select claim_presentation_token((select v->>'reference' from t.res where k = 'k4'))$$, 'TOKEN_EXPIRED', 'jeton expiré refusé');
select t.admin();
-- Demande déjà liée à un autre payeur : même réponse qu’une référence inconnue.
select t.login('fc000000-0000-4000-8000-000000000002');
insert into t.res values ('k5', issue_presentation_token((select v from t.ids where k = 'c1')));
select t.admin();
select t.login('fc000000-0000-4000-8000-000000000006');
select t.check(claim_presentation_token((select v->>'reference' from t.res where k = 'k5')) is null, 'demande liée à un autre payeur : réponse nulle (pas de substitution)');
select t.check(claim_presentation_token('0123456789abcdef0123456789abcdef') is null, 'référence inconnue : réponse nulle');
select t.admin();
select t.check((select count(*) from security_events where user_id = 'fc000000-0000-4000-8000-000000000006' and kind = 'REFERENCE_FAILED'
                and detail->>'via' = 'claim_presentation_token') = 2,
  'échecs de prise en charge enregistrés (limitation)');
update app_config set value = '2' where key = 'reference_failure_limit';
select t.login('fc000000-0000-4000-8000-000000000006');
select t.hint($$select claim_presentation_token('0123456789abcdef0123456789abcdef')$$, 'TOO_MANY_ATTEMPTS', 'limitation de débit : trop de tentatives');
select t.admin();
update app_config set value = '10' where key = 'reference_failure_limit';
delete from app_config where key = 'presentation_token_ttl_seconds';
select t.login('fc000000-0000-4000-8000-000000000002');
select t.hint($$select issue_presentation_token((select v from t.ids where k = 'c1'))$$, 'NOT_CONFIGURED', 'durée de vie non configurée : refus prudent');
select t.admin();

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
