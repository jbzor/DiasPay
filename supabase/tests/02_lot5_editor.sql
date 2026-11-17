-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 02_lot5.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
-- Test de la migration 0006 (lot 5, bureau de contrôle). Même format que 00_smoke.sql et 01_lot4.sql :
-- utilisateurs fictifs, rôles réels (authenticated, anon), jetons aal1 / aal2, tout est annulé à la fin
-- (ROLLBACK), le résumé échoue au moindre FAIL. Variante pour l’éditeur SQL : 02_lot5_editor.sql (générée).
-- Prérequis : 0001 à 0016 appliquées, app_config.mock_mode = 'true' (projet de développement).
-- Lot X version 2 (0014) : la file ne reçoit plus que les dossiers PENDING_REVIEW (platform_review ≠ NEVER) ; l’approbation
-- active l’opération (ACTIVE), le rejet l’annule (CANCELLED) ; preuves de jalon en CONDITIONAL seulement ; litige distinct.
begin;
create schema t;
create table t.results (n serial primary key, ok boolean not null, label text not null);
create function t.check(ok boolean, label text) returns void language plpgsql security definer as $$
begin
  insert into t.results(ok, label) values (coalesce(ok,false), label);
  raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, label;
end $$;
-- Connexion avec un niveau d’authentification (aal1 : mot de passe seul ; aal2 : second facteur vérifié).
create function t.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
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
create function t.hint(sql text, expected text, label text) returns void language plpgsql as $$
declare h text; m text;
begin
  begin execute sql; exception when others then get stacked diagnostics h = pg_exception_hint, m = message_text; end;
  if h is distinct from expected then raise notice '   attendu %, obtenu % (%)', expected, coalesce(h, 'aucune erreur'), m; end if;
  perform t.check(h is not distinct from expected, label || ' [' || expected || ']');
end $$;
create function t.j(sql text) returns jsonb language plpgsql as $$
declare r jsonb; begin execute sql into r; return r; end $$;
create function t.n(sql text) returns bigint language plpgsql as $$
declare r bigint; begin execute 'select count(*) from (' || sql || ') x' into r; return r; end $$;
create table t.ids (k text primary key, v uuid);
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- ---------- Jeu d’essai ----------
insert into auth.users(id, phone) values
 ('f1000000-0000-4000-8000-000000000001','33622220001'),   -- payeur
 ('f1000000-0000-4000-8000-000000000002','33622220002'),   -- demandeur
 ('f1000000-0000-4000-8000-000000000003','237622220003'),  -- prestataire (compte de l’annuaire)
 ('f1000000-0000-4000-8000-000000000004','237622220004'),  -- validateur A
 ('f1000000-0000-4000-8000-000000000005','237622220005'),  -- validateur B
 ('f1000000-0000-4000-8000-000000000006','237622220006'),  -- administrateur
 ('f1000000-0000-4000-8000-000000000007','33622220007'),   -- utilisateur ordinaire étranger aux dossiers
 ('f1000000-0000-4000-8000-000000000008','237622220008');  -- validateur partie à un dossier (payeur)
update profiles p set full_name = v.n, platform_role = v.r::platform_role, primary_role = v.pr
from (values ('f1000000-0000-4000-8000-000000000001'::uuid, 'Marie N. (test)', 'USER', 'PAYER'),
             ('f1000000-0000-4000-8000-000000000002'::uuid, 'Jean K. (test)', 'USER', 'REQUESTER'),
             ('f1000000-0000-4000-8000-000000000003'::uuid, 'Lycée de la Réunification (test)', 'USER', 'PROVIDER'),
             ('f1000000-0000-4000-8000-000000000004'::uuid, 'Validateur A (test)', 'VALIDATOR', null),
             ('f1000000-0000-4000-8000-000000000005'::uuid, 'Validateur B (test)', 'VALIDATOR', null),
             ('f1000000-0000-4000-8000-000000000006'::uuid, 'Administratrice (test)', 'ADMIN', null),
             ('f1000000-0000-4000-8000-000000000007'::uuid, 'Paul T. (test)', 'USER', 'PAYER'),
             ('f1000000-0000-4000-8000-000000000008'::uuid, 'Validateur partie (test)', 'VALIDATOR', null)) v(id, n, r, pr)
where p.id = v.id;
-- Lot X v2 (X4, 0020) : niveau d’enrôlement réglé ici comme après la revue d’un dossier (N1 requis pour initier en demandeur).
update profiles set enrolment_level = 'N1' where id = 'f1000000-0000-4000-8000-000000000002';
insert into providers(id, name, city, verticals, verified, phone) values
 ('f2000000-0000-4000-8000-000000000001', 'Lycée de la Réunification (test)', 'Yaoundé', '{EDUCATION}', true, '+237622220003'),
 ('f2000000-0000-4000-8000-000000000002', 'Institut Non Vérifié (test)', 'Douala', '{EDUCATION}', false, null);
-- Second facteur non exigé, sauf dans sa section. (Lot X v2 : plus d’émission simulée du jeton, auto_issue_token inutile.)
update app_config set value = 'false' where key = 'require_staff_mfa';
-- Lot X v2 (K2) : platform_review vaut NEVER par défaut (soumission → ACTIVE, hors file ; vérifié plus bas avec tx10).
-- Ce test exerce la file du bureau : le type Scolarité passe en revue systématique avant les soumissions.
select t.check((select bool_and(platform_review = 'NEVER') from request_modules), 'platform_review : NEVER par défaut pour tous les modules (lot X v2, K2)');
update request_modules set platform_review = 'ALWAYS' where code = 'EDUCATION';

-- ---------- Structure et droits ----------
select t.check((select value from app_config where key = 'require_staff_mfa') is not null, 'clé require_staff_mfa présente');
select t.check(to_regprocedure('public.decide_tx(uuid, boolean, text)') is null and to_regprocedure('public.decide_tx(uuid, boolean, boolean, text)') is not null,
  'decide_tx : ancienne signature retirée, nouvelle signature avec p_amount_checked');
select t.check(exists (select 1 from information_schema.columns where table_name = 'validations' and column_name = 'amount_checked'), 'validations.amount_checked');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname in ('_staff_aal_ok','_require_validator','_tx_ref','_party_name','_staff_name','_round_start','_evidence_round_start',
      '_simulate_token_issue','_dispute_notified_at','_recently_opened','decide_tx','claim_dossier','dossier_checks','evidence_checks',
      'bo_decisions','dossier_documents','open_document','bo_audit','bo_audit_verify','log_audit_export','bo_find_transactions','respond_dispute')),
  'aucune fonction de 0006 exécutable par anon');
select t.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname in ('_staff_aal_ok','_require_validator','_simulate_token_issue')),
  'fonctions internes de 0006 non exécutables par authenticated');
select t.check(not has_table_privilege('anon', 'bo_dossiers', 'SELECT') and not has_table_privilege('anon', 'bo_evidence_queue', 'SELECT')
           and not has_table_privilege('anon', 'bo_disputes', 'SELECT'), 'vues du bureau fermées à anon');
select t.check((select bool_and(coalesce('security_invoker=true' = any(c.reloptions), false)) from pg_class c
                where c.relname in ('bo_dossiers','bo_evidence_queue','bo_disputes')), 'vues du bureau en security_invoker (RLS de l’utilisateur)');
select t.check((select count(*) from pg_constraint where conname = 'validations_amount_checked') = 1, 'contrainte : approbation de dossier avec la case cochée');

-- ---------- Dossiers soumis par le demandeur ----------
select t.login('f1000000-0000-4000-8000-000000000002');
-- tx1 : scolarité, 900 000 FCFA en deux tranches, prestataire vérifié de l’annuaire, payeur rattaché par son numéro.
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000001','vertical','EDUCATION','step','recap','amountMinor','900000','currency','XAF',
  'purpose','Scolarité Lycée Réunification (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','PARTIAL',
  'tranches',jsonb_build_array(jsonb_build_object('label','Inscription','amountMinor','400000','dueDate',(current_date + 3)::text),
                               jsonb_build_object('label','Solde','amountMinor','500000','dueDate',(current_date + 60)::text))));
-- tx2 : 3 500 000 FCFA, au-delà du seuil de double validation (RG-04).
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000002','vertical','EDUCATION','step','recap','amountMinor','3500000','currency','XAF',
  'purpose','Université privée (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000002','name','Institut Non Vérifié (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Année','amountMinor','3500000','dueDate',(current_date + 30)::text))));
-- tx3 : le payeur est un validateur (partie au dossier).
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000003','vertical','EDUCATION','step','recap','amountMinor','150000','currency','XAF',
  'purpose','Cantine (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+237 6 22 22 00 08',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Cantine','amountMinor','150000','dueDate',(current_date + 30)::text))));
-- tx4 : à rejeter.
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000004','vertical','EDUCATION','step','recap','amountMinor','200000','currency','XAF',
  'purpose','Fournitures (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Fournitures','amountMinor','200000','dueDate',(current_date + 30)::text))));
-- tx5 : doublon possible de tx1 (même payeur, même prestataire, même montant).
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000005','vertical','EDUCATION','step','recap','amountMinor','900000','currency','XAF',
  'purpose','Scolarité, deuxième demande (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Année','amountMinor','900000','dueDate',(current_date + 30)::text))));
-- tx6 : prestataire hors annuaire (invité par numéro), première tranche dans 3 jours.
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000006','vertical','EDUCATION','step','recap','amountMinor','120000','currency','XAF',
  'purpose','Cours du soir (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('name','École du Quartier (test)','invitedPhone','+237 6 22 22 00 99'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Trimestre','amountMinor','120000','dueDate',(current_date + 3)::text))));
select add_document(x.id, 'ENROLMENT_CERTIFICATE', x.id || '/ENROLMENT_CERTIFICATE/attestation.pdf', 'attestation.pdf', 'application/pdf', 1000)
from (values ('f3000000-0000-4000-8000-000000000001'::uuid), ('f3000000-0000-4000-8000-000000000002'), ('f3000000-0000-4000-8000-000000000003'),
             ('f3000000-0000-4000-8000-000000000004'), ('f3000000-0000-4000-8000-000000000005'), ('f3000000-0000-4000-8000-000000000006')) x(id);
select add_document('f3000000-0000-4000-8000-000000000001', 'SCHOOL_SCHEDULE', 'f3000000-0000-4000-8000-000000000001/SCHOOL_SCHEDULE/echeancier.png', 'echeancier.png', 'image/png', 2000);
select transition_tx(x.id, 'SUBMITTED')
from (values ('f3000000-0000-4000-8000-000000000001'::uuid), ('f3000000-0000-4000-8000-000000000002'), ('f3000000-0000-4000-8000-000000000003'),
             ('f3000000-0000-4000-8000-000000000004'), ('f3000000-0000-4000-8000-000000000005'), ('f3000000-0000-4000-8000-000000000006')) x(id);
-- Le demandeur, partie, ne voit rien du bureau de contrôle (pas même ses propres dossiers).
select t.check(t.n('select * from bo_dossiers') = 0, 'isolation : un demandeur ne voit pas la file bo_dossiers');
select t.hint($$select * from dossier_checks('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'contrôles réservés au personnel (partie)');
select t.admin();

-- ---------- Isolation : un utilisateur ordinaire n’accède à rien ----------
select t.login('f1000000-0000-4000-8000-000000000007');
select t.check(t.n('select * from bo_dossiers') = 0 and t.n('select * from bo_evidence_queue') = 0 and t.n('select * from bo_disputes') = 0,
  'isolation : vues du bureau vides pour un utilisateur ordinaire');
select t.hint($$select claim_dossier('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'prise en charge refusée à un utilisateur ordinaire');
select t.hint($$select * from dossier_checks('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'contrôles refusés');
select t.hint($$select * from bo_audit('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'journal refusé');
select t.hint($$select bo_audit_verify('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'vérification du journal refusée');
select t.hint($$select * from bo_find_transactions('')$$, 'VALIDATOR_ONLY', 'recherche refusée');
select t.hint($$select dossier_documents('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'liste des pièces refusée');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000001', true, true)$$, 'VALIDATOR_ONLY', 'décision refusée');
select t.hint($$select log_audit_export('f3000000-0000-4000-8000-000000000001', 1)$$, 'VALIDATOR_ONLY', 'export refusé');
select t.check((select count(*) from transactions where id = 'f3000000-0000-4000-8000-000000000001') = 0, 'RLS : le dossier reste invisible');
select t.admin();
select t.anon();
select t.fails($$select * from bo_dossiers$$, 'anon : aucune lecture des vues du bureau');
select t.fails($$select claim_dossier('f3000000-0000-4000-8000-000000000001')$$, 'anon : aucune fonction du bureau');
select t.admin();

-- ---------- File des dossiers et contrôles automatiques (D6) ----------
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check(t.n($$select * from bo_dossiers where id::text like 'f3000000-%'$$) = 6, 'bo_dossiers : les six dossiers soumis');
select t.check((select status = 'PENDING_REVIEW' and validations_required = 1 and validations_received = 0 and not decided_by_me and not is_party
                  and requester_name = 'Jean K. (test)' and payer_name = 'Marie N. (test)' and provider_name = 'Lycée de la Réunification (test)'
                  and reference = 'F3000000' and submitted_at is not null
                from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000001'),
  'bo_dossiers : statut PENDING_REVIEW, validations 0 sur 1, noms des parties, référence, date de soumission');
select t.check((select validations_required from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000002') = 2, 'bo_dossiers : double validation au-delà du seuil (RG-04)');
select t.check((select is_party from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000003') = false, 'is_party : faux pour un validateur non partie');
select t.check((select string_agg(code || '=' || result, ',' order by code) from dossier_checks('f3000000-0000-4000-8000-000000000001'))
  = 'DOCUMENT_REUSED=OK,DOCUMENTS=OK,DUPLICATE=ATTENTION,PLAN_SUM=OK,PROVIDER_VERIFIED=OK',
  'contrôles tx1 : pièces, prestataire vérifié, somme ; doublon possible (tx5) ; justificatif non réutilisé (lot X, X4)');
select t.check((select detail->'references' from dossier_checks('f3000000-0000-4000-8000-000000000005') where code = 'DUPLICATE') = '["F3000000"]'::jsonb
           and (select result from dossier_checks('f3000000-0000-4000-8000-000000000005') where code = 'DUPLICATE') = 'ATTENTION',
  'doublon possible : même payeur, même prestataire, même montant (référence de l’autre dossier)');
select t.check((select result from dossier_checks('f3000000-0000-4000-8000-000000000004') where code = 'DUPLICATE') = 'OK', 'pas de doublon pour un montant différent');
select t.check((select result || ':' || (detail->>'reason') from dossier_checks('f3000000-0000-4000-8000-000000000002') where code = 'PROVIDER_VERIFIED') = 'ATTENTION:UNVERIFIED',
  'prestataire de l’annuaire non vérifié : attention');
select t.check((select result || ':' || (detail->>'reason') from dossier_checks('f3000000-0000-4000-8000-000000000006') where code = 'PROVIDER_VERIFIED') = 'ATTENTION:OUTSIDE_DIRECTORY',
  'prestataire hors annuaire : attention');
select t.hint($$select * from dossier_checks('f3000000-0000-4000-8000-0000000000ff')$$, 'TX_NOT_FOUND', 'contrôles d’un dossier inconnu');
select t.admin();
-- Pièce obligatoire retirée en base (cas anormal) : le contrôle échoue ; somme faussée : échec avec l’écart.
-- Lot X (X4) : les pièces d’un dossier soumis sont immuables ; le cas anormal se fabrique en suspendant le déclencheur.
alter table documents disable trigger documents_immutable_trg;
update documents set deleted_at = now() where tx_id = 'f3000000-0000-4000-8000-000000000004' and kind = 'ENROLMENT_CERTIFICATE';
update tranches set amount_minor = 150000 where tx_id = 'f3000000-0000-4000-8000-000000000004';
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check((select result || ':' || (detail->>'missing') from dossier_checks('f3000000-0000-4000-8000-000000000004') where code = 'DOCUMENTS') = 'ECHEC:["ENROLMENT_CERTIFICATE"]',
  'pièce obligatoire manquante : échec avec le type de pièce');
select t.check((select result || ':' || (detail->>'gap') from dossier_checks('f3000000-0000-4000-8000-000000000004') where code = 'PLAN_SUM') = 'ECHEC:50000',
  'somme des tranches différente : échec avec l’écart');
select t.admin();
update documents set deleted_at = null where tx_id = 'f3000000-0000-4000-8000-000000000004';
alter table documents enable trigger documents_immutable_trg;
update tranches set amount_minor = 200000 where tx_id = 'f3000000-0000-4000-8000-000000000004';

-- ---------- Validateur partie au dossier (RG-03) ----------
select t.login('f1000000-0000-4000-8000-000000000008');
select t.check((select is_party from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000003'), 'bo_dossiers : le validateur partie est signalé (lecture seule)');
select t.hint($$select claim_dossier('f3000000-0000-4000-8000-000000000003')$$, 'VALIDATOR_IS_PARTY', 'un validateur partie ne prend pas le dossier en charge');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000004');
select claim_dossier('f3000000-0000-4000-8000-000000000003');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000008');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000003', true, true)$$, 'VALIDATOR_IS_PARTY', 'un validateur partie ne décide pas');
select t.admin();

-- ---------- Prise en charge (D8) ----------
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check((select status from claim_dossier('f3000000-0000-4000-8000-000000000001')) = 'IN_REVIEW', 'claim_dossier : PENDING_REVIEW → IN_REVIEW');
select t.admin();
select t.check((select actor_id = 'f1000000-0000-4000-8000-000000000004' and from_status = 'PENDING_REVIEW' from audit_log
                where tx_id = 'f3000000-0000-4000-8000-000000000001' and to_status = 'IN_REVIEW'), 'prise en charge journalisée au nom du validateur');
select t.login('f1000000-0000-4000-8000-000000000005');
select t.check((select status from claim_dossier('f3000000-0000-4000-8000-000000000001')) = 'IN_REVIEW', 'dossier déjà IN_REVIEW : reste ouvert à un autre validateur');
select t.admin();
select t.check((select count(*) from audit_log where tx_id = 'f3000000-0000-4000-8000-000000000001' and to_status = 'IN_REVIEW') = 1,
  'seconde ouverture : aucune nouvelle ligne de journal');

-- ---------- Décision : case de vérification du montant et motif (D6) ----------
select t.login('f1000000-0000-4000-8000-000000000004');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000001', true, false)$$, 'AMOUNT_NOT_CHECKED', 'approbation refusée sans la case de vérification du montant');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000001', true, null)$$, 'AMOUNT_NOT_CHECKED', 'case non renseignée : approbation refusée');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000001', false, false, ' ')$$, 'REASON_REQUIRED', 'rejet sans motif refusé');
select t.check((select count(*) from validations where tx_id = 'f3000000-0000-4000-8000-000000000001') = 0, 'aucune validation enregistrée après un refus');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000001', true, true)) = 'ACTIVE', 'approbation avec la case : opération active (une validation requise)');
select t.admin();
select t.check((select amount_checked and approved from validations where tx_id = 'f3000000-0000-4000-8000-000000000001'), 'case enregistrée avec la validation');
select t.check((select payload->>'amount_checked' = 'true' and actor_id = 'f1000000-0000-4000-8000-000000000004' from audit_log
                where tx_id = 'f3000000-0000-4000-8000-000000000001' and event = 'VALIDATION_DECISION'), 'case journalisée (VALIDATION_DECISION)');
select t.check((select array_agg(user_id order by user_id)::text from notifications where tx_id = 'f3000000-0000-4000-8000-000000000001' and event = 'TX_VALIDATED')
  = '{f1000000-0000-4000-8000-000000000001,f1000000-0000-4000-8000-000000000002,f1000000-0000-4000-8000-000000000003}',
  'alerte TX_VALIDATED au payeur, au demandeur et au prestataire');
select t.fails($$insert into validations(tx_id, validator_id, approved, amount_checked) values ('f3000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000005', true, false)$$,
  'la base refuse une approbation de dossier sans la case, même en écriture directe');
select t.check((select status from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000001') is null, 'dossier approuvé (ACTIVE) sorti de la file');

-- ---------- Double validation de bout en bout (RG-04, deux validateurs distincts) ----------
select t.login('f1000000-0000-4000-8000-000000000004');
select claim_dossier('f3000000-0000-4000-8000-000000000002');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000002', true, true)) = 'IN_REVIEW', 'première approbation : reste en validation');
select t.check((select validations_received = 1 and decided_by_me from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000002'),
  'bo_dossiers : 1 sur 2, décision du validateur courant signalée');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000002', true, true)$$, 'ALREADY_DECIDED', 'le même validateur ne peut pas approuver deux fois');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000005');
select t.check((select validations_received = 1 and not decided_by_me from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000002'),
  'second validateur : 1 sur 2 reçue, pas encore sa décision');
select t.check((select string_agg(validator_name || ':' || approved::text || ':' || is_me::text, ',') from bo_decisions('f3000000-0000-4000-8000-000000000002'))
  = 'Validateur A (test):true:false', 'bo_decisions : qui a déjà validé (nom), vu par l’autre validateur');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000002', true, false)$$, 'AMOUNT_NOT_CHECKED', 'second validateur : la case est exigée aussi');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000002', true, true)) = 'ACTIVE', 'second validateur distinct : opération active');
select t.check((select count(*) from bo_decisions('f3000000-0000-4000-8000-000000000002')) = 2, 'bo_decisions : deux validations');
select t.admin();

-- ---------- Rejet avec motif ----------
select t.login('f1000000-0000-4000-8000-000000000005');
select claim_dossier('f3000000-0000-4000-8000-000000000004');
select t.check((select status = 'CANCELLED' and reject_reason = 'Attestation illisible' from decide_tx('f3000000-0000-4000-8000-000000000004', false, false, '  Attestation illisible ')),
  'rejet avec motif (espaces retirés) : opération annulée (CANCELLED, plus de retour en correction)');
select t.admin();
select t.check((select count(*) from notifications where tx_id = 'f3000000-0000-4000-8000-000000000004' and event = 'TX_REJECTED'
                and payload->>'reason' = 'Attestation illisible') = 3, 'alerte TX_REJECTED avec le motif');
-- Un doublon possible n’empêche pas d’approuver (il alerte).
select t.login('f1000000-0000-4000-8000-000000000005');
select claim_dossier('f3000000-0000-4000-8000-000000000005');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000005', true, true)) = 'ACTIVE', 'doublon possible : approbation permise');
select t.admin();

-- ---------- Pièces : liste, ouverture journalisée, lecture du stockage ----------
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check(jsonb_array_length(dossier_documents('f3000000-0000-4000-8000-000000000001')) = 2
           and dossier_documents('f3000000-0000-4000-8000-000000000001')->0->>'name' = 'attestation.pdf', 'dossier_documents : pièces du dossier, nom du fichier');
insert into t.ids select 'doc1', (dossier_documents('f3000000-0000-4000-8000-000000000001')->0->>'id')::uuid;
select t.check((select open_document((select v from t.ids where k = 'doc1'))->>'path') = 'f3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/attestation.pdf',
  'open_document : chemin du fichier');
select t.hint($$select open_document('f3000000-0000-4000-8000-0000000000ff')$$, 'NOT_FOUND', 'pièce inconnue');
select t.check(_recently_opened('f3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/attestation.pdf'), 'lecture du fichier ouverte au validateur qui l’a consulté');
select t.admin();
select t.check((select actor_id = 'f1000000-0000-4000-8000-000000000004' and payload->>'kind' = 'ENROLMENT_CERTIFICATE' and payload->>'file_name' = 'attestation.pdf'
                from audit_log where tx_id = 'f3000000-0000-4000-8000-000000000001' and event = 'DOCUMENT_VIEWED'),
  'consultation de pièce journalisée : qui, quelle pièce (et quand : horodatage de la ligne)');
select t.check((select count(*) from notifications where tx_id = 'f3000000-0000-4000-8000-000000000001' and event = 'DOCUMENT_VIEWED') = 0,
  'consultation : aucune alerte envoyée aux parties');
select t.login('f1000000-0000-4000-8000-000000000005');
select t.check(not _recently_opened('f3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/attestation.pdf'), 'un autre validateur doit ouvrir la pièce lui-même');
select t.admin();
-- Politique du stockage (bucket « dossiers ») : ligne d’objet créée pour le test.
insert into storage.objects(bucket_id, name) values ('dossiers', 'f3000000-0000-4000-8000-000000000001/ENROLMENT_CERTIFICATE/attestation.pdf');
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check((select count(*) from storage.objects where name like 'f3000000-0000-4000-8000-000000000001/%') = 1, 'stockage : lisible par le validateur après ouverture journalisée');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000005');
select t.check((select count(*) from storage.objects where name like 'f3000000-0000-4000-8000-000000000001/%') = 0, 'stockage : illisible pour un validateur sans ouverture journalisée');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000001');
-- Lot X (X4) : une partie ne lit plus le fichier d’un dossier soumis qu’après une consultation journalisée (avant : toujours lisible).
select t.check((select count(*) from storage.objects where name like 'f3000000-0000-4000-8000-000000000001/%') = 0, 'stockage : illisible pour une partie sans consultation journalisée');
select get_document_access((select v from t.ids where k = 'doc1'));
select t.check((select count(*) from storage.objects where name like 'f3000000-0000-4000-8000-000000000001/%') = 1, 'stockage : lisible par une partie après consultation journalisée');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000007');
select t.check((select count(*) from storage.objects where name like 'f3000000-0000-4000-8000-000000000001/%') = 0, 'stockage : illisible pour un tiers');
select t.admin();

-- ---------- Preuve de jalon (vague 2, CONDITIONAL : opération et paiement créés directement) ----------
-- Lot X v2 : la preuve ne sert qu’en CONDITIONAL ; demande PAID avec fonds bloqués (HELD), le prestataire dépose sa pièce
-- puis demande l’examen (submit_evidence). Avant : statut de tranche EVIDENCE_SUBMITTED écrit directement.
insert into transactions(id, vertical, purpose, amount_minor, currency, status, created_by, provider_name, plan_type, settlement_mode)
values ('f3000000-0000-4000-8000-000000000007', 'LAND', 'Terrain Odza (test lot 5)', 6000000, 'XAF', 'ACTIVE', 'f1000000-0000-4000-8000-000000000002', 'Étude notariale (test)', 'PARTIAL', 'CONDITIONAL');
insert into transaction_parties(tx_id, user_id, role) values
 ('f3000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000002', 'REQUESTER'),
 ('f3000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000001', 'PAYER'),
 ('f3000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000003', 'PROVIDER');
insert into tranches(id, tx_id, seq, label, amount_minor, status, funds_state, paid_at, release_mode, contest_hours)
values ('f4000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000007', 1, 'Remise du titre foncier', 6000000, 'PAID', 'HELD', now(), 'EVIDENCE_REVIEW', 0);
-- Jeton de la demande (CONDITIONAL : émis à la soumission ; ici données directes), pour la recherche par référence d’eQR.
select _issue_tranche_token('f4000000-0000-4000-8000-000000000001');
insert into payments(tx_id, tranche_id, provider, status) values ('f3000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000001', 'MOCK', 'SUCCEEDED');
select t.login('f1000000-0000-4000-8000-000000000003');
insert into documents(tx_id, tranche_id, kind, storage_path, mime_type, size_bytes, uploaded_by, file_name)
values ('f3000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000001', 'EVIDENCE', 'f3000000-0000-4000-8000-000000000007/EVIDENCE/titre.pdf',
        'application/pdf', 5000, 'f1000000-0000-4000-8000-000000000003', 'titre_foncier.pdf');
select t.check((select evidence_submitted_at is not null and status = 'PAID' and funds_state = 'HELD' from submit_evidence('f4000000-0000-4000-8000-000000000001')),
  'submit_evidence : le prestataire demande l’examen de sa preuve (PAID, fonds bloqués)');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check((select validations_required = 2 and validations_received = 0 and label = 'Remise du titre foncier' and submitted_at is not null
                from bo_evidence_queue where tranche_id = 'f4000000-0000-4000-8000-000000000001'), 'bo_evidence_queue : preuve en attente, 2 validations requises (terrain)');
select t.check((select string_agg(code || '=' || result, ',' order by code) from evidence_checks('f4000000-0000-4000-8000-000000000001'))
  = 'EVIDENCE_PRESENT=OK,PROVIDER_VERIFIED=ATTENTION', 'evidence_checks : preuve déposée, prestataire hors annuaire');
select t.check(jsonb_array_length(dossier_documents('f3000000-0000-4000-8000-000000000007')) = 1, 'dossier_documents : la preuve de la tranche');
select t.hint($$select decide_tranche('f4000000-0000-4000-8000-000000000001', false, '')$$, 'REASON_REQUIRED', 'rejet de preuve sans motif');
select t.check((select status = 'PAID' and funds_state = 'HELD' and evidence_submitted_at is not null from decide_tranche('f4000000-0000-4000-8000-000000000001', true)),
  'preuve : première approbation, fonds toujours bloqués, en attente de la seconde');
select t.hint($$select decide_tranche('f4000000-0000-4000-8000-000000000001', true)$$, 'ALREADY_DECIDED', 'preuve : même validateur refusé');
select t.check((select validations_received from bo_evidence_queue where tranche_id = 'f4000000-0000-4000-8000-000000000001') = 1, 'bo_evidence_queue : 1 sur 2');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000005');
select t.check((select status = 'PAID' and funds_state = 'RELEASED' from decide_tranche('f4000000-0000-4000-8000-000000000001', true)),
  'preuve : second validateur, fonds libérés (PAID, RELEASED)');
select t.check(t.n($$select * from bo_evidence_queue where tranche_id = 'f4000000-0000-4000-8000-000000000001'$$) = 0, 'preuve sortie de la file');
select t.admin();
select t.check(exists (select 1 from release_events where tranche_id = 'f4000000-0000-4000-8000-000000000001' and trigger = 'VALIDATOR_APPROVAL')
           and exists (select 1 from notifications where tx_id = 'f3000000-0000-4000-8000-000000000007' and event = 'TRANCHE_RELEASED'),
  'libération par le bureau : release_events VALIDATOR_APPROVAL et alerte TRANCHE_RELEASED');

-- ---------- Litiges (RG-09) : réponse de la partie adverse, administrateur seulement ----------
-- Lot X v2 : tx1 (Scolarité, DIRECT) est active depuis son approbation ; la première tranche due est soumise, la seconde
-- programmée. Le paiement simulé passe par start_payment et l’événement du partenaire ; le litige est un dossier distinct.
select t.login('f1000000-0000-4000-8000-000000000001');
insert into t.ids select 'tr1', id from tranches where tx_id = 'f3000000-0000-4000-8000-000000000001' and seq = 1;
insert into t.ids select 'tr2', id from tranches where tx_id = 'f3000000-0000-4000-8000-000000000001' and seq = 2;
select simulate_tranche_system((select v from t.ids where k = 'tr1'), 'PAID');
insert into t.ids select 'd1', id from open_dispute((select v from t.ids where k = 'tr1'), 'Les cours n’ont pas commencé à la date prévue.', 'NOT_DELIVERED');
select t.hint($$select respond_dispute((select v from t.ids where k = 'd1'), 'Je réponds à mon propre litige.')$$, 'NOT_RESPONDENT', 'l’auteur du litige ne se répond pas');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000003');
select t.hint($$select respond_dispute((select v from t.ids where k = 'd1'), 'Non.')$$, 'REASON_TOO_SHORT', 'réponse trop courte');
select t.check((select response is not null and status = 'IN_MEDIATION' from respond_dispute((select v from t.ids where k = 'd1'), 'Les cours ont commencé le 4 novembre, liste d’appel jointe.')),
  'le prestataire donne sa version (litige en médiation)');
select t.hint($$select respond_dispute((select v from t.ids where k = 'd1'), 'Une seconde réponse refusée.')$$, 'ALREADY_ANSWERED', 'une seule réponse');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check(t.n('select * from bo_disputes') = 0, 'bo_disputes : vide pour un validateur (administrateurs seulement)');
select t.hint($$select resolve_dispute((select v from t.ids where k = 'd1'), 'REFUND_FULL', 'Remboursement')$$, 'ADMIN_ONLY', 'un validateur ne tranche pas un litige');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000006');
select t.check((select opened_by_role = 'PAYER' and reason_code = 'NOT_DELIVERED' and response like 'Les cours ont commencé%' and notified_at is not null
                  and status = 'IN_MEDIATION' and not is_party and tranche_seq = 1 and amount_minor = 400000 and payer_name = 'Marie N. (test)'
                  and tranche_status = 'PAID' and not before_payment and not on_hold and settlement_mode = 'DIRECT' and funds_state = 'NONE'
                from bo_disputes where id = (select v from t.ids where k = 'd1')),
  'bo_disputes : auteur, motif, version du prestataire, partie adverse informée, montant ; litige après paiement (DIRECT, demande PAID)');
select t.hint($$select resolve_dispute((select v from t.ids where k = 'd1'), 'REFUND_FULL', '')$$, 'REASON_REQUIRED', 'note de décision obligatoire');
select t.check((select status = 'RESOLVED' and outcome = 'REFUND_FULL' and refund_amount_minor = 400000 and refund_id is not null
                from resolve_dispute((select v from t.ids where k = 'd1'), 'REFUND_FULL', 'Prestation non réalisée, remboursement.')),
  'administrateur : remboursement intégral du payeur (REFUND_FULL, remboursement lié)');
select t.admin();
select t.check((select status from tranches where id = (select v from t.ids where k = 'tr1')) = 'PAID'
           and (select status = 'REQUESTED' and amount_minor = 400000 from refunds where tranche_id = (select v from t.ids where k = 'tr1')),
  'litige tranché : la demande payée reste PAID tant que le remboursement n’est pas exécuté (K7)');
select t.login('f1000000-0000-4000-8000-000000000006');
select demo_settle_refund((select id from refunds where tranche_id = (select v from t.ids where k = 'tr1')));
select t.admin();
select t.check((select status = 'REFUNDED' and refunded_minor = 400000 from tranches where id = (select v from t.ids where k = 'tr1'))
           and (select status from payments where tranche_id = (select v from t.ids where k = 'tr1')) = 'REFUNDED', 'remboursement exécuté : demande REFUNDED, paiement remboursé');
select t.check(exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'tr1') and event = 'DISPUTE_RESOLVED'
                 and actor_id = 'f1000000-0000-4000-8000-000000000006' and payload->>'outcome' = 'REFUND_FULL'), 'journal : litige tranché par l’administrateur (remboursement)');
-- Second litige, ouvert par le prestataire, tranché en sa faveur (DIRECT : le paiement exécuté reste acquis, sans action).
select t.login('f1000000-0000-4000-8000-000000000001');
select simulate_tranche_system((select v from t.ids where k = 'tr2'), 'SUBMITTED');
select simulate_tranche_system((select v from t.ids where k = 'tr2'), 'PAID');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000003');
insert into t.ids select 'd2', id from open_dispute((select v from t.ids where k = 'tr2'), 'Le payeur conteste une prestation pourtant livrée.', 'OTHER');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000006');
select t.check((select opened_by_role = 'PROVIDER' and response is null from bo_disputes where id = (select v from t.ids where k = 'd2')), 'litige ouvert par le prestataire, sans réponse');
select t.hint($$select resolve_dispute((select v from t.ids where k = 'd2'), 'FUNDS_RELEASED', 'Prestation attestée.')$$, 'INVALID_OUTCOME',
  'règlement direct : fonds déjà versés, aucune libération à décider');
select t.check((select status = 'RESOLVED' and outcome = 'NO_ACTION' from resolve_dispute((select v from t.ids where k = 'd2'), 'NO_ACTION', 'Prestation attestée.')),
  'administrateur : litige tranché en faveur du prestataire (NO_ACTION, paiement acquis)');
select t.check((select tranche_status = 'PAID' and status = 'RESOLVED' and outcome = 'NO_ACTION' and resolved_by_name = 'Administratrice (test)'
                from bo_disputes where id = (select v from t.ids where k = 'd2')), 'bo_disputes : demande payée inchangée, décision et auteur');
select t.admin();
select t.check((select status from transactions where id = 'f3000000-0000-4000-8000-000000000001') = 'CLOSED', 'toutes les tranches terminées : transaction close');

-- ---------- Journal d’audit : lecture, vérification, export, recherche ----------
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check((select count(*) from bo_audit('f3000000-0000-4000-8000-000000000001')) = (select (bo_audit_verify('f3000000-0000-4000-8000-000000000001')->>'count')::int),
  'bo_audit : toutes les lignes de la transaction');
select t.check((select actor_role = 'REQUESTER' and actor_name = 'Jean K. (test)' and event = 'STATUS_CHANGE' and to_status = 'PENDING_REVIEW'
                from bo_audit('f3000000-0000-4000-8000-000000000001') where to_status = 'PENDING_REVIEW'), 'bo_audit : acteur affiché avec son rôle au dossier');
select t.check((select actor_role from bo_audit('f3000000-0000-4000-8000-000000000001') where event = 'VALIDATION_DECISION') = 'VALIDATOR', 'bo_audit : rôle de plateforme du validateur');
select t.check((select tranche_seq from bo_audit('f3000000-0000-4000-8000-000000000001') where event = 'DISPUTE_OPENED' limit 1) = 1, 'bo_audit : numéro de tranche');
select t.check((select bool_and(length(hash) = 64) from bo_audit('f3000000-0000-4000-8000-000000000001')), 'bo_audit : empreintes entières');
select t.check((bo_audit_verify('f3000000-0000-4000-8000-000000000001')->>'valid')::boolean, 'chaîne vérifiée sur un parcours complet');
select log_audit_export('f3000000-0000-4000-8000-000000000001', 25);
select t.check((select payload->>'format' = 'csv' and (payload->>'rows')::int = 25 and actor_id = auth.uid()
                from bo_audit('f3000000-0000-4000-8000-000000000001') where event = 'AUDIT_EXPORTED'), 'export journalisé (format, nombre de lignes, auteur)');
select t.check((bo_audit_verify('f3000000-0000-4000-8000-000000000001')->>'valid')::boolean, 'chaîne toujours valide après l’export');
select t.check(exists (select 1 from bo_find_transactions('UNIVERSITE PRIVEE') where id = 'f3000000-0000-4000-8000-000000000002'), 'recherche par objectif, sans accents ni casse');
select t.check(exists (select 1 from bo_find_transactions('marie n.') where id = 'f3000000-0000-4000-8000-000000000001'), 'recherche par nom d’une partie');
select t.check(exists (select 1 from bo_find_transactions('F3000000') where id = 'f3000000-0000-4000-8000-000000000001'), 'recherche par référence du dossier');
select t.check(exists (select 1 from bo_find_transactions('Étude notariale') where id = 'f3000000-0000-4000-8000-000000000007'), 'recherche par prestataire');
select t.check(exists (select 1 from bo_find_transactions((select k.reference from tranche_tokens k where k.tranche_id = 'f4000000-0000-4000-8000-000000000001'))
                       where id = 'f3000000-0000-4000-8000-000000000007'), 'recherche par référence d’eQR (18 caractères ; jeton en CONDITIONAL seulement)');
select t.hint($$select * from bo_audit('f3000000-0000-4000-8000-0000000000ff')$$, 'TX_NOT_FOUND', 'journal d’une transaction inconnue');
select t.admin();

-- ---------- Approbation : opération active et première demande soumise (lot X v2 : plus d’émission simulée du jeton) ----------
select t.login('f1000000-0000-4000-8000-000000000005');
select claim_dossier('f3000000-0000-4000-8000-000000000006');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000006', true, true)) = 'ACTIVE', 'approbation : opération active directement (sans jeton ni auto_issue_token)');
select t.admin();
select t.check((select status from tranches where tx_id = 'f3000000-0000-4000-8000-000000000006' and seq = 1) = 'SUBMITTED'
           and exists (select 1 from notifications where tx_id = 'f3000000-0000-4000-8000-000000000006' and event = 'PAYMENT_REQUEST_RECEIVED'
                       and user_id = 'f1000000-0000-4000-8000-000000000001'),
  'première demande due soumise (RG-12) et alerte PAYMENT_REQUEST_RECEIVED au payeur (non initiateur)');
select t.login('f1000000-0000-4000-8000-000000000005');
select t.check((select array_agg(event order by event) = array['REQUEST_SUBMITTED','TOKEN_ISSUED'] and bool_and(actor_name is null and actor_role is null)
                 from bo_audit('f3000000-0000-4000-8000-000000000006') where actor_id is null),
  'bo_audit : étapes du système (jeton émis puis demande soumise, lot X-C T7) sans acteur');
select t.admin();
-- Hors mock_mode (production) : même parcours, aucune simulation (l’approbation active l’opération).
update app_config set value = 'false' where key = 'mock_mode';
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000003', true, true)) = 'ACTIVE', 'hors mock_mode : approbation → ACTIVE, sans simulation');
select t.admin();
update app_config set value = 'true' where key = 'mock_mode';

-- ---------- Validation de démonstration : case cochée par le validateur simulé ----------
do $$ begin
  if to_regprocedure('public.demo_review(uuid, boolean, text)') is null then
    perform t.check(true, 'demo_review absente (mock_mode désactivé à la migration) : rien à vérifier');
  end if;
end $$;
select t.login('f1000000-0000-4000-8000-000000000002');
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000008','vertical','EDUCATION','step','recap','amountMinor','80000','currency','XAF',
  'purpose','Démonstration (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Année','amountMinor','80000','dueDate',(current_date + 3)::text))));
select add_document('f3000000-0000-4000-8000-000000000008', 'ENROLMENT_CERTIFICATE', 'f3000000-0000-4000-8000-000000000008/ENROLMENT_CERTIFICATE/a.pdf', 'a.pdf', 'application/pdf', 1000);
select transition_tx('f3000000-0000-4000-8000-000000000008', 'SUBMITTED');
-- tx9 : reste dans la file pour la section du second facteur.
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000009','vertical','EDUCATION','step','recap','amountMinor','70000','currency','XAF',
  'purpose','Transport scolaire (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Année','amountMinor','70000','dueDate',(current_date + 30)::text))));
select add_document('f3000000-0000-4000-8000-000000000009', 'ENROLMENT_CERTIFICATE', 'f3000000-0000-4000-8000-000000000009/ENROLMENT_CERTIFICATE/a.pdf', 'a.pdf', 'application/pdf', 1000);
select transition_tx('f3000000-0000-4000-8000-000000000009', 'SUBMITTED');
select t.check((select status from demo_review('f3000000-0000-4000-8000-000000000008', true)) = 'ACTIVE', 'demo_review : approbation → ACTIVE (lot X v2)');
select t.admin();
select t.check((select bool_and(amount_checked) from validations where tx_id = 'f3000000-0000-4000-8000-000000000008'), 'demo_review : case cochée par le validateur simulé');

-- ---------- Second facteur exigé (production) : ni interface ni API sans aal2 ----------
update app_config set value = 'true' where key = 'require_staff_mfa';
select t.login('f1000000-0000-4000-8000-000000000005', 'aal1');
select t.check(not is_validator(), 'aal1 : is_validator() faux quand le second facteur est exigé');
select t.check(t.n('select * from bo_dossiers') = 0, 'aal1 : file des dossiers vide');
select t.check((select count(*) from transactions where id = 'f3000000-0000-4000-8000-000000000002') = 0, 'aal1 : dossiers d’autrui invisibles (RLS)');
select t.check((select count(*) from audit_log where tx_id = 'f3000000-0000-4000-8000-000000000002') = 0, 'aal1 : journal d’autrui invisible (RLS)');
select t.hint($$select claim_dossier('f3000000-0000-4000-8000-000000000009')$$, 'VALIDATOR_ONLY', 'aal1 : prise en charge refusée');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000009', true, true)$$, 'VALIDATOR_ONLY', 'aal1 : décision refusée');
select t.hint($$select * from bo_audit('f3000000-0000-4000-8000-000000000001')$$, 'VALIDATOR_ONLY', 'aal1 : journal refusé');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000006', 'aal1');
select t.check(not is_admin() and t.n('select * from bo_disputes') = 0, 'aal1 : administrateur sans droits ni litiges');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000005', 'aal2');
select t.check(is_validator() and t.n($$select * from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000009'$$) = 1, 'aal2 : validateur admis, file visible');
select t.check((select status from claim_dossier('f3000000-0000-4000-8000-000000000009')) = 'IN_REVIEW', 'aal2 : prise en charge acceptée');
select t.check((select status from decide_tx('f3000000-0000-4000-8000-000000000009', true, true)) = 'ACTIVE', 'aal2 : décision acceptée');
select t.admin();
select t.login('f1000000-0000-4000-8000-000000000006', 'aal2');
select t.check(is_admin(), 'aal2 : administrateur admis');
select t.admin();
update app_config set value = 'false' where key = 'require_staff_mfa';
select t.login('f1000000-0000-4000-8000-000000000004', 'aal1');
select t.check(is_validator(), 'second facteur non exigé : aal1 suffit (développement)');
select t.admin();

-- ---------- Parcours par défaut (platform_review = NEVER) : la file ne reçoit plus le dossier ----------
update request_modules set platform_review = 'NEVER' where code = 'EDUCATION';
select t.login('f1000000-0000-4000-8000-000000000002');
select save_draft(jsonb_build_object('id','f3000000-0000-4000-8000-000000000010','vertical','EDUCATION','step','recap','amountMinor','60000','currency','XAF',
  'purpose','Activités périscolaires (test lot 5)','beneficiaryName','Awa','counterpartyPhone','+33 6 22 22 00 01',
  'provider',jsonb_build_object('id','f2000000-0000-4000-8000-000000000001','name','Lycée de la Réunification (test)'),'planType','SINGLE',
  'tranches',jsonb_build_array(jsonb_build_object('label','Année','amountMinor','60000','dueDate',(current_date + 3)::text))));
select add_document('f3000000-0000-4000-8000-000000000010', 'ENROLMENT_CERTIFICATE', 'f3000000-0000-4000-8000-000000000010/ENROLMENT_CERTIFICATE/a.pdf', 'a.pdf', 'application/pdf', 1000);
select t.check((select status from transition_tx('f3000000-0000-4000-8000-000000000010', 'SUBMITTED')) = 'ACTIVE', 'platform_review NEVER : soumission → ACTIVE directement');
select t.admin();
select t.check(exists (select 1 from audit_log where tx_id = 'f3000000-0000-4000-8000-000000000010' and event = 'AUTO_ACTIVATED' and from_status = 'DRAFT' and to_status = 'ACTIVE')
           and not exists (select 1 from notifications where tx_id = 'f3000000-0000-4000-8000-000000000010' and event = 'TX_VALIDATED'),
  'activation automatique journalisée (AUTO_ACTIVATED), sans alerte TX_VALIDATED (aucune décision du bureau)');
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check(t.n($$select * from bo_dossiers where id = 'f3000000-0000-4000-8000-000000000010'$$) = 0, 'bo_dossiers : un dossier activé automatiquement n’entre pas dans la file');
select t.check((select status from claim_dossier('f3000000-0000-4000-8000-000000000010')) = 'ACTIVE'
           and not exists (select 1 from audit_log where tx_id = 'f3000000-0000-4000-8000-000000000010' and to_status = 'IN_REVIEW'),
  'claim_dossier sur un dossier actif : sans effet (reste ACTIVE, aucune prise en charge)');
select t.hint($$select decide_tx('f3000000-0000-4000-8000-000000000010', true, true)$$, 'NOT_IN_REVIEW', 'aucune décision sur un dossier hors revue');
select t.admin();

-- ---------- Chaîne rompue : une ligne altérée est détectée ----------
-- Altération volontaire (rôle propriétaire, déclencheur d’ajout seul suspendu), annulée par le ROLLBACK final.
alter table audit_log disable trigger audit_no_update;
update audit_log set payload = payload || '{"altere":true}'
 where id = (select min(id) from audit_log where tx_id = 'f3000000-0000-4000-8000-000000000002');
alter table audit_log enable trigger audit_no_update;
select t.login('f1000000-0000-4000-8000-000000000004');
select t.check(not (bo_audit_verify('f3000000-0000-4000-8000-000000000002')->>'valid')::boolean, 'ligne altérée : chaîne signalée rompue');
select t.check((bo_audit_verify('f3000000-0000-4000-8000-000000000001')->>'valid')::boolean, 'les autres transactions restent vérifiées');
select t.admin();

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
