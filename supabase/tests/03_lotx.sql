-- Test des migrations 0007 et 0008 (lot X, passe 1). Même format que 01_lot4.sql : utilisateurs fictifs, rôles réels
-- (authenticated, anon), tout est annulé à la fin (ROLLBACK), le résumé échoue au moindre FAIL.
-- Prérequis : 0001 à 0008 appliquées, app_config.mock_mode = 'true' (projet de développement).
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
create table t.ids (k text primary key, v uuid);
create table t.refs (k text primary key, v text);
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- ---------- Jeu d’essai ----------
insert into auth.users(id, phone) values
 ('f9000000-0000-4000-8000-000000000001','33622220001'),   -- payeur
 ('f9000000-0000-4000-8000-000000000002','33622220002'),   -- demandeur (initiateur)
 ('f9000000-0000-4000-8000-000000000003','237622220003'),  -- prestataire du dossier
 ('f9000000-0000-4000-8000-000000000004','237622220004'),  -- validateur
 ('f9000000-0000-4000-8000-000000000005','237622220005'),  -- administrateur
 ('f9000000-0000-4000-8000-000000000006','33622220006'),   -- étranger
 ('f9000000-0000-4000-8000-000000000007','237622220007'),  -- prestataire autorisé à initier
 ('f9000000-0000-4000-8000-000000000008','237622220008');  -- prestataire non autorisé
update profiles set platform_role = 'VALIDATOR' where id = 'f9000000-0000-4000-8000-000000000004';
update profiles set platform_role = 'ADMIN' where id = 'f9000000-0000-4000-8000-000000000005';
update profiles set primary_role = 'REQUESTER' where id = 'f9000000-0000-4000-8000-000000000002';
update profiles set primary_role = 'PROVIDER', full_name = 'École Les Manguiers (test)' where id = 'f9000000-0000-4000-8000-000000000007';
update profiles set primary_role = 'PROVIDER' where id in ('f9000000-0000-4000-8000-000000000003', 'f9000000-0000-4000-8000-000000000008');
-- Émission simulée du jeton à la validation (développement), comme l’application de démonstration.
update app_config set value = 'true' where key = 'auto_issue_token';

-- ===================== X1 : sécurité du TrustLink =====================
-- ---------- Structure et droits ----------
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('revoke_token','reissue_token','mark_received','request_info','answer_info','reject_request',
      'resolve_reference_info','resolve_tranche_reference','confirm_by_reference','get_receipt','transition_tranche',
      'simulate_tranche_system','transition_tx','save_draft','_revoke_active_token','_check_token_manager','_reference_failures',
      '_reference_guard','_reference_failed','_party_token','_check_message','_request_tranche')),
  'aucune fonction de 0008 (ni redéfinie) exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_revoke_active_token','_check_token_manager','_reference_failures','_reference_guard','_reference_failed',
      '_party_token','_check_message','_request_tranche','_issue_tranche_token','_set_tranche_status','_notify_from_audit')),
  'fonctions internes de 0008 non exécutables par authenticated');
select t.check(not has_table_privilege('authenticated', 'security_events', 'INSERT') and not has_table_privilege('authenticated', 'security_events', 'UPDATE')
           and not has_table_privilege('authenticated', 'security_events', 'DELETE') and not has_table_privilege('anon', 'security_events', 'SELECT'),
  'security_events : aucune écriture par le client, rien pour anon');
select t.check((select value from app_config where key = 'eqr_image_enabled') = 'true', 'eqr_image_enabled : true par défaut');
select t.check(exists (select 1 from pg_indexes where tablename = 'tranche_tokens' and indexname = 'tranche_tokens_one_active'),
  'un seul jeton actif par tranche (index unique partiel)');
-- ---------- Dossier A : demandeur initiateur, payeur, prestataire ----------
select t.login('f9000000-0000-4000-8000-000000000002');
select save_draft(jsonb_build_object('id','f9300000-0000-4000-8000-00000000000a','vertical','EDUCATION','amountMinor','900000','currency','XAF',
  'purpose','Scolarité (lot X)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider', jsonb_build_object('name','Lycée (lot X)','invitedPhone','+237 6 2222 0003'),'planType','PARTIAL',
  'tranches', jsonb_build_array(jsonb_build_object('label','Inscription','amountMinor','300000','dueDate',(current_date + 2)::text),
                                jsonb_build_object('label','Solde','amountMinor','600000','dueDate',(current_date + 60)::text))));
select add_document('f9300000-0000-4000-8000-00000000000a', 'ENROLMENT_CERTIFICATE', 'f9300000-0000-4000-8000-00000000000a/ENROLMENT_CERTIFICATE/a.pdf', 'a.pdf', 'application/pdf', 1000);
select transition_tx('f9300000-0000-4000-8000-00000000000a', 'SUBMITTED');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000004');
select transition_tx('f9300000-0000-4000-8000-00000000000a', 'IN_REVIEW');
select decide_tx('f9300000-0000-4000-8000-00000000000a', true, true);
select t.admin();
insert into t.ids select 'a1', id from tranches where tx_id = 'f9300000-0000-4000-8000-00000000000a' and seq = 1;
insert into t.ids select 'a2', id from tranches where tx_id = 'f9300000-0000-4000-8000-00000000000a' and seq = 2;
insert into t.refs select 'a1', reference from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1') and revoked_at is null;
select t.check((select status from transactions where id = 'f9300000-0000-4000-8000-00000000000a') = 'IN_PROGRESS'
           and (select status from tranches where id = (select v from t.ids where k = 'a1')) = 'AWAITING_PAYMENT'
           and (select length(v) from t.refs where k = 'a1') = 18, 'dossier A en cours, tranche 1 à payer, jeton émis');

-- ---------- X1 : jeton lisible par le payeur seulement ----------
select t.login('f9000000-0000-4000-8000-000000000001');
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1')) = 1, 'le payeur lit le jeton de sa tranche');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000003');
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1')) = 0, 'le prestataire ne lit pas le jeton (il scanne le QR du payeur)');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000002');
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1')) = 0, 'le demandeur ne lit pas le jeton');
select t.admin();

-- ---------- X1 : substitution de destinataire, même réponse pour « inconnue » et « étranger » ----------
select t.login('f9000000-0000-4000-8000-000000000006');
select t.check((select resolve_reference_info((select v from t.refs where k = 'a1'))) is null, 'un étranger ne résout pas une référence réelle (réponse vide)');
select t.check((select resolve_reference_info('ffffffffffffffffff')) is null, 'référence inconnue : même réponse vide');
select t.check((select count(*) from resolve_tranche_reference((select v from t.refs where k = 'a1'))) = 0, 'resolve_tranche_reference : aucune ligne pour un étranger');
select t.hint($$select confirm_by_reference((select v from t.refs where k = 'a1'))$$, 'UNKNOWN_REFERENCE', 'un étranger ne confirme pas (même code qu’une référence inconnue)');
select t.hint($$select confirm_by_reference('ffffffffffffffffff')$$, 'UNKNOWN_REFERENCE', 'référence inconnue à la confirmation');
select t.check((select count(*) from security_events) = 0, 'un utilisateur ne lit pas les événements de sécurité');
select t.admin();
select t.check((select count(*) from security_events where user_id = 'f9000000-0000-4000-8000-000000000006' and kind = 'REFERENCE_FAILED') = 3,
  'trois résolutions échouées enregistrées (la confirmation refusée n’écrit rien)');
select t.check(not exists (select 1 from security_events where detail::text like '%' || (select v from t.refs where k = 'a1') || '%'),
  'la référence tentée n’est pas conservée en entier');
select t.login('f9000000-0000-4000-8000-000000000004');
select t.check((select count(*) from security_events where user_id = 'f9000000-0000-4000-8000-000000000006') = 3, 'le personnel lit les événements de sécurité');
select t.admin();

-- Limitation : plus de 10 échecs en une heure.
select t.login('f9000000-0000-4000-8000-000000000006');
select resolve_reference_info('fffffffffffffffff' || n::text) from generate_series(1, 7) n;
select t.hint($$select resolve_reference_info('ffffffffffffffff00')$$, 'TOO_MANY_ATTEMPTS', 'onzième résolution refusée');
select t.hint($$select confirm_by_reference('ffffffffffffffff00')$$, 'TOO_MANY_ATTEMPTS', 'confirmation refusée aussi au-delà de la limite');
select t.hint($$select * from resolve_tranche_reference('ffffffffffffffff00')$$, 'TOO_MANY_ATTEMPTS', 'resolve_tranche_reference refusée aussi');
select t.admin();
select t.check((select count(*) from security_events where user_id = 'f9000000-0000-4000-8000-000000000006' and kind = 'SUSPICIOUS_ACTIVITY') = 1,
  'SUSPICIOUS_ACTIVITY écrit une seule fois au seuil');
select t.fails($$delete from security_events$$, 'security_events en ajout seul (même pour le propriétaire)');
select t.login('f9000000-0000-4000-8000-000000000001');
select t.check((t.j($$select resolve_reference_info((select v from t.refs where k = 'a1'))$$)->>'label') = 'Inscription', 'le payeur résout sa référence');
select t.admin();

-- ---------- X1 : ouverture de la demande par le payeur ----------
select t.login('f9000000-0000-4000-8000-000000000002');
select t.hint($$select mark_received((select v from t.ids where k = 'a1'))$$, 'PAYER_ONLY', 'mark_received réservé au payeur');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000006');
select t.hint($$select mark_received((select v from t.ids where k = 'a1'))$$, 'TRANCHE_NOT_FOUND', 'mark_received : tranche introuvable pour un étranger');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000001');
select t.check((select first_viewed_at is not null from mark_received((select v from t.ids where k = 'a1'))), 'le payeur marque la demande reçue');
select mark_received((select v from t.ids where k = 'a1'));
select t.admin();
select t.check((select count(*) from audit_log where tranche_id = (select v from t.ids where k = 'a1') and event = 'REQUEST_VIEWED') = 1,
  'REQUEST_VIEWED journalisé une seule fois (idempotent)');

-- ---------- X1 : révocation et réémission ----------
select t.login('f9000000-0000-4000-8000-000000000003');
select t.hint($$select revoke_token((select v from t.ids where k = 'a1'), 'Lien compromis')$$, 'INITIATOR_ONLY', 'le prestataire ne révoque pas');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000001');
select t.hint($$select revoke_token((select v from t.ids where k = 'a1'), 'Lien compromis')$$, 'INITIATOR_ONLY', 'le payeur non initiateur ne révoque pas');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000002');
select t.hint($$select revoke_token((select v from t.ids where k = 'a1'), '')$$, 'REASON_REQUIRED', 'motif de révocation obligatoire');
select t.check((t.j($$select revoke_token((select v from t.ids where k = 'a1'), 'Lien compromis')$$)->>'revoked') = 'true', 'l’initiateur révoque le jeton avant paiement');
select t.hint($$select revoke_token((select v from t.ids where k = 'a1'), 'Encore')$$, 'NO_TOKEN', 'plus de jeton actif à révoquer');
select t.admin();
select t.check((select count(*) from audit_log where tranche_id = (select v from t.ids where k = 'a1') and event = 'TOKEN_REVOKED') = 1, 'révocation journalisée');
select t.check((select revoked_by = 'f9000000-0000-4000-8000-000000000002' and revoke_reason = 'Lien compromis' from tranche_tokens
                where reference = (select v from t.refs where k = 'a1')), 'jeton révoqué conservé (auteur, motif)');
select t.login('f9000000-0000-4000-8000-000000000001');
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1')) = 0, 'le payeur ne lit plus de jeton révoqué');
select t.hint($$select resolve_reference_info((select v from t.refs where k = 'a1'))$$, 'TOKEN_REVOKED', 'jeton révoqué refusé à la résolution');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000002');
select t.check((t.j($$select reissue_token((select v from t.ids where k = 'a1'), 'Nouveau lien')$$)->>'tokenId') is not null, 'l’initiateur réémet un jeton');
select t.admin();
insert into t.refs select 'a1b', reference from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1') and revoked_at is null;
select t.check((select v from t.refs where k = 'a1b') <> (select v from t.refs where k = 'a1'), 'nouvelle référence différente');
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1')) = 2, 'l’ancien jeton reste en base, révoqué');
select t.check(not exists (select 1 from audit_log where tx_id = 'f9300000-0000-4000-8000-00000000000a' and payload::text like '%' || (select v from t.refs where k = 'a1b') || '%'),
  'la nouvelle référence n’est jamais journalisée');
select t.check(exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'a1') and event = 'TOKEN_REISSUED'), 'réémission journalisée');

-- Paiement : ensuite seul un administrateur non partie révoque.
select t.login('f9000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'a1'), 'PAID_LOCKED');
select t.admin();
select t.check((select status from tranches where id = (select v from t.ids where k = 'a1')) = 'PAID_LOCKED', 'mode PROVIDER_CONFIRM : le paiement verrouille (inchangé)');
select t.login('f9000000-0000-4000-8000-000000000002');
select t.hint($$select revoke_token((select v from t.ids where k = 'a1'), 'Trop tard')$$, 'NOT_REVOCABLE', 'tranche payée : l’initiateur ne révoque plus');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000005');
select t.check((t.j($$select reissue_token((select v from t.ids where k = 'a1'), 'Jeton compromis après paiement')$$)->>'tokenId') is not null,
  'un administrateur non partie réémet après paiement');
select t.admin();
insert into t.refs select 'a1c', reference from tranche_tokens where tranche_id = (select v from t.ids where k = 'a1') and revoked_at is null;
select t.login('f9000000-0000-4000-8000-000000000003');
select t.hint($$select confirm_by_reference((select v from t.refs where k = 'a1b'))$$, 'TOKEN_REVOKED', 'le prestataire ne confirme pas avec un jeton révoqué');
select t.check((select status from confirm_by_reference((select v from t.refs where k = 'a1c'))) = 'CONFIRMED', 'le prestataire confirme avec le jeton actif');
select t.admin();

-- ===================== X2 : décisions du payeur =====================
-- ---------- Structure (X2) ----------
select t.check(not has_table_privilege('authenticated', 'request_messages', 'INSERT') and not has_table_privilege('authenticated', 'request_messages', 'UPDATE')
           and not has_table_privilege('authenticated', 'request_messages', 'DELETE'),
  'request_messages : aucune écriture par le client');
select t.check(not exists (select 1 from release_rules where release_mode = 'IMMEDIATE'), 'aucun type de besoin n’utilise IMMEDIATE (K1)');
select t.check((select count(*) from tranche_transitions where (from_status, to_status) in
   (('AWAITING_PAYMENT','INFO_REQUESTED'),('INFO_REQUESTED','AWAITING_PAYMENT'),('AWAITING_PAYMENT','REJECTED'),('INFO_REQUESTED','REJECTED'),('AWAITING_PAYMENT','RELEASED'))) = 6,
  'transitions de tranche du lot X (miroir de transitionTranche)');
select t.check(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dossiers_insert_info')
           and exists (select 1 from pg_policies where tablename = 'documents' and policyname = 'docs_insert_info'),
  'pièces d’une réponse : politiques d’insertion (table et bucket)');

-- ---------- X2 : décisions du payeur (tranche 2) ----------
select t.login('f9000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'a2'), 'AWAITING_PAYMENT');
select t.hint($$select simulate_tranche_system((select v from t.ids where k = 'a2'), 'RELEASED')$$, 'NOT_PAID', 'pas de déblocage direct sans paiement (mode non IMMEDIATE)');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000002');
select t.hint($$select request_info((select v from t.ids where k = 'a2'), 'Pouvez-vous préciser ?')$$, 'PAYER_ONLY', 'request_info réservé au payeur');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000001');
select t.hint($$select request_info((select v from t.ids where k = 'a2'), ' ')$$, 'REASON_REQUIRED', 'message obligatoire');
select t.hint($$select transition_tranche((select v from t.ids where k = 'a2'), 'INFO_REQUESTED')$$, 'TRANSITION_FORBIDDEN', 'pas de demande d’informations sans la fonction dédiée');
select t.hint($$select transition_tranche((select v from t.ids where k = 'a2'), 'REJECTED')$$, 'TRANSITION_FORBIDDEN', 'pas de rejet sans motif (fonction dédiée)');
select t.check((select status from request_info((select v from t.ids where k = 'a2'), 'Pouvez-vous joindre le relevé de notes ?')) = 'INFO_REQUESTED',
  'le payeur demande des informations : INFO_REQUESTED');
select t.hint($$select simulate_tranche_system((select v from t.ids where k = 'a2'), 'PAID_LOCKED')$$, 'NOT_PAYABLE', 'pas de paiement pendant la demande d’informations');
select t.admin();
select t.check((select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'INFO_REQUESTED') = 2
           and not exists (select 1 from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'INFO_REQUESTED'
                           and user_id = 'f9000000-0000-4000-8000-000000000001'),
  'INFO_REQUESTED notifié aux autres parties, pas à son auteur');
select t.check((select payload - 'type' - 'txId' - 'trancheId' = '{}'::jsonb from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'INFO_REQUESTED' limit 1),
  'notification sans texte ni montant (type, dossier, tranche)');
-- Pièce d’une réponse : par l’initiateur pendant INFO_REQUESTED seulement.
select t.login('f9000000-0000-4000-8000-000000000006');
select t.fails($$insert into documents(tx_id, tranche_id, kind, storage_path, mime_type, size_bytes, uploaded_by) values ('f9300000-0000-4000-8000-00000000000a', (select v from t.ids where k = 'a2'), 'SUPPORTING_DOCUMENT', 'f9300000-0000-4000-8000-00000000000a/info/x.pdf', 'application/pdf', 100, auth.uid())$$,
  'un étranger ne joint pas de pièce');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000002');
insert into documents(tx_id, tranche_id, kind, storage_path, mime_type, size_bytes, uploaded_by, file_name)
values ('f9300000-0000-4000-8000-00000000000a', (select v from t.ids where k = 'a2'), 'SUPPORTING_DOCUMENT', 'f9300000-0000-4000-8000-00000000000a/info/notes.pdf', 'application/pdf', 100, auth.uid(), 'notes.pdf');
select t.check((select count(*) from documents where tranche_id = (select v from t.ids where k = 'a2')) = 1, 'l’initiateur joint une pièce à sa réponse');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000001');
select t.hint($$select answer_info((select v from t.ids where k = 'a2'), 'Voici')$$, 'INITIATOR_ONLY', 'le payeur ne répond pas à sa propre demande');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000003');
select t.hint($$select answer_info((select v from t.ids where k = 'a2'), 'Voici le relevé')$$, 'INITIATOR_ONLY', 'le prestataire non initiateur ne répond pas');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000002');
select t.check((select status from answer_info((select v from t.ids where k = 'a2'), 'Relevé de notes joint.')) = 'AWAITING_PAYMENT', 'l’initiateur répond : à payer de nouveau');
select t.hint($$select answer_info((select v from t.ids where k = 'a2'), 'Encore')$$, 'TRANSITION_UNKNOWN', 'pas de réponse sans demande en cours');
select t.fails($$insert into documents(tx_id, tranche_id, kind, storage_path, mime_type, size_bytes, uploaded_by) values ('f9300000-0000-4000-8000-00000000000a', (select v from t.ids where k = 'a2'), 'SUPPORTING_DOCUMENT', 'f9300000-0000-4000-8000-00000000000a/info/y.pdf', 'application/pdf', 100, auth.uid())$$,
  'plus de pièce de réponse hors demande d’informations');
select t.admin();
select t.check((select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'INFO_ANSWERED') = 2
           and not exists (select 1 from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'INFO_ANSWERED'
                           and user_id = 'f9000000-0000-4000-8000-000000000002'),
  'INFO_ANSWERED notifié au payeur et au prestataire');
select t.check((select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'PAYMENT_READY'
                and payload->>'trancheId' = (select v from t.ids where k = 'a2')::text) = 3,
  'retour à payer après réponse : pas de nouvelle alerte PAYMENT_READY (seulement celle de l’ouverture)');
select t.login('f9000000-0000-4000-8000-000000000003');
select t.hint($$select reject_request((select v from t.ids where k = 'a2'), 'Non')$$, 'PAYER_ONLY', 'rejet réservé au payeur');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000001');
select request_info((select v from t.ids where k = 'a2'), 'Et le certificat de scolarité ?');
select t.hint($$select reject_request((select v from t.ids where k = 'a2'), '')$$, 'REASON_REQUIRED', 'motif de rejet obligatoire');
select t.check((select status from reject_request((select v from t.ids where k = 'a2'), 'Je ne reconnais pas cette demande.')) = 'REJECTED',
  'le payeur rejette depuis INFO_REQUESTED : REJECTED');
select t.hint($$select request_info((select v from t.ids where k = 'a2'), 'Encore une question')$$, 'TRANSITION_UNKNOWN', 'REJECTED est terminal');
select t.check((select count(*) from request_messages where tranche_id = (select v from t.ids where k = 'a2')) = 4, 'le payeur lit les messages de la demande');
select t.fails($$insert into request_messages(tx_id, author_id, kind, body) values ('f9300000-0000-4000-8000-00000000000a', auth.uid(), 'NOTE', 'Intrus')$$,
  'le client n’écrit pas de message directement');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000006');
select t.check((select count(*) from request_messages where tx_id = 'f9300000-0000-4000-8000-00000000000a') = 0, 'un étranger ne lit pas les messages');
select t.admin();
select t.fails($$update request_messages set body = 'Modifié' where tx_id = 'f9300000-0000-4000-8000-00000000000a'$$, 'messages immuables (même pour le propriétaire)');
select t.check((select array_agg(kind order by kind)::text from request_messages where tranche_id = (select v from t.ids where k = 'a2'))
               = '{INFO_ANSWER,INFO_REQUEST,INFO_REQUEST,NOTE}', 'messages : deux demandes, une réponse, le motif du rejet');
select t.check(not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'a2') and revoked_at is null),
  'rejet : jeton de la tranche révoqué');
select t.check((select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000a' and event = 'REQUEST_REJECTED') = 2,
  'REQUEST_REJECTED notifié aux autres parties');
select t.check((select status from transactions where id = 'f9300000-0000-4000-8000-00000000000a') = 'IN_PROGRESS', 'une tranche confirmée reste ouverte : dossier en cours');
select t.login('f9000000-0000-4000-8000-000000000001');
select transition_tranche((select v from t.ids where k = 'a1'), 'RELEASED');
select t.admin();
select t.check((select status from transactions where id = 'f9300000-0000-4000-8000-00000000000a') = 'CLOSED', 'clôture avec une tranche débloquée et une tranche rejetée');
select t.check(verify_audit('f9300000-0000-4000-8000-00000000000a'), 'journal chaîné intact après révocations et décisions');
select t.check((select reference from tranche_tokens where id = (select k.id from tranche_tokens k where k.tranche_id = (select v from t.ids where k = 'a1') and k.revoked_at is null))
               = (select v from t.refs where k = 'a1c'), 'reçu : jeton actif');
select t.login('f9000000-0000-4000-8000-000000000001');
select t.check((t.j($$select get_receipt((select v from t.ids where k = 'a1'))$$)->>'reference') = (select v from t.refs where k = 'a1c'), 'le reçu porte la référence du jeton actif');
select t.admin();

-- ---------- X2.6 Mode IMMEDIATE (type de besoin de test, annulé à la fin) ----------
update release_rules set release_mode = 'IMMEDIATE', contest_hours = 0 where vertical = 'RENT';
select t.login('f9000000-0000-4000-8000-000000000001');
select save_draft(jsonb_build_object('id','f9300000-0000-4000-8000-00000000000b','vertical','RENT','amountMinor','150000','currency','XAF',
  'purpose','Loyer (paiement direct)','beneficiaryName','Moi','provider', jsonb_build_object('name','Bailleur (lot X)','invitedPhone','+237 6 2222 0003'),
  'planType','SINGLE','tranches', jsonb_build_array(jsonb_build_object('label','Loyer','amountMinor','150000','dueDate',(current_date + 1)::text))));
select add_document('f9300000-0000-4000-8000-00000000000b', 'LEASE', 'f9300000-0000-4000-8000-00000000000b/LEASE/bail.pdf', 'bail.pdf', 'application/pdf', 1000);
select transition_tx('f9300000-0000-4000-8000-00000000000b', 'SUBMITTED');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000004');
select transition_tx('f9300000-0000-4000-8000-00000000000b', 'IN_REVIEW');
select decide_tx('f9300000-0000-4000-8000-00000000000b', true, true);
select t.admin();
insert into t.ids select 'b1', id from tranches where tx_id = 'f9300000-0000-4000-8000-00000000000b' and seq = 1;
select t.check((select release_mode from tranches where id = (select v from t.ids where k = 'b1')) = 'IMMEDIATE', 'tranche du type de test en mode IMMEDIATE');
select t.login('f9000000-0000-4000-8000-000000000001');
select t.check((select status from simulate_tranche_system((select v from t.ids where k = 'b1'), 'PAID_LOCKED')) = 'RELEASED', 'paiement direct : débloquée sans verrouillage');
select t.admin();
select t.check(exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'b1') and event = 'DIRECT_PAYMENT')
           and not exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'b1') and payload->>'tranche_to' = 'PAID_LOCKED'),
  'événement DIRECT_PAYMENT, aucun passage par PAID_LOCKED');
select t.check((select trigger from release_events where tranche_id = (select v from t.ids where k = 'b1')) = 'DIRECT_PAYMENT'
           and (select count(*) from payments where tranche_id = (select v from t.ids where k = 'b1') and status = 'SUCCEEDED') = 1,
  'paiement enregistré, déblocage DIRECT_PAYMENT');
select t.check((select contest_ends_at is null from tranches where id = (select v from t.ids where k = 'b1')), 'aucun délai de contestation');
select t.check((select status from transactions where id = 'f9300000-0000-4000-8000-00000000000b') = 'CLOSED', 'dossier à paiement direct clôturé');

-- ===================== X3 : demandes initiées par un prestataire =====================
-- ---------- X3 : demande initiée par un prestataire ----------
select t.login('f9000000-0000-4000-8000-000000000008');
select t.hint($$select save_draft('{"id":"f9300000-0000-4000-8000-00000000000c","vertical":"EDUCATION","creatorRole":"PROVIDER","counterpartyPhone":"+33622220001"}')$$,
  'INITIATION_NOT_ALLOWED', 'prestataire sans autorisation refusé');
select t.fails($$update profiles set can_initiate_requests = true where id = auth.uid()$$, 'un utilisateur ne s’accorde pas l’autorisation d’initier');
select t.hint($$select save_draft('{"id":"f9300000-0000-4000-8000-00000000000c","vertical":"EDUCATION","creatorRole":"BANQUIER"}')$$, 'VALIDATION', 'rôle de créateur inconnu');
select t.admin();
select t.check(not (select can_initiate_requests from profiles where id = 'f9000000-0000-4000-8000-000000000008'), 'autorisation inchangée');
update profiles set can_initiate_requests = true where id = 'f9000000-0000-4000-8000-000000000007';   -- administrateur (SQL)
select t.login('f9000000-0000-4000-8000-000000000007');
select t.hint($$select save_draft('{"id":"f9300000-0000-4000-8000-00000000000c","vertical":"EDUCATION","creatorRole":"PROVIDER","counterpartyPhone":"+237 6 2222 0007"}')$$,
  'SELF_PAYER', 'le prestataire ne se désigne pas payeur');
-- Sans payeur : enregistrable (brouillon partiel), refusé à la soumission.
select save_draft(jsonb_build_object('id','f9300000-0000-4000-8000-00000000000d','vertical','EDUCATION','creatorRole','PROVIDER','amountMinor','100000',
  'currency','XAF','purpose','Inscription sans payeur','beneficiaryName','Élève','planType','SINGLE',
  'tranches', jsonb_build_array(jsonb_build_object('label','Inscription','amountMinor','100000','dueDate',(current_date + 2)::text))));
select t.hint($$select transition_tx('f9300000-0000-4000-8000-00000000000d', 'SUBMITTED')$$, 'VALIDATION', 'demande d’un prestataire sans payeur refusée à la soumission');
-- Payeur invité (pas encore de compte).
select save_draft(jsonb_build_object('id','f9300000-0000-4000-8000-00000000000c','vertical','EDUCATION','creatorRole','PROVIDER','amountMinor','200000',
  'currency','XAF','purpose','Frais d’inscription','beneficiaryName','Élève','counterpartyPhone','+33 6 22 22 00 09','planType','SINGLE',
  'tranches', jsonb_build_array(jsonb_build_object('label','Inscription','amountMinor','200000','dueDate',(current_date + 2)::text))));
select add_document('f9300000-0000-4000-8000-00000000000c', 'ENROLMENT_CERTIFICATE', 'f9300000-0000-4000-8000-00000000000c/ENROLMENT_CERTIFICATE/c.pdf', 'c.pdf', 'application/pdf', 1000);
select t.check((select role from transaction_parties where tx_id = 'f9300000-0000-4000-8000-00000000000c' and user_id = auth.uid()) = 'PROVIDER',
  'le créateur est partie PROVIDER');
select t.check((select provider_name from transactions where id = 'f9300000-0000-4000-8000-00000000000c') = 'École Les Manguiers (test)', 'prestataire de la demande : le créateur');
select t.check((select status from transition_tx('f9300000-0000-4000-8000-00000000000c', 'SUBMITTED')) = 'SUBMITTED', 'le prestataire autorisé soumet sa demande');
select t.admin();
select t.check((select invited_phone from transaction_parties where tx_id = 'f9300000-0000-4000-8000-00000000000c' and role = 'PAYER' and user_id is null) = '+33622220009',
  'payeur invité par son numéro');
select t.check((select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000c') = 0, 'payeur sans compte : aucune alerte possible');
insert into auth.users(id, phone) values ('f9000000-0000-4000-8000-000000000009', '33622220009');
select t.login('f9000000-0000-4000-8000-000000000009');
select t.check((select count(*) from transactions where id = 'f9300000-0000-4000-8000-00000000000c') = 1, 'le payeur invité retrouve la demande à son inscription');
select t.admin();
-- Un prestataire partie d’un brouillon qu’il n’a pas créé ne le soumet pas.
select t.login('f9000000-0000-4000-8000-000000000002');
select save_draft(jsonb_build_object('id','f9300000-0000-4000-8000-00000000000e','vertical','EDUCATION','counterpartyPhone','+33622220001',
  'provider', jsonb_build_object('name','Lycée (lot X)','invitedPhone','+237 6 2222 0003')));
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000003');
select t.hint($$select transition_tx('f9300000-0000-4000-8000-00000000000e', 'SUBMITTED')$$, 'TRANSITION_FORBIDDEN', 'le prestataire ne soumet pas le brouillon d’un autre');
select t.admin();
-- Payeur existant : alerte PAYMENT_REQUEST_RECEIVED, sans donnée sensible.
select t.login('f9000000-0000-4000-8000-000000000007');
select save_draft(jsonb_build_object('id','f9300000-0000-4000-8000-00000000000f','vertical','EDUCATION','creatorRole','PROVIDER','amountMinor','50000',
  'currency','XAF','purpose','Cantine','beneficiaryName','Élève','counterpartyPhone','+33622220001','planType','SINGLE',
  'tranches', jsonb_build_array(jsonb_build_object('label','Cantine','amountMinor','50000','dueDate',(current_date + 2)::text))));
select add_document('f9300000-0000-4000-8000-00000000000f', 'ENROLMENT_CERTIFICATE', 'f9300000-0000-4000-8000-00000000000f/ENROLMENT_CERTIFICATE/f.pdf', 'f.pdf', 'application/pdf', 1000);
select transition_tx('f9300000-0000-4000-8000-00000000000f', 'SUBMITTED');
select t.admin();
select t.check((select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000f' and event = 'PAYMENT_REQUEST_RECEIVED'
                and user_id = 'f9000000-0000-4000-8000-000000000001') = 1
           and (select count(*) from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000f') = 1,
  'PAYMENT_REQUEST_RECEIVED au payeur seulement');
select t.check((select payload - 'type' - 'txId' = '{}'::jsonb from notifications where tx_id = 'f9300000-0000-4000-8000-00000000000f'),
  'alerte de demande reçue : ni montant, ni nom, ni texte');
select t.check(not exists (select 1 from notifications n join transactions x on x.id = n.tx_id where n.event = 'PAYMENT_REQUEST_RECEIVED'
                           and not exists (select 1 from transaction_parties p where p.tx_id = x.id and p.role = 'PROVIDER' and p.user_id = x.created_by)
                           and n.tx_id::text like 'f93%'),
  'pas d’alerte de demande reçue pour un dossier créé par le payeur ou un demandeur');
-- La demande du prestataire suit le circuit existant ; le payeur peut demander des informations, le prestataire initiateur répond.
select t.login('f9000000-0000-4000-8000-000000000004');
select transition_tx('f9300000-0000-4000-8000-00000000000f', 'IN_REVIEW');
select t.check((select status from decide_tx('f9300000-0000-4000-8000-00000000000f', true, true)) = 'IN_PROGRESS', 'validation par le bureau de contrôle (inchangée)');
select t.admin();
insert into t.ids select 'f1', id from tranches where tx_id = 'f9300000-0000-4000-8000-00000000000f' and seq = 1;
select t.login('f9000000-0000-4000-8000-000000000001');
select request_info((select v from t.ids where k = 'f1'), 'Quel trimestre ?');
select t.admin();
select t.login('f9000000-0000-4000-8000-000000000007');
select t.check((select status from answer_info((select v from t.ids where k = 'f1'), 'Premier trimestre.')) = 'AWAITING_PAYMENT', 'le prestataire initiateur répond');
select t.check((t.j($$select revoke_token((select v from t.ids where k = 'f1'), 'Erreur de montant')$$)->>'revoked') = 'true', 'le prestataire initiateur révoque avant paiement');
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
