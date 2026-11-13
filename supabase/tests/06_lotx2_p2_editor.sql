-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 06_lotx2_p2.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
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

-- @@X5@@

-- @@X6@@

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
