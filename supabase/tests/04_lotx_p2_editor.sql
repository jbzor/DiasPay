-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 04_lotx_p2.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
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
 ('fa000000-0000-4000-8000-000000000001','33623330001'),   -- payeur (créateur des dossiers)
 ('fa000000-0000-4000-8000-000000000003','237623330003'),  -- prestataire des dossiers
 ('fa000000-0000-4000-8000-000000000004','237623330004'),  -- validateur
 ('fa000000-0000-4000-8000-000000000005','237623330005'),  -- second validateur
 ('fa000000-0000-4000-8000-000000000006','33623330006'),   -- étranger
 ('fa000000-0000-4000-8000-000000000007','237623330007');  -- administrateur (remboursements)
update profiles set platform_role = 'VALIDATOR' where id in ('fa000000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000005');
update profiles set primary_role = 'PROVIDER' where id = 'fa000000-0000-4000-8000-000000000003';
update profiles set platform_role = 'ADMIN' where id = 'fa000000-0000-4000-8000-000000000007';
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
-- Brouillon d’un type de besoin donné (modules de test).
create function t.module_draft(p_id uuid, p_module text, p_amount int) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', p_module, 'amountMinor', p_amount::text, 'currency', 'XAF', 'purpose', 'Besoin (module de test)',
    'beneficiaryName', 'Awa', 'provider', jsonb_build_object('name', 'Lycée (passe 2)', 'invitedPhone', '+237 6 2333 0003'), 'planType', 'SINGLE',
    'tranches', jsonb_build_array(jsonb_build_object('label', 'Unique', 'amountMinor', p_amount::text, 'dueDate', (current_date + 2)::text)))
$$;
grant execute on function t.module_draft(uuid, text, int) to authenticated;

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

-- ===================== X5 : fondations des paiements =====================
-- Opération active (première demande soumise, à payer) : créée et soumise par le payeur fa..01. platform_review vaut NEVER
-- par défaut (K2) : la soumission active l’opération sans passer par le bureau.
create function t.active_dossier(p_draft jsonb, p_kind text default 'ENROLMENT_CERTIFICATE') returns void language plpgsql as $$
begin
  perform t.login('fa000000-0000-4000-8000-000000000001');
  perform save_draft(p_draft);
  perform add_document((p_draft->>'id')::uuid, p_kind, (p_draft->>'id') || '/' || p_kind || '/x.pdf', 'x.pdf', 'application/pdf', 1000);
  perform transition_tx((p_draft->>'id')::uuid, 'SUBMITTED');
  perform t.admin();
end $$;
-- Événement du partenaire simulé (contenu de PaymentPort.parseWebhook).
create function t.evt(p_type text, p_key text, p_amount bigint) returns jsonb language sql as $$
  select jsonb_build_object('type', p_type, 'idempotencyKey', p_key, 'amountMinor', p_amount, 'currency', 'XAF')
$$;
-- Journal déséquilibré écrit directement (propriétaire de la base) : refusé à la vérification des contraintes différées.
create function t.unbalanced(p_tranche uuid) returns void language plpgsql as $$
declare j uuid;
begin
  insert into ledger_journals(kind, tx_id, tranche_id) select 'PAYMENT', tx_id, id from tranches where id = p_tranche returning id into j;
  insert into ledger_entries(journal_id, account_code, currency, debit_minor) values (j, 'PARTNER_CASH', 'XAF', 100);
  insert into ledger_entries(journal_id, account_code, currency, credit_minor) values (j, 'DUE_TO_PROVIDER', 'XAF', 90);
  set constraints ledger_entries_balanced, ledger_journals_balanced immediate;
end $$;

-- ---------- Structure et droits (X5) ----------
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('start_payment','apply_payment_event','request_refund','demo_settle_payment','demo_settle_refund','_process_payment_event',
                      '_post_journal','_refunded','_ledger_on_release','_ledger_check_balanced','_ledger_immutable','_webhook_events_guard','_attempt_json')),
  'aucune fonction de 0010 exécutable par anon');
select t.check(not has_function_privilege('authenticated', 'apply_payment_event(text, text, boolean, jsonb)', 'execute')
           and has_function_privilege('service_role', 'apply_payment_event(text, text, boolean, jsonb)', 'execute'),
  'apply_payment_event réservée au service (ni anon, ni authenticated)');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_process_payment_event','_post_journal','_refunded','_ledger_on_release','_ledger_check_balanced','_ledger_immutable',
                      '_webhook_events_guard','_attempt_json')),
  'fonctions internes de 0010 non exécutables par authenticated');
select t.check(not exists (
  select 1 from unnest(array['payment_attempts','refunds','webhook_events','ledger_accounts','ledger_journals','ledger_entries']) tb, unnest(array['INSERT','UPDATE','DELETE']) pr
  where has_table_privilege('authenticated', tb, pr) or has_table_privilege('anon', tb, pr)),
  'paiements et journal financier : aucune écriture par le client');
select t.check((select array_agg(code order by code) from ledger_accounts) = array['DUE_TO_PROVIDER','FEES','PARTNER_CASH','REFUNDS_PAYABLE'],
  'plan de comptes minimal (fonds chez le partenaire, dû au prestataire, remboursements, frais)');

-- ---------- Dossier E : deux tranches ----------
select t.active_dossier(jsonb_build_object('id','fa300000-0000-4000-8000-00000000000e','vertical','EDUCATION','amountMinor','300000','currency','XAF',
  'purpose','Scolarité (paiements)','beneficiaryName','Awa','provider', jsonb_build_object('name','Lycée (passe 2)','invitedPhone','+237 6 2333 0003'),
  'planType','PARTIAL','tranches', jsonb_build_array(jsonb_build_object('label','Inscription','amountMinor','100000','dueDate',(current_date + 2)::text),
                                                    jsonb_build_object('label','Solde','amountMinor','200000','dueDate',(current_date + 90)::text))));
insert into t.ids select 'e1', id from tranches where tx_id = 'fa300000-0000-4000-8000-00000000000e' and seq = 1;
insert into t.ids select 'e2', id from tranches where tx_id = 'fa300000-0000-4000-8000-00000000000e' and seq = 2;
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-00000000000e') = 'ACTIVE'
           and (select status from tranches where id = (select v from t.ids where k = 'e1')) = 'SUBMITTED'
           and (select status from tranches where id = (select v from t.ids where k = 'e2')) = 'DRAFT',
  'opération E active, demande 1 soumise (à payer), demande 2 programmée');

-- ---------- X5.2 Tentatives et idempotence ----------
select t.login('fa000000-0000-4000-8000-000000000001');
insert into t.ids select 'att1', (start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0001')->>'id')::uuid;
select t.check((select status = 'PENDING' and provider = 'SIMULATED' and amount_minor = 100000 and provider_ref like 'SIM-%'
                from payment_attempts where id = (select v from t.ids where k = 'att1'))
           and (select status from tranches where id = (select v from t.ids where k = 'e1')) = 'ACCEPTED',
  'start_payment : tentative en cours, montant de la demande, demande acceptée (ACCEPTED)');
insert into t.res values ('att1b', start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0001'));
select t.check((select (v->>'id')::uuid from t.res where k = 'att1b') = (select v from t.ids where k = 'att1')
           and (select count(*) from payment_attempts where tranche_id = (select v from t.ids where k = 'e1')) = 1,
  'même clé rejouée : même tentative, aucun nouveau paiement');
select t.hint($$select start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0002')$$, 'PAYMENT_IN_PROGRESS', 'autre clé pendant une tentative en cours');
select t.hint($$select start_payment((select v from t.ids where k = 'e2'), 'cle-e1-0001')$$, 'IDEMPOTENCY_CONFLICT', 'même clé pour une autre tranche');
select t.hint($$select start_payment((select v from t.ids where k = 'e1'), 'court')$$, 'VALIDATION', 'clé trop courte');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000003');
select t.hint($$select start_payment((select v from t.ids where k = 'e1'), 'cle-prestataire-1')$$, 'PAYER_ONLY', 'le prestataire ne paie pas');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000006');
select t.hint($$select start_payment((select v from t.ids where k = 'e1'), 'cle-etranger-01')$$, 'TRANCHE_NOT_FOUND', 'étranger : tranche introuvable');
select t.check((select count(*) from payment_attempts where tx_id = 'fa300000-0000-4000-8000-00000000000e') = 0, 'étranger : tentatives illisibles (RLS)');
select t.admin();
select t.fails($$insert into payment_attempts(tx_id, tranche_id, idempotency_key, provider, method, amount_minor, currency)
  select tx_id, id, 'cle-doublon-001', 'SIMULATED', 'SIMULATED', amount_minor, 'XAF' from tranches where id = (select v from t.ids where k = 'e1')$$,
  'au plus une tentative en cours ou réussie par tranche (index unique)');

-- ---------- X5.3 Événements du partenaire ----------
insert into t.res values ('evt1', apply_payment_event('SIMULATED', 'evt-e1-1', false, t.evt('PAYMENT_SUCCEEDED', 'cle-e1-0001', 100000)));
select t.check((select v->>'result' from t.res where k = 'evt1') = 'INVALID_SIGNATURE'
           and (select status from payment_attempts where id = (select v from t.ids where k = 'att1')) = 'PENDING'
           and (select processed_at is not null and result = 'INVALID_SIGNATURE' from webhook_events where event_id = 'evt-e1-1'),
  'signature invalide : événement enregistré, jamais appliqué');
select t.check((apply_payment_event('SIMULATED', 'evt-e1-2', true, t.evt('PAYMENT_SUCCEEDED', 'cle-e1-0001', 999))->>'error') = 'AMOUNT_MISMATCH'
           and (select status from payment_attempts where id = (select v from t.ids where k = 'att1')) = 'PENDING',
  'montant différent : événement rejeté');
select t.check((apply_payment_event('SIMULATED', 'evt-e1-x', true, t.evt('PAYMENT_SUCCEEDED', 'cle-inconnue-9', 100000))->>'error') = 'UNKNOWN_ATTEMPT',
  'tentative inconnue : événement rejeté');
insert into t.res values ('evt3', apply_payment_event('SIMULATED', 'evt-e1-3', true, t.evt('PAYMENT_SUCCEEDED', 'cle-e1-0001', 100000)));
select t.check((select v->>'result' from t.res where k = 'evt3') = 'APPLIED'
           and (select status from payment_attempts where id = (select v from t.ids where k = 'att1')) = 'SUCCEEDED'
           and (select status = 'PAID' and funds_state = 'NONE' and paid_at is not null from tranches where id = (select v from t.ids where k = 'e1'))
           and (select count(*) from payments where tranche_id = (select v from t.ids where k = 'e1') and status = 'SUCCEEDED' and provider = 'SIMULATED') = 1,
  'paiement réussi : tentative réussie, demande payée (PAID, règlement direct : aucun fonds bloqué), paiement enregistré');
select t.check((select count(*) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1') and kind = 'PAYMENT') = 1
           and (select sum(debit_minor) from ledger_entries e join ledger_journals j on j.id = e.journal_id where j.tranche_id = (select v from t.ids where k = 'e1') and e.account_code = 'PARTNER_CASH') = 100000
           and (select sum(credit_minor) from ledger_entries e join ledger_journals j on j.id = e.journal_id where j.tranche_id = (select v from t.ids where k = 'e1') and e.account_code = 'DUE_TO_PROVIDER') = 100000,
  'journal financier : fonds chez le partenaire au débit, dû au prestataire au crédit');
select t.check((select trigger from release_events where tranche_id = (select v from t.ids where k = 'e1')) = 'DIRECT_PAYMENT'
           and (select array_agg(kind order by kind) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1')) = array['PAYMENT','RELEASE'],
  'règlement direct : événement DIRECT_PAYMENT, paiement puis versement au prestataire au journal');
insert into t.res values ('evt3b', apply_payment_event('SIMULATED', 'evt-e1-3', true, t.evt('PAYMENT_SUCCEEDED', 'cle-e1-0001', 100000)));
select t.check((select v - 'eventId' from t.res where k = 'evt3b') = '{"result":"DUPLICATE","original":"APPLIED"}'::jsonb
           and (select count(*) from webhook_events where event_id = 'evt-e1-3') = 1
           and (select count(*) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1')) = 2,
  'événement en double (même identifiant) : DUPLICATE, rien de plus (toujours un paiement et un versement au journal)');
insert into t.res values ('evt4', apply_payment_event('SIMULATED', 'evt-e1-4', true, t.evt('PAYMENT_SUCCEEDED', 'cle-e1-0001', 100000)));
select t.check((select v->>'error' from t.res where k = 'evt4') = 'ALREADY_APPLIED'
           and (select count(*) from payments where tranche_id = (select v from t.ids where k = 'e1')) = 1,
  'même paiement annoncé deux fois (autre identifiant) : ignoré');
insert into t.res values ('evt0', apply_payment_event('SIMULATED', 'evt-e1-0', true, t.evt('PAYMENT_PENDING', 'cle-e1-0001', 100000)));
insert into t.res values ('evt5', apply_payment_event('SIMULATED', 'evt-e1-5', true, t.evt('PAYMENT_FAILED', 'cle-e1-0001', 100000)));
select t.check((select v->>'result' from t.res where k = 'evt0') = 'IGNORED'
           and (select v->>'error' from t.res where k = 'evt5') = 'CONTRADICTS_FINAL_STATE'
           and (select status from payment_attempts where id = (select v from t.ids where k = 'att1')) = 'SUCCEEDED',
  'hors d’ordre : « en cours » reçu après la réussite ignoré, échec contradictoire rejeté ; la réussite reste');
select t.login('fa000000-0000-4000-8000-000000000001');
select t.check((start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0001')->>'status') = 'SUCCEEDED', 'même clé après la réussite : même résultat');
select t.hint($$select start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0003')$$, 'NOT_PAYABLE', 'nouvelle clé sur une demande payée');
select t.check((select count(*) from ledger_entries) = 0 and (select count(*) from webhook_events) = 0, 'payeur : journal financier et événements illisibles (personnel seulement)');
select t.admin();

-- ---------- X5.4 Journal immuable et équilibré ----------
select t.hint($$update ledger_entries set credit_minor = 1 where journal_id in (select id from ledger_journals where tranche_id = (select v from t.ids where k = 'e1'))
  and credit_minor > 0$$, 'LEDGER_IMMUTABLE', 'ligne du journal non modifiable (même par le propriétaire de la base)');
select t.hint($$delete from ledger_journals where tranche_id = (select v from t.ids where k = 'e1')$$, 'LEDGER_IMMUTABLE', 'journal non supprimable');
select t.hint($$update webhook_events set payload = '{}' where event_id = 'evt-e1-3'$$, 'LEDGER_IMMUTABLE', 'événement reçu non modifiable');
select t.hint($$select t.unbalanced((select v from t.ids where k = 'e1'))$$, 'LEDGER_UNBALANCED', 'journal déséquilibré refusé');

-- ---------- X5.4 Remboursements : partiel puis total, jamais au-delà ----------
select t.login('fa000000-0000-4000-8000-000000000004');
select t.hint($$select request_refund((select v from t.ids where k = 'e1'), 30000, 'remb-e1-0001', 'Trop perçu')$$, 'ADMIN_ONLY', 'remboursement : administrateur seulement');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000007');
insert into t.ids select 'r1', (request_refund((select v from t.ids where k = 'e1'), 30000, 'remb-e1-0001', 'Trop perçu')->>'id')::uuid;
insert into t.res values ('r1b', request_refund((select v from t.ids where k = 'e1'), 30000, 'remb-e1-0001', 'Trop perçu'));
select t.check((select (v->>'id')::uuid from t.res where k = 'r1b') = (select v from t.ids where k = 'r1')
           and (select count(*) from refunds where tranche_id = (select v from t.ids where k = 'e1')) = 1, 'même clé : même remboursement (jamais deux)');
select t.hint($$select request_refund((select v from t.ids where k = 'e1'), 40000, 'remb-e1-0001', 'Trop perçu')$$, 'IDEMPOTENCY_CONFLICT', 'même clé, autre montant');
select t.hint($$select request_refund((select v from t.ids where k = 'e1'), 80000, 'remb-e1-0002', 'Annulation')$$, 'REFUND_EXCEEDS_PAID', 'partiel puis au-delà du reste : refusé');
insert into t.ids select 'r2', (request_refund((select v from t.ids where k = 'e1'), 70000, 'remb-e1-0003', 'Annulation du reste')->>'id')::uuid;
select t.hint($$select request_refund((select v from t.ids where k = 'e1'), 1, 'remb-e1-0004', 'Encore')$$, 'REFUND_EXCEEDS_PAID', 'après le total : plus rien');
insert into t.res values ('r1', demo_settle_refund((select v from t.ids where k = 'r1')));
insert into t.res values ('r2', demo_settle_refund((select v from t.ids where k = 'r2')));
select t.check((select v->>'result' from t.res where k = 'r1') = 'APPLIED'
           and (select v->>'result' from t.res where k = 'r2') = 'APPLIED', 'remboursements versés par le partenaire (même chemin d’événements)');
select t.admin();
select t.check((select array_agg(kind order by created_at, kind) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1'))
               @> array['PAYMENT','REFUND_REQUESTED','REFUND_SETTLED']
           and (select bool_and(reverses_journal_id is not null) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1') and kind like 'REFUND%'),
  'remboursement : contrepassations liées au paiement d’origine, jamais une modification');
select t.check((select status = 'REFUNDED' and refunded_minor = 100000 from tranches where id = (select v from t.ids where k = 'e1'))
           and exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'e1') and event = 'REQUEST_REFUNDED'
                       and payload->>'tranche_from' = 'PAID' and payload->>'tranche_to' = 'REFUNDED'),
  'remboursements versés : demande PAID → REFUNDED, refunded_minor = montant remboursé (100 000)');
select t.check((select sum(e.debit_minor) = sum(e.credit_minor) from ledger_entries e join ledger_journals j on j.id = e.journal_id
                where j.tranche_id = (select v from t.ids where k = 'e1'))
           and (select coalesce(sum(e.credit_minor), 0) - coalesce(sum(e.debit_minor), 0) from ledger_entries e join ledger_journals j on j.id = e.journal_id
                where j.tranche_id = (select v from t.ids where k = 'e1') and e.account_code = 'REFUNDS_PAYABLE') = 0,
  'règlement direct remboursé en totalité : journal de la demande équilibré, remboursements dus soldés');
select t.check((select status from payments where tranche_id = (select v from t.ids where k = 'e1')) = 'REFUNDED', 'paiement marqué remboursé');

-- ---------- X2.6 + X5 : règlement direct par le même chemin (l’ancien mode IMMEDIATE devient settlement_mode = DIRECT) ----------
select t.fails($$update tranches set release_mode = 'IMMEDIATE' where id = (select v from t.ids where k = 'e2')$$,
  'mode IMMEDIATE refusé (contrainte) : remplacé par le règlement direct');
select t.login('fa000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'e2'), 'SUBMITTED');
insert into t.ids select 'att2', (start_payment((select v from t.ids where k = 'e2'), 'cle-e2-0001')->>'id')::uuid;
insert into t.res values ('att2', demo_settle_payment((select v from t.ids where k = 'att2')));
select t.check((select v->>'result' from t.res where k = 'att2') = 'APPLIED'
           and (select status = 'PAID' and funds_state = 'NONE' from tranches where id = (select v from t.ids where k = 'e2')),
  'DIRECT : demande soumise plus tôt, le paiement simulé (événement) la règle directement (PAID, aucun fonds bloqué)');
select t.admin();
select t.check((select trigger from release_events where tranche_id = (select v from t.ids where k = 'e2')) = 'DIRECT_PAYMENT'
           and (select array_agg(kind order by kind) from ledger_journals where tranche_id = (select v from t.ids where k = 'e2')) = array['PAYMENT','RELEASE'],
  'réglé : événement DIRECT_PAYMENT, versement au prestataire au journal');
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-00000000000e') = 'CLOSED',
  'opération E close : toutes ses demandes dans un état final (remboursée, payée)');

-- ---------- X5 : règlement conditionnel (CONDITIONAL : fonds bloqués, libération, remboursement) ----------
select t.login('fa000000-0000-4000-8000-000000000007');
insert into request_modules(code, label_fr, label_en, enabled, wave, release_mode, contest_hours, settlement_mode, required_documents, display_order)
values ('TEST_COND', 'Module conditionnel', 'Conditional module', true, 1, 'PAYER_CONFIRM', 24, 'CONDITIONAL',
        '[{"kind":"INVOICE","required":true,"maxFiles":1,"labels":{"fr":"Facture","en":"Invoice"}}]', 89);
select t.admin();
select t.active_dossier(t.module_draft('fa300000-0000-4000-8000-0000000000e1', 'TEST_COND', 80000), 'INVOICE');
select t.active_dossier(t.module_draft('fa300000-0000-4000-8000-0000000000e2', 'TEST_COND', 90000), 'INVOICE');
insert into t.ids select 'k1', id from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000e1';
insert into t.ids select 'l1', id from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000e2';
select t.login('fa000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'k1'), 'PAID');
select simulate_tranche_system((select v from t.ids where k = 'l1'), 'PAID');
select t.admin();
select t.check((select settlement_mode from transactions where id = 'fa300000-0000-4000-8000-0000000000e1') = 'CONDITIONAL'
           and (select status = 'PAID' and funds_state = 'HELD' from tranches where id = (select v from t.ids where k = 'k1'))
           and (select array_agg(kind) from ledger_journals where tranche_id = (select v from t.ids where k = 'k1')) = array['PAYMENT']
           and not exists (select 1 from release_events where tranche_id = (select v from t.ids where k = 'k1')),
  'CONDITIONAL : paiement réussi, demande payée, fonds bloqués (HELD), paiement seul au journal');
select t.login('fa000000-0000-4000-8000-000000000007');
insert into t.ids select 'rk', (request_refund((select v from t.ids where k = 'k1'), 80000, 'remb-k1-0001', 'Annulation')->>'id')::uuid;
select demo_settle_refund((select v from t.ids where k = 'rk'));
select t.admin();
select t.check(not exists (
  select 1 from ledger_entries e join ledger_journals j on j.id = e.journal_id where j.tranche_id = (select v from t.ids where k = 'k1')
  group by e.account_code having sum(e.debit_minor) <> sum(e.credit_minor))
           and (select status = 'REFUNDED' and refunded_minor = 80000 from tranches where id = (select v from t.ids where k = 'k1')),
  'fonds bloqués remboursés en totalité : chaque compte de la demande revient à zéro, demande REFUNDED');
select t.login('fa000000-0000-4000-8000-000000000001');
select confirm_service((select v from t.ids where k = 'l1'));
select approve_release((select v from t.ids where k = 'l1'));
select t.admin();
select t.check((select status = 'PAID' and funds_state = 'RELEASED' from tranches where id = (select v from t.ids where k = 'l1'))
           and (select array_agg(kind order by kind) from ledger_journals where tranche_id = (select v from t.ids where k = 'l1')) = array['PAYMENT','RELEASE'],
  'CONDITIONAL : fonds libérés après confirmation (RELEASED), versement au prestataire au journal');
select t.login('fa000000-0000-4000-8000-000000000007');
select t.hint($$select request_refund((select v from t.ids where k = 'l1'), 1000, 'remb-l1-0001', 'Trop tard')$$, 'NOT_REFUNDABLE',
  'fonds conditionnels libérés au prestataire : remboursement refusé');
select t.admin();

-- ---------- Dossier F : échec puis nouvelle tentative ----------
select t.active_dossier(t.draft('fa300000-0000-4000-8000-0000000000f0', 50000));
insert into t.ids select 'f1', id from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000f0';
select t.login('fa000000-0000-4000-8000-000000000001');
insert into t.ids select 'attf1', (start_payment((select v from t.ids where k = 'f1'), 'cle-f1-0001')->>'id')::uuid;
insert into t.res values ('attf1', demo_settle_payment((select v from t.ids where k = 'attf1'), 'FAILED'));
select t.check((select v->>'result' from t.res where k = 'attf1') = 'APPLIED'
           and (select status = 'FAILED' and error_code = 'SIMULATED_DECLINE' from payment_attempts where id = (select v from t.ids where k = 'attf1'))
           and (select status from tranches where id = (select v from t.ids where k = 'f1')) = 'SUBMITTED',
  'échec du paiement : tentative échouée, demande de nouveau à payer (ACCEPTED → SUBMITTED)');
insert into t.ids select 'attf2', (start_payment((select v from t.ids where k = 'f1'), 'cle-f1-0002')->>'id')::uuid;
select demo_settle_payment((select v from t.ids where k = 'attf2'));
select t.check((select status from tranches where id = (select v from t.ids where k = 'f1')) = 'PAID', 'nouvelle tentative après un échec : payée');
select t.check((select count(*) from v_reconciliation) = 0, 'rapprochement : réservé au personnel');
select t.admin();

-- ---------- X5.5 Rapprochement ----------
select t.active_dossier(t.draft('fa300000-0000-4000-8000-0000000000f1', 60000));
insert into t.ids select 'g1', id from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000f1';
select t.login('fa000000-0000-4000-8000-000000000001');
insert into t.ids select 'attg', (start_payment((select v from t.ids where k = 'g1'), 'cle-g1-0001')->>'id')::uuid;
select t.admin();
-- Écart volontaire : tentative marquée réussie en base, sans événement du partenaire ni écriture.
update payment_attempts set status = 'SUCCEEDED' where id = (select v from t.ids where k = 'attg');
select t.login('fa000000-0000-4000-8000-000000000004');
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'attg'))
               = array['SUCCEEDED_WITHOUT_EVENT','SUCCEEDED_WITHOUT_LEDGER','TRANCHE_NOT_PAID'],
  'écart volontaire détecté : réussite sans événement, sans écriture, tranche non payée');
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'att2')) = '{}'
           and (select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'attf1')) = '{}'
           and (select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'attf2')) = '{}',
  'paiements cohérents : aucun écart (y compris la tentative échouée suivie d’une réussite)');
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'att1')) = array['EVENT_REJECTED']
           and (select tranche_status from v_reconciliation where attempt_id = (select v from t.ids where k = 'att1')) = 'REFUNDED',
  'demande remboursée (REFUNDED) : pas d’écart de statut ; événements rejetés (montant, état contradictoire) : signalés');
select t.check((select issues from v_reconciliation where tranche_id = (select v from t.ids where k = 'k1')) = '{}'
           and (select funds_state from v_reconciliation where tranche_id = (select v from t.ids where k = 'l1')) = 'RELEASED'
           and (select issues from v_reconciliation where tranche_id = (select v from t.ids where k = 'l1')) = '{}',
  'règlement conditionnel cohérent (remboursé, libéré) : aucun écart ; état des fonds exposé');
select t.admin();
-- Écart volontaire : remboursement versé, demande remise à PAID (propriétaire de la base, hors des fonctions).
select set_config('app.via_transition', 'on', true);
update tranches set status = 'PAID' where id = (select v from t.ids where k = 'e1');
select set_config('app.via_transition', 'off', true);
select t.login('fa000000-0000-4000-8000-000000000004');
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'att1')) = array['REFUNDED_TRANCHE_OPEN','EVENT_REJECTED'],
  'écart volontaire : remboursement versé mais demande non marquée remboursée, signalé (REFUNDED_TRANCHE_OPEN)');
select t.admin();

-- ===================== X6 : types de besoin configurables =====================
-- ---------- Structure, amorçage et droits (X6) ----------
select t.check((select count(*) from request_modules) >= 6
           and (select array_agg(code order by display_order) from request_modules where code in ('EDUCATION','HEALTH','RENT','AGRO','REAL_ESTATE','LAND'))
               = array['EDUCATION','HEALTH','RENT','AGRO','REAL_ESTATE','LAND'],
  'request_modules : les six types de besoin, dans l’ordre d’affichage');
select t.check((select bool_and(enabled = (code in ('EDUCATION','HEALTH','RENT')) and wave = case when code in ('EDUCATION','HEALTH','RENT') then 1 else 2 end
                         and platform_review = 'NEVER' and not multiple_payers)
                from request_modules where code in ('EDUCATION','HEALTH','RENT','AGRO','REAL_ESTATE','LAND'))
           and (select column_default from information_schema.columns where table_name = 'request_modules' and column_name = 'platform_review') like '''NEVER''%',
  'amorçage : vague 1 ouverte, vague 2 fermée, platform_review NEVER (défaut de la colonne et lignes existantes, K2) et un seul payeur partout');
select t.check((select bool_and(settlement_mode::text = case when code in ('EDUCATION','HEALTH','RENT') then 'DIRECT' else 'CONDITIONAL' end
                         and request_expiry_days is null)
                from request_modules where code in ('EDUCATION','HEALTH','RENT','AGRO','REAL_ESTATE','LAND'))
           and not exists (select 1 from request_modules where release_mode = 'IMMEDIATE'),
  'amorçage : vague 1 en règlement direct, vague 2 en conditionnel ; aucune expiration configurée ; plus de mode IMMEDIATE');
select t.check((select string_agg(vertical || ':' || release_mode || ':' || contest_hours || ':' || dual_validation, ',' order by vertical) from release_rules
                where vertical in ('EDUCATION','HEALTH','RENT','AGRO','REAL_ESTATE','LAND'))
               = 'AGRO:PAYER_CONFIRM:72:false,EDUCATION:PROVIDER_CONFIRM:72:false,HEALTH:PROVIDER_CONFIRM:48:false,LAND:EVIDENCE_REVIEW:0:true,'
                 || 'REAL_ESTATE:EVIDENCE_REVIEW:0:true,RENT:PROVIDER_CONFIRM:72:false',
  'release_rules (vue sur request_modules) : valeurs inchangées');
select t.check((select relkind from pg_class where oid = 'public.release_rules'::regclass) = 'v'
           and (select relkind from pg_class where oid = 'public.required_documents'::regclass) = 'v'
           and to_regclass('public._release_rules_0003') is not null and to_regclass('public._required_documents_0005') is not null,
  'release_rules et required_documents : vues ; anciennes tables conservées (réversibilité)');
select t.check((select string_agg(vertical || ':' || kind || ':' || required, ',' order by vertical, kind) from required_documents
                where vertical in ('EDUCATION','HEALTH','RENT'))
               = 'EDUCATION:ENROLMENT_CERTIFICATE:true,EDUCATION:SCHOOL_SCHEDULE:false,HEALTH:BENEFICIARY_ID:true,HEALTH:MEDICAL_CERTIFICATE:false,'
                 || 'HEALTH:QUOTE:true,RENT:LAST_RECEIPT:false,RENT:LEASE:true',
  'required_documents (vue) : pièces de la vague 1 inchangées (décision D2)');
select t.check((select data_type from information_schema.columns where table_name = 'transactions' and column_name = 'vertical') = 'text'
           and exists (select 1 from pg_constraint where conname = 'transactions_vertical_module_fk'),
  'transactions.vertical : texte, référencé par request_modules(code)');
select t.fails($$insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
  values (gen_random_uuid(), 'INCONNU', 'Essai', 1000, 'XAF', 'fa000000-0000-4000-8000-000000000001')$$, 'type de besoin inconnu refusé (clé étrangère)');
select t.check(to_regclass('public.bo_dossiers') is not null and to_regclass('public.bo_evidence_queue') is not null and to_regclass('public.bo_disputes') is not null
           and (select bool_and(reloptions @> array['security_invoker=true']) from pg_class where relname in ('bo_dossiers','bo_evidence_queue','bo_disputes')),
  'vues du bureau recréées (security_invoker)');
select t.check(not has_function_privilege('authenticated', '_platform_review(uuid)', 'execute')
           and not has_function_privilege('anon', 'needs_platform_review(uuid)', 'execute')
           and has_function_privilege('authenticated', 'needs_platform_review(uuid)', 'execute'),
  'needs_platform_review : utilisateurs connectés ; décision interne réservée');

-- ---------- Un type de besoin s’ajoute par une ligne de données ----------
select t.login('fa000000-0000-4000-8000-000000000001');
select t.fails($$insert into request_modules(code, label_fr, label_en, release_mode) values ('PIRATE', 'Pirate', 'Pirate', 'PAYER_CONFIRM')$$,
  'un utilisateur ne crée pas de type de besoin');
select t.check(t.n_updated($$update request_modules set enabled = true where code = 'AGRO'$$) = 0, 'un utilisateur ne modifie pas un type de besoin');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000007');
insert into request_modules(code, label_fr, label_en, enabled, wave, release_mode, contest_hours, platform_review, required_documents, display_order)
values ('TEST_NEVER', 'Module de test', 'Test module', true, 1, 'PAYER_CONFIRM', 24, 'NEVER',
        '[{"kind":"INVOICE","required":true,"maxFiles":1,"labels":{"fr":"Facture","en":"Invoice"}}]', 90),
       ('TEST_RISK', 'Module à risque', 'Risk module', true, 1, 'PROVIDER_CONFIRM', 48, 'RISK_BASED',
        '[{"kind":"INVOICE","required":true,"maxFiles":3,"labels":{"fr":"Facture","en":"Invoice"}}]', 91);
select t.hint($$insert into request_modules(code, label_fr, label_en, release_mode, required_documents)
  values ('TEST_BAD', 'Mauvais', 'Bad', 'AUTO', '[{"kind":"x","required":true}]')$$, 'VALIDATION', 'pièce de module mal décrite refusée');
select t.admin();

-- NEVER (défaut) : activation automatique, journalisée ; pièces et règle de déblocage lues dans le module.
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000a1', 'TEST_NEVER', 40000));
select t.check((select release_mode::text || ':' || contest_hours from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000a1') = 'PAYER_CONFIRM:24',
  'règle de déblocage lue dans le module');
select t.hint($$select transition_tx('fa300000-0000-4000-8000-0000000000a1', 'SUBMITTED')$$, 'TX_NO_DOCUMENT', 'aucune pièce : refus (inchangé)');
select add_document('fa300000-0000-4000-8000-0000000000a1', 'OTHER', 'fa300000-0000-4000-8000-0000000000a1/OTHER/o.pdf', 'o.pdf', 'application/pdf', 1000);
select t.hint($$select transition_tx('fa300000-0000-4000-8000-0000000000a1', 'SUBMITTED')$$, 'DOCUMENT_REQUIRED', 'pièce obligatoire du module manquante');
select add_document('fa300000-0000-4000-8000-0000000000a1', 'INVOICE', 'fa300000-0000-4000-8000-0000000000a1/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select t.hint($$select add_document('fa300000-0000-4000-8000-0000000000a1', 'INVOICE', 'fa300000-0000-4000-8000-0000000000a1/INVOICE/j.pdf', 'j.pdf', 'application/pdf', 1000)$$,
  'TOO_MANY_FILES', 'nombre maximal de fichiers lu dans le module (1)');
select t.check(not needs_platform_review('fa300000-0000-4000-8000-0000000000a1'), 'NEVER : pas de revue par le bureau');
select transition_tx('fa300000-0000-4000-8000-0000000000a1', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000a1') = 'ACTIVE'
           and exists (select 1 from audit_log where tx_id = 'fa300000-0000-4000-8000-0000000000a1' and event = 'AUTO_ACTIVATED'
                       and from_status = 'DRAFT' and to_status = 'ACTIVE' and actor_id = 'fa000000-0000-4000-8000-000000000001' and payload->>'mode' = 'NEVER')
           and not exists (select 1 from validations where tx_id = 'fa300000-0000-4000-8000-0000000000a1')
           and (select status from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000a1') = 'SUBMITTED',
  'NEVER : activation automatique à la soumission (AUTO_ACTIVATED, DRAFT → ACTIVE), sans validateur ; demande due soumise');
select t.check(exists (select 1 from notifications where tx_id = 'fa300000-0000-4000-8000-0000000000a1' and event = 'PAYMENT_READY'
                       and user_id = 'fa000000-0000-4000-8000-000000000001')
           and not exists (select 1 from notifications where tx_id = 'fa300000-0000-4000-8000-0000000000a1' and event = 'TX_VALIDATED'),
  'NEVER : alerte de demande à payer au payeur ; aucune alerte de validation (aucune décision du bureau)');
-- NEVER au seuil de double validation : toujours le bureau (double validation toujours appliquée).
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000a2', 'TEST_NEVER', 3000000));
select add_document('fa300000-0000-4000-8000-0000000000a2', 'INVOICE', 'fa300000-0000-4000-8000-0000000000a2/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select transition_tx('fa300000-0000-4000-8000-0000000000a2', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000a2') = 'PENDING_REVIEW'
           and (_platform_review('fa300000-0000-4000-8000-0000000000a2')->'reasons') = '["DUAL_VALIDATION"]'
           and required_validations('fa300000-0000-4000-8000-0000000000a2') = 2,
  'NEVER au seuil : file du bureau, deux validateurs exigés');

-- RISK_BASED : automatique sauf seuil de montant absent ou atteint, première demande ou doublon.
-- Seuil absent (point ouvert 4) : revue par prudence.
delete from app_config where key = 'risk_review_threshold';
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000b0', 'TEST_RISK', 15000));
select add_document('fa300000-0000-4000-8000-0000000000b0', 'INVOICE', 'fa300000-0000-4000-8000-0000000000b0/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select transition_tx('fa300000-0000-4000-8000-0000000000b0', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000b0') = 'PENDING_REVIEW'
           and (_platform_review('fa300000-0000-4000-8000-0000000000b0')->'reasons') = '["THRESHOLD_NOT_CONFIGURED"]',
  'RISK_BASED : seuil de montant non configuré → bureau de contrôle (prudence)');
insert into app_config(key, value) values ('risk_review_threshold', '{"XAF": 100000}');
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000b1', 'TEST_RISK', 70000));
select add_document('fa300000-0000-4000-8000-0000000000b1', 'INVOICE', 'fa300000-0000-4000-8000-0000000000b1/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select transition_tx('fa300000-0000-4000-8000-0000000000b1', 'SUBMITTED');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000b2', 'TEST_RISK', 70000));
select add_document('fa300000-0000-4000-8000-0000000000b2', 'INVOICE', 'fa300000-0000-4000-8000-0000000000b2/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select transition_tx('fa300000-0000-4000-8000-0000000000b2', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000b1') = 'ACTIVE'
           and exists (select 1 from audit_log where tx_id = 'fa300000-0000-4000-8000-0000000000b1' and event = 'AUTO_ACTIVATED' and payload->>'mode' = 'RISK_BASED'),
  'RISK_BASED : demandeur connu, montant sous le seuil, pas de doublon : activation automatique');
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000b2') = 'PENDING_REVIEW'
           and (_platform_review('fa300000-0000-4000-8000-0000000000b2')->'reasons') = '["DUPLICATE"]',
  'RISK_BASED : doublon possible → bureau de contrôle');
select t.login('fa000000-0000-4000-8000-000000000006');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000b3', 'TEST_RISK', 20000));
select add_document('fa300000-0000-4000-8000-0000000000b3', 'INVOICE', 'fa300000-0000-4000-8000-0000000000b3/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select transition_tx('fa300000-0000-4000-8000-0000000000b3', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000b3') = 'PENDING_REVIEW'
           and (_platform_review('fa300000-0000-4000-8000-0000000000b3')->'reasons') = '["FIRST_REQUEST"]',
  'RISK_BASED : première demande de ce demandeur → bureau de contrôle');
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000b4', 'TEST_RISK', 150000));
select add_document('fa300000-0000-4000-8000-0000000000b4', 'INVOICE', 'fa300000-0000-4000-8000-0000000000b4/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select transition_tx('fa300000-0000-4000-8000-0000000000b4', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000b4') = 'PENDING_REVIEW'
           and (_platform_review('fa300000-0000-4000-8000-0000000000b4')->'reasons') = '["AMOUNT_THRESHOLD"]',
  'RISK_BASED : montant au-delà du seuil configuré → bureau de contrôle');
-- NEVER (défaut) : le dossier C (Scolarité) est actif sans passer par le bureau.
select t.check((_platform_review('fa300000-0000-4000-8000-00000000000c')->'reasons') = '[]'
           and (select status from transactions where id = 'fa300000-0000-4000-8000-00000000000c') = 'ACTIVE',
  'NEVER (défaut) : aucune revue, opération active dès la soumission');
-- ALWAYS : file du bureau, prise en charge, approbation → ACTIVE, alerte de validation.
select t.login('fa000000-0000-4000-8000-000000000007');
insert into request_modules(code, label_fr, label_en, enabled, wave, release_mode, contest_hours, platform_review, required_documents, display_order)
values ('TEST_ALWAYS', 'Module revu', 'Reviewed module', true, 1, 'PROVIDER_CONFIRM', 48, 'ALWAYS',
        '[{"kind":"INVOICE","required":true,"maxFiles":1,"labels":{"fr":"Facture","en":"Invoice"}}]', 93);
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000a3', 'TEST_ALWAYS', 45000));
select add_document('fa300000-0000-4000-8000-0000000000a3', 'INVOICE', 'fa300000-0000-4000-8000-0000000000a3/INVOICE/i.pdf', 'i.pdf', 'application/pdf', 1000);
select t.check(needs_platform_review('fa300000-0000-4000-8000-0000000000a3'), 'needs_platform_review : vrai pour un module ALWAYS');
select transition_tx('fa300000-0000-4000-8000-0000000000a3', 'SUBMITTED');
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000a3') = 'PENDING_REVIEW'
           and (_platform_review('fa300000-0000-4000-8000-0000000000a3')->'reasons') = '["ALWAYS"]'
           and (select status from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000a3') = 'DRAFT',
  'ALWAYS : file du bureau (PENDING_REVIEW), demande pas encore soumise');
select t.login('fa000000-0000-4000-8000-000000000004');
select transition_tx('fa300000-0000-4000-8000-0000000000a3', 'IN_REVIEW');
select decide_tx('fa300000-0000-4000-8000-0000000000a3', true, true);
select t.admin();
select t.check((select status from transactions where id = 'fa300000-0000-4000-8000-0000000000a3') = 'ACTIVE'
           and (select status from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000a3') = 'SUBMITTED'
           and exists (select 1 from notifications where tx_id = 'fa300000-0000-4000-8000-0000000000a3' and event = 'TX_VALIDATED'),
  'ALWAYS : approuvé par le bureau → ACTIVE, demande soumise, alerte de validation (TX_VALIDATED)');
-- Vague 2 fermée : refusée à la soumission.
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000c1', 'AGRO', 10000));
select add_document('fa300000-0000-4000-8000-0000000000c1', 'SUPPORTING_DOCUMENT', 'fa300000-0000-4000-8000-0000000000c1/SUPPORTING_DOCUMENT/s.pdf', 's.pdf', 'application/pdf', 1000);
select t.hint($$select transition_tx('fa300000-0000-4000-8000-0000000000c1', 'SUBMITTED')$$, 'VERTICAL_UNAVAILABLE', 'type de la vague 2 désactivé : refusé');
select t.hint($$select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000c2', 'INCONNU', 10000))$$, 'VALIDATION', 'brouillon d’un type inconnu refusé');
select t.check(not needs_platform_review('fa300000-0000-4000-8000-0000000000c1'), 'needs_platform_review : faux pour un module NEVER (défaut)');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000006');
select t.hint($$select needs_platform_review('fa300000-0000-4000-8000-0000000000c1')$$, 'TX_NOT_FOUND', 'needs_platform_review : dossier étranger introuvable');
select t.admin();

-- ===================== X7 : structure multi-payeurs =====================
select t.check((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.transaction_parties'::regclass and contype = 'p') = 'PRIMARY KEY (id)'
           and exists (select 1 from pg_constraint where conname = 'transaction_parties_tx_user_role')
           and exists (select 1 from pg_constraint where conname = 'transaction_parties_tx_phone_role')
           and exists (select 1 from pg_indexes where indexname = 'transaction_parties_one_per_role'),
  'transaction_parties : identifiant propre ; unicité (transaction, utilisateur, rôle) et (transaction, téléphone invité, rôle)');
select t.check(not has_function_privilege('authenticated', '_check_multiple_payers()', 'execute'), 'déclencheur multi-payeurs non exécutable par le client');
select t.check(not exists (select 1 from request_modules where multiple_payers), 'aucun module n’autorise plusieurs payeurs');
-- Dossier existant (dossier E) : rôles et accès inchangés.
select t.login('fa000000-0000-4000-8000-000000000003');
select t.check(has_role('fa300000-0000-4000-8000-00000000000e', 'PROVIDER') and is_party('fa300000-0000-4000-8000-00000000000e')
           and (select count(*) from transactions where id = 'fa300000-0000-4000-8000-00000000000e') = 1,
  'has_role, is_party et politiques : inchangés');
select t.admin();
-- Second payeur refusé (module sans plusieurs payeurs), par le créateur comme par le propriétaire de la base.
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.draft('fa300000-0000-4000-8000-0000000000d1', 10000));
select t.hint($$insert into transaction_parties(tx_id, user_id, role) values ('fa300000-0000-4000-8000-0000000000d1', 'fa000000-0000-4000-8000-000000000006', 'PAYER')$$,
  'MULTIPLE_PAYERS_NOT_ALLOWED', 'second payeur refusé (créateur, brouillon)');
select t.admin();
select t.hint($$insert into transaction_parties(tx_id, user_id, role) values ('fa300000-0000-4000-8000-0000000000d1', 'fa000000-0000-4000-8000-000000000006', 'PAYER')$$,
  'MULTIPLE_PAYERS_NOT_ALLOWED', 'second payeur refusé même hors politique RLS');
select t.fails($$insert into transaction_parties(tx_id, user_id, role) values ('fa300000-0000-4000-8000-0000000000d1', 'fa000000-0000-4000-8000-000000000006', 'PROVIDER')$$,
  'un seul prestataire par dossier (inchangé)');
-- Module de test autorisant plusieurs payeurs : accepté.
select t.login('fa000000-0000-4000-8000-000000000007');
insert into request_modules(code, label_fr, label_en, enabled, release_mode, multiple_payers, required_documents, display_order)
values ('TEST_MULTI', 'Collecte de test', 'Test collection', true, 'PROVIDER_CONFIRM', true,
        '[{"kind":"INVOICE","required":true,"maxFiles":3,"labels":{"fr":"Facture","en":"Invoice"}}]', 92);
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000001');
select save_draft(t.module_draft('fa300000-0000-4000-8000-0000000000d2', 'TEST_MULTI', 10000));
insert into transaction_parties(tx_id, user_id, role) values ('fa300000-0000-4000-8000-0000000000d2', 'fa000000-0000-4000-8000-000000000006', 'PAYER');
select t.check((select count(*) from transaction_parties where tx_id = 'fa300000-0000-4000-8000-0000000000d2' and role = 'PAYER') = 2,
  'module autorisé : second payeur accepté');
select t.fails($$insert into transaction_parties(tx_id, user_id, role) values ('fa300000-0000-4000-8000-0000000000d2', 'fa000000-0000-4000-8000-000000000006', 'PAYER')$$,
  'même utilisateur deux fois payeur : refusé (unicité)');
insert into transaction_parties(tx_id, role, invited_phone) values ('fa300000-0000-4000-8000-0000000000d2', 'PAYER', '+33623330099');
select t.fails($$insert into transaction_parties(tx_id, role, invited_phone) values ('fa300000-0000-4000-8000-0000000000d2', 'PAYER', '+33623330099')$$,
  'même numéro invité deux fois payeur : refusé (unicité)');
select t.admin();
select t.login('fa000000-0000-4000-8000-000000000006');
select t.check(has_role('fa300000-0000-4000-8000-0000000000d2', 'PAYER') and is_party('fa300000-0000-4000-8000-0000000000d2'),
  'le second payeur est partie au dossier (has_role, is_party)');
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
