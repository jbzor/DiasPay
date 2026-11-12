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
-- Dossier validé (en cours, première tranche à payer) : créé par le payeur fa..01, validé par fa..04.
create function t.active_dossier(p_draft jsonb) returns void language plpgsql as $$
begin
  perform t.login('fa000000-0000-4000-8000-000000000001');
  perform save_draft(p_draft);
  perform add_document((p_draft->>'id')::uuid, 'ENROLMENT_CERTIFICATE', (p_draft->>'id') || '/ENROLMENT_CERTIFICATE/x.pdf', 'x.pdf', 'application/pdf', 1000);
  perform transition_tx((p_draft->>'id')::uuid, 'SUBMITTED');
  perform t.admin();
  perform t.login('fa000000-0000-4000-8000-000000000004');
  perform transition_tx((p_draft->>'id')::uuid, 'IN_REVIEW');
  perform decide_tx((p_draft->>'id')::uuid, true, true);
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
select t.check((select status from tranches where id = (select v from t.ids where k = 'e1')) = 'AWAITING_PAYMENT', 'dossier E en cours, tranche 1 à payer');

-- ---------- X5.2 Tentatives et idempotence ----------
select t.login('fa000000-0000-4000-8000-000000000001');
insert into t.ids select 'att1', (start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0001')->>'id')::uuid;
select t.check((select status = 'PENDING' and provider = 'SIMULATED' and amount_minor = 100000 and provider_ref like 'SIM-%'
                from payment_attempts where id = (select v from t.ids where k = 'att1')), 'start_payment : tentative en cours, montant de la tranche');
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
           and (select status from tranches where id = (select v from t.ids where k = 'e1')) = 'PAID_LOCKED'
           and (select count(*) from payments where tranche_id = (select v from t.ids where k = 'e1') and status = 'SUCCEEDED' and provider = 'SIMULATED') = 1,
  'paiement réussi : tentative réussie, tranche payée (fonds bloqués), paiement enregistré');
select t.check((select count(*) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1') and kind = 'PAYMENT') = 1
           and (select sum(debit_minor) from ledger_entries e join ledger_journals j on j.id = e.journal_id where j.tranche_id = (select v from t.ids where k = 'e1') and e.account_code = 'PARTNER_CASH') = 100000
           and (select sum(credit_minor) from ledger_entries e join ledger_journals j on j.id = e.journal_id where j.tranche_id = (select v from t.ids where k = 'e1') and e.account_code = 'DUE_TO_PROVIDER') = 100000,
  'journal financier : fonds chez le partenaire au débit, dû au prestataire au crédit');
insert into t.res values ('evt3b', apply_payment_event('SIMULATED', 'evt-e1-3', true, t.evt('PAYMENT_SUCCEEDED', 'cle-e1-0001', 100000)));
select t.check((select v - 'eventId' from t.res where k = 'evt3b') = '{"result":"DUPLICATE","original":"APPLIED"}'::jsonb
           and (select count(*) from webhook_events where event_id = 'evt-e1-3') = 1
           and (select count(*) from ledger_journals where tranche_id = (select v from t.ids where k = 'e1')) = 1,
  'événement en double (même identifiant) : DUPLICATE, rien de plus');
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
select t.hint($$select start_payment((select v from t.ids where k = 'e1'), 'cle-e1-0003')$$, 'NOT_PAYABLE', 'nouvelle clé sur une tranche payée');
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
select t.check(not exists (
  select 1 from ledger_entries e join ledger_journals j on j.id = e.journal_id where j.tranche_id = (select v from t.ids where k = 'e1')
  group by e.account_code having sum(e.debit_minor) <> sum(e.credit_minor)),
  'remboursé en totalité : chaque compte de la tranche revient à zéro');
select t.check((select status from payments where tranche_id = (select v from t.ids where k = 'e1')) = 'REFUNDED', 'paiement marqué remboursé');

-- ---------- X2.6 + X5 : mode IMMEDIATE par le même chemin (débloqué au paiement) ----------
update tranches set release_mode = 'IMMEDIATE' where id = (select v from t.ids where k = 'e2');
select t.login('fa000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'e2'), 'AWAITING_PAYMENT');
insert into t.ids select 'att2', (start_payment((select v from t.ids where k = 'e2'), 'cle-e2-0001')->>'id')::uuid;
insert into t.res values ('att2', demo_settle_payment((select v from t.ids where k = 'att2')));
select t.check((select v->>'result' from t.res where k = 'att2') = 'APPLIED'
           and (select status from tranches where id = (select v from t.ids where k = 'e2')) = 'RELEASED',
  'IMMEDIATE : le paiement simulé (événement) débloque directement');
select t.admin();
select t.check((select trigger from release_events where tranche_id = (select v from t.ids where k = 'e2')) = 'DIRECT_PAYMENT'
           and (select array_agg(kind order by kind) from ledger_journals where tranche_id = (select v from t.ids where k = 'e2')) = array['PAYMENT','RELEASE'],
  'débloqué : événement DIRECT_PAYMENT, versement au prestataire au journal');

-- ---------- Dossier F : échec puis nouvelle tentative ----------
select t.active_dossier(t.draft('fa300000-0000-4000-8000-0000000000f0', 50000));
insert into t.ids select 'f1', id from tranches where tx_id = 'fa300000-0000-4000-8000-0000000000f0';
select t.login('fa000000-0000-4000-8000-000000000001');
insert into t.ids select 'attf1', (start_payment((select v from t.ids where k = 'f1'), 'cle-f1-0001')->>'id')::uuid;
insert into t.res values ('attf1', demo_settle_payment((select v from t.ids where k = 'attf1'), 'FAILED'));
select t.check((select v->>'result' from t.res where k = 'attf1') = 'APPLIED'
           and (select status = 'FAILED' and error_code = 'SIMULATED_DECLINE' from payment_attempts where id = (select v from t.ids where k = 'attf1'))
           and (select status from tranches where id = (select v from t.ids where k = 'f1')) = 'AWAITING_PAYMENT',
  'échec du paiement : tentative échouée, tranche toujours à payer');
insert into t.ids select 'attf2', (start_payment((select v from t.ids where k = 'f1'), 'cle-f1-0002')->>'id')::uuid;
select demo_settle_payment((select v from t.ids where k = 'attf2'));
select t.check((select status from tranches where id = (select v from t.ids where k = 'f1')) = 'PAID_LOCKED', 'nouvelle tentative après un échec : payée');
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
select t.check((select issues from v_reconciliation where attempt_id = (select v from t.ids where k = 'att1')) = array['REFUNDED_TRANCHE_OPEN','EVENT_REJECTED'],
  'tranche remboursée en totalité mais toujours ouverte, événements rejetés (montant, état contradictoire) : signalés');
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
