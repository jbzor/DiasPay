-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 04_lotx_p2.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
-- Test des migrations 0009 à 0012 (lot X, passe 2 : X4 à X7). Même format que 03_lotx.sql : utilisateurs fictifs, rôles
-- réels (authenticated, anon), tout est annulé à la fin (ROLLBACK), le résumé échoue au moindre FAIL.
-- Prérequis : 0001 à 0012 appliquées, app_config.mock_mode = 'true' (projet de développement).
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
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- ---------- Jeu d’essai ----------
insert into auth.users(id, phone) values
 ('fa000000-0000-4000-8000-000000000001','33623330001'),   -- payeur (créateur des dossiers)
 ('fa000000-0000-4000-8000-000000000003','237623330003'),  -- prestataire des dossiers
 ('fa000000-0000-4000-8000-000000000004','237623330004'),  -- validateur
 ('fa000000-0000-4000-8000-000000000005','237623330005'),  -- second validateur
 ('fa000000-0000-4000-8000-000000000006','33623330006');   -- étranger
update profiles set platform_role = 'VALIDATOR' where id in ('fa000000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000005');
update profiles set primary_role = 'PROVIDER' where id = 'fa000000-0000-4000-8000-000000000003';
update app_config set value = 'true' where key = 'auto_issue_token';
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');

-- Brouillon complet du payeur fa..01, prestataire invité fa..03 (inscrit : rattaché par son numéro).
create function t.draft(p_id uuid, p_amount int) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', 'EDUCATION', 'amountMinor', p_amount::text, 'currency', 'XAF',
    'purpose', 'Scolarité (passe 2)', 'beneficiaryName', 'Awa',
    'provider', jsonb_build_object('name', 'Lycée (passe 2)', 'invitedPhone', '+237 6 2333 0003'), 'planType', 'SINGLE',
    'tranches', jsonb_build_array(jsonb_build_object('label', 'Inscription', 'amountMinor', p_amount::text, 'dueDate', (current_date + 2)::text)))
$$;
grant execute on function t.draft(uuid, int) to authenticated;

-- ===================== X4 : TrustVault =====================
-- ---------- Structure et droits (X4) ----------
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('add_document','document_reuse','get_document_access','dossier_checks','_norm_hash','_documents_guard',
                      '_documents_immutable','_hash_reuse')),
  'aucune fonction de 0009 (ni redéfinie) exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_norm_hash','_documents_guard','_documents_immutable','_hash_reuse')),
  'fonctions internes de 0009 non exécutables par authenticated');
select t.check((select count(*) from pg_proc where proname = 'add_document' and pronamespace = 'public'::regnamespace) = 1,
  'add_document : une seule signature (empreinte facultative)');
select t.check((select value from app_config where key = 'require_content_hash') = 'false', 'require_content_hash : false par défaut');

-- ---------- X4.1 Empreinte enregistrée avec la pièce ----------
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.draft('fa300000-0000-4000-8000-00000000000a', 100000));
select t.check((t.j($$select add_document('fa300000-0000-4000-8000-00000000000a', 'ENROLMENT_CERTIFICATE',
    'fa300000-0000-4000-8000-00000000000a/ENROLMENT_CERTIFICATE/a.pdf', 'a.pdf', 'application/pdf', 1000,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')$$)->>'contentHash') = repeat('a', 64),
  'empreinte enregistrée (normalisée en minuscules) et renvoyée');
select add_document('fa300000-0000-4000-8000-00000000000a', 'SCHOOL_SCHEDULE', 'fa300000-0000-4000-8000-00000000000a/SCHOOL_SCHEDULE/b.pdf',
  'b.pdf', 'application/pdf', 1000);
select t.hint($$select add_document('fa300000-0000-4000-8000-00000000000a', 'SCHOOL_SCHEDULE', 'fa300000-0000-4000-8000-00000000000a/SCHOOL_SCHEDULE/c.pdf',
  'c.pdf', 'application/pdf', 1000, 'abc')$$, 'HASH_INVALID', 'empreinte mal formée refusée');
select t.admin();
select t.check((select hash_algo from documents where storage_path like '%/a.pdf' and tx_id = 'fa300000-0000-4000-8000-00000000000a') = 'SHA-256'
           and (select content_hash is null and hash_algo is null from documents where storage_path like '%/b.pdf' and tx_id = 'fa300000-0000-4000-8000-00000000000a'),
  'algorithme SHA-256 ; pièce sans empreinte acceptée tant que le réglage ne l’exige pas');
update app_config set value = 'true' where key = 'require_content_hash';
select t.login('fa000000-0000-4000-8000-000000000001');
select t.hint($$select add_document('fa300000-0000-4000-8000-00000000000a', 'SCHOOL_SCHEDULE', 'fa300000-0000-4000-8000-00000000000a/SCHOOL_SCHEDULE/d.pdf',
  'd.pdf', 'application/pdf', 1000)$$, 'HASH_REQUIRED', 'require_content_hash = true : empreinte obligatoire');
select t.admin();
update app_config set value = 'false' where key = 'require_content_hash';
select t.hint($$update documents set content_hash = repeat('b', 64) where storage_path like '%/a.pdf' and tx_id = 'fa300000-0000-4000-8000-00000000000a'$$,
  'HASH_IMMUTABLE', 'empreinte immuable, même dans un brouillon (et même pour le propriétaire de la base)');
select t.hint($$update documents set content_hash = repeat('b', 64), hash_algo = 'SHA-256' where storage_path like '%/b.pdf' and tx_id = 'fa300000-0000-4000-8000-00000000000a'$$,
  'HASH_IMMUTABLE', 'une pièce enregistrée sans empreinte n’en reçoit pas après coup');

-- ---------- X4.4 Pièces d’un dossier soumis immuables ----------
select t.login('fa000000-0000-4000-8000-000000000001');
select transition_tx('fa300000-0000-4000-8000-00000000000a', 'SUBMITTED');
insert into t.ids select 'docA', id from documents where tx_id = 'fa300000-0000-4000-8000-00000000000a' and kind = 'ENROLMENT_CERTIFICATE';
select t.hint($$select remove_document((select v from t.ids where k = 'docA'))$$, 'NOT_EDITABLE', 'retrait refusé après soumission (inchangé)');
select t.admin();
select t.hint($$delete from documents where id = (select v from t.ids where k = 'docA')$$, 'DOCUMENT_LOCKED', 'suppression directe refusée après soumission');
select t.hint($$update documents set file_name = 'autre.pdf' where id = (select v from t.ids where k = 'docA')$$, 'DOCUMENT_LOCKED', 'modification directe refusée après soumission');
select t.hint($$update documents set deleted_at = now() where id = (select v from t.ids where k = 'docA')$$, 'DOCUMENT_LOCKED', 'archivage refusé après soumission');

-- ---------- X4.2 Réutilisation d’un justificatif ----------
-- Dossier B : même attestation (même empreinte) ; dossier C : autre pièce ; brouillon D : même empreinte, jamais soumis.
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.draft('fa300000-0000-4000-8000-00000000000b', 200000));
select add_document('fa300000-0000-4000-8000-00000000000b', 'ENROLMENT_CERTIFICATE', 'fa300000-0000-4000-8000-00000000000b/ENROLMENT_CERTIFICATE/a.pdf',
  'a.pdf', 'application/pdf', 1000, repeat('a', 64));
select transition_tx('fa300000-0000-4000-8000-00000000000b', 'SUBMITTED');
select save_draft(t.draft('fa300000-0000-4000-8000-00000000000c', 300000));
select add_document('fa300000-0000-4000-8000-00000000000c', 'ENROLMENT_CERTIFICATE', 'fa300000-0000-4000-8000-00000000000c/ENROLMENT_CERTIFICATE/c.pdf',
  'c.pdf', 'application/pdf', 1000, repeat('c', 64));
select transition_tx('fa300000-0000-4000-8000-00000000000c', 'SUBMITTED');
select save_draft(t.draft('fa300000-0000-4000-8000-00000000000d', 400000));
select add_document('fa300000-0000-4000-8000-00000000000d', 'ENROLMENT_CERTIFICATE', 'fa300000-0000-4000-8000-00000000000d/ENROLMENT_CERTIFICATE/a.pdf',
  'a.pdf', 'application/pdf', 1000, repeat('a', 64));
select t.check((select document_reuse(repeat('a', 64), 'fa300000-0000-4000-8000-00000000000b')) = jsonb_build_object('hash', repeat('a', 64), 'reused', true, 'count', 1),
  'partie : réutilisation signalée par un nombre seulement (ni référence, ni donnée de l’autre dossier)');
select t.check((document_reuse(repeat('c', 64), 'fa300000-0000-4000-8000-00000000000c')->>'count')::int = 0, 'pièce unique : aucune réutilisation');
select t.check((document_reuse(repeat('a', 64), 'fa300000-0000-4000-8000-00000000000d')->>'count')::int = 2,
  'brouillon : les deux dossiers soumis comptent ; les brouillons ne comptent jamais');
select t.hint($$select document_reuse('xyz')$$, 'HASH_INVALID', 'empreinte mal formée');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000006');
select t.hint($$select document_reuse(repeat('a', 64))$$, 'NOT_FOUND', 'étranger : aucune réponse sur une empreinte qu’il ne voit pas');
select t.hint($$select document_reuse(repeat('f', 64))$$, 'NOT_FOUND', 'étranger : même réponse pour une empreinte inconnue');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000004');
select t.check((select document_reuse(repeat('a', 64), 'fa300000-0000-4000-8000-00000000000b')->'references') = jsonb_build_array(_tx_ref('fa300000-0000-4000-8000-00000000000a')),
  'personnel : références des autres dossiers');
select t.check((select result from dossier_checks('fa300000-0000-4000-8000-00000000000b') where code = 'DOCUMENT_REUSED') = 'ATTENTION'
           and (select detail->'documents'->0->>'kind' from dossier_checks('fa300000-0000-4000-8000-00000000000b') where code = 'DOCUMENT_REUSED') = 'ENROLMENT_CERTIFICATE'
           and (select detail->'documents'->0->'references' from dossier_checks('fa300000-0000-4000-8000-00000000000b') where code = 'DOCUMENT_REUSED')
               = jsonb_build_array(_tx_ref('fa300000-0000-4000-8000-00000000000a')),
  'dossier_checks : DOCUMENT_REUSED (ATTENTION), type de pièce et référence');
select t.check((select result from dossier_checks('fa300000-0000-4000-8000-00000000000c') where code = 'DOCUMENT_REUSED') = 'OK', 'dossier_checks : pièce unique, OK');
select t.check((select array_agg(code order by code collate "C") from dossier_checks('fa300000-0000-4000-8000-00000000000c'))
               = array['DOCUMENTS','DOCUMENT_REUSED','DUPLICATE','PLAN_SUM','PROVIDER_VERIFIED'],
  'dossier_checks : contrôles existants inchangés, un de plus');

-- ---------- X4.3 Consultations journalisées pour chaque rôle ----------
select t.admin();
insert into storage.objects(bucket_id, name) values
  ('dossiers', 'fa300000-0000-4000-8000-00000000000a/ENROLMENT_CERTIFICATE/a.pdf'),
  ('dossiers', 'fa300000-0000-4000-8000-00000000000d/ENROLMENT_CERTIFICATE/a.pdf');
select t.login('fa000000-0000-4000-8000-000000000003');
select t.check((select count(*) from storage.objects where name like 'fa300000-0000-4000-8000-00000000000a/%') = 0,
  'stockage : illisible pour une partie sans consultation journalisée');
select t.check((get_document_access((select v from t.ids where k = 'docA'))->>'path') = 'fa300000-0000-4000-8000-00000000000a/ENROLMENT_CERTIFICATE/a.pdf',
  'get_document_access (prestataire) : chemin du fichier');
select t.check((select count(*) from storage.objects where name like 'fa300000-0000-4000-8000-00000000000a/%') = 1,
  'stockage : lisible par la partie après consultation journalisée');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000001');
select get_document_access((select v from t.ids where k = 'docA'));
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000004');
select get_document_access((select v from t.ids where k = 'docA'));
select t.admin();
select t.check((select array_agg(payload->>'role' order by id) from audit_log where tx_id = 'fa300000-0000-4000-8000-00000000000a' and event = 'DOCUMENT_VIEWED')
               = array['PROVIDER','PAYER','STAFF'],
  'DOCUMENT_VIEWED journalisé pour chaque rôle (prestataire, payeur, personnel)');
select t.check((select bool_and(payload->>'document_id' = (select v::text from t.ids where k = 'docA') and actor_id is not null and payload->>'kind' = 'ENROLMENT_CERTIFICATE')
                from audit_log where tx_id = 'fa300000-0000-4000-8000-00000000000a' and event = 'DOCUMENT_VIEWED'),
  'consultation : qui, quelle pièce (quand : horodatage de la ligne)');
select t.check(verify_audit('fa300000-0000-4000-8000-00000000000a'), 'journal chaîné toujours valide');
select t.check((select count(*) from notifications where tx_id = 'fa300000-0000-4000-8000-00000000000a' and event = 'DOCUMENT_VIEWED') = 0,
  'consultation : aucune alerte envoyée');
select t.login('fa000000-0000-4000-8000-000000000006');
select t.hint($$select get_document_access((select v from t.ids where k = 'docA'))$$, 'NOT_FOUND', 'étranger : pièce introuvable');
select t.check((select count(*) from storage.objects where name like 'fa300000-0000-4000-8000-00000000000a/%') = 0, 'stockage : illisible pour un tiers');
select t.admin();
-- Brouillon jamais audité : son créateur lit ses fichiers, sans journal (sinon le brouillon deviendrait insupprimable, D4).
insert into t.ids select 'docD', id from documents where tx_id = 'fa300000-0000-4000-8000-00000000000d';
select t.login('fa000000-0000-4000-8000-000000000001');
select get_document_access((select v from t.ids where k = 'docD'));
select t.check((select count(*) from storage.objects where name like 'fa300000-0000-4000-8000-00000000000d/%') = 1, 'brouillon : lisible par son créateur');
select t.check(not has_audit('fa300000-0000-4000-8000-00000000000d'), 'brouillon : consultation non journalisée, toujours supprimable');
select delete_draft('fa300000-0000-4000-8000-00000000000d');
select t.check(not exists (select 1 from transactions where id = 'fa300000-0000-4000-8000-00000000000d'), 'brouillon supprimé avec ses pièces');
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
