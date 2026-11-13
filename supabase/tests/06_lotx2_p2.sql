-- Test des migrations 0020 à 0022 (lot X version 2, passe 2 : X4 à X6). Même format que 05_lotx2_p1.sql : utilisateurs
-- fictifs, rôles réels (authenticated, anon, service_role), tout est annulé à la fin (ROLLBACK), le résumé échoue au moindre FAIL.
-- Prérequis : 0001 à 0022 appliquées, app_config.mock_mode = 'true' (projet de développement).
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
create table t.res (k text primary key, v jsonb);   -- résultat d’un appel, vérifié par une instruction suivante (autre instantané)
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users(id, phone) values
 ('fd000000-0000-4000-8000-000000000001','33625550001'),   -- payeur
 ('fd000000-0000-4000-8000-000000000002','33625550002'),   -- demandeur (KYC approuvé)
 ('fd000000-0000-4000-8000-000000000003','237625550003'),  -- prestataire (N1 puis N2)
 ('fd000000-0000-4000-8000-000000000004','237625550004'),  -- validateur (relecteur)
 ('fd000000-0000-4000-8000-000000000005','237625550005'),  -- second validateur
 ('fd000000-0000-4000-8000-000000000006','33625550006'),   -- étranger (KYC refusé)
 ('fd000000-0000-4000-8000-000000000007','237625550007'),  -- administrateur
 ('fd000000-0000-4000-8000-000000000008','33625550008');   -- demandeur (KYC en revue manuelle)
update profiles set platform_role = 'VALIDATOR' where id in ('fd000000-0000-4000-8000-000000000004', 'fd000000-0000-4000-8000-000000000005');
update profiles set platform_role = 'ADMIN' where id = 'fd000000-0000-4000-8000-000000000007';
update profiles set primary_role = 'REQUESTER', full_name = 'Jean K. (test)' where id in ('fd000000-0000-4000-8000-000000000002', 'fd000000-0000-4000-8000-000000000008');
update profiles set primary_role = 'PROVIDER', full_name = 'École Les Flamboyants (test)' where id = 'fd000000-0000-4000-8000-000000000003';
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');
create function t.docs(p_uid uuid, variadic p_kinds text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('kind', k, 'path', p_uid::text || '/' || lower(k) || '-' || substr(md5(random()::text), 1, 8) || '.jpg',
                                      'contentHash', encode(extensions.digest(k || p_uid::text, 'sha256'), 'hex'), 'mimeType', 'image/jpeg', 'sizeBytes', 2000))
    from unnest(p_kinds) k
$$;
grant execute on function t.docs(uuid, text[]) to authenticated;

-- ===================== X4 : enrôlement et niveaux =====================
-- ---------- Structure et droits ----------
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('submit_enrolment','my_enrolment','claim_enrolment_case','decide_enrolment','get_enrolment_document_access','apply_kyc_result',
                      '_check_payer_limits','_apply_kyc','_require_enrolment')),
  'X4 : aucune fonction d’enrôlement exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('apply_kyc_result','_apply_kyc','_approve_enrolment','_reject_enrolment','_check_payer_limits','_require_enrolment','_check_initiator_level')),
  'X4 : adaptateur KYC et fonctions internes non exécutables par authenticated');
select t.check(has_function_privilege('service_role', 'apply_kyc_result(uuid, text, text, text, text)', 'execute'), 'X4 : adaptateur KYC réel : rôle service');
select t.check(not has_table_privilege('authenticated', 'enrolment_cases', 'INSERT') and not has_table_privilege('authenticated', 'enrolment_documents', 'INSERT')
           and not has_table_privilege('authenticated', 'enrolment_events', 'INSERT') and not has_table_privilege('anon', 'enrolment_cases', 'SELECT')
           and not has_table_privilege('anon', 'enrolment_limits', 'SELECT'),
  'X4 : dossiers, pièces et journal : aucune écriture directe, rien pour anon');
select t.check((select not public from storage.buckets where id = 'identity'), 'X4 : bucket « identity » distinct et privé');
select t.check(not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'can_initiate_requests'),
  'X4 : can_initiate_requests remplacée par le niveau');
select t.check((select enrolment_level from profiles where id = 'fd000000-0000-4000-8000-000000000002') = 'N0', 'X4 : nouveau compte au niveau N0');

-- ---------- Niveau protégé ----------
select t.login('fd000000-0000-4000-8000-000000000002');
select t.hint($$update profiles set enrolment_level = 'N3' where id = auth.uid()$$, 'PROFILE_PROTECTED', 'X4 : personne ne modifie son propre niveau');
select t.check((select enrolment_level from profiles where id = auth.uid()) = 'N0', 'X4 : niveau inchangé');
-- ---------- Initiation selon le niveau ----------
select t.hint($$select save_draft('{"id":"fd100000-0000-4000-8000-000000000001","vertical":"EDUCATION","creatorRole":"REQUESTER","counterpartyPhone":"+33625550001"}')$$,
  'ENROLMENT_REQUIRED', 'X4 : N0 : initier une demande en demandeur refusé (N1 requis)');
select t.login('fd000000-0000-4000-8000-000000000001');
select save_draft('{"id":"fd100000-0000-4000-8000-000000000002","vertical":"EDUCATION","creatorRole":"PAYER"}');
select t.check(exists (select 1 from transactions where id = 'fd100000-0000-4000-8000-000000000002'), 'X4 : N0 : le payeur crée son propre besoin');

-- ---------- Dossier N1 par l’adaptateur KYC simulé (résultat APPROVED) ----------
select t.login('fd000000-0000-4000-8000-000000000002');
select t.hint($$select submit_enrolment('N2', t.docs(auth.uid(), 'BUSINESS_REGISTRATION', 'ACTIVITY_PROOF'))$$, 'ENROLMENT_REQUIRED', 'X4 : N2 exige d’abord le N1 du représentant');
select t.hint($$select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT'))$$, 'DOCUMENT_REQUIRED', 'X4 : N1 sans selfie refusé');
select t.hint($$select submit_enrolment('N1', t.docs('fd000000-0000-4000-8000-000000000006', 'ID_DOCUMENT', 'SELFIE'))$$, 'VALIDATION', 'X4 : pièce hors de son propre dossier refusée');
select t.hint($$select submit_enrolment('N1', '[{"kind":"PASSEPORT_VOLE","path":"fd000000-0000-4000-8000-000000000002/a.jpg"},{"kind":"ID_DOCUMENT","path":"fd000000-0000-4000-8000-000000000002/b.jpg"},{"kind":"SELFIE","path":"fd000000-0000-4000-8000-000000000002/c.jpg"}]')$$,
  'VALIDATION', 'X4 : type de pièce inconnu refusé');
insert into t.res values ('n1', (select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'))));
select t.check((select v->>'status' from t.res where k = 'n1') = 'APPROVED' and (select v->>'kycResult' from t.res where k = 'n1') = 'APPROVED',
  'X4 : KYC simulé approuvé : dossier APPROVED');
select t.check((select enrolment_level from profiles where id = auth.uid()) = 'N1', 'X4 : montée au niveau N1');
select t.check((select array_agg(event order by id) from enrolment_events where profile_id = auth.uid()) = array['CASE_SUBMITTED','KYC_RESULT','LEVEL_CHANGED','CASE_APPROVED'],
  'X4 : soumission, résultat KYC, changement de niveau et décision journalisés');
select t.check((select (v->>'level') = 'N1' and v->'case'->>'status' = 'APPROVED' from t.j('select my_enrolment()') v), 'X4 : my_enrolment : niveau et dernier dossier');
select t.hint($$select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'))$$, 'ALREADY_ENROLLED', 'X4 : niveau déjà atteint');
select save_draft('{"id":"fd100000-0000-4000-8000-000000000001","vertical":"EDUCATION","creatorRole":"REQUESTER","counterpartyPhone":"+33625550001"}');
select t.check(exists (select 1 from transactions where id = 'fd100000-0000-4000-8000-000000000001'), 'X4 : N1 : initier une demande en demandeur accepté');
select t.hint($$select save_draft('{"id":"fd100000-0000-4000-8000-000000000003","vertical":"EDUCATION","creatorRole":"PROVIDER","counterpartyPhone":"+33625550001"}')$$,
  'ENROLMENT_REQUIRED', 'X4 : N1 : initier en prestataire refusé (N2 requis)');
select t.admin();

-- ---------- KYC refusé ----------
update app_config set value = 'REJECTED' where key = 'kyc_simulated_result';
select t.login('fd000000-0000-4000-8000-000000000006');
insert into t.res values ('rej', (select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'))));
select t.check((select v->>'status' = 'REJECTED' and length(v->>'rejectionReason') >= 3 from t.res where k = 'rej'), 'X4 : KYC refusé : dossier REJECTED avec motif');
select t.check((select enrolment_level from profiles where id = auth.uid()) = 'N0', 'X4 : refus : niveau inchangé');
select t.admin();

-- ---------- KYC en revue manuelle, puis décision du personnel ----------
update app_config set value = 'REVIEW' where key = 'kyc_simulated_result';
select t.login('fd000000-0000-4000-8000-000000000008');
insert into t.res values ('rev', (select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'))));
insert into t.ids values ('rev', ((select v->>'id' from t.res where k = 'rev'))::uuid);
select t.check((select v->>'status' = 'SUBMITTED' and v->>'kycResult' = 'REVIEW' from t.res where k = 'rev'), 'X4 : KYC « revue » : dossier en attente du bureau');
select t.hint($$select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'))$$, 'ENROLMENT_PENDING', 'X4 : un seul dossier en cours');
select t.hint($$select claim_enrolment_case((select v from t.ids where k = 'rev'))$$, 'VALIDATOR_ONLY', 'X4 : prise en charge réservée au personnel');
select t.check((select count(*) from enrolment_cases) = 1, 'X4 : RLS : le titulaire ne voit que ses dossiers');
select t.login('fd000000-0000-4000-8000-000000000001');
select t.check((select count(*) from enrolment_cases where profile_id = 'fd000000-0000-4000-8000-000000000008') = 0
           and (select count(*) from enrolment_documents where profile_id = 'fd000000-0000-4000-8000-000000000008') = 0,
  'X4 : RLS : un autre utilisateur ne voit ni le dossier ni les pièces');
-- Pièces : bucket distinct, lecture après consultation journalisée seulement (titulaire ou relecteur du dossier).
select t.admin();
insert into storage.objects(bucket_id, name) select 'identity', storage_path from enrolment_documents where case_id = (select v from t.ids where k = 'rev');
insert into t.ids values ('idoc', (select id from enrolment_documents where case_id = (select v from t.ids where k = 'rev') and kind = 'ID_DOCUMENT'));
select t.login('fd000000-0000-4000-8000-000000000008');
select t.check((select count(*) from storage.objects where bucket_id = 'identity' and name like 'fd000000-0000-4000-8000-000000000008/%') = 0,
  'X4 : stockage : pièce d’identité illisible sans consultation journalisée, même pour le titulaire');
select get_enrolment_document_access((select v from t.ids where k = 'idoc'));
select t.check((select count(*) from storage.objects where bucket_id = 'identity' and name = (select storage_path from enrolment_documents where id = (select v from t.ids where k = 'idoc'))) = 1,
  'X4 : stockage : lisible par le titulaire après consultation journalisée');
select t.login('fd000000-0000-4000-8000-000000000006');
select t.hint($$select get_enrolment_document_access((select v from t.ids where k = 'idoc'))$$, 'NOT_FOUND', 'X4 : pièce d’identité : tiers refusé');
select t.check((select count(*) from storage.objects where bucket_id = 'identity' and name like 'fd000000-0000-4000-8000-000000000008/%') = 0, 'X4 : stockage : illisible pour un tiers');
select t.login('fd000000-0000-4000-8000-000000000005');
select t.hint($$select get_enrolment_document_access((select v from t.ids where k = 'idoc'))$$, 'NOT_FOUND', 'X4 : pièce d’identité : validateur qui n’est pas le relecteur refusé');
select t.login('fd000000-0000-4000-8000-000000000004');
select t.hint($$select decide_enrolment((select v from t.ids where k = 'rev'), true)$$, 'NOT_CLAIMED', 'X4 : décision sans prise en charge refusée');
select claim_enrolment_case((select v from t.ids where k = 'rev'));
select t.login('fd000000-0000-4000-8000-000000000005');
select t.hint($$select claim_enrolment_case((select v from t.ids where k = 'rev'))$$, 'ALREADY_CLAIMED', 'X4 : un seul relecteur par dossier');
select t.login('fd000000-0000-4000-8000-000000000004');
select get_enrolment_document_access((select v from t.ids where k = 'idoc'));
select t.check((select count(*) from storage.objects where bucket_id = 'identity' and name = (select storage_path from enrolment_documents where id = (select v from t.ids where k = 'idoc'))) = 1,
  'X4 : stockage : lisible par le relecteur après consultation journalisée');
select t.check((select count(*) from enrolment_events where event = 'DOCUMENT_VIEWED' and case_id = (select v from t.ids where k = 'rev')) = 2
           and exists (select 1 from enrolment_events where event = 'DOCUMENT_VIEWED' and actor_id = 'fd000000-0000-4000-8000-000000000004' and payload->>'role' = 'REVIEWER'),
  'X4 : chaque consultation journalisée (qui, quelle pièce, rôle)');
select t.hint($$select decide_enrolment((select v from t.ids where k = 'rev'), false, '')$$, 'REASON_REQUIRED', 'X4 : refus sans motif impossible');
insert into t.res values ('dec', (select decide_enrolment((select v from t.ids where k = 'rev'), true)));
select t.check((select v->>'status' from t.res where k = 'dec') = 'APPROVED', 'X4 : approbation par le relecteur');
select t.check((select enrolment_level from profiles where id = 'fd000000-0000-4000-8000-000000000008') = 'N1', 'X4 : niveau relevé par la revue');
select t.hint($$select decide_enrolment((select v from t.ids where k = 'rev'), false, 'trop tard')$$, 'CASE_CLOSED', 'X4 : dossier tranché : décision définitive');
-- Le personnel n’examine pas son propre dossier.
select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'));
select t.login('fd000000-0000-4000-8000-000000000004');
select t.hint($$select claim_enrolment_case((select id from enrolment_cases where profile_id = auth.uid()))$$, 'SELF_REVIEW', 'X4 : pas de revue de son propre dossier');
select t.admin();

-- ---------- N2 (KYC) puis N3 (revue manuelle) ----------
update app_config set value = 'APPROVED' where key = 'kyc_simulated_result';
select t.login('fd000000-0000-4000-8000-000000000003');
select submit_enrolment('N1', t.docs(auth.uid(), 'ID_DOCUMENT', 'SELFIE'));
select t.hint($$select submit_enrolment('N2', t.docs(auth.uid(), 'BUSINESS_REGISTRATION'))$$, 'DOCUMENT_REQUIRED', 'X4 : N2 sans justificatif d’activité refusé');
select submit_enrolment('N2', t.docs(auth.uid(), 'BUSINESS_REGISTRATION', 'ACTIVITY_PROOF'), '{"registrationNumber":"RC/YAO/2026/B/0001"}');
select t.check((select enrolment_level from profiles where id = auth.uid()) = 'N2', 'X4 : commerçant : N1 puis N2 par l’adaptateur KYC');
select save_draft('{"id":"fd100000-0000-4000-8000-000000000003","vertical":"EDUCATION","creatorRole":"PROVIDER","counterpartyPhone":"+33625550001"}');
select t.check(exists (select 1 from transactions where id = 'fd100000-0000-4000-8000-000000000003'), 'X4 : N2 : initier en prestataire accepté');
insert into t.res values ('n3', (select submit_enrolment('N3', t.docs(auth.uid(), 'LEGAL_DOCUMENTS', 'REPRESENTATIVE_MANDATE'))));
select t.check((select v->>'status' = 'SUBMITTED' and v->>'route' = 'MANUAL' and not (v ? 'kycResult') from t.res where k = 'n3'),
  'X4 : N3 : revue manuelle, sans adaptateur KYC');
select t.login('fd000000-0000-4000-8000-000000000005');
select claim_enrolment_case(((select v->>'id' from t.res where k = 'n3'))::uuid);
select decide_enrolment(((select v->>'id' from t.res where k = 'n3'))::uuid, false, 'Mandat du représentant non signé');
select t.check((select enrolment_level from profiles where id = 'fd000000-0000-4000-8000-000000000003') = 'N2'
           and (select rejection_reason from enrolment_cases where id = ((select v->>'id' from t.res where k = 'n3'))::uuid) = 'Mandat du représentant non signé',
  'X4 : N3 refusé avec motif : niveau inchangé');
-- Soumission : niveau contrôlé de nouveau (un niveau retiré entre-temps bloque la soumission).
select t.admin();
update profiles set enrolment_level = 'N0' where id = 'fd000000-0000-4000-8000-000000000002';
select t.login('fd000000-0000-4000-8000-000000000002');
select t.hint($$select submit_operation('fd100000-0000-4000-8000-000000000001')$$, 'ENROLMENT_REQUIRED', 'X4 : soumission : niveau contrôlé de nouveau');
select t.admin();
update profiles set enrolment_level = 'N1' where id = 'fd000000-0000-4000-8000-000000000002';

-- ---------- Adaptateur réel (rôle service) ----------
select t.login('fd000000-0000-4000-8000-000000000002');
select t.fails($$select apply_kyc_result((select v from t.ids where k = 'rev'), 'REJECTED', 'x')$$, 'X4 : apply_kyc_result interdit à un utilisateur');
select t.admin();
select set_config('t.rev', (select v::text from t.ids where k = 'rev'), true);
set local role service_role;
select apply_kyc_result(current_setting('t.rev')::uuid, 'REJECTED', 'KYC-LATE');
reset role;
select t.check((select status from enrolment_cases where id = (select v from t.ids where k = 'rev')) = 'APPROVED', 'X4 : résultat KYC tardif sans effet sur un dossier tranché');
select t.hint($$delete from enrolment_events where profile_id = 'fd000000-0000-4000-8000-000000000002'$$, 'AUDIT_IMMUTABLE', 'X4 : journal d’enrôlement immuable');

-- ---------- Plafonds ----------
select t.check((select count(*) = 12 and bool_and(dev_only) and bool_and(per_operation_minor is null and per_day_minor is null and per_month_minor is null) from enrolment_limits),
  'X4 : plafonds : lignes de développement seulement, sans aucun nombre (mock_mode)');
delete from enrolment_limits where level = 'N0' and currency = 'XAF';
select t.hint($$select _check_payer_limits('fd000000-0000-4000-8000-000000000001', 'XAF', 1000)$$, 'LIMITS_NOT_CONFIGURED', 'X4 : plafonds absents : refus prudent');
insert into app_config(key, value) values ('limits_when_missing', 'ALLOW') on conflict (key) do update set value = excluded.value;
select t.ok($$select _check_payer_limits('fd000000-0000-4000-8000-000000000001', 'XAF', 1000)$$, 'X4 : réglage explicite ALLOW : accepté');
delete from app_config where key = 'limits_when_missing';
update enrolment_limits set per_operation_minor = 50000, dev_only = false where level = 'N0' and currency = 'EUR';
select t.hint($$select _check_payer_limits('fd000000-0000-4000-8000-000000000001', 'EUR', 50001)$$, 'LIMIT_EXCEEDED', 'X4 : plafond par paiement dépassé');
select t.ok($$select _check_payer_limits('fd000000-0000-4000-8000-000000000001', 'EUR', 50000)$$, 'X4 : plafond par paiement atteint sans dépassement');
select t.login('fd000000-0000-4000-8000-000000000001');
select t.check(t.n_updated($$update enrolment_limits set per_operation_minor = null where level = 'N0'$$) = 0, 'X4 : plafonds modifiables par un administrateur seulement');
select t.admin();
select t.check((select per_operation_minor from enrolment_limits where level = 'N0' and currency = 'EUR') = 50000, 'X4 : plafond inchangé par un utilisateur');
-- (restauré à la fin par le rollback)

-- ===================== X5 : paiements, devises, remboursements =====================
-- Opération d’un demandeur N1 (fd..02) pour le payeur fd..01 (N0), scolarité (règlement direct), 100 000 XAF.
create function t.op(p_id uuid, p_module text, p_amount int, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', p_module, 'amountMinor', p_amount::text, 'currency', 'XAF', 'purpose', 'Besoin (passe 2)',
    'beneficiaryName', 'Awa', 'counterpartyPhone', p_phone, 'provider', jsonb_build_object('name', 'Prestataire (passe 2)', 'invitedPhone', '+237 6 2555 0003'),
    'planType', 'SINGLE', 'tranches', jsonb_build_array(jsonb_build_object('label', 'Unique', 'amountMinor', p_amount::text, 'dueDate', (current_date + 2)::text)))
$$;
create function t.submit(p_id uuid, p_kind text) returns void language plpgsql as $$
begin
  perform t.login('fd000000-0000-4000-8000-000000000002');
  perform add_document(p_id, p_kind, p_id::text || '/' || p_kind || '/x.pdf', 'x.pdf', 'application/pdf', 1000);
  perform submit_operation(p_id);
  perform t.admin();
end $$;
grant execute on function t.op(uuid, text, int, text), t.submit(uuid, text) to authenticated;

-- ---------- Structure et droits ----------
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('get_quote','accept_and_pay','start_payment','mark_refund_executed','request_refund','apply_payment_event','_refund_executed','_quote_fees')),
  'X5 : aucune fonction de paiement exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_refund_executed','_quote_fees','_quote_json','_process_payment_event','apply_payment_event','_create_refund','_post_journal')),
  'X5 : fonctions internes et réception des événements non exécutables par authenticated');
select t.check(not has_table_privilege('authenticated', 'fx_quotes', 'INSERT') and not has_table_privilege('authenticated', 'contributions', 'INSERT')
           and not has_table_privilege('anon', 'fx_quotes', 'SELECT') and not has_table_privilege('anon', 'contributions', 'SELECT'),
  'X5 : devis et contributions : aucune écriture par le client, rien pour anon');
select t.check(not exists (select 1 from payment_attempts where status not in ('INITIATED','PENDING','CONFIRMED','FAILED'))
           and not exists (select 1 from refunds where status not in ('REQUESTED','EXECUTED','FAILED')),
  'X5 : statuts de tentative et de remboursement du modèle cible seulement');

select t.login('fd000000-0000-4000-8000-000000000002');
select save_draft(t.op('fd300000-0000-4000-8000-000000000001', 'EDUCATION', 100000, '+33625550001'));
select t.submit('fd300000-0000-4000-8000-000000000001', 'ENROLMENT_CERTIFICATE');
insert into t.ids select 'p1', id from tranches where tx_id = 'fd300000-0000-4000-8000-000000000001';
select t.check((select status from tranches where id = (select v from t.ids where k = 'p1')) = 'SUBMITTED', 'X5 : demande soumise au payeur');

-- ---------- Devis ----------
select t.login('fd000000-0000-4000-8000-000000000002');
select t.hint($$select get_quote((select v from t.ids where k = 'p1'))$$, 'PAYER_ONLY', 'X5 : devis réservé au payeur');
select t.login('fd000000-0000-4000-8000-000000000001');
insert into t.res values ('qx', get_quote((select v from t.ids where k = 'p1')));
select t.check((select v->>'source' = 'IDENTITY' and (v->>'rate')::numeric = 1 and (v->>'debitAmountMinor')::bigint = 100000
                and (v->>'totalDebitMinor')::bigint = 100000 and v->>'debitCurrency' = 'XAF' from t.res where k = 'qx'),
  'X5 : devis dans la devise de la demande : taux 1, aucun frais (barème absent)');
insert into t.res values ('qe', get_quote((select v from t.ids where k = 'p1'), 'EUR'));
select t.check((select v->>'source' = 'SIMULATED' and (v->>'simulated')::boolean and (v->>'debitAmountMinor')::bigint = 15245
                and v->>'requestCurrency' = 'XAF' and (v->>'requestAmountMinor')::bigint = 100000 and (v->'fees'->>'fxMinor')::bigint = 0 from t.res where k = 'qe'),
  'X5 : devis EUR simulé et marqué : 100 000 XAF = 152,45 € (parité 655,957, arrondi au supérieur)');
select t.check((select expires_at > quoted_at and source = 'SIMULATED' and simulated from fx_quotes where id = ((select v->>'id' from t.res where k = 'qe'))::uuid),
  'X5 : devis conservé avec source, horodatage et expiration');
select t.hint($$select get_quote((select v from t.ids where k = 'p1'), 'USD')$$, 'QUOTE_UNAVAILABLE', 'X5 : aucune cotation inventée (USD absent des taux simulés)');
select t.admin();
insert into app_config(key, value) values ('fee_schedule', '{"serviceBps": 100, "fxBps": 50, "methodBps": {"CARD": 200}}')
on conflict (key) do update set value = excluded.value;
select t.login('fd000000-0000-4000-8000-000000000001');
insert into t.res values ('qf', get_quote((select v from t.ids where k = 'p1'), 'EUR', 'CARD'));
select t.check((select (v->'fees'->>'serviceMinor')::bigint = 153 and (v->'fees'->>'fxMinor')::bigint = 77 and (v->'fees'->>'methodMinor')::bigint = 305
                and (v->>'totalDebitMinor')::bigint = 15780 from t.res where k = 'qf'),
  'X5 : frais par poste (service, change, moyen de paiement) et total débité, avant toute autorisation');
select t.admin();
select t.hint($$update fx_quotes set rate = 1 where id = ((select v->>'id' from t.res where k = 'qe'))::uuid$$, 'QUOTE_FROZEN', 'X5 : devis figé');
delete from app_config where key = 'fee_schedule';
-- Devis expiré (la transaction de test fige now() : expiration fabriquée en suspendant le déclencheur).
alter table fx_quotes disable trigger fx_quotes_frozen;
update fx_quotes set quoted_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes' where id = ((select v->>'id' from t.res where k = 'qx'))::uuid;
alter table fx_quotes enable trigger fx_quotes_frozen;
select t.login('fd000000-0000-4000-8000-000000000001');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0000', ((select v->>'id' from t.res where k = 'qx'))::uuid)$$,
  'QUOTE_EXPIRED', 'X5 : devis expiré refusé');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0000', gen_random_uuid())$$, 'QUOTE_INVALID', 'X5 : devis inconnu refusé');

-- ---------- Plafonds à l’acceptation ----------
select t.admin();
insert into enrolment_limits(level, currency, per_operation_minor) values ('N0', 'XAF', 50000)
on conflict (level, currency) do update set per_operation_minor = 50000, dev_only = false;
select t.login('fd000000-0000-4000-8000-000000000001');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0001', ((select v->>'id' from t.res where k = 'qe'))::uuid)$$,
  'LIMIT_EXCEEDED', 'X5 : plafond du niveau dépassé : paiement refusé');
select t.admin();
delete from enrolment_limits where level = 'N0' and currency = 'XAF';
select t.login('fd000000-0000-4000-8000-000000000001');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0001', ((select v->>'id' from t.res where k = 'qe'))::uuid)$$,
  'LIMITS_NOT_CONFIGURED', 'X5 : plafonds absents : refus prudent');
select t.check((select status from tranches where id = (select v from t.ids where k = 'p1')) = 'SUBMITTED'
           and (select count(*) from contributions where tranche_id = (select v from t.ids where k = 'p1')) = 0,
  'X5 : refus : demande toujours à payer, aucune contribution');
select t.admin();
insert into enrolment_limits(level, currency, dev_only) values ('N0', 'XAF', true);

-- ---------- Accepter et payer ----------
select t.login('fd000000-0000-4000-8000-000000000001');
insert into t.ids select 'a1', (accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0001', ((select v->>'id' from t.res where k = 'qe'))::uuid)->>'id')::uuid;
select t.check((select status = 'INITIATED' and amount_minor = 100000 and currency = 'XAF' and debit_currency = 'EUR' and debit_amount_minor = 15245
                and quote_id = ((select v->>'id' from t.res where k = 'qe'))::uuid from payment_attempts where id = (select v from t.ids where k = 'a1'))
           and (select status from tranches where id = (select v from t.ids where k = 'p1')) = 'ACCEPTED',
  'X5 : accepter et payer : tentative INITIATED (montant canonique XAF, débit EUR du devis), demande ACCEPTED');
select t.check((select c.status = 'PENDING' and c.amount_minor = 100000 and c.payer_id = auth.uid()
                from contributions c join payment_attempts a on a.contribution_id = c.id where a.id = (select v from t.ids where k = 'a1')),
  'X5 : contribution du montant total créée (phase 1 : un seul payeur)');
select t.check((select used_at is not null and attempt_id = (select v from t.ids where k = 'a1') from fx_quotes where id = ((select v->>'id' from t.res where k = 'qe'))::uuid),
  'X5 : devis consommé et rattaché au paiement');
select t.check((accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0001', null)->>'id')::uuid = (select v from t.ids where k = 'a1'),
  'X5 : même clé rejouée : même tentative');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0002', ((select v->>'id' from t.res where k = 'qf'))::uuid)$$,
  'PAYMENT_IN_PROGRESS', 'X5 : une seule tentative en cours');
select demo_settle_payment((select v from t.ids where k = 'a1'), 'PENDING');
select t.check((select status from payment_attempts where id = (select v from t.ids where k = 'a1')) = 'PENDING', 'X5 : événement « en cours » : INITIATED → PENDING');
-- Échec puis nouvelle tentative.
select demo_settle_payment((select v from t.ids where k = 'a1'), 'FAILED');
select t.check((select status from payment_attempts where id = (select v from t.ids where k = 'a1')) = 'FAILED'
           and (select c.status from contributions c join payment_attempts a on a.contribution_id = c.id where a.id = (select v from t.ids where k = 'a1')) = 'FAILED'
           and (select status from tranches where id = (select v from t.ids where k = 'p1')) = 'SUBMITTED',
  'X5 : échec : tentative et contribution en échec, demande de nouveau payable (SUBMITTED)');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0002', ((select v->>'id' from t.res where k = 'qe'))::uuid)$$,
  'QUOTE_USED', 'X5 : un devis ne sert qu’une fois');
insert into t.ids select 'a2', (accept_and_pay((select v from t.ids where k = 'p1'), 'cle-p1-0002', ((select v->>'id' from t.res where k = 'qf'))::uuid)->>'id')::uuid;
select t.check((select fees_minor = 535 and debit_amount_minor = 15245 and method = 'CARD' from payment_attempts where id = (select v from t.ids where k = 'a2')),
  'X5 : nouvelle tentative avec son propre devis (frais figés)');
select demo_settle_payment((select v from t.ids where k = 'a2'));
select t.check((select status from payment_attempts where id = (select v from t.ids where k = 'a2')) = 'CONFIRMED'
           and (select c.status from contributions c join payment_attempts a on a.contribution_id = c.id where a.id = (select v from t.ids where k = 'a2')) = 'CONFIRMED'
           and (select status = 'PAID' and funds_state = 'NONE' from tranches where id = (select v from t.ids where k = 'p1')),
  'X5 : tentative confirmée par un événement : contribution confirmée, somme suffisante, demande PAID');
select t.admin();
select t.check((select count(*) from ledger_entries e join ledger_journals j on j.id = e.journal_id
                where j.attempt_id = (select v from t.ids where k = 'a2') and j.kind = 'PAYMENT' and e.currency = 'EUR' and e.account_code = 'FEES' and e.credit_minor = 535) = 1
           and (select sum(credit_minor) from ledger_entries e join ledger_journals j on j.id = e.journal_id
                where j.attempt_id = (select v from t.ids where k = 'a2') and j.kind = 'PAYMENT' and e.currency = 'XAF' and e.account_code = 'DUE_TO_PROVIDER') = 100000,
  'X5 : journal : montant en XAF (devise canonique), frais en EUR (devise débitée), chaque devise équilibrée');
select t.login('fd000000-0000-4000-8000-000000000004');   -- rapprochement : personnel seulement
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'a2')) = '{}'
           and (select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'a1')) = '{}',
  'X5 : rapprochement sans écart');

-- ---------- Remboursements : demande, exécution manuelle, plafond ----------
select t.login('fd000000-0000-4000-8000-000000000007');
insert into t.res values ('rf1', request_refund((select v from t.ids where k = 'p1'), 30000, 'cle-rf-p1-0001', 'Geste commercial'));
insert into t.ids values ('rf1', ((select v->>'id' from t.res where k = 'rf1'))::uuid);
select t.check((select v->>'status' from t.res where k = 'rf1') = 'REQUESTED', 'X5 : remboursement demandé (REQUESTED)');
select t.login('fd000000-0000-4000-8000-000000000001');
select t.hint($$select mark_refund_executed((select v from t.ids where k = 'rf1'), 'TPW-REF-0001')$$, 'ADMIN_ONLY', 'X5 : exécution réservée à un administrateur');
select t.login('fd000000-0000-4000-8000-000000000007');
select t.hint($$select mark_refund_executed((select v from t.ids where k = 'rf1'), '')$$, 'VALIDATION', 'X5 : référence du partenaire obligatoire');
insert into t.res values ('rx1', mark_refund_executed((select v from t.ids where k = 'rf1'), 'TPW-REF-0001'));
select t.check((select v->>'status' = 'EXECUTED' and v->>'partnerRef' = 'TPW-REF-0001' from t.res where k = 'rx1')
           and (select status = 'REFUNDED' and refunded_minor = 30000 from tranches where id = (select v from t.ids where k = 'p1'))
           and (select executed_by = 'fd000000-0000-4000-8000-000000000007' from refunds where id = (select v from t.ids where k = 'rf1')),
  'X5 : exécution manuelle (pilote) : EXECUTED, demande REFUNDED partiellement (refunded_minor)');
select t.check((select reverses_journal_id is not null from ledger_journals where refund_id = (select v from t.ids where k = 'rf1') and kind = 'REFUND_SETTLED'),
  'X5 : contrepassation posée automatiquement (jamais une modification)');
select t.check((mark_refund_executed((select v from t.ids where k = 'rf1'), 'TPW-REF-0001')->>'status') = 'EXECUTED'
           and (select count(*) from ledger_journals where refund_id = (select v from t.ids where k = 'rf1') and kind = 'REFUND_SETTLED') = 1,
  'X5 : même référence rejouée : sans effet');
select t.hint($$select mark_refund_executed((select v from t.ids where k = 'rf1'), 'TPW-AUTRE-02')$$, 'REFUND_NOT_PENDING', 'X5 : remboursement déjà exécuté');
insert into t.res values ('rf2', request_refund((select v from t.ids where k = 'p1'), 70000, 'cle-rf-p1-0002', 'Solde'));
select mark_refund_executed(((select v->>'id' from t.res where k = 'rf2'))::uuid, 'TPW-REF-0002');
select t.check((select refunded_minor = 100000 and status = 'REFUNDED' from tranches where id = (select v from t.ids where k = 'p1'))
           and (select c.status from contributions c join payment_attempts a on a.contribution_id = c.id where a.id = (select v from t.ids where k = 'a2')) = 'REFUNDED',
  'X5 : remboursement partiel puis total : contribution remboursée');
select t.hint($$select request_refund((select v from t.ids where k = 'p1'), 1, 'cle-rf-p1-0003', 'Encore')$$, 'REFUND_EXCEEDS_PAID', 'X5 : jamais au-delà du payé');
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'a2')) = '{}', 'X5 : rapprochement après remboursement total : sans écart');
select t.admin();


-- @@X6@@

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
