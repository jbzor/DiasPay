-- À exécuter dans l'éditeur SQL Supabase (rôle postgres) sur un projet de TEST.
-- Tout est annulé à la fin (ROLLBACK). Lire les lignes PASS / FAIL.
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
-- exécute une instruction attendue en échec ; pass si exception
create function t.fails(sql text, label text) returns void language plpgsql as $$
declare ok boolean := false;
begin
  begin execute sql; exception when others then ok := true; end;
  perform t.check(ok, label);
end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- ---------- Jeu d'essai ----------
insert into auth.users(id, phone) values
 ('00000000-0000-0000-0000-000000000001','+33600000001'),  -- demandeur
 ('00000000-0000-0000-0000-000000000002','+33600000002'),  -- payeur
 ('00000000-0000-0000-0000-000000000003','+237600000003'), -- prestataire
 ('00000000-0000-0000-0000-000000000004','+237600000004'), -- validateur A
 ('00000000-0000-0000-0000-000000000005','+237600000005'), -- validateur B
 ('00000000-0000-0000-0000-000000000006','+237600000006'), -- administrateur
 ('00000000-0000-0000-0000-000000000007','+33600000007');  -- étranger au dossier
update profiles set platform_role='VALIDATOR' where phone in ('+237600000004','+237600000005');
update profiles set platform_role='ADMIN' where phone='+237600000006';
-- Compte seulement les sept utilisateurs du test (la base peut déjà contenir des comptes, dont ceux du seed).
select t.check((select count(*) from profiles where id::text like '00000000-0000-0000-0000-00000000000_')=7, 'profils créés automatiquement à l''inscription');

-- ---------- Structure et droits ----------
select t.check((select count(*) from pg_tables where schemaname='public' and not rowsecurity)=0,
  'RLS activée sur toutes les tables publiques');
select t.check(not exists (select 1 from information_schema.routine_privileges
   where grantee='anon' and routine_schema='public' and routine_name in
   ('transition_tx','decide_tx','create_tranches','transition_tranche','decide_tranche','confirm_by_reference',
    'open_dispute','resolve_dispute','simulate_tranche_system','simulate_system_transition','_set_tranche_status',
    'release_due_tranches','activate_due_tranches')),
  'aucune fonction sensible exécutable par anon');
select t.check(not exists (select 1 from information_schema.routine_privileges
   where grantee='authenticated' and routine_schema='public' and routine_name in
   ('_set_tranche_status','_issue_tranche_token','release_due_tranches','activate_due_tranches')),
  'fonctions internes non exécutables par authenticated');

-- ---------- Parcours scolarité : création ----------
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('10000000-0000-0000-0000-000000000001','EDUCATION','Scolarité 2026-2027',900000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id, user_id, role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select t.check((select count(*) from create_tranches('10000000-0000-0000-0000-000000000001',
  '[{"label":"Inscription","amount_minor":300000,"due_date":"2026-12-01"},{"label":"T1","amount_minor":300000,"due_date":"2027-01-15"},{"label":"T2","amount_minor":300000,"due_date":"2027-04-15"}]'::jsonb))=3,
  'création de 3 tranches par le demandeur');
select t.fails($$select transition_tx('10000000-0000-0000-0000-000000000001','SUBMITTED')$$,
  'soumission refusée sans pièce justificative');
insert into documents(tx_id, kind, storage_path, mime_type, size_bytes, uploaded_by)
 values ('10000000-0000-0000-0000-000000000001','ENROLMENT_CERTIFICATE','10000000-0000-0000-0000-000000000001/a.pdf','application/pdf',1000,'00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tx('10000000-0000-0000-0000-000000000001','SUBMITTED'))='SUBMITTED',
  'soumission acceptée avec plan et pièce');
with u as (update transactions set status='VALIDATED' where id='10000000-0000-0000-0000-000000000001' returning 1)
  select t.check((select count(*) from u)=0, 'changement de statut direct sans effet pour le client (RLS)');
select t.check((select status from transactions where id='10000000-0000-0000-0000-000000000001')='SUBMITTED', 'le statut est resté SUBMITTED');
select t.admin();

-- ---------- Isolation (RLS) ----------
select t.login('00000000-0000-0000-0000-000000000007');
select t.check((select count(*) from transactions)=0, 'un étranger ne voit aucune transaction');
select t.check((select count(*) from tranches)=0, 'un étranger ne voit aucune tranche');
select t.check((select count(*) from audit_log)=0, 'un étranger ne voit pas le journal');
select t.fails($$select transition_tx('10000000-0000-0000-0000-000000000001','DRAFT')$$, 'un étranger ne peut pas agir sur le dossier');
select t.admin();
select t.anon();
select t.check((select count(*) from transactions)=0, 'anon ne voit aucune transaction');
select t.fails($$select transition_tx('10000000-0000-0000-0000-000000000001','DRAFT')$$, 'anon ne peut pas appeler transition_tx');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000003');
select t.check((select count(*) from transactions)=1, 'le prestataire voit la transaction');
select t.fails($$select transition_tx('10000000-0000-0000-0000-000000000001','IN_REVIEW')$$, 'le prestataire ne peut pas passer le dossier en revue');
select t.admin();

-- ---------- Validation ----------
select t.login('00000000-0000-0000-0000-000000000004');
select t.check((select status from transition_tx('10000000-0000-0000-0000-000000000001','IN_REVIEW'))='IN_REVIEW', 'le validateur prend en charge le dossier');
select t.check((select status from decide_tx('10000000-0000-0000-0000-000000000001', true))='VALIDATED', 'un seul validateur suffit pour la scolarité');
select t.fails($$select decide_tx('10000000-0000-0000-0000-000000000001', true)$$, 'décision impossible une fois validé');
select t.admin();

-- ---------- Jeton, activation, paiement (simulation) ----------
select t.login('00000000-0000-0000-0000-000000000002');
select t.check((select status from simulate_system_transition('10000000-0000-0000-0000-000000000001','TOKEN_ISSUED'))='TOKEN_ISSUED', 'jeton émis (simulé)');
select t.check((select status from simulate_system_transition('10000000-0000-0000-0000-000000000001','IN_PROGRESS'))='IN_PROGRESS', 'transaction en cours');
select t.admin();
select set_config('t.t1', (select id::text from tranches where tx_id='10000000-0000-0000-0000-000000000001' and seq=1), false);
select set_config('t.t2', (select id::text from tranches where tx_id='10000000-0000-0000-0000-000000000001' and seq=2), false);
select set_config('t.t3', (select id::text from tranches where tx_id='10000000-0000-0000-0000-000000000001' and seq=3), false);
select t.login('00000000-0000-0000-0000-000000000002');
select t.check((select status from simulate_tranche_system(current_setting('t.t1')::uuid,'AWAITING_PAYMENT'))='AWAITING_PAYMENT', 'tranche 1 activée');
select t.check((select status from simulate_tranche_system(current_setting('t.t1')::uuid,'PAID_LOCKED'))='PAID_LOCKED', 'tranche 1 payée et verrouillée');
select t.fails($$insert into payments(tx_id,tranche_id,provider,status) values ('10000000-0000-0000-0000-000000000001',current_setting('t.t1')::uuid,'MOCK','SUCCEEDED')$$, 'un client ne peut pas insérer un paiement');
select t.admin();
insert into payments(tx_id,tranche_id,provider,status) values ('10000000-0000-0000-0000-000000000001',current_setting('t.t1')::uuid,'MOCK','SUCCEEDED') on conflict do nothing;
select t.check((select count(*) from payments where tranche_id=current_setting('t.t1')::uuid and status='SUCCEEDED')=1, 'un seul paiement réussi par tranche');
select t.fails($$insert into payments(tx_id,tranche_id,provider,status) values ('10000000-0000-0000-0000-000000000001',current_setting('t.t1')::uuid,'MOCK','SUCCEEDED')$$, 'second paiement réussi refusé (index unique)');

-- ---------- Confirmation par scan ----------
select set_config('t.ref1', (select reference from tranche_tokens where tranche_id=current_setting('t.t1')::uuid), false);
select t.check(length(current_setting('t.ref1'))=18, 'référence du jeton : 18 caractères hexadécimaux');
select t.login('00000000-0000-0000-0000-000000000002');
select t.fails($$select confirm_by_reference(current_setting('t.ref1'))$$, 'le payeur ne peut pas confirmer par scan');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000003');
select t.fails($$select confirm_by_reference(current_setting('t.ref1'), now() + interval '10 minutes')$$, 'heure d''appareil trop avancée refusée');
select t.check((select status from confirm_by_reference(current_setting('t.ref1')))='CONFIRMED', 'le prestataire confirme par scan');
select t.fails($$select confirm_by_reference(current_setting('t.ref1'))$$, 'second scan du même QR refusé');
select t.admin();
select t.check((select contest_ends_at > now() + interval '71 hours' and contest_ends_at < now() + interval '73 hours' from tranches where id=current_setting('t.t1')::uuid), 'délai de contestation de 72 h');

-- ---------- Litige ----------
select t.login('00000000-0000-0000-0000-000000000002');
select t.fails($$select open_dispute(current_setting('t.t1')::uuid,'court')$$, 'motif de litige trop court refusé');
select t.check((select status from open_dispute(current_setting('t.t1')::uuid,'Prestation non réalisée à ce jour')) ='OPEN', 'le payeur ouvre un litige');
select t.admin();
select t.check((select status from tranches where id=current_setting('t.t1')::uuid)='DISPUTED', 'tranche suspendue en litige');
select t.login('00000000-0000-0000-0000-000000000003');
select t.fails($$select resolve_dispute((select id from disputes limit 1),'RELEASE_TO_PROVIDER','x')$$, 'le prestataire ne peut pas trancher');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
select t.fails($$select resolve_dispute((select id from disputes limit 1),'RELEASE_TO_PROVIDER','x')$$, 'un validateur non administrateur ne peut pas trancher');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000006');
select t.check((select status from resolve_dispute((select id from disputes limit 1),'REFUND_PAYER','Prestation non justifiée'))='REFUNDED_TO_PAYER', 'l''administrateur rembourse le payeur');
select t.admin();
select t.check((select status from tranches where id=current_setting('t.t1')::uuid)='CANCELLED', 'tranche annulée après remboursement');
select t.check((select status from payments where tranche_id=current_setting('t.t1')::uuid)='REFUNDED', 'paiement marqué remboursé');

-- ---------- Déblocage automatique ----------
select t.login('00000000-0000-0000-0000-000000000002');
select simulate_tranche_system(current_setting('t.t2')::uuid,'AWAITING_PAYMENT');
select simulate_tranche_system(current_setting('t.t2')::uuid,'PAID_LOCKED');
select t.admin();
select set_config('t.ref2', (select reference from tranche_tokens where tranche_id=current_setting('t.t2')::uuid), false);
select t.login('00000000-0000-0000-0000-000000000003');
select confirm_by_reference(current_setting('t.ref2'));
select t.admin();
select t.check(release_due_tranches()=0, 'pas de déblocage avant la fin du délai');
update tranches set contest_ends_at = now() - interval '1 minute' where id=current_setting('t.t2')::uuid;
select t.check(release_due_tranches()=1, 'déblocage automatique après le délai');
select t.check((select status from tranches where id=current_setting('t.t2')::uuid)='RELEASED', 'tranche 2 débloquée');
select t.check((select trigger from release_events where tranche_id=current_setting('t.t2')::uuid)='AUTO_TIMEOUT', 'événement de déblocage AUTO_TIMEOUT');
select t.check(activate_due_tranches()>=0, 'activation des tranches exécutable');

-- ---------- Clôture ----------
select t.login('00000000-0000-0000-0000-000000000002');
select simulate_tranche_system(current_setting('t.t3')::uuid,'AWAITING_PAYMENT');
select t.check((select status from transition_tranche(current_setting('t.t3')::uuid,'CANCELLED'))='CANCELLED', 'le payeur annule une tranche en attente de paiement');
select t.admin();
select t.check((select status from transactions where id='10000000-0000-0000-0000-000000000001')='CLOSED', 'la transaction se clôt quand toutes les tranches sont terminées');

-- ---------- Journal d'audit ----------
select t.check(verify_audit('10000000-0000-0000-0000-000000000001'), 'chaîne d''audit valide');
select t.fails($$update audit_log set event='X' where tx_id='10000000-0000-0000-0000-000000000001'$$, 'journal : modification refusée');
select t.fails($$delete from audit_log where tx_id='10000000-0000-0000-0000-000000000001'$$, 'journal : suppression refusée');

-- ---------- Double validation (terrain) ----------
update app_config set value = value || ',LAND' where key = 'open_verticals';  -- 0005 : terrain ouvert le temps du test (vague 2)
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('20000000-0000-0000-0000-000000000001','LAND','Parcelle',12500000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select count(*) from create_tranches('20000000-0000-0000-0000-000000000001','[{"label":"Promesse","amount_minor":2500000},{"label":"Acte","amount_minor":10000000}]'::jsonb);
insert into documents(tx_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('20000000-0000-0000-0000-000000000001','SUPPORTING_DOCUMENT','20000000-0000-0000-0000-000000000001/t.pdf','application/pdf',1000,'00000000-0000-0000-0000-000000000001');
select transition_tx('20000000-0000-0000-0000-000000000001','SUBMITTED');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
select transition_tx('20000000-0000-0000-0000-000000000001','IN_REVIEW');
select t.check((select status from decide_tx('20000000-0000-0000-0000-000000000001', true))='IN_REVIEW', 'terrain : une validation ne suffit pas');
select t.fails($$select decide_tx('20000000-0000-0000-0000-000000000001', true)$$, 'le même validateur ne peut pas valider deux fois');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000005');
select t.check((select status from decide_tx('20000000-0000-0000-0000-000000000001', true))='VALIDATED', 'terrain : deuxième validateur distinct => validé');
select t.admin();

-- ---------- Rejet puis abandon (décision D4) ----------
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('30000000-0000-0000-0000-000000000001','HEALTH','Soins',180000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id,user_id,role) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select count(*) from create_tranches('30000000-0000-0000-0000-000000000001','[{"label":"Soins","amount_minor":180000}]'::jsonb);
insert into documents(tx_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('30000000-0000-0000-0000-000000000001','QUOTE','30000000-0000-0000-0000-000000000001/q.pdf','application/pdf',1000,'00000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000001','BENEFICIARY_ID','30000000-0000-0000-0000-000000000001/id.jpg','image/jpeg',1000,'00000000-0000-0000-0000-000000000001');
select transition_tx('30000000-0000-0000-0000-000000000001','SUBMITTED');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
select transition_tx('30000000-0000-0000-0000-000000000001','IN_REVIEW');
select t.check((select status from decide_tx('30000000-0000-0000-0000-000000000001', false, 'Devis illisible'))='REJECTED', 'rejet avec motif');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tx('30000000-0000-0000-0000-000000000001','CANCELLED'))='CANCELLED', 'abandon d''un dossier rejeté (D4)');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('40000000-0000-0000-0000-000000000001','HEALTH','Brouillon à supprimer',1000,'XAF','00000000-0000-0000-0000-000000000001');
delete from transactions where id='40000000-0000-0000-0000-000000000001';
select t.check(not exists (select 1 from transactions where id='40000000-0000-0000-0000-000000000001'), 'suppression d''un brouillon jamais soumis (D4)');
with d as (delete from transactions where id='10000000-0000-0000-0000-000000000001' returning 1)
  select t.check((select count(*) from d)=0, 'suppression d''un dossier soumis sans effet (D4)');
select t.check(exists (select 1 from transactions where id='10000000-0000-0000-0000-000000000001'), 'le dossier soumis existe toujours');
select t.admin();

-- ---------- Profils ----------
select t.login('00000000-0000-0000-0000-000000000002');
update profiles set full_name='Marie N.', primary_role='PAYER' where id='00000000-0000-0000-0000-000000000002';
select t.check((select full_name from profiles where id='00000000-0000-0000-0000-000000000002')='Marie N.', 'un utilisateur modifie son profil');
select t.fails($$update profiles set platform_role='ADMIN' where id='00000000-0000-0000-0000-000000000002'$$, 'un utilisateur ne peut pas s''octroyer un rôle de plateforme');
select t.fails($$update profiles set kyc_status='VERIFIED' where id='00000000-0000-0000-0000-000000000002'$$, 'un utilisateur ne peut pas modifier son statut KYC');
select t.check((select count(*) from profiles)=1, 'un utilisateur ne voit que son profil');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
update profiles set full_name='Validateur A' where id='00000000-0000-0000-0000-000000000004';
select t.check((select full_name from profiles where id='00000000-0000-0000-0000-000000000004')='Validateur A', 'un validateur modifie son propre profil');
select t.admin();

-- ---------- Brouillon corrigé : non supprimable ----------
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('50000000-0000-0000-0000-000000000001','HEALTH','Dossier à corriger',1000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id,user_id,role) values
 ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select count(*) from create_tranches('50000000-0000-0000-0000-000000000001','[{"label":"Soins","amount_minor":1000}]'::jsonb);
insert into documents(tx_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('50000000-0000-0000-0000-000000000001','QUOTE','50000000-0000-0000-0000-000000000001/q.pdf','application/pdf',10,'00000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000001','BENEFICIARY_ID','50000000-0000-0000-0000-000000000001/id.jpg','image/jpeg',10,'00000000-0000-0000-0000-000000000001');
select transition_tx('50000000-0000-0000-0000-000000000001','SUBMITTED');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
select transition_tx('50000000-0000-0000-0000-000000000001','IN_REVIEW');
select decide_tx('50000000-0000-0000-0000-000000000001', false, 'Pièce manquante');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tx('50000000-0000-0000-0000-000000000001','DRAFT'))='DRAFT', 'un dossier rejeté revient en brouillon pour correction');
with d as (delete from transactions where id='50000000-0000-0000-0000-000000000001' returning 1)
  select t.check((select count(*) from d)=0, 'un brouillon de correction (déjà audité) ne se supprime pas');
select t.admin();
select t.check(has_audit('50000000-0000-0000-0000-000000000001') and not has_audit('40000000-0000-0000-0000-000000000001'), 'has_audit distingue dossier audité et brouillon vierge');
-- ---------- Résumé : échoue (code de sortie non nul avec ON_ERROR_STOP) s'il y a un seul FAIL ----------
do $$
declare total int; bad int;
begin
  select count(*), count(*) filter (where not ok) into total, bad from t.results;
  if bad > 0 then raise exception 'ECHEC : % vérification(s) sur %', bad, total; end if;
  raise notice 'RESULTAT : % vérifications, toutes réussies', total;
end $$;
rollback;
