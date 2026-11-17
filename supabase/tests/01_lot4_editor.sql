-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 01_lot4.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
-- Test de la migration 0005 (lot 4). Même format que 00_smoke.sql : utilisateurs fictifs, rôles réels
-- (authenticated, anon), tout est annulé à la fin (ROLLBACK), le résumé échoue au moindre FAIL.
-- Prérequis : 0001 à 0005 appliquées, app_config.mock_mode = 'true' (projet de développement).
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
create function t.anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims','',true); perform set_config('request.jwt.claim.sub','',true); execute 'set local role anon'; end $$;
create function t.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function t.fails(sql text, label text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin execute sql; exception when others then ok := true; end;
  perform t.check(ok, label);
end $$;
-- Exécute une instruction attendue en échec avec le code stable « hint » donné.
create function t.hint(sql text, expected text, label text) returns void language plpgsql as $$
declare h text; m text;
begin
  begin execute sql; exception when others then get stacked diagnostics h = pg_exception_hint, m = message_text; end;
  if h is distinct from expected then raise notice '   attendu %, obtenu % (%)', expected, coalesce(h, 'aucune erreur'), m; end if;
  perform t.check(h is not distinct from expected, label || ' [' || expected || ']');
end $$;
-- Valeur jsonb d’une fonction exécutée avec les droits de l’utilisateur courant.
create function t.j(sql text) returns jsonb language plpgsql as $$
declare r jsonb; begin execute sql into r; return r; end $$;
create table t.ids (k text primary key, v uuid);
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- ---------- Jeu d’essai ----------
-- Numéros enregistrés comme le fait l’authentification (sans « + ») : l’application envoie le format E.164.
insert into auth.users(id, phone) values
 ('e1000000-0000-4000-8000-000000000001','33611110001'),   -- payeur
 ('e1000000-0000-4000-8000-000000000002','33611110002'),   -- demandeur
 ('e1000000-0000-4000-8000-000000000003','237611110003'),  -- prestataire (compte existant)
 ('e1000000-0000-4000-8000-000000000004','237611110004'),  -- validateur
 ('e1000000-0000-4000-8000-000000000006','237611110006'),  -- administrateur
 ('e1000000-0000-4000-8000-000000000007','33611110007');   -- étranger
update profiles set platform_role = 'VALIDATOR' where id = 'e1000000-0000-4000-8000-000000000004';
update profiles set platform_role = 'ADMIN' where id = 'e1000000-0000-4000-8000-000000000006';
update profiles set primary_role = 'REQUESTER' where id = 'e1000000-0000-4000-8000-000000000002';
-- Lot X v2 (X4, 0020) : niveau d’enrôlement réglé ici comme après la revue d’un dossier (N1 requis pour initier en demandeur).
update profiles set enrolment_level = 'N1' where id = 'e1000000-0000-4000-8000-000000000002';
insert into providers(id, name, city, verticals, verified, phone) values
 ('e2000000-0000-4000-8000-000000000001', 'Lycée Général Leclerc (test)', 'Yaoundé', '{EDUCATION}', true, '+237611110003'),
 ('e2000000-0000-4000-8000-000000000002', 'Clinique de l’Espérance (test)', 'Douala', '{HEALTH}', true, null);

-- Lot 5 : pas d’émission simulée du jeton à la validation dans ce test (étapes système jouées explicitement).
-- Lot X v2 (0014) : platform_review vaut NEVER partout et EDUCATION, HEALTH, RENT sont en règlement DIRECT. Pour exercer
-- ici la revue par le bureau (validation, rejet motivé) et la libération conditionnelle (confirmation par référence,
-- déblocage, litige tranché par libération), EDUCATION passe en revue ALWAYS et en CONDITIONAL, HEALTH en revue ALWAYS.
-- Le chemin par défaut (NEVER, DIRECT) est vérifié plus bas sur un dossier RENT.
update request_modules set platform_review = 'ALWAYS', settlement_mode = 'CONDITIONAL' where code = 'EDUCATION';
update request_modules set platform_review = 'ALWAYS' where code = 'HEALTH';

-- ---------- Structure et droits ----------
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('_err','_norm_phone','_valid_phone','_require_user','_mock_mode','_fold','_draft_json','_user_by_phone',
      '_resolve_dispute_core','_storage_tx','search_providers','save_draft','get_draft','get_drafts','delete_draft','add_document',
      'remove_document','get_receipt','get_dispute','resolve_reference_info','demo_review','demo_resolve_dispute','demo_reset',
      'transition_tx','decide_tx','create_tranches','generate_recurring_tranches','transition_tranche','decide_tranche',
      'confirm_by_reference','open_dispute','resolve_dispute','simulate_tranche_system','simulate_system_transition')),
  'aucune fonction de 0005 (ni redéfinie) exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_err','_require_user','_mock_mode','_draft_json','_user_by_phone','_resolve_dispute_core',
                      'release_due_tranches','activate_due_tranches')),
  'fonctions internes non exécutables par authenticated');
select t.check(not has_table_privilege('authenticated', 'notifications', 'INSERT')
           and not has_table_privilege('authenticated', 'notifications', 'DELETE')
           and has_column_privilege('authenticated', 'notifications', 'read_at', 'UPDATE')
           and not has_column_privilege('authenticated', 'notifications', 'event', 'UPDATE')
           and not has_column_privilege('authenticated', 'notifications', 'payload', 'UPDATE'),
  'notifications : le client ne modifie que read_at');
select t.check((select file_size_limit = 10485760 and not public
                   and allowed_mime_types @> array['image/jpeg','image/png','application/pdf'] and cardinality(allowed_mime_types) = 3
                from storage.buckets where id = 'dossiers'), 'bucket dossiers privé, 10 Mo, JPEG / PNG / PDF');
select t.check(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dossiers_delete')
           and exists (select 1 from pg_policies where tablename = 'documents' and policyname = 'docs_delete'),
  'politiques de suppression : documents et fichiers du bucket');
select t.check((select count(*) from cron.job where jobname = 'diaspay-release-due-tranches' and schedule = '*/10 * * * *') = 1
           and (select count(*) from cron.job where jobname = 'diaspay-activate-due-tranches' and schedule = '0 6 * * *') = 1,
  'pg_cron : déblocage toutes les 10 min, activation à 06:00 UTC');
select t.check((select count(*) from required_documents where required) = 6, 'pièces obligatoires D2 en base (miroir du domaine ; santé : devis seul, K13)');

-- ---------- Codes d’erreur ----------
-- Jeton sans identifiant : rôle authenticated mais aucun sub.
do $$ begin perform set_config('request.jwt.claims', '{"role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
set local role authenticated;
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000001","vertical":"EDUCATION"}')$$, 'NOT_AUTHENTICATED', 'appel sans session');
select t.admin();
select t.anon();
select t.fails($$select search_providers('', 'EDUCATION')$$, 'anon ne peut pas rechercher les prestataires');
select t.fails($$select count(*) from providers$$, 'anon ne lit pas la table providers');
select t.admin();

-- ---------- Prestataires : recherche sans accents ni casse ----------
select t.login('e1000000-0000-4000-8000-000000000002');
select t.check((select count(*) from search_providers('LYCEE general', 'EDUCATION') where id = 'e2000000-0000-4000-8000-000000000001') = 1,
  'recherche insensible aux accents et à la casse (nom)');
select t.check((select count(*) from search_providers('yaounde', 'EDUCATION') where id = 'e2000000-0000-4000-8000-000000000001') = 1,
  'recherche par ville sans accent');
select t.check((select count(*) from search_providers('esperance', 'EDUCATION')) = 0, 'filtre par verticale');
select t.check((select count(*) from search_providers('ESPÉRANCE', 'HEALTH') where id = 'e2000000-0000-4000-8000-000000000002') = 1,
  'recherche avec accents saisis');
select t.fails($$insert into providers(name, city, verticals) values ('Intrus', 'Douala', '{HEALTH}')$$, 'un utilisateur ne crée pas de prestataire');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000006');
insert into providers(name, city, verticals, verified) values ('Pharmacie du Centre (test)', 'Douala', '{HEALTH}', true);
select t.check((select count(*) from providers where name = 'Pharmacie du Centre (test)') = 1, 'un administrateur crée un prestataire');
select t.admin();

-- ---------- save_draft : création partielle, mise à jour, parties, tranches ----------
select t.login('e1000000-0000-4000-8000-000000000002');
select t.check((t.j($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000001","vertical":"EDUCATION","step":"amount"}')$$)->>'step') = 'amount',
  'brouillon partiel enregistré (étape 1, sans montant)');
select t.check((select status = 'DRAFT' and amount_minor is null and purpose is null from transactions where id = 'e3000000-0000-4000-8000-000000000001'),
  'colonnes incomplètes à NULL, statut DRAFT');
select t.check((t.j($$select save_draft('{
   "id":"e3000000-0000-4000-8000-000000000001","vertical":"EDUCATION","step":"recap",
   "amountMinor":"900000","currency":"XAF","purpose":"Scolarité 2026-2027","beneficiaryName":"Awa",
   "counterpartyPhone":"+33 6 11 11 00 01",
   "provider":{"id":"e2000000-0000-4000-8000-000000000001","name":"Lycée Général Leclerc (test)"},
   "planType":"PARTIAL",
   "tranches":[{"label":"Inscription","amountMinor":"400000","dueDate":"2026-11-15"},{"label":"Solde","amountMinor":"500000"},{"label":"","amountMinor":""}]}')$$)->>'purpose') = 'Scolarité 2026-2027',
  'brouillon complété (montant, objet, payeur, prestataire, plan)');
select t.check((select amount_minor = 900000 and currency = 'XAF' and provider_name like 'Lycée%' and plan_type = 'PARTIAL'
                from transactions where id = 'e3000000-0000-4000-8000-000000000001'), 'colonnes structurées renseignées');
select t.check((select count(*) from tranches where tx_id = 'e3000000-0000-4000-8000-000000000001') = 2
           and (select release_mode = 'PROVIDER_CONFIRM' and contest_hours = 72 from tranches where tx_id = 'e3000000-0000-4000-8000-000000000001' and seq = 1),
  'tranches complètes seules matérialisées, règle de la verticale appliquée');
select t.check((select user_id from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000001' and role = 'REQUESTER') = 'e1000000-0000-4000-8000-000000000002'
           and (select user_id from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000001' and role = 'PAYER') = 'e1000000-0000-4000-8000-000000000001',
  'demandeur créateur ; payeur résolu depuis son numéro (+33 avec espaces vs 336… en base)');
select t.check((select user_id from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000001' and role = 'PROVIDER') = 'e1000000-0000-4000-8000-000000000003',
  'prestataire de l’annuaire rattaché à son compte par son numéro');
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000009","vertical":"HEALTH","counterpartyPhone":"12"}')$$, 'PHONE_INVALID', 'numéro de payeur invalide');
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000009"}')$$, 'VALIDATION', 'type de besoin manquant');
select t.hint($$select save_draft('{"id":"pas-un-uuid","vertical":"HEALTH"}')$$, 'VALIDATION', 'identifiant invalide');
select t.check(jsonb_array_length(t.j($$select get_drafts()$$)) = 1, 'get_drafts : brouillons du créateur');
select t.admin();

-- Isolation : un tiers ne voit ni ne modifie le brouillon.
select t.login('e1000000-0000-4000-8000-000000000007');
select t.check((select count(*) from transactions where id = 'e3000000-0000-4000-8000-000000000001') = 0, 'isolation : le brouillon est invisible pour un tiers');
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000001","vertical":"EDUCATION"}')$$, 'TX_NOT_FOUND', 'un tiers ne peut pas écraser le brouillon');
select t.hint($$select get_draft('e3000000-0000-4000-8000-000000000001')$$, 'TX_NOT_FOUND', 'get_draft refusé à un tiers');
select t.check(jsonb_array_length(t.j($$select get_drafts()$$)) = 0, 'get_drafts du tiers : vide');
select t.admin();
-- Le payeur, partie, voit le dossier mais ne peut pas le modifier (réservé au créateur).
select t.login('e1000000-0000-4000-8000-000000000001');
select t.check((select count(*) from transactions where id = 'e3000000-0000-4000-8000-000000000001') = 1, 'le payeur invité voit le dossier');
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000001","vertical":"EDUCATION"}')$$, 'TX_NOT_FOUND', 'save_draft réservé au créateur');
select t.admin();

-- ---------- Invitation : prestataire inconnu, rattaché à l’inscription ----------
select t.login('e1000000-0000-4000-8000-000000000001');   -- payeur créateur (profil PAYER)
select save_draft('{"id":"e3000000-0000-4000-8000-000000000002","vertical":"HEALTH","amountMinor":"180000","currency":"XAF",
  "purpose":"Soins dentaires","beneficiaryReference":"MN","provider":{"name":"Cabinet Dr Ngo","invitedPhone":"+237 6 1111 0009"},
  "planType":"SINGLE","tranches":[{"label":"Soins","amountMinor":"180000"}]}');
select t.check((select role from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000002' and user_id = 'e1000000-0000-4000-8000-000000000001') = 'PAYER',
  'créateur au profil payeur : partie PAYER');
select t.check((select invited_phone from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000002' and role = 'PROVIDER' and user_id is null) = '+237611110009',
  'prestataire inconnu : invited_phone normalisé en E.164');
select t.admin();
insert into auth.users(id, phone) values ('e1000000-0000-4000-8000-000000000009', '237611110009');
select t.check((select user_id from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000002' and role = 'PROVIDER') = 'e1000000-0000-4000-8000-000000000009',
  'invitation rattachée à la création du profil');
select t.login('e1000000-0000-4000-8000-000000000009');
select t.check((select count(*) from transactions where id = 'e3000000-0000-4000-8000-000000000002') = 1, 'l’invité inscrit voit son dossier');
select t.admin();

-- ---------- Pièces : limites en base, suppression, archivage ----------
select t.login('e1000000-0000-4000-8000-000000000002');
select add_document('e3000000-0000-4000-8000-000000000001', 'ENROLMENT_CERTIFICATE', 'e3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/a.pdf', 'a.pdf', 'application/pdf', 1000);
select add_document('e3000000-0000-4000-8000-000000000001', 'ENROLMENT_CERTIFICATE', 'e3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/b.jpg', 'b.jpg', 'image/jpeg', 2000);
insert into t.ids select 'doc_c', (add_document('e3000000-0000-4000-8000-000000000001', 'ENROLMENT_CERTIFICATE',
  'e3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/c.png', 'c.png', 'image/png', 3000)->>'id')::uuid;
select t.hint($$select add_document('e3000000-0000-4000-8000-000000000001', 'ENROLMENT_CERTIFICATE', 'e3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/d.pdf', 'd.pdf', 'application/pdf', 1000)$$,
  'TOO_MANY_FILES', 'quatrième fichier du même type refusé');
select t.hint($$insert into documents(tx_id, kind, storage_path, mime_type, size_bytes, uploaded_by) values ('e3000000-0000-4000-8000-000000000001', 'ENROLMENT_CERTIFICATE', 'e3000000-0000-4000-8000-000000000001/x.pdf', 'application/pdf', 10, auth.uid())$$,
  'TOO_MANY_FILES', 'limite imposée aussi à l’insertion directe');
select t.hint($$select add_document('e3000000-0000-4000-8000-000000000001', 'SCHOOL_SCHEDULE', 'e3000000-0000-4000-8000-000000000001/SCHOOL_SCHEDULE/e.gif', 'e.gif', 'image/gif', 1000)$$,
  'FILE_TYPE', 'type de fichier refusé');
select t.hint($$select add_document('e3000000-0000-4000-8000-000000000001', 'SCHOOL_SCHEDULE', 'e3000000-0000-4000-8000-000000000001/SCHOOL_SCHEDULE/f.pdf', 'f.pdf', 'application/pdf', 10485761)$$,
  'FILE_TOO_LARGE', 'fichier de plus de 10 Mo refusé');
select t.hint($$select add_document('e3000000-0000-4000-8000-000000000001', 'SCHOOL_SCHEDULE', 'autre-dossier/f.pdf', 'f.pdf', 'application/pdf', 100)$$,
  'VALIDATION', 'chemin hors du dossier refusé');
select t.check((select remove_document((select v from t.ids where k = 'doc_c'))) = 'DELETED', 'pièce d’un brouillon vierge supprimée');
select t.check((select count(*) from documents where tx_id = 'e3000000-0000-4000-8000-000000000001') = 2, 'ligne de la pièce supprimée');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000007');
select t.hint($$select add_document('e3000000-0000-4000-8000-000000000001', 'SCHOOL_SCHEDULE', 'e3000000-0000-4000-8000-000000000001/SCHOOL_SCHEDULE/g.pdf', 'g.pdf', 'application/pdf', 100)$$,
  'TX_NOT_FOUND', 'un tiers ne dépose pas de pièce');
select t.admin();

-- ---------- Soumission : contrôles du domaine en base ----------
select t.login('e1000000-0000-4000-8000-000000000001');
select add_document('e3000000-0000-4000-8000-000000000002', 'QUOTE', 'e3000000-0000-4000-8000-000000000002/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
-- Lot X v2 (X6, K13) : la pièce d’identité du bénéficiaire n’est plus demandée ni acceptée pour la santé.
select t.hint($$select add_document('e3000000-0000-4000-8000-000000000002', 'BENEFICIARY_ID', 'e3000000-0000-4000-8000-000000000002/BENEFICIARY_ID/id.jpg', 'id.jpg', 'image/jpeg', 1000)$$,
  'DOCUMENT_KIND_NOT_ALLOWED', 'pièce d’identité du bénéficiaire refusée pour la santé (D2 corrigée, K13)');
select save_draft(get_draft('e3000000-0000-4000-8000-000000000002') || '{"tranches":[{"label":"Soins","amountMinor":"100000"}]}');
select t.hint($$select transition_tx('e3000000-0000-4000-8000-000000000002', 'SUBMITTED')$$, 'PLAN_SUM_MISMATCH', 'somme des tranches différente du total');
select save_draft(get_draft('e3000000-0000-4000-8000-000000000002') || '{"tranches":[]}');
select t.hint($$select transition_tx('e3000000-0000-4000-8000-000000000002', 'SUBMITTED')$$, 'PLAN_EMPTY', 'plan vide');
select t.check((select count(*) from documents where tx_id = 'e3000000-0000-4000-8000-000000000002') = 1, 'save_draft conserve les pièces (le devis ; K13 : plus de pièce d’identité)');
select save_draft('{"id":"e3000000-0000-4000-8000-000000000003","vertical":"AGRO","amountMinor":"5000","currency":"XAF","purpose":"Semences",
  "beneficiaryName":"Coop","planType":"SINGLE","tranches":[{"label":"Semences","amountMinor":"5000"}]}');
select t.hint($$select transition_tx('e3000000-0000-4000-8000-000000000003', 'SUBMITTED')$$, 'VERTICAL_UNAVAILABLE', 'verticale de vague 2 non ouverte');
select t.hint($$select transition_tx('e3000000-0000-4000-8000-000000000003', 'VALIDATED')$$, 'TRANSITION_UNKNOWN', 'transition inconnue');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000002');
select t.check((select status from transition_tx('e3000000-0000-4000-8000-000000000001', 'SUBMITTED')) = 'PENDING_REVIEW',
  'dossier complet soumis : en attente de revue (platform_review ALWAYS)');
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000001","vertical":"EDUCATION"}')$$, 'NOT_EDITABLE', 'dossier soumis non modifiable par save_draft');
select t.hint($$select delete_draft('e3000000-0000-4000-8000-000000000001')$$, 'AUDITED_FILE', 'dossier audité non supprimable');
select t.hint($$select transition_tx('e3000000-0000-4000-8000-000000000001', 'IN_REVIEW')$$, 'VALIDATOR_ONLY', 'mise en validation réservée aux validateurs');
select t.admin();

-- ---------- Validation et notifications aux bonnes parties ----------
select t.login('e1000000-0000-4000-8000-000000000004');
select transition_tx('e3000000-0000-4000-8000-000000000001', 'IN_REVIEW');
select t.check((select status from decide_tx('e3000000-0000-4000-8000-000000000001', true, true)) = 'ACTIVE', 'validation : opération ACTIVE');
select t.hint($$select decide_tx('e3000000-0000-4000-8000-000000000001', true, true)$$, 'NOT_IN_REVIEW', 'décision sur un dossier déjà validé');
select t.admin();
select t.check((select array_agg(user_id order by user_id)::text from notifications where tx_id = 'e3000000-0000-4000-8000-000000000001' and event = 'TX_VALIDATED')
  = '{e1000000-0000-4000-8000-000000000001,e1000000-0000-4000-8000-000000000002,e1000000-0000-4000-8000-000000000003}',
  'TX_VALIDATED : payeur, demandeur et prestataire, pas le validateur');
select t.check((select payload->>'type' = 'TX_VALIDATED' and payload->>'txId' = 'e3000000-0000-4000-8000-000000000001'
                from notifications where tx_id = 'e3000000-0000-4000-8000-000000000001' and event = 'TX_VALIDATED' limit 1), 'payload de notification');

-- Lot X v2 : l’approbation active l’opération et soumet les demandes dues (RG-12) : la tranche 1 (échéance proche),
-- pas la tranche 2 (jalon après une demande en cours). Plus d’émission de jeton ni de passage IN_PROGRESS simulés.
insert into t.ids select 'tr1', id from tranches where tx_id = 'e3000000-0000-4000-8000-000000000001' and seq = 1;
insert into t.ids select 'tr2', id from tranches where tx_id = 'e3000000-0000-4000-8000-000000000001' and seq = 2;
select t.check((select status from tranches where id = (select v from t.ids where k = 'tr1')) = 'SUBMITTED'
           and (select status from tranches where id = (select v from t.ids where k = 'tr2')) = 'DRAFT',
  'activation : demande due soumise, jalon suivant programmé (RG-12)');
-- Le paiement (simulé) est fait par le payeur : start_payment puis événement du partenaire.
select t.login('e1000000-0000-4000-8000-000000000001');
select t.hint($$select simulate_tranche_system((select v from t.ids where k = 'tr2'), 'PAID')$$, 'NOT_PAYABLE', 'tranche non activée non payable');
select simulate_tranche_system((select v from t.ids where k = 'tr1'), 'PAID');
select t.check((select status = 'PAID' and funds_state = 'HELD' from tranches where id = (select v from t.ids where k = 'tr1')),
  'paiement en CONDITIONAL : PAID, fonds bloqués (HELD)');
select t.admin();
create temp table ref1 as select reference from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr1');
grant select on ref1 to authenticated;
select t.login('e1000000-0000-4000-8000-000000000002');
select t.hint($$select confirm_by_reference((select reference from ref1))$$, 'PROVIDER_ONLY', 'le demandeur ne confirme pas une tranche');
select t.check((select count(*) from notifications where event = 'TX_VALIDATED' and tx_id = 'e3000000-0000-4000-8000-000000000001') = 1,
  'RLS : le demandeur ne lit que ses propres notifications');
select t.admin();
select t.check((select array_agg(user_id)::text from notifications where event = 'PAYMENT_REQUEST_RECEIVED' and tx_id = 'e3000000-0000-4000-8000-000000000001')
               = '{e1000000-0000-4000-8000-000000000001}'
           and not exists (select 1 from notifications where event = 'PAYMENT_READY' and tx_id = 'e3000000-0000-4000-8000-000000000001'),
  'PAYMENT_REQUEST_RECEIVED au payeur seul (demande soumise par le demandeur)');
select t.check((select count(*) from notifications where event = 'REQUEST_PAID' and tx_id = 'e3000000-0000-4000-8000-000000000001') = 3,
  'REQUEST_PAID aux trois parties');

-- Confirmation par référence (prestataire, CONDITIONAL, mode PROVIDER_CONFIRM).
select t.login('e1000000-0000-4000-8000-000000000007');
-- Lot X (X1.6) : un tiers reçoit la même réponse qu’une référence inconnue (null), au lieu de NOT_A_PARTY.
select t.check((select resolve_reference_info((select reference from ref1))) is null, 'référence : un tiers est refusé (même réponse qu’une référence inconnue)');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000001');
select t.hint($$select confirm_by_reference((select reference from ref1))$$, 'PROVIDER_ONLY', 'le payeur ne confirme pas par scan');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000003');
select t.check((t.j($$select resolve_reference_info((select reference from ref1))$$)->>'label') = 'Inscription', 'resolve_reference_info');
select t.hint($$select confirm_by_reference('ffffffffffffffffff')$$, 'UNKNOWN_REFERENCE', 'référence inconnue');
select t.hint($$select confirm_by_reference((select reference from ref1), now() + interval '1 hour')$$, 'DEVICE_TIME_INVALID', 'heure d’appareil dans le futur');
select t.check((select status = 'PAID' and funds_state = 'HELD' and confirmed_at is not null and contest_ends_at > now()
                from confirm_by_reference((select upper(reference) from ref1))),
  'confirmation par référence (casse indifférente) : confirmée, délai de contestation ouvert, fonds encore bloqués');
select t.hint($$select confirm_by_reference((select reference from ref1))$$, 'TOKEN_USED', 'QR déjà utilisé');
select t.admin();
select t.check((select count(*) from notifications where event = 'TRANCHE_CONFIRMED' and tx_id = 'e3000000-0000-4000-8000-000000000001' and payload ? 'releaseAt') = 3,
  'TRANCHE_CONFIRMED avec date de déblocage');
select t.login('e1000000-0000-4000-8000-000000000003');
select t.hint($$select get_receipt((select v from t.ids where k = 'tr1'))$$, 'NOT_RELEASED', 'pas de reçu avant déblocage');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000001');
select approve_release((select v from t.ids where k = 'tr1'));
select t.admin();
select t.check((select funds_state = 'RELEASED' and status = 'PAID' from tranches where id = (select v from t.ids where k = 'tr1'))
           and exists (select 1 from release_events where tranche_id = (select v from t.ids where k = 'tr1') and trigger = 'PAYER_APPROVAL'),
  'libération anticipée par le payeur après confirmation : fonds RELEASED');
select t.check((select count(*) from notifications where event = 'TRANCHE_RELEASED' and tx_id = 'e3000000-0000-4000-8000-000000000001') = 3, 'TRANCHE_RELEASED aux trois parties');
select t.login('e1000000-0000-4000-8000-000000000003');
select t.check((select (r->>'chainValid')::boolean and length(r->>'lastHash') = 64 and (r->>'amountMinor')::bigint = 400000 and (r->>'entryCount')::int > 5
                from (select get_receipt((select v from t.ids where k = 'tr1')) r) x), 'reçu : montant, dernière empreinte, chaîne vérifiée');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000007');
select t.hint($$select get_receipt((select v from t.ids where k = 'tr1'))$$, 'TRANCHE_NOT_FOUND', 'reçu refusé à un tiers');
select t.admin();

-- Lecture d’une notification : read_at seulement.
select t.login('e1000000-0000-4000-8000-000000000002');
update notifications set read_at = now() where user_id = auth.uid();
select t.check((select count(*) from notifications where read_at is null) = 0, 'le destinataire marque ses alertes lues');
select t.fails($$update notifications set event = 'X' where user_id = auth.uid()$$, 'le client ne modifie pas le type d’une alerte');
select t.fails($$insert into notifications(user_id, event) values (auth.uid(), 'TX_VALIDATED')$$, 'le client ne crée pas d’alerte');
select t.admin();

-- ---------- Litige ----------
select t.login('e1000000-0000-4000-8000-000000000002');
select simulate_tranche_system((select v from t.ids where k = 'tr2'), 'SUBMITTED');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'tr2'), 'PAID');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000002');
select t.hint($$select open_dispute((select v from t.ids where k = 'tr2'), 'Trop court')$$, 'NOT_A_PARTY', 'le demandeur n’ouvre pas de litige');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000001');
select t.hint($$select open_dispute((select v from t.ids where k = 'tr2'), 'court')$$, 'REASON_TOO_SHORT', 'motif trop court');
select t.check((select status from open_dispute((select v from t.ids where k = 'tr2'), 'Le lycée n’a pas reçu le solde annoncé', 'NOT_DELIVERED')) = 'OPEN', 'litige ouvert par le payeur');
select t.check((select r->>'status' = 'OPEN' and r->>'reason' = 'NOT_DELIVERED' and r->>'openedBy' = 'PAYER'
                from (select get_dispute((select v from t.ids where k = 'tr2')) r) x), 'get_dispute');
select t.check(get_dispute((select v from t.ids where k = 'tr1')) is null, 'get_dispute : aucun litige sur une autre tranche');
select t.admin();
select t.check((select status = 'PAID' and funds_state = 'HELD' and not on_hold from tranches where id = (select v from t.ids where k = 'tr2'))
           and (select status from transactions where id = 'e3000000-0000-4000-8000-000000000001') = 'ACTIVE',
  'litige après paiement : statut de la demande et de l’opération inchangés (K7)');
select t.check((select count(*) from notifications where event = 'DISPUTE_OPENED' and tx_id = 'e3000000-0000-4000-8000-000000000001') = 3, 'DISPUTE_OPENED aux trois parties');
create temp table disp as select id from disputes where tranche_id = (select v from t.ids where k = 'tr2');
grant select on disp to authenticated;
select t.login('e1000000-0000-4000-8000-000000000004');
select t.hint($$select resolve_dispute((select id from disp), 'FUNDS_RELEASED', 'Livré')$$, 'ADMIN_ONLY', 'un validateur ne tranche pas un litige (RG-09)');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000006');
select t.hint($$select resolve_dispute((select id from disp), 'PARTAGE', 'Livré')$$, 'INVALID_OUTCOME', 'issue invalide');
select t.check((select status = 'RESOLVED' and outcome = 'FUNDS_RELEASED' from resolve_dispute((select id from disp), 'FUNDS_RELEASED', 'Attestation du lycée reçue')),
  'litige tranché par l’administrateur (RESOLVED, FUNDS_RELEASED)');
select t.hint($$select resolve_dispute((select id from disp), 'REFUND_FULL', 'Nouvelle décision')$$, 'NO_OPEN_DISPUTE', 'litige déjà clos');
select t.admin();
select t.check((select count(*) from notifications where event = 'DISPUTE_RESOLVED' and payload->>'outcome' = 'RELEASED' and tx_id = 'e3000000-0000-4000-8000-000000000001') = 3,
  'DISPUTE_RESOLVED (RELEASED) aux trois parties');
select t.check((select count(*) from notifications where event = 'TRANCHE_RELEASED' and tx_id = 'e3000000-0000-4000-8000-000000000001') = 3,
  'pas de TRANCHE_RELEASED en double après un litige');
select t.check((select status from transactions where id = 'e3000000-0000-4000-8000-000000000001') = 'CLOSED', 'dossier clos après la dernière tranche');
select t.check(verify_audit('e3000000-0000-4000-8000-000000000001'), 'journal d’audit intègre');
-- Administrateur partie au dossier : refusé.
insert into transaction_parties(tx_id, user_id, role) values ('e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000006', 'REQUESTER');
insert into disputes(tx_id, tranche_id, opened_by, reason)
  select 'e3000000-0000-4000-8000-000000000002', id, 'e1000000-0000-4000-8000-000000000001', 'Litige de test (insertion directe)'
  from tranches where tx_id = 'e3000000-0000-4000-8000-000000000003' limit 1;
create temp table disp2 as select id from disputes where reason = 'Litige de test (insertion directe)';
grant select on disp2 to authenticated;
select t.login('e1000000-0000-4000-8000-000000000006');
select t.hint($$select resolve_dispute((select id from disp2), 'REFUND_FULL', 'Remboursement')$$, 'VALIDATOR_IS_PARTY', 'un administrateur partie ne tranche pas');
select t.admin();
delete from disputes where reason = 'Litige de test (insertion directe)';
delete from transaction_parties where tx_id = 'e3000000-0000-4000-8000-000000000002' and user_id = 'e1000000-0000-4000-8000-000000000006';

-- ---------- Rejet et notification motivée ----------
select t.login('e1000000-0000-4000-8000-000000000001');
select save_draft(get_draft('e3000000-0000-4000-8000-000000000002') || '{"tranches":[{"label":"Soins","amountMinor":"180000"}]}');
select transition_tx('e3000000-0000-4000-8000-000000000002', 'SUBMITTED');
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000004');
select transition_tx('e3000000-0000-4000-8000-000000000002', 'IN_REVIEW');
select t.hint($$select decide_tx('e3000000-0000-4000-8000-000000000002', false, false, '')$$, 'REASON_REQUIRED', 'rejet sans motif');
select decide_tx('e3000000-0000-4000-8000-000000000002', false, false, 'Devis illisible');
select t.admin();
select t.check((select count(*) from notifications where event = 'TX_REJECTED' and payload->>'reason' = 'Devis illisible' and tx_id = 'e3000000-0000-4000-8000-000000000002') = 2,
  'TX_REJECTED avec motif au payeur et au prestataire inscrit');
-- Lot X v2 : un rejet annule l’opération (CANCELLED, motif conservé) ; plus de retour en brouillon pour correction.
select t.check((select status = 'CANCELLED' and reject_reason = 'Devis illisible' from transactions where id = 'e3000000-0000-4000-8000-000000000002')
           and not exists (select 1 from tranches where tx_id = 'e3000000-0000-4000-8000-000000000002' and status <> 'CANCELLED'),
  'dossier rejeté : opération annulée avec son motif, demandes annulées');
select t.login('e1000000-0000-4000-8000-000000000001');
select t.hint($$select save_draft('{"id":"e3000000-0000-4000-8000-000000000002","vertical":"HEALTH","purpose":"Soins dentaires (devis lisible)"}')$$,
  'NOT_EDITABLE', 'un dossier rejeté ne se corrige plus par save_draft');
-- Pièce d’un brouillon audité : la consultation journalisée d’une pièce par une autre partie (X4) audite le brouillon.
select save_draft('{"id":"e3000000-0000-4000-8000-000000000006","vertical":"HEALTH","amountMinor":"50000","currency":"XAF",
  "purpose":"Consultation","beneficiaryReference":"MN","provider":{"name":"Cabinet Dr Ngo","invitedPhone":"+237 6 1111 0009"},
  "planType":"SINGLE","tranches":[{"label":"Consultation","amountMinor":"50000"}]}');
insert into t.ids select 'doc_q', (add_document('e3000000-0000-4000-8000-000000000006', 'QUOTE',
  'e3000000-0000-4000-8000-000000000006/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000)->>'id')::uuid;
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000009');
select get_document_access((select v from t.ids where k = 'doc_q'));
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000001');
select t.check(remove_document((select v from t.ids where k = 'doc_q')) = 'ARCHIVED', 'pièce d’un dossier audité archivée, pas supprimée');
select t.check((select count(*) from documents where tx_id = 'e3000000-0000-4000-8000-000000000006' and kind = 'QUOTE' and deleted_at is not null) = 1, 'ligne archivée conservée');
select t.check(not exists (select 1 from jsonb_array_elements(get_draft('e3000000-0000-4000-8000-000000000006')->'documents') d where d->>'kind' = 'QUOTE'),
  'pièce archivée absente du brouillon');
select t.admin();

-- ---------- Suppression d’un brouillon vierge ----------
select t.login('e1000000-0000-4000-8000-000000000001');
select save_draft('{"id":"e3000000-0000-4000-8000-000000000004","vertical":"RENT"}');
select delete_draft('e3000000-0000-4000-8000-000000000004');
select t.check(not exists (select 1 from transactions where id = 'e3000000-0000-4000-8000-000000000004'), 'brouillon vierge supprimé');
select t.admin();

-- ---------- Fonctions de démonstration (mock_mode = true) ----------
-- Chemin par défaut (lot X v2) : platform_review NEVER, règlement DIRECT (RENT).
select t.login('e1000000-0000-4000-8000-000000000002');
select save_draft('{"id":"e3000000-0000-4000-8000-000000000007","vertical":"RENT","amountMinor":"120000","currency":"XAF","purpose":"Loyer de novembre",
  "beneficiaryName":"Awa","counterpartyPhone":"+33611110001","provider":{"name":"Bailleur","invitedPhone":"+237611110003"},
  "planType":"SINGLE","tranches":[{"label":"Loyer","amountMinor":"120000"}]}');
select add_document('e3000000-0000-4000-8000-000000000007', 'LEASE', 'e3000000-0000-4000-8000-000000000007/LEASE/bail.pdf', 'bail.pdf', 'application/pdf', 1000);
select t.check((select status from transition_tx('e3000000-0000-4000-8000-000000000007', 'SUBMITTED')) = 'ACTIVE',
  'soumission sans revue (platform_review NEVER) : opération ACTIVE');
insert into t.ids select 'tr7', id from tranches where tx_id = 'e3000000-0000-4000-8000-000000000007';
select t.admin();
select t.check(exists (select 1 from audit_log where tx_id = 'e3000000-0000-4000-8000-000000000007' and event = 'AUTO_ACTIVATED' and to_status = 'ACTIVE')
           and (select status from tranches where id = (select v from t.ids where k = 'tr7')) = 'SUBMITTED'
           and exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr7') and revoked_at is null),
  'AUTO_ACTIVATED : demande due soumise, avec son jeton en DIRECT (lot X-C, T7)');
select t.check(not exists (select 1 from notifications where tx_id = 'e3000000-0000-4000-8000-000000000007' and event in ('TX_VALIDATED','TX_REJECTED'))
           and (select array_agg(user_id)::text from notifications where tx_id = 'e3000000-0000-4000-8000-000000000007' and event = 'PAYMENT_REQUEST_RECEIVED')
               = '{e1000000-0000-4000-8000-000000000001}',
  'sans revue : ni TX_VALIDATED ni TX_REJECTED ; PAYMENT_REQUEST_RECEIVED au payeur');
select t.login('e1000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'tr7'), 'PAID');
select t.admin();
select t.check((select status = 'PAID' and funds_state = 'NONE' from tranches where id = (select v from t.ids where k = 'tr7'))
           and exists (select 1 from release_events where tranche_id = (select v from t.ids where k = 'tr7') and trigger = 'DIRECT_PAYMENT')
           and (select status from transactions where id = 'e3000000-0000-4000-8000-000000000007') = 'CLOSED',
  'règlement DIRECT : paiement → PAID sans blocage (DIRECT_PAYMENT), opération close');
select t.login('e1000000-0000-4000-8000-000000000003');
select t.check((get_receipt((select v from t.ids where k = 'tr7'))->>'amountMinor')::bigint = 120000, 'règlement DIRECT : reçu disponible dès le paiement');
select t.admin();

select t.login('e1000000-0000-4000-8000-000000000002');
select save_draft('{"id":"e3000000-0000-4000-8000-000000000005","vertical":"RENT","amountMinor":"150000","currency":"XAF","purpose":"Loyer de décembre",
  "beneficiaryName":"Awa","counterpartyPhone":"+33611110001","provider":{"name":"Bailleur","invitedPhone":"+237611110003"},
  "planType":"SINGLE","tranches":[{"label":"Loyer","amountMinor":"150000"}]}');
select add_document('e3000000-0000-4000-8000-000000000005', 'LEASE', 'e3000000-0000-4000-8000-000000000005/LEASE/bail.pdf', 'bail.pdf', 'application/pdf', 1000);
select t.hint($$select demo_review('e3000000-0000-4000-8000-000000000005', true)$$, 'NOT_IN_REVIEW', 'demo_review sur un brouillon refusé');
select t.hint($$select demo_review('e3000000-0000-4000-8000-000000000003', true)$$, 'TX_NOT_FOUND', 'demo_review sur le dossier d’un autre refusé');
-- demo_review ne sert que pour un dossier en revue : RENT passe en revue ALWAYS pour ce dossier.
select t.admin();
update request_modules set platform_review = 'ALWAYS' where code = 'RENT';
select t.login('e1000000-0000-4000-8000-000000000002');
select transition_tx('e3000000-0000-4000-8000-000000000005', 'SUBMITTED');
select t.check((select status from demo_review('e3000000-0000-4000-8000-000000000005', true)) = 'ACTIVE', 'demo_review : validation jusqu’à ACTIVE');
select t.check((select status from tranches where tx_id = 'e3000000-0000-4000-8000-000000000005' and seq = 1) = 'SUBMITTED', 'demo_review : première tranche soumise (RG-12)');
select t.check((select count(*) from audit_log where tx_id = 'e3000000-0000-4000-8000-000000000005' and event = 'DEMO_REVIEW') = 2, 'demo_review écrit le journal d’audit');
insert into t.ids select 'tr5', id from tranches where tx_id = 'e3000000-0000-4000-8000-000000000005';
select t.admin();
select t.login('e1000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'tr5'), 'PAID');
select open_dispute((select v from t.ids where k = 'tr5'), 'Le bailleur conteste avoir reçu le loyer', 'NOT_DELIVERED');
select t.check((select status = 'RESOLVED' and outcome = 'REFUND_FULL' and refund_amount_minor = 150000 and refund_id is not null
                from demo_resolve_dispute((select v from t.ids where k = 'tr5'), 'REFUND_FULL', 'Remboursement simulé')), 'demo_resolve_dispute (remboursement total)');
select t.check((select count(*) from notifications where event = 'DISPUTE_RESOLVED' and payload->>'outcome' = 'REFUNDED' and tx_id = 'e3000000-0000-4000-8000-000000000005') = 1,
  'DISPUTE_RESOLVED (REFUNDED) reçu par le payeur');
select t.admin();
select t.check((select status from tranches where id = (select v from t.ids where k = 'tr5')) = 'PAID'
           and (select count(*) from refunds where tranche_id = (select v from t.ids where k = 'tr5') and amount_minor = 150000) = 1,
  'litige après paiement : remboursement créé, statut de la demande inchangé avant exécution');
select t.check((select resolved_by from disputes where tranche_id = (select v from t.ids where k = 'tr5')) in (select id from profiles where platform_role = 'ADMIN'),
  'demo_resolve_dispute : décision attribuée à un administrateur');
select t.login('e1000000-0000-4000-8000-000000000002');
select t.check(demo_reset() >= 2, 'demo_reset : dossiers de l’utilisateur supprimés');
select t.check(not exists (select 1 from transactions where created_by = auth.uid()), 'plus aucun dossier pour le demandeur');
select t.admin();
select t.check(not exists (select 1 from audit_log where tx_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000005',
                                                                   'e3000000-0000-4000-8000-000000000007'))
           and exists (select 1 from audit_log where tx_id = 'e3000000-0000-4000-8000-000000000002'),
  'demo_reset n’efface que le journal des dossiers de l’appelant');
select t.fails($$delete from audit_log where tx_id = 'e3000000-0000-4000-8000-000000000002'$$, 'journal d’audit toujours en ajout seul hors demo_reset');

-- ---------- mock_mode = false : simulation et démonstration refusées ----------
update app_config set value = 'false' where key = 'mock_mode';
select t.login('e1000000-0000-4000-8000-000000000001');
select t.hint($$select demo_review('e3000000-0000-4000-8000-000000000002', true)$$, 'DEMO_DISABLED', 'demo_review refusé hors mock_mode');
select t.hint($$select demo_resolve_dispute('e3000000-0000-4000-8000-000000000002', 'RELEASED', 'Note')$$, 'DEMO_DISABLED', 'demo_resolve_dispute refusé hors mock_mode');
select t.hint($$select demo_reset()$$, 'DEMO_DISABLED', 'demo_reset refusé hors mock_mode');
select t.hint($$select simulate_system_transition('e3000000-0000-4000-8000-000000000002', 'TOKEN_ISSUED')$$, 'DEMO_DISABLED', 'simulation système refusée hors mock_mode');
select t.hint($$select simulate_tranche_system((select id from tranches where tx_id = 'e3000000-0000-4000-8000-000000000002' limit 1), 'PAID')$$,
  'DEMO_DISABLED', 'paiement simulé refusé hors mock_mode');
select t.admin();
do $$ begin perform set_config('app.demo_reset', 'on', true); end $$;
select t.fails($$delete from audit_log where tx_id = 'e3000000-0000-4000-8000-000000000002'$$, 'hors mock_mode, même le drapeau de réinitialisation n’efface rien');

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
