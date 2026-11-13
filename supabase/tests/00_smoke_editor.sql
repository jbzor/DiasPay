-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 00_smoke.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
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
-- exécute une instruction attendue en échec avec le code (hint) indiqué
create function t.hint(sql text, expected text, label text) returns void language plpgsql as $$
declare h text; m text;
begin
  begin execute sql; exception when others then get stacked diagnostics h = pg_exception_hint, m = message_text; end;
  if h is distinct from expected then raise notice '   attendu %, obtenu % (%)', expected, coalesce(h, 'aucune erreur'), m; end if;
  perform t.check(h is not distinct from expected, label || ' [' || expected || ']');
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
-- Lot X v2 (X4, 0020) : niveau d’enrôlement réglé ici comme après la revue d’un dossier (N1 requis pour initier en demandeur).
update profiles set enrolment_level = 'N1' where id = '00000000-0000-0000-0000-000000000001';
-- Compte seulement les sept utilisateurs du test (la base peut déjà contenir des comptes, dont ceux du seed).
select t.check((select count(*) from profiles where id::text like '00000000-0000-0000-0000-00000000000_')=7, 'profils créés automatiquement à l''inscription');

-- Lot 5 : pas d’émission simulée du jeton à la validation dans ce test (étapes système jouées explicitement).
update app_config set value = 'false' where key = 'auto_issue_token';
-- Lot X v2 (0014) : platform_review vaut NEVER partout (opération active dès la soumission). Le parcours de revue du bureau
-- est joué ici sur la scolarité et la santé ; le parcours sans revue, sur l’agro (règlement conditionnel).
update request_modules set platform_review = 'ALWAYS' where code in ('EDUCATION','HEALTH');

-- ---------- Structure et droits ----------
select t.check((select count(*) from pg_tables where schemaname='public' and not rowsecurity)=0,
  'RLS activée sur toutes les tables publiques');
select t.check(not exists (select 1 from information_schema.routine_privileges
   where grantee='anon' and routine_schema='public' and routine_name in
   ('transition_tx','decide_tx','create_tranches','transition_tranche','decide_tranche','confirm_by_reference',
    'open_dispute','resolve_dispute','simulate_tranche_system','simulate_system_transition','_set_tranche_status',
    'release_due_tranches','activate_due_tranches',
    -- Lot X v2 (0014, 0016)
    'submit_operation','claim_dossier','request_info','answer_info','reject_request','confirm_service','submit_evidence',
    'approve_release','start_payment','request_refund','respond_dispute','lift_suspension','suspend_operation',
    'expire_due_requests','accept_plan')),
  'aucune fonction sensible exécutable par anon');
select t.check(not exists (select 1 from information_schema.routine_privileges
   where grantee='authenticated' and routine_schema='public' and routine_name in
   ('_set_tranche_status','_issue_tranche_token','release_due_tranches','activate_due_tranches',
    -- Lot X v2 (0014)
    '_set_tx_status','_set_funds_state','_submit_request','_activate_operation','_platform_review','_create_refund',
    '_resolve_dispute_v2','_process_payment_event','expire_due_requests')),
  'fonctions internes non exécutables par authenticated');

-- ---------- Parcours scolarité : création ----------
-- Lot X v2 : échéances relatives à la date du jour (la première dans les 7 jours de prévenance : soumise à l’activation).
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('10000000-0000-0000-0000-000000000001','EDUCATION','Scolarité 2026-2027',900000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id, user_id, role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select t.check((select count(*) from create_tranches('10000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('label','Inscription','amount_minor',300000,'due_date',current_date + 3),
  jsonb_build_object('label','T1','amount_minor',300000,'due_date',current_date + 60),
  jsonb_build_object('label','T2','amount_minor',300000,'due_date',current_date + 150))))=3,
  'création de 3 tranches par le demandeur');
select t.fails($$select transition_tx('10000000-0000-0000-0000-000000000001','SUBMITTED')$$,
  'soumission refusée sans pièce justificative');
insert into documents(tx_id, kind, storage_path, mime_type, size_bytes, uploaded_by)
 values ('10000000-0000-0000-0000-000000000001','ENROLMENT_CERTIFICATE','10000000-0000-0000-0000-000000000001/a.pdf','application/pdf',1000,'00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tx('10000000-0000-0000-0000-000000000001','SUBMITTED'))='PENDING_REVIEW',
  'soumission acceptée avec plan et pièce : en attente de revue (platform_review ALWAYS)');
with u as (update transactions set status='ACTIVE' where id='10000000-0000-0000-0000-000000000001' returning 1)
  select t.check((select count(*) from u)=0, 'changement de statut direct sans effet pour le client (RLS)');
select t.check((select status from transactions where id='10000000-0000-0000-0000-000000000001')='PENDING_REVIEW', 'le statut est resté PENDING_REVIEW');
select t.admin();
select set_config('t.t1', (select id::text from tranches where tx_id='10000000-0000-0000-0000-000000000001' and seq=1), false);
select set_config('t.t2', (select id::text from tranches where tx_id='10000000-0000-0000-0000-000000000001' and seq=2), false);
select set_config('t.t3', (select id::text from tranches where tx_id='10000000-0000-0000-0000-000000000001' and seq=3), false);

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

-- ---------- Validation (revue du bureau) ----------
select t.login('00000000-0000-0000-0000-000000000004');
select t.check((select status from transition_tx('10000000-0000-0000-0000-000000000001','IN_REVIEW'))='IN_REVIEW', 'le validateur prend en charge le dossier');
select t.check((select status from decide_tx('10000000-0000-0000-0000-000000000001', true, true))='ACTIVE', 'un seul validateur suffit pour la scolarité : opération active');
select t.fails($$select decide_tx('10000000-0000-0000-0000-000000000001', true, true)$$, 'décision impossible une fois validé');
select t.admin();

-- ---------- Activation, paiement (simulation) ----------
-- Lot X v2 : plus de statuts TOKEN_ISSUED / IN_PROGRESS ; l’activation soumet les demandes dues ; en règlement direct, pas de jeton.
select t.check((select status from tranches where id=current_setting('t.t1')::uuid)='SUBMITTED',
  'tranche 1 activée : demande soumise à l’activation (échéance dans les 7 jours)');
select t.check((select array_agg(status::text order by seq)::text from tranches where tx_id='10000000-0000-0000-0000-000000000001')='{SUBMITTED,DRAFT,DRAFT}',
  'opération active : demandes 2 et 3 programmées (DRAFT)');
select t.check(not exists (select 1 from tranche_tokens k join tranches tr on tr.id = k.tranche_id where tr.tx_id='10000000-0000-0000-0000-000000000001'),
  'règlement direct : aucun jeton émis pour la demande soumise');
select t.check((select count(distinct user_id) from notifications where tx_id='10000000-0000-0000-0000-000000000001' and event='TX_VALIDATED')=3,
  'alerte TX_VALIDATED aux trois parties après la décision du bureau');
select t.check(exists (select 1 from notifications where tx_id='10000000-0000-0000-0000-000000000001' and event='PAYMENT_REQUEST_RECEIVED'
                        and user_id='00000000-0000-0000-0000-000000000002' and payload->>'trancheId'=current_setting('t.t1')),
  'demande soumise : alerte PAYMENT_REQUEST_RECEIVED au payeur (non initiateur)');
select t.login('00000000-0000-0000-0000-000000000002');
select t.check((select status::text || '/' || funds_state from simulate_tranche_system(current_setting('t.t1')::uuid,'PAID'))='PAID/NONE',
  'tranche 1 payée : PAID directement, sans blocage des fonds (règlement direct)');
select t.fails($$insert into payments(tx_id,tranche_id,provider,status) values ('10000000-0000-0000-0000-000000000001',current_setting('t.t1')::uuid,'MOCK','SUCCEEDED')$$, 'un client ne peut pas insérer un paiement');
select t.admin();
insert into payments(tx_id,tranche_id,provider,status) values ('10000000-0000-0000-0000-000000000001',current_setting('t.t1')::uuid,'MOCK','SUCCEEDED') on conflict do nothing;
select t.check((select count(*) from payments where tranche_id=current_setting('t.t1')::uuid and status='SUCCEEDED')=1, 'un seul paiement réussi par tranche');
select t.fails($$insert into payments(tx_id,tranche_id,provider,status) values ('10000000-0000-0000-0000-000000000001',current_setting('t.t1')::uuid,'MOCK','SUCCEEDED')$$, 'second paiement réussi refusé (index unique)');
select t.check(exists (select 1 from notifications where tx_id='10000000-0000-0000-0000-000000000001' and event='REQUEST_PAID' and payload->>'trancheId'=current_setting('t.t1')),
  'alerte REQUEST_PAID au paiement');

-- ---------- Litige après paiement (règlement direct) ----------
-- Lot X v2 : un litige ne change jamais le statut d’une demande payée ; issue REFUND_FULL (remboursement lié au paiement).
select t.login('00000000-0000-0000-0000-000000000002');
select t.fails($$select open_dispute(current_setting('t.t1')::uuid,'court')$$, 'motif de litige trop court refusé');
select t.check((select status from open_dispute(current_setting('t.t1')::uuid,'Prestation non réalisée à ce jour')) ='OPEN', 'le payeur ouvre un litige');
select t.admin();
select set_config('t.d1', (select id::text from disputes where tranche_id=current_setting('t.t1')::uuid), false);
select t.check((select status::text || '/' || on_hold from tranches where id=current_setting('t.t1')::uuid)='PAID/false'
           and (select status from transactions where id='10000000-0000-0000-0000-000000000001')='ACTIVE',
  'litige après paiement : demande toujours PAID (non suspendue), opération toujours ACTIVE');
select t.login('00000000-0000-0000-0000-000000000003');
select t.hint($$select resolve_dispute(current_setting('t.d1')::uuid,'REFUND_FULL','Décision')$$, 'ADMIN_ONLY', 'le prestataire ne peut pas trancher');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
select t.hint($$select resolve_dispute(current_setting('t.d1')::uuid,'REFUND_FULL','Décision')$$, 'ADMIN_ONLY', 'un validateur non administrateur ne peut pas trancher');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000006');
select t.check((select status || '/' || outcome from resolve_dispute(current_setting('t.d1')::uuid,'REFUND_FULL','Prestation non justifiée'))='RESOLVED/REFUND_FULL', 'l''administrateur rembourse le payeur');
select t.admin();
select t.check((select count(*) from refunds where tranche_id=current_setting('t.t1')::uuid and amount_minor=300000 and status='REQUESTED')=1
           and (select status from tranches where id=current_setting('t.t1')::uuid)='PAID',
  'remboursement intégral créé (en attente d’exécution), demande encore PAID');
select t.login('00000000-0000-0000-0000-000000000006');
select demo_settle_refund((select id from refunds where tranche_id=current_setting('t.t1')::uuid));
select t.admin();
select t.check((select status::text || '/' || refunded_minor from tranches where id=current_setting('t.t1')::uuid)='REFUNDED/300000', 'tranche remboursée (REFUNDED) après exécution du remboursement');
select t.check((select status from payments where tranche_id=current_setting('t.t1')::uuid)='REFUNDED', 'paiement marqué remboursé');

-- ---------- Règlement direct : versement au paiement ----------
-- Lot X v2 : en DIRECT, ni confirmation ni délai de contestation ; le déblocage automatique est joué sur l’agro (CONDITIONAL).
select t.login('00000000-0000-0000-0000-000000000002');
select simulate_tranche_system(current_setting('t.t2')::uuid,'SUBMITTED');
select t.check((select status::text || '/' || funds_state from simulate_tranche_system(current_setting('t.t2')::uuid,'PAID'))='PAID/NONE',
  'tranche 2 payée et versée sans confirmation (règlement direct)');
select t.hint($$select confirm_service(current_setting('t.t2')::uuid)$$, 'WRONG_MODE', 'règlement direct : aucune confirmation de service');
select t.check((select get_receipt(current_setting('t.t2')::uuid)->>'trancheId')=current_setting('t.t2'), 'reçu disponible dès le paiement (règlement direct)');
select t.admin();
select t.check((select trigger from release_events where tranche_id=current_setting('t.t2')::uuid)='DIRECT_PAYMENT', 'événement de versement DIRECT_PAYMENT');

-- ---------- Clôture ----------
-- Lot X v2 : seul l’initiateur (ici le demandeur) soumet plus tôt ou annule une demande.
select t.login('00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tranche(current_setting('t.t3')::uuid,'SUBMITTED'))='SUBMITTED', 'l’initiateur soumet plus tôt une demande programmée');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000002');
select t.hint($$select transition_tranche(current_setting('t.t3')::uuid,'CANCELLED')$$, 'INITIATOR_ONLY', 'le payeur ne peut pas annuler une demande (réservé à l’initiateur)');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tranche(current_setting('t.t3')::uuid,'CANCELLED'))='CANCELLED', 'l’initiateur annule une demande soumise non payée');
select t.admin();
select t.check((select status from transactions where id='10000000-0000-0000-0000-000000000001')='CLOSED', 'la transaction se clôt quand toutes les tranches sont terminées');

-- ---------- Journal d'audit ----------
select t.check(verify_audit('10000000-0000-0000-0000-000000000001'), 'chaîne d''audit valide');
select t.fails($$update audit_log set event='X' where tx_id='10000000-0000-0000-0000-000000000001'$$, 'journal : modification refusée');
select t.fails($$delete from audit_log where tx_id='10000000-0000-0000-0000-000000000001'$$, 'journal : suppression refusée');

-- ---------- Règlement conditionnel (agro) : sans revue, confirmation par scan, déblocage automatique ----------
-- Lot X v2 : le scan du prestataire ne sert qu’en CONDITIONAL, mode PROVIDER_CONFIRM, qu’aucun module n’a par défaut.
-- Configuration de test : agro ouvert et confirmé par le prestataire (délai de contestation du module : 72 h).
update request_modules set enabled = true, release_mode = 'PROVIDER_CONFIRM' where code = 'AGRO';
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('60000000-0000-0000-0000-000000000001','AGRO','Intrants agricoles',1000000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id,user_id,role) values
 ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select count(*) from create_tranches('60000000-0000-0000-0000-000000000001','[{"label":"Semences","amount_minor":400000},{"label":"Récolte","amount_minor":600000}]'::jsonb);
insert into documents(tx_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('60000000-0000-0000-0000-000000000001','SUPPORTING_DOCUMENT','60000000-0000-0000-0000-000000000001/a.pdf','application/pdf',1000,'00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tx('60000000-0000-0000-0000-000000000001','SUBMITTED'))='ACTIVE', 'platform_review NEVER : opération active dès la soumission');
select t.admin();
select t.check(exists (select 1 from audit_log where tx_id='60000000-0000-0000-0000-000000000001' and event='AUTO_ACTIVATED' and to_status='ACTIVE'), 'événement AUTO_ACTIVATED au journal');
select set_config('t.a1', (select id::text from tranches where tx_id='60000000-0000-0000-0000-000000000001' and seq=1), false);
select set_config('t.a2', (select id::text from tranches where tx_id='60000000-0000-0000-0000-000000000001' and seq=2), false);
select t.check((select array_agg(status::text order by seq)::text from tranches where tx_id='60000000-0000-0000-0000-000000000001')='{SUBMITTED,DRAFT}',
  'jalons : le premier soumis à l’activation, le suivant programmé');
select t.check((select count(*) from tranche_tokens where tranche_id=current_setting('t.a1')::uuid and revoked_at is null)=1, 'règlement conditionnel : jeton émis à la soumission de la demande');
select t.login('00000000-0000-0000-0000-000000000002');
select t.check((select status::text || '/' || funds_state from simulate_tranche_system(current_setting('t.a1')::uuid,'PAID'))='PAID/HELD', 'tranche payée et verrouillée (fonds HELD)');
select t.admin();
select set_config('t.ref1', (select reference from tranche_tokens where tranche_id=current_setting('t.a1')::uuid), false);
select t.check(length(current_setting('t.ref1'))=18, 'référence du jeton : 18 caractères hexadécimaux');
select t.login('00000000-0000-0000-0000-000000000002');
select t.fails($$select confirm_by_reference(current_setting('t.ref1'))$$, 'le payeur ne peut pas confirmer par scan');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000003');
select t.fails($$select confirm_by_reference(current_setting('t.ref1'), now() + interval '10 minutes')$$, 'heure d''appareil trop avancée refusée');
select t.check((select status::text || '/' || funds_state || '/' || (confirmed_at is not null) from confirm_by_reference(current_setting('t.ref1')))='PAID/HELD/true', 'le prestataire confirme par scan (fonds encore bloqués)');
select t.fails($$select confirm_by_reference(current_setting('t.ref1'))$$, 'second scan du même QR refusé');
select t.admin();
select t.check((select contest_ends_at > now() + interval '71 hours' and contest_ends_at < now() + interval '73 hours' from tranches where id=current_setting('t.a1')::uuid), 'délai de contestation de 72 h');

-- Déblocage automatique
select t.check(release_due_tranches()=0, 'pas de déblocage avant la fin du délai');
update tranches set contest_ends_at = now() - interval '1 minute' where id=current_setting('t.a1')::uuid;
select t.check(release_due_tranches()=1, 'déblocage automatique après le délai');
select t.check((select status::text || '/' || funds_state from tranches where id=current_setting('t.a1')::uuid)='PAID/RELEASED', 'tranche débloquée (fonds RELEASED, statut PAID)');
select t.check((select trigger from release_events where tranche_id=current_setting('t.a1')::uuid)='AUTO_TIMEOUT', 'événement de déblocage AUTO_TIMEOUT');
select t.check(exists (select 1 from notifications where tx_id='60000000-0000-0000-0000-000000000001' and event='TRANCHE_RELEASED' and payload->>'trancheId'=current_setting('t.a1')), 'alerte TRANCHE_RELEASED au déblocage');
select t.check(activate_due_tranches()>=1, 'activation des tranches exécutable');
select t.check((select status from tranches where id=current_setting('t.a2')::uuid)='SUBMITTED', 'jalon suivant soumis une fois le précédent terminé');

-- Litige avant paiement : demande suspendue (on_hold), opération SUSPENDED, puis levée
select t.login('00000000-0000-0000-0000-000000000003');
select t.check((select status from open_dispute(current_setting('t.a2')::uuid,'Semences livrées non conformes')) ='OPEN', 'le prestataire ouvre un litige avant paiement');
select t.admin();
select set_config('t.d2', (select id::text from disputes where tranche_id=current_setting('t.a2')::uuid), false);
select t.check((select status::text || '/' || on_hold from tranches where id=current_setting('t.a2')::uuid)='SUBMITTED/true'
           and (select status from transactions where id='60000000-0000-0000-0000-000000000001')='SUSPENDED',
  'tranche suspendue en litige (on_hold), opération SUSPENDED');
select t.login('00000000-0000-0000-0000-000000000002');
select t.hint($$select simulate_tranche_system(current_setting('t.a2')::uuid,'PAID')$$, 'TX_NOT_ACTIVE', 'paiement impossible pendant la suspension');
select t.check((select status from respond_dispute(current_setting('t.d2')::uuid,'Les semences sont conformes au bon de commande'))='IN_MEDIATION', 'la partie adverse répond : médiation');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000006');
select t.check((select status || '/' || outcome from resolve_dispute(current_setting('t.d2')::uuid,'NO_ACTION','Litige sans suite'))='RESOLVED/NO_ACTION', 'l’administrateur clôt le litige sans suite');
select t.admin();
select t.check((select on_hold from tranches where id=current_setting('t.a2')::uuid)=false
           and (select status from transactions where id='60000000-0000-0000-0000-000000000001')='ACTIVE',
  'suspension levée : demande payable, opération ACTIVE');
select t.login('00000000-0000-0000-0000-000000000001');
select transition_tranche(current_setting('t.a2')::uuid,'CANCELLED');
select t.admin();
select t.check((select status from transactions where id='60000000-0000-0000-0000-000000000001')='CLOSED', 'opération conditionnelle close : fonds libérés et demande restante annulée');

-- ---------- Double validation (terrain) ----------
update app_config set value = value || ',LAND' where key = 'open_verticals';  -- 0005 : terrain ouvert le temps du test (vague 2)
-- Lot X (0011) : l’ouverture d’un type de besoin se lit dans request_modules (open_verticals n’est plus lu).
do $$ begin
  if to_regclass('public.request_modules') is not null then execute 'update request_modules set enabled = true where code = ''LAND'''; end if;
end $$;
select t.login('00000000-0000-0000-0000-000000000001');
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('20000000-0000-0000-0000-000000000001','LAND','Parcelle',12500000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','PROVIDER');
select count(*) from create_tranches('20000000-0000-0000-0000-000000000001','[{"label":"Promesse","amount_minor":2500000},{"label":"Acte","amount_minor":10000000}]'::jsonb);
insert into documents(tx_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('20000000-0000-0000-0000-000000000001','SUPPORTING_DOCUMENT','20000000-0000-0000-0000-000000000001/t.pdf','application/pdf',1000,'00000000-0000-0000-0000-000000000001');
select t.check((select status from transition_tx('20000000-0000-0000-0000-000000000001','SUBMITTED'))='PENDING_REVIEW', 'terrain : double validation exigée => revue du bureau malgré platform_review NEVER');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000004');
select transition_tx('20000000-0000-0000-0000-000000000001','IN_REVIEW');
select t.check((select status from decide_tx('20000000-0000-0000-0000-000000000001', true, true))='IN_REVIEW', 'terrain : une validation ne suffit pas');
select t.fails($$select decide_tx('20000000-0000-0000-0000-000000000001', true, true)$$, 'le même validateur ne peut pas valider deux fois');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000005');
select t.check((select status from decide_tx('20000000-0000-0000-0000-000000000001', true, true))='ACTIVE', 'terrain : deuxième validateur distinct => opération active');
select t.admin();

-- ---------- Rejet : opération annulée (D4 remplacée) ----------
-- Lot X v2 : un rejet du bureau annule l’opération (CANCELLED, motif) ; le statut REJECTED et l’abandon qui suivait n’existent plus.
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
select t.check((select status || '/' || reject_reason from decide_tx('30000000-0000-0000-0000-000000000001', false, false, 'Devis illisible'))='CANCELLED/Devis illisible', 'rejet avec motif : opération annulée');
select t.admin();
select t.check((select array_agg(status::text)::text from tranches where tx_id='30000000-0000-0000-0000-000000000001')='{CANCELLED}'
           and exists (select 1 from notifications where tx_id='30000000-0000-0000-0000-000000000001' and event='TX_REJECTED'
                        and user_id='00000000-0000-0000-0000-000000000001' and payload->>'reason'='Devis illisible'),
  'dossier rejeté : demande annulée d’office, alerte TX_REJECTED avec le motif');
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

-- ---------- Dossier rejeté : plus de correction ; brouillon audité non supprimable ----------
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
select decide_tx('50000000-0000-0000-0000-000000000001', false, false, 'Pièce manquante');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000001');
select t.hint($$select transition_tx('50000000-0000-0000-0000-000000000001','DRAFT')$$, 'TRANSITION_UNKNOWN', 'un dossier rejeté ne revient plus en brouillon (chemin de correction supprimé)');
with d as (delete from transactions where id='50000000-0000-0000-0000-000000000001' returning 1)
  select t.check((select count(*) from d)=0, 'un dossier rejeté (déjà audité) ne se supprime pas');
-- Brouillon audité : une pièce consultée par le payeur (DOCUMENT_VIEWED, 0009) rend le brouillon insupprimable.
insert into transactions(id, vertical, purpose, amount_minor, currency, created_by)
 values ('70000000-0000-0000-0000-000000000001','HEALTH','Brouillon consulté',1000,'XAF','00000000-0000-0000-0000-000000000001');
insert into transaction_parties(tx_id,user_id,role) values
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','REQUESTER'),
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PAYER');
insert into documents(id,tx_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('70000000-0000-0000-0000-0000000000d1','70000000-0000-0000-0000-000000000001','QUOTE','70000000-0000-0000-0000-000000000001/q.pdf','application/pdf',10,'00000000-0000-0000-0000-000000000001');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000002');
select get_document_access('70000000-0000-0000-0000-0000000000d1');
select t.admin();
select t.login('00000000-0000-0000-0000-000000000001');
with d as (delete from transactions where id='70000000-0000-0000-0000-000000000001' returning 1)
  select t.check((select count(*) from d)=0, 'un brouillon déjà audité (pièce consultée par le payeur) ne se supprime pas');
select t.admin();
select t.check(has_audit('50000000-0000-0000-0000-000000000001') and has_audit('70000000-0000-0000-0000-000000000001')
           and not has_audit('40000000-0000-0000-0000-000000000001'), 'has_audit distingue dossier audité et brouillon vierge');
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
