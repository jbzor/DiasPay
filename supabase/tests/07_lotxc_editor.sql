-- VARIANTE POUR L’ÉDITEUR SQL DE SUPABASE, générée depuis 07_lotxc.sql par scripts/sql-editor-variant.mjs : ne pas modifier.
-- Coller tout le fichier dans l’éditeur et exécuter : lire le message d’erreur final (RESULTAT ou ECHEC).
-- Test du lot X-C (corrections avant la passe 3) : migrations 0024 et suivantes. Même format que 06_lotx2_p2.sql :
-- utilisateurs fictifs, rôles réels (authenticated, anon, service_role), tout est annulé à la fin (ROLLBACK),
-- le résumé échoue au moindre FAIL. La RLS filtre en silence : un UPDATE interdit est vérifié par le nombre de
-- lignes touchées (t.n_updated) ET par la valeur relue, jamais par la seule absence d’erreur.
-- Prérequis : 0001 à 0024 appliquées, app_config.mock_mode = 'true' (projet de développement).
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
create table t.res (k text primary key, v jsonb);
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users(id, phone) values
 ('fdc00000-0000-4000-8000-000000000001','33625560001'),   -- payeur, créateur des brouillons
 ('fdc00000-0000-4000-8000-000000000002','237625560002'),  -- prestataire (partie aux dossiers, complice des falsifications T3)
 ('fdc00000-0000-4000-8000-000000000003','33625560003'),   -- témoin T4 (changement de numéro par le flux d’authentification), payeur invité T5
 ('fdc00000-0000-4000-8000-000000000006','33625560006');   -- demandeur N1 (initiateur des demandes présentées, T5)
update profiles set primary_role = 'REQUESTER', enrolment_level = 'N1', full_name = 'Demandeur X-C (test)' where id = 'fdc00000-0000-4000-8000-000000000006';
update profiles set primary_role = 'PROVIDER', full_name = 'Clinique X-C (test)' where id = 'fdc00000-0000-4000-8000-000000000002';
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'prérequis : mock_mode = true');

-- Brouillon santé prêt à soumettre (module HEALTH : REFERENCE_ONLY, DIRECT, devis obligatoire).
create function t.health_draft(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', 'HEALTH', 'creatorRole', 'PAYER',
    'amountMinor', '180000', 'currency', 'XAF', 'purpose', 'Soins (test X-C)', 'beneficiaryReference', 'RM-12',
    'desiredDate', to_char(current_date + 10, 'YYYY-MM-DD'), 'planType', 'SINGLE',
    'provider', jsonb_build_object('name', 'Clinique X-C (test)', 'invitedPhone', '+237625560002'),
    'tranches', jsonb_build_array(jsonb_build_object('label', 'Soins', 'amountMinor', '180000')))
$$;
grant execute on function t.health_draft(uuid) to authenticated;

-- ===================== T3 : brouillons d’opération (R2) =====================
-- ---------- Structure ----------
select t.check(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transactions' and policyname = 'tx_update_draft'),
  'T3 : la politique tx_update_draft est supprimée (aucune écriture directe des brouillons)');

-- ---------- Écriture directe par le créateur : silencieusement sans effet (RLS) ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000001'))$$, 'T3 : brouillon créé par save_draft');
select t.check(t.n_updated($$update transactions set beneficiary_name = 'Rose Mbarga' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : nom du bénéficiaire : écriture directe sans effet (0 ligne)');
select t.check((select beneficiary_name from transactions where id = 'fdc10000-0000-4000-8000-000000000001') is null, 'T3 : nom inchangé (null)');
select t.check(t.n_updated($$update transactions set settlement_mode = 'CONDITIONAL' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : mode de règlement : écriture directe sans effet (0 ligne)');
select t.check((select settlement_mode from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'DIRECT', 'T3 : mode de règlement inchangé (DIRECT)');
select t.check(t.n_updated($$update transactions set initiator_id = 'fdc00000-0000-4000-8000-000000000002' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : initiateur : écriture directe sans effet (0 ligne)');
select t.check((select initiator_id from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'fdc00000-0000-4000-8000-000000000001',
  'T3 : initiateur inchangé (créateur)');
select t.check(t.n_updated($$update transactions set status = 'CLOSED' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : statut : écriture directe sans effet (0 ligne)');
select t.check(t.n_updated($$update transactions set purpose = 'Détourné' where id = 'fdc10000-0000-4000-8000-000000000001'$$) = 0,
  'T3 : motif : écriture directe sans effet (0 ligne)');
select t.check((select status from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'DRAFT'
           and (select purpose from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'Soins (test X-C)',
  'T3 : statut et motif inchangés');
-- save_draft reste le chemin légitime.
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000001') || '{"beneficiaryReference":"RM-13"}')$$, 'T3 : save_draft modifie toujours le brouillon');
select t.check((select beneficiary_reference from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'RM-13', 'T3 : référence mise à jour par save_draft');

-- ---------- Soumission d’un brouillon falsifié (données antérieures à 0024, posées hors RLS) ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select add_document('fdc10000-0000-4000-8000-000000000001', 'QUOTE', 'fdc10000-0000-4000-8000-000000000001/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
-- Nom falsifié sur un module REFERENCE_ONLY (K13) : refusé.
select t.admin();
update transactions set beneficiary_name = 'Rose Mbarga' where id = 'fdc10000-0000-4000-8000-000000000001';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$select submit_operation('fdc10000-0000-4000-8000-000000000001')$$, 'BENEFICIARY_NAME_NOT_ALLOWED',
  'T3 : soumission refusée : nom falsifié sur un module à référence seule');
-- Mode de règlement falsifié : la soumission le recalcule depuis le module.
select t.admin();
update transactions set beneficiary_name = null, settlement_mode = 'CONDITIONAL' where id = 'fdc10000-0000-4000-8000-000000000001';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select submit_operation('fdc10000-0000-4000-8000-000000000001')$$, 'T3 : soumission acceptée après correction du nom');
select t.check((select settlement_mode from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'DIRECT'
           and (select status from transactions where id = 'fdc10000-0000-4000-8000-000000000001') = 'ACTIVE',
  'T3 : mode de règlement recalculé depuis le module (DIRECT), opération active');
-- Initiateur falsifié : refusé pour le complice (INITIATOR_MISMATCH) comme pour le créateur (INITIATOR_ONLY).
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000002'))$$, 'T3 : second brouillon créé');
select add_document('fdc10000-0000-4000-8000-000000000002', 'QUOTE', 'fdc10000-0000-4000-8000-000000000002/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select t.admin();
update transactions set initiator_id = 'fdc00000-0000-4000-8000-000000000002' where id = 'fdc10000-0000-4000-8000-000000000002';
select t.login('fdc00000-0000-4000-8000-000000000002');
select t.hint($$select submit_operation('fdc10000-0000-4000-8000-000000000002')$$, 'INITIATOR_MISMATCH',
  'T3 : soumission par l’initiateur falsifié refusée');
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$select submit_operation('fdc10000-0000-4000-8000-000000000002')$$, 'INITIATOR_ONLY',
  'T3 : soumission par le créateur dépossédé refusée (il n’est plus l’initiateur)');
select t.admin();
update transactions set initiator_id = created_by where id = 'fdc10000-0000-4000-8000-000000000002';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select submit_operation('fdc10000-0000-4000-8000-000000000002')$$, 'T3 : initiateur rétabli : la soumission passe (le brouillon était sain par ailleurs)');
select t.admin();

-- ===================== T4 : profils et numéro de téléphone (R3) =====================
-- ---------- Le titulaire ne modifie pas son numéro ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$update profiles set phone = '33625560002' where id = auth.uid()$$, 'PROFILE_PROTECTED',
  'T4 : changer son propre numéro refusé');
select t.check((select phone from profiles where id = 'fdc00000-0000-4000-8000-000000000001') = '33625560001', 'T4 : numéro inchangé');
-- Les colonnes du profil restent modifiables (auth.saveProfile : full_name, country, primary_role ; préférences : push_enabled).
select t.check(t.n_updated($$update profiles set full_name = 'Payeur X-C', country = 'FR', push_enabled = false where id = auth.uid()$$) = 1,
  'T4 : nom, pays et préférences toujours modifiables par le titulaire');

-- ---------- Unicité du numéro normalisé ----------
select t.admin();
select t.check((select count(*) from pg_indexes where tablename = 'profiles' and indexname = 'profiles_phone_norm_key') = 1,
  'T4 : index d’unicité du numéro normalisé présent');
-- Une autre graphie du numéro d’un profil existant est refusée, même hors RLS (contrainte de la base).
select t.fails($$update profiles set phone = '+237 6 25 56 00 02' where id = 'fdc00000-0000-4000-8000-000000000003'$$,
  'T4 : deux profils ne partagent pas un même numéro normalisé');
select t.fails($$insert into auth.users(id, phone) values ('fdc00000-0000-4000-8000-000000000004', '+33625560001')$$,
  'T4 : inscription avec la graphie « + » d’un numéro déjà pris refusée (profil en doublon normalisé)');

-- ---------- Seul le flux d’authentification change le numéro (auth.users → profiles) ----------
update auth.users set phone = '33625560099' where id = 'fdc00000-0000-4000-8000-000000000003';
select t.check((select phone from profiles where id = 'fdc00000-0000-4000-8000-000000000003') = '33625560099',
  'T4 : numéro vérifié recopié depuis auth.users (on_auth_user_phone_changed)');

-- ===================== T5 : jeton de présentation (R5, prise en charge) =====================
-- Demande d’un demandeur N1, payeur invité par un numéro sans compte (+33625560777).
select t.login('fdc00000-0000-4000-8000-000000000006');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000003') || '{"creatorRole":"REQUESTER","counterpartyPhone":"+33625560777"}')$$,
  'T5 : demande créée, payeur invité par téléphone (numéro sans compte)');
select add_document('fdc10000-0000-4000-8000-000000000003', 'QUOTE', 'fdc10000-0000-4000-8000-000000000003/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000003');
select t.check((select user_id from transaction_parties where tx_id = 'fdc10000-0000-4000-8000-000000000003' and role = 'PAYER') is null,
  'T5 : payeur connu par son seul numéro (user_id vide)');
insert into t.res(k, v) select 'ref3', issue_presentation_token(id) from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000003';

-- Autre numéro : même réponse nulle qu’une référence inconnue, échec compté.
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check(claim_presentation_token((select v->>'reference' from t.res where k = 'ref3')) is null,
  'T5 : porteur au mauvais numéro : réponse nulle (comme une référence inconnue)');
select t.admin();   -- security_events n’est lisible que par le personnel
select t.check((select count(*) from security_events where user_id = 'fdc00000-0000-4000-8000-000000000001'
                 and kind = 'REFERENCE_FAILED' and detail->>'via' = 'claim_presentation_token') = 1,
  'T5 : l’échec compte pour la limitation (security_events)');
select t.check((select user_id from transaction_parties where tx_id = 'fdc10000-0000-4000-8000-000000000003' and role = 'PAYER') is null
           and (select claimed_at from presentation_tokens pt join tranches tr on tr.id = pt.tranche_id
                 where tr.tx_id = 'fdc10000-0000-4000-8000-000000000003') is null,
  'T5 : payeur et jeton inchangés après l’échec (lecture hors rôle)');

-- Bon numéro : l’utilisateur dont le numéro vérifié est celui de l’invitation (ici changé par le flux d’authentification, T4).
select t.admin();
update auth.users set phone = '33625560777' where id = 'fdc00000-0000-4000-8000-000000000003';
select t.login('fdc00000-0000-4000-8000-000000000003');
select t.check(claim_presentation_token((select v->>'reference' from t.res where k = 'ref3')) ->> 'txId' = 'fdc10000-0000-4000-8000-000000000003',
  'T5 : titulaire du numéro invité : prise en charge acceptée (résumé minimal)');
select t.check((select user_id from transaction_parties where tx_id = 'fdc10000-0000-4000-8000-000000000003' and role = 'PAYER')
             = 'fdc00000-0000-4000-8000-000000000003',
  'T5 : le titulaire du numéro devient le payeur du dossier');

-- Aucun payeur désigné (cas du commerçant, K4) : comportement conservé — l’utilisateur connecté devient payeur.
-- Les flux actuels exigent un payeur à la soumission : l’état est posé hors RLS pour couvrir le cas prévu par 0016.
select t.login('fdc00000-0000-4000-8000-000000000006');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000004') || '{"creatorRole":"REQUESTER","counterpartyPhone":"+33625560888"}')$$,
  'T5 : seconde demande créée');
select add_document('fdc10000-0000-4000-8000-000000000004', 'QUOTE', 'fdc10000-0000-4000-8000-000000000004/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000004');
insert into t.res(k, v) select 'ref4', issue_presentation_token(id) from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000004';
select t.admin();
delete from transaction_parties where tx_id = 'fdc10000-0000-4000-8000-000000000004' and role = 'PAYER';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check(claim_presentation_token((select v->>'reference' from t.res where k = 'ref4')) is not null,
  'T5 : aucun payeur désigné : l’utilisateur connecté prend la demande en charge');
select t.check((select user_id from transaction_parties where tx_id = 'fdc10000-0000-4000-8000-000000000004' and role = 'PAYER')
             = 'fdc00000-0000-4000-8000-000000000001',
  'T5 : il devient le payeur (comportement 0016 conservé)');
select t.admin();

-- ===================== T6 : libération automatique et demande échue (R6, J1) =====================
-- AGRO (CONDITIONAL, PAYER_CONFIRM) activé le temps du test (vague 2, désactivé en développement) ; tout est annulé.
select t.admin();
update request_modules set enabled = true where code = 'AGRO';
create function t.agro_draft(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'vertical', 'AGRO', 'creatorRole', 'PAYER',
    'amountMinor', '100000', 'currency', 'XAF', 'purpose', 'Intrants (test X-C)', 'planType', 'INSTALLMENTS',
    'provider', jsonb_build_object('name', 'Coopérative X-C (test)', 'invitedPhone', '+237625560002'),
    'tranches', jsonb_build_array(
      jsonb_build_object('label', 'Avance', 'amountMinor', '60000', 'dueDate', to_char(current_date + 2, 'YYYY-MM-DD')),
      jsonb_build_object('label', 'Solde', 'amountMinor', '40000', 'dueDate', to_char(current_date + 3, 'YYYY-MM-DD'))))
$$;
grant execute on function t.agro_draft(uuid) to authenticated;
-- Paye la demande seq 1 du dossier, la confirme (PAYER_CONFIRM) ; le délai de contestation est mis au passé hors rôle.
create function t.pay_and_confirm(p_tx uuid) returns void language plpgsql security definer as $$
declare v_tr uuid; a jsonb;
begin
  select id into v_tr from tranches where tx_id = p_tx and seq = 1;
  a := start_payment(v_tr, 'xc-t6-' || p_tx::text);
  perform demo_settle_payment((a->>'id')::uuid);
  perform confirm_service(v_tr);
end $$;
grant execute on function t.pay_and_confirm(uuid) to authenticated;

-- Dossier 1 : payé, confirmé, délai écoulé… puis opération suspendue par un litige avant paiement sur la demande 2.
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.agro_draft('fdc10000-0000-4000-8000-000000000005'))$$, 'T6 : dossier conditionnel créé');
select add_document('fdc10000-0000-4000-8000-000000000005', 'SUPPORTING_DOCUMENT', 'fdc10000-0000-4000-8000-000000000005/SUPPORTING_DOCUMENT/a.pdf', 'a.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000005');
select t.check((select count(*) from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000005' and status = 'SUBMITTED') = 2,
  'T6 : les deux demandes dues sont soumises');
select t.pay_and_confirm('fdc10000-0000-4000-8000-000000000005');
select t.admin();
update tranches set contest_ends_at = now() - interval '1 hour' where tx_id = 'fdc10000-0000-4000-8000-000000000005' and seq = 1;
select t.login('fdc00000-0000-4000-8000-000000000001');
select open_dispute((select id from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000005' and seq = 2), 'Semences non conformes à la commande');
select t.admin();
select t.check((select status from transactions where id = 'fdc10000-0000-4000-8000-000000000005') = 'SUSPENDED',
  'T6 : litige avant paiement sur la demande 2 : opération suspendue');

-- Dossier 2 (témoin) : même état, opération restée active.
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.agro_draft('fdc10000-0000-4000-8000-000000000006'))$$, 'T6 : dossier témoin créé');
select add_document('fdc10000-0000-4000-8000-000000000006', 'SUPPORTING_DOCUMENT', 'fdc10000-0000-4000-8000-000000000006/SUPPORTING_DOCUMENT/a.pdf', 'a.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000006');
select t.pay_and_confirm('fdc10000-0000-4000-8000-000000000006');
select t.admin();
update tranches set contest_ends_at = now() - interval '1 hour' where tx_id = 'fdc10000-0000-4000-8000-000000000006' and seq = 1;

-- Le passage de libération ne touche pas l’opération suspendue, et libère bien le témoin.
select release_due_tranches();
select t.check((select funds_state from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000005' and seq = 1) = 'HELD',
  'T6 : fonds d’une opération suspendue jamais libérés automatiquement');
select t.check((select funds_state from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000006' and seq = 1) = 'RELEASED',
  'T6 : même passage : les fonds du dossier actif témoin sont libérés');

-- Demande échue : plus payable avant même le passage horaire d’expire_due_requests.
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000007'))$$, 'T6 : demande santé créée');
select add_document('fdc10000-0000-4000-8000-000000000007', 'QUOTE', 'fdc10000-0000-4000-8000-000000000007/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000007');
insert into t.ids select 'tr7', id from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000007';
insert into t.res select 'q7', get_quote((select v from t.ids where k = 'tr7'));
select t.admin();
update tranches set expires_at = now() - interval '1 minute' where id = (select v from t.ids where k = 'tr7');
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$select get_quote((select v from t.ids where k = 'tr7'))$$, 'REQUEST_EXPIRED',
  'T6 : devis refusé pour une demande échue encore SUBMITTED');
select t.hint($$select accept_and_pay((select v from t.ids where k = 'tr7'), 'xc-t6-expired', (select (v->>'id')::uuid from t.res where k = 'q7'))$$,
  'REQUEST_EXPIRED', 'T6 : paiement refusé pour une demande échue encore SUBMITTED');
select t.admin();
select expire_due_requests();
select t.check((select status from tranches where id = (select v from t.ids where k = 'tr7')) = 'EXPIRED',
  'T6 : le passage horaire marque ensuite la demande EXPIRED');
-- La demande expirée était la seule : l’opération se clôt (toutes les demandes finales), d’où TX_NOT_ACTIVE.
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.hint($$select get_quote((select v from t.ids where k = 'tr7'))$$, 'TX_NOT_ACTIVE',
  'T6 : après le passage, codes d’aujourd’hui inchangés (opération close)');
select t.admin();

-- ===================== T7 : un TrustToken pour chaque demande, y compris en DIRECT =====================
-- ---------- Émission à la soumission, en DIRECT ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000008'))$$, 'T7 : demande santé (DIRECT) créée');
select add_document('fdc10000-0000-4000-8000-000000000008', 'QUOTE', 'fdc10000-0000-4000-8000-000000000008/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000008');
select t.admin();
insert into t.ids select 'tr8', id from tranches where tx_id = 'fdc10000-0000-4000-8000-000000000008';
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8') and revoked_at is null) = 1,
  'T7 : DIRECT : jeton actif émis à la soumission');
select t.check(exists (select 1 from audit_log where tranche_id = (select v from t.ids where k = 'tr8') and event = 'TOKEN_ISSUED'),
  'T7 : « TrustToken généré » dans la chronologie (TOKEN_ISSUED)');
select t.check((select expires_at from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8') and revoked_at is null) is null
           and (select expires_at from tranches where id = (select v from t.ids where k = 'tr8')) is null,
  'T7 : DIRECT : le jeton suit la demande (aucune durée fixée : ni la demande ni le jeton n’expirent)');
insert into t.res select 'ref8', to_jsonb(reference) from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8') and revoked_at is null;
-- Durée des demandes fixée pour le module : le jeton en hérite.
update request_modules set request_expiry_days = 5 where code = 'HEALTH';
select t.login('fdc00000-0000-4000-8000-000000000001');
select save_draft(t.health_draft('fdc10000-0000-4000-8000-000000000009'));
select add_document('fdc10000-0000-4000-8000-000000000009', 'QUOTE', 'fdc10000-0000-4000-8000-000000000009/QUOTE/q.pdf', 'q.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-000000000009');
select t.admin();
select t.check((select k.expires_at = tr.expires_at and tr.expires_at is not null from tranche_tokens k join tranches tr on tr.id = k.tranche_id
                 where tr.tx_id = 'fdc10000-0000-4000-8000-000000000009' and k.revoked_at is null),
  'T7 : DIRECT : expiration du jeton = expiration de la demande (héritée du module)');
update request_modules set request_expiry_days = null where code = 'HEALTH';
-- CONDITIONAL inchangé : token_ttl_days (dossier AGRO de T6).
-- CONDITIONAL (règle de 0031) : la demande payée a un jeton à échéance token_ttl_days ; la demande non payée suit la sienne.
select t.check((select k.expires_at is not null from tranche_tokens k join tranches tr on tr.id = k.tranche_id
                 where tr.tx_id = 'fdc10000-0000-4000-8000-000000000006' and tr.seq = 1 and k.revoked_at is null)
           and (select k.expires_at is not distinct from tr.expires_at from tranche_tokens k join tranches tr on tr.id = k.tranche_id
                 where tr.tx_id = 'fdc10000-0000-4000-8000-000000000006' and tr.seq = 2 and k.revoked_at is null),
  'T7 : CONDITIONAL : payée = token_ttl_days ; non payée = échéance de la demande (0031)');

-- ---------- Résolution : payeur et initiateur seulement en DIRECT ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check(resolve_reference_info((select v #>> '{}' from t.res where k = 'ref8')) ->> 'trancheId' = (select v::text from t.ids where k = 'tr8'),
  'T7 : DIRECT : le payeur (initiateur) résout la référence');
select t.login('fdc00000-0000-4000-8000-000000000002');
select t.check(exists (select 1 from transaction_parties where tx_id = 'fdc10000-0000-4000-8000-000000000008' and role = 'PROVIDER' and user_id = auth.uid())
           and resolve_reference_info((select v #>> '{}' from t.res where k = 'ref8')) is null,
  'T7 : DIRECT : le prestataire, partie au dossier, ne résout pas la référence (réponse nulle)');
select t.login('fdc00000-0000-4000-8000-000000000006');
select t.check(resolve_reference_info((select v #>> '{}' from t.res where k = 'ref8')) is null,
  'T7 : étranger au dossier : réponse nulle, aucune information');

-- ---------- Réémission, révocation, paiement bloqué ----------
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check(reissue_token((select v from t.ids where k = 'tr8'), 'Nouveau jeton') ->> 'tokenId' is not null, 'T7 : DIRECT : réémission');
select t.admin();
select t.check((select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8')) = 2
           and (select count(*) from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8') and revoked_at is null) = 1
           and not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8') and revoked_at is null
                            and reference = (select v #>> '{}' from t.res where k = 'ref8')),
  'T7 : DIRECT : l’ancien jeton est révoqué, un nouveau (autre référence) est actif');
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check((revoke_token((select v from t.ids where k = 'tr8'), 'Jeton compromis') ->> 'revoked')::boolean, 'T7 : DIRECT : révocation');
insert into t.res select 'q8', get_quote((select v from t.ids where k = 'tr8'));
select t.hint($$select accept_and_pay((select v from t.ids where k = 'tr8'), 'xc-t7-revoked-1', (select (v->>'id')::uuid from t.res where k = 'q8'))$$,
  'TOKEN_REVOKED', 'T7 : paiement refusé avec un jeton révoqué');
select t.hint($$select reissue_token(null, 'x')$$, 'TRANCHE_NOT_FOUND', 'T7 : réémission d’une demande inconnue refusée');
-- Nouveau jeton : le paiement passe ; payé en DIRECT, le jeton a servi et est révoqué.
select t.check(reissue_token((select v from t.ids where k = 'tr8'), 'Nouveau jeton après révocation') ->> 'tokenId' is not null, 'T7 : réémission après révocation');
insert into t.res select 'a8', start_payment((select v from t.ids where k = 'tr8'), 'xc-t7-pay-0001');
select demo_settle_payment((select (v->>'id')::uuid from t.res where k = 'a8'));
select t.admin();
select t.check((select status from tranches where id = (select v from t.ids where k = 'tr8')) = 'PAID'
           and not exists (select 1 from tranche_tokens where tranche_id = (select v from t.ids where k = 'tr8') and revoked_at is null),
  'T7 : DIRECT : demande payée, jeton révoqué (statut final)');
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check(length(get_receipt((select v from t.ids where k = 'tr8')) ->> 'reference') = 18, 'T7 : DIRECT : le reçu porte la référence du jeton');

-- ---------- Révocation à l’annulation de l’opération (transition_tx ne révoquait rien) ----------
select t.check((select status from transition_tx('fdc10000-0000-4000-8000-000000000009', 'CANCELLED')) = 'CANCELLED',
  'T7 : opération annulée par l’initiateur');
select t.admin();
select t.check(not exists (select 1 from tranche_tokens k join tranches tr on tr.id = k.tranche_id
                           where tr.tx_id = 'fdc10000-0000-4000-8000-000000000009' and k.revoked_at is null)
           and exists (select 1 from audit_log where tx_id = 'fdc10000-0000-4000-8000-000000000009' and event = 'TOKEN_REVOKED'),
  'T7 : annulation de l’opération : jetons de ses demandes révoqués et journalisés');
-- Données : aucune demande DIRECT soumise et non finale sans jeton actif (rattrapage de 0028, et nouvelles demandes).
select t.check(not exists (select 1 from tranches tr join transactions x on x.id = tr.tx_id
                           where x.settlement_mode = 'DIRECT' and tr.status in ('SUBMITTED','INFO_REQUESTED','ACCEPTED')
                             and not exists (select 1 from tranche_tokens k where k.tranche_id = tr.id and k.revoked_at is null)),
  'T7 : toute demande DIRECT soumise et non finale a un jeton actif');
-- Aucun lien, aucune image : le réglage d’image reste faux.
select t.check((select value from app_config where key = 'eqr_image_enabled') = 'false', 'T7 : image du QR toujours désactivée');

-- ===================== T8 : droits de anon et lecture des réglages (R7, D.6) =====================
select t.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'T8 : aucune fonction du schéma public exécutable par anon');
select t.check(has_function_privilege('authenticated', 'has_role(uuid, tx_role)', 'EXECUTE')
           and has_function_privilege('authenticated', 'is_party(uuid)', 'EXECUTE')
           and has_function_privilege('authenticated', 'is_validator()', 'EXECUTE')
           and has_function_privilege('authenticated', 'is_admin()', 'EXECUTE'),
  'T8 : authenticated garde les fonctions des politiques RLS');
select t.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type ty on ty.oid = p.prorettype
                            where n.nspname = 'public' and ty.typname in ('trigger','event_trigger')
                              and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'T8 : aucune fonction de déclencheur exécutable par authenticated');
select t.check(not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                            where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f'
                              and (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
                              and a.grantee in (0, 'anon'::regrole) and a.privilege_type = 'EXECUTE'),
  'T8 : fonctions futures de postgres : aucun EXECUTE par défaut pour anon ni PUBLIC');
-- Une fonction créée maintenant (comme par une migration future) n’est pas exécutable par anon.
create function public.xc_t8_probe() returns int language sql as $$ select 1 $$;
select t.check(not has_function_privilege('anon', 'public.xc_t8_probe()', 'EXECUTE')
           and has_function_privilege('authenticated', 'public.xc_t8_probe()', 'EXECUTE'),
  'T8 : fonction nouvelle : anon exclu, authenticated conservé');
drop function public.xc_t8_probe();
-- app_config : rien pour anon (droit de table et politique), lecture pour authenticated.
select t.check(not has_table_privilege('anon', 'app_config', 'SELECT')
           and (select polroles = array['authenticated'::regrole::oid] from pg_policy where polrelid = 'app_config'::regclass and polname = 'config_read'),
  'T8 : app_config réservé à authenticated (droit et politique)');
set local role anon;
select t.fails($$select value from app_config where key = 'mock_mode'$$, 'T8 : anon ne lit pas app_config');
select t.admin();
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.check((select value from app_config where key = 'mock_mode') = 'true', 'T8 : un utilisateur connecté lit app_config');
select t.admin();
-- Création du profil par le déclencheur d’inscription (handle_new_user) : inchangée.
insert into auth.users(id, phone) values ('fdc00000-0000-4000-8000-000000000009', '33625560009');
select t.check(exists (select 1 from profiles where id = 'fdc00000-0000-4000-8000-000000000009' and phone = '33625560009'),
  'T8 : le profil est toujours créé à l’inscription');

-- ===================== T4b : nom figé à partir de N1 (0030) =====================
select t.check((select enrolment_level from profiles where id = 'fdc00000-0000-4000-8000-000000000006') = 'N1'
           and (select enrolment_level from profiles where id = 'fdc00000-0000-4000-8000-000000000003') = 'N0',
  'T4b : prérequis : un compte N1 et un compte N0');
select t.login('fdc00000-0000-4000-8000-000000000006');
select t.hint($$update profiles set full_name = 'Autre nom' where id = auth.uid()$$, 'PROFILE_PROTECTED', 'T4b : N1 : changer son nom refusé');
select t.check((select full_name from profiles where id = auth.uid()) = 'Demandeur X-C (test)', 'T4b : N1 : nom inchangé');
select t.check(t.n_updated($$update profiles set full_name = 'Demandeur X-C (test)', country = 'CM' where id = auth.uid()$$) = 1,
  'T4b : N1 : réécrire le même nom avec un autre pays reste permis (saveProfile)');
select t.login('fdc00000-0000-4000-8000-000000000003');
select t.check(t.n_updated($$update profiles set full_name = 'Nom posé en N0' where id = auth.uid()$$) = 1, 'T4b : N0 : le titulaire pose encore son nom');
select t.check((select full_name from profiles where id = auth.uid()) = 'Nom posé en N0', 'T4b : N0 : nom enregistré');   -- instruction suivante : nouvel instantané
select t.admin();

-- ===================== T7b : échéance du jeton CONDITIONAL, auto_issue_token (0031) =====================
-- Échéance de la demande fixée pour AGRO le temps du test (30 jours) : avant le paiement, le jeton la suit.
update request_modules set request_expiry_days = 30 where code = 'AGRO';
select t.login('fdc00000-0000-4000-8000-000000000001');
select t.ok($$select save_draft(t.agro_draft('fdc10000-0000-4000-8000-00000000000a'))$$, 'T7b : dossier conditionnel créé');
select add_document('fdc10000-0000-4000-8000-00000000000a', 'SUPPORTING_DOCUMENT', 'fdc10000-0000-4000-8000-00000000000a/SUPPORTING_DOCUMENT/a.pdf', 'a.pdf', 'application/pdf', 1000);
select submit_operation('fdc10000-0000-4000-8000-00000000000a');
select t.admin();
insert into t.ids select 'tra', id from tranches where tx_id = 'fdc10000-0000-4000-8000-00000000000a' and seq = 1;
select t.check((select k.expires_at = tr.expires_at and tr.expires_at > now() + interval '29 days'
                  from tranche_tokens k join tranches tr on tr.id = k.tranche_id
                 where tr.id = (select v from t.ids where k = 'tra') and k.revoked_at is null),
  'T7b : CONDITIONAL avant paiement : le jeton suit l’échéance de la demande (30 jours), pas token_ttl_days');
-- Paiement : la phase de confirmation commence, le jeton prend token_ttl_days à compter du paiement.
select t.login('fdc00000-0000-4000-8000-000000000001');
insert into t.res select 'aa', start_payment((select v from t.ids where k = 'tra'), 'xc-t7b-pay-0001');
select demo_settle_payment((select (v->>'id')::uuid from t.res where k = 'aa'));
select t.admin();
select t.check((select tr.status = 'PAID' and tr.funds_state = 'HELD'
                   and k.expires_at between now() + make_interval(days => (select value::int from app_config where key = 'token_ttl_days')) - interval '1 minute'
                                        and now() + make_interval(days => (select value::int from app_config where key = 'token_ttl_days')) + interval '1 minute'
                  from tranche_tokens k join tranches tr on tr.id = k.tranche_id
                 where tr.id = (select v from t.ids where k = 'tra') and k.revoked_at is null),
  'T7b : CONDITIONAL après paiement : jeton actif, échéance = paiement + token_ttl_days (phase de confirmation)');
-- Réémission pendant la phase de confirmation : même règle (administrateur non partie, seul autorisé après paiement).
-- Payé tard : un jeton émis il y a plus de token_ttl_days reste confirmable, puisque le délai part du paiement.
select t.check(not exists (select 1 from tranche_tokens k join tranches tr on tr.id = k.tranche_id join transactions x on x.id = tr.tx_id
                            where x.settlement_mode = 'CONDITIONAL' and tr.status <> 'PAID' and k.revoked_at is null
                              and k.expires_at is distinct from tr.expires_at),
  'T7b : aucun jeton CONDITIONAL non payé avec une autre échéance que celle de sa demande (données reprises)');
update request_modules set request_expiry_days = null where code = 'AGRO';
-- auto_issue_token : supprimé, l’émission à la soumission est inconditionnelle.
select t.check(not exists (select 1 from app_config where key = 'auto_issue_token')
           and not exists (select 1 from pg_proc where proname = '_simulate_token_issue'),
  'T7b : réglage auto_issue_token et fonction morte _simulate_token_issue supprimés');

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
