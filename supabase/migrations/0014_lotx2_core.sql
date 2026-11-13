-- =====================================================================
-- DiasPay : migration 0014 (lot X version 2, X2) — le noyau après le kickoff.
-- Modèle cible : docs/specs/modele-cible-v2.md. À appliquer SUR 0001 à 0013. Ne modifie aucune migration précédente.
-- Test : supabase/tests/05_lotx2_p1.sql (et les tests 00 à 04, mis à jour : voir docs/decisions.md, X2-v2).
--
--  1. Opération (transactions) : settlement_mode (DIRECT par défaut, K1), initiator_id, accepted_at, accepted_by ;
--     statuts DRAFT, PENDING_REVIEW, IN_REVIEW, ACTIVE, SUSPENDED, CLOSED, CANCELLED (section 3.1).
--  2. Demande de paiement (tranches, vue payment_requests) : target_amount_minor, currency, scheduled_for, expires_at, on_hold,
--     refunded_minor, funds_state, paid_at ; statuts DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED, PAID, REJECTED, CANCELLED,
--     EXPIRED, REFUNDED (section 3.2). DISPUTED n’est plus un statut.
--  3. Données de développement converties (aucune donnée de production) : correspondance de la section 5 du modèle.
--  4. Règlement direct par défaut : paiement → PAID, sans blocage ni confirmation ; la libération conditionnelle (confirmation,
--     délai de contestation, preuves, double validation) ne sert plus qu’en CONDITIONAL, sur funds_state.
--  5. Litige distinct (K5, K7) : statuts OPEN, AWAITING_RESPONSE, IN_MEDIATION, RESOLVED ; issues NO_ACTION, REFUND_FULL,
--     REFUND_PARTIAL, FUNDS_RELEASED, FUNDS_RETURNED ; dispute_messages. Avant paiement : on_hold et opération SUSPENDED ;
--     après paiement : le statut de la demande ne change jamais.
--  6. platform_review : NEVER par défaut (K2) ; NEVER → ACTIVE (AUTO_ACTIVATED), ALWAYS → PENDING_REVIEW, RISK_BASED →
--     PENDING_REVIEW si une règle de risque s’applique (seuil de montant : réglage sans valeur, absent = revue).
--  7. Modules de la vague 1 en DIRECT ; vague 2 en CONDITIONAL (règles de libération conservées en données).
-- =====================================================================

-- ---------- 1. Modules : mode de règlement, revue, expiration ----------
alter table request_modules add column if not exists settlement_mode settlement_mode not null default 'DIRECT';
-- Durée d’expiration d’une demande soumise, en jours (point ouvert 3 : aucune valeur ; absente = pas d’expiration).
alter table request_modules add column if not exists request_expiry_days int check (request_expiry_days between 1 and 365);
alter table request_modules alter column platform_review set default 'NEVER';
update request_modules set platform_review = 'NEVER';
update request_modules set settlement_mode = case when code in ('EDUCATION','HEALTH','RENT') then 'DIRECT' else 'CONDITIONAL' end::settlement_mode
 where code in ('EDUCATION','HEALTH','RENT','AGRO','REAL_ESTATE','LAND');
-- L’ancien mode IMMEDIATE devient settlement_mode = DIRECT (la règle de libération ne sert plus).
update request_modules set settlement_mode = 'DIRECT', release_mode = 'PROVIDER_CONFIRM' where release_mode = 'IMMEDIATE';
alter table request_modules drop constraint if exists request_modules_no_immediate;
alter table request_modules add constraint request_modules_no_immediate check (release_mode <> 'IMMEDIATE');

-- ---------- 2. Opération ----------
alter table transactions add column if not exists settlement_mode settlement_mode not null default 'DIRECT';
alter table transactions add column if not exists initiator_id uuid references profiles(id);
alter table transactions add column if not exists accepted_at timestamptz;
alter table transactions add column if not exists accepted_by uuid references profiles(id);
update transactions set initiator_id = created_by where initiator_id is null;

-- L’initiateur est le créateur (demandeur, prestataire ou tiers enrôlé) ; posé à la création.
create or replace function _transactions_defaults() returns trigger language plpgsql as $$
begin
  new.initiator_id := coalesce(new.initiator_id, new.created_by);
  return new;
end $$;
drop trigger if exists transactions_defaults on transactions;
create trigger transactions_defaults before insert on transactions for each row execute function _transactions_defaults();

-- ---------- 3. Demande de paiement ----------
alter table tranches add column if not exists target_amount_minor bigint generated always as (amount_minor) stored;
alter table tranches add column if not exists scheduled_for date generated always as (due_date) stored;
alter table tranches add column if not exists currency currency;
alter table tranches add column if not exists expires_at timestamptz;
alter table tranches add column if not exists on_hold boolean not null default false;
alter table tranches add column if not exists refunded_minor bigint not null default 0 check (refunded_minor >= 0);
alter table tranches add column if not exists funds_state text not null default 'NONE';
alter table tranches add column if not exists paid_at timestamptz;
-- Libération conditionnelle (CONDITIONAL seulement) : confirmation et preuves, à la place des anciens statuts.
alter table tranches add column if not exists confirmed_at timestamptz;
alter table tranches add column if not exists evidence_submitted_at timestamptz;
alter table tranches alter column status set default 'DRAFT';
alter table tranches drop constraint if exists tranches_funds_state;
alter table tranches add constraint tranches_funds_state check (funds_state in ('NONE','HELD','RELEASED','RETURNED'));
alter table tranches drop constraint if exists tranches_no_immediate;

-- Devise de la demande : celle de l’opération (devise canonique, K10).
create or replace function _tranches_defaults() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.currency := coalesce((select currency from transactions where id = new.tx_id), new.currency);
  return new;
end $$;
drop trigger if exists tranches_defaults on tranches;
create trigger tranches_defaults before insert or update of tx_id, amount_minor on tranches for each row execute function _tranches_defaults();

-- ---------- 4. Conversion des données de développement (section 5 du modèle) ----------
do $$
begin
  perform set_config('app.via_transition', 'on', true);
  update transactions t set settlement_mode = coalesce(m.settlement_mode, 'DIRECT')
    from request_modules m where m.code = t.vertical;
  update tranches tr set currency = t.currency from transactions t where t.id = tr.tx_id and tr.currency is distinct from t.currency;
  -- Demandes : PLANNED → DRAFT (programmée), AWAITING_PAYMENT → SUBMITTED, payée (bloquée, confirmée, preuve, débloquée,
  -- en litige) → PAID avec l’état des fonds en CONDITIONAL ; les litiges deviennent des dossiers distincts.
  update tranches tr set
    funds_state = case when t.settlement_mode = 'CONDITIONAL' and tr.status in ('PAID_LOCKED','EVIDENCE_SUBMITTED','CONFIRMED','DISPUTED') then 'HELD'
                       when t.settlement_mode = 'CONDITIONAL' and tr.status = 'RELEASED' then 'RELEASED' else 'NONE' end,
    confirmed_at = case when tr.status = 'CONFIRMED' then coalesce(tr.updated_at, now()) end,
    evidence_submitted_at = case when tr.status = 'EVIDENCE_SUBMITTED' then coalesce(tr.updated_at, now()) end,
    paid_at = case when tr.status in ('PAID_LOCKED','EVIDENCE_SUBMITTED','CONFIRMED','DISPUTED','RELEASED') then coalesce(tr.updated_at, now()) end,
    status = case tr.status
      when 'PLANNED' then 'DRAFT' when 'AWAITING_PAYMENT' then 'SUBMITTED'
      when 'PAID_LOCKED' then 'PAID' when 'EVIDENCE_SUBMITTED' then 'PAID' when 'CONFIRMED' then 'PAID'
      when 'RELEASED' then 'PAID' when 'DISPUTED' then 'PAID' else tr.status end
  from transactions t where t.id = tr.tx_id;
  -- Opérations : soumise ou en revue → PENDING_REVIEW / IN_REVIEW ; validée, en cours, en litige → ACTIVE ; rejetée → CANCELLED.
  update transactions set status = case status
      when 'SUBMITTED' then 'PENDING_REVIEW' when 'VALIDATED' then 'ACTIVE' when 'TOKEN_ISSUED' then 'ACTIVE'
      when 'IN_PROGRESS' then 'ACTIVE' when 'DISPUTED' then 'ACTIVE' when 'REJECTED' then 'CANCELLED'
      when 'PAID_LOCKED' then 'ACTIVE' when 'SERVICE_CONFIRMED' then 'ACTIVE' when 'RELEASED' then 'ACTIVE'
      when 'AWAITING_PAYMENT' then 'ACTIVE' when 'EXPIRED' then 'CANCELLED' else status end
   where status not in ('DRAFT','PENDING_REVIEW','IN_REVIEW','ACTIVE','SUSPENDED','CLOSED','CANCELLED');
  perform set_config('app.via_transition', 'off', true);
end $$;

alter table transactions drop constraint if exists transactions_status_v2;
alter table transactions add constraint transactions_status_v2
  check (status in ('DRAFT','PENDING_REVIEW','IN_REVIEW','ACTIVE','SUSPENDED','CLOSED','CANCELLED'));
alter table tranches drop constraint if exists tranches_status_v2;
alter table tranches add constraint tranches_status_v2
  check (status in ('DRAFT','SUBMITTED','INFO_REQUESTED','ACCEPTED','PAID','REJECTED','CANCELLED','EXPIRED','REFUNDED'));
alter table tranches add constraint tranches_no_immediate check (release_mode <> 'IMMEDIATE');
alter table transaction_parties drop constraint if exists transaction_parties_no_initiator_role;
alter table transaction_parties add constraint transaction_parties_no_initiator_role check (role <> 'INITIATOR');

-- Vue en lecture seule : le vocabulaire du modèle cible (la table garde son nom, toutes les fonctions la lisent).
create or replace view payment_requests with (security_invoker = true) as
  select tr.id, tr.tx_id as operation_id, tr.seq, tr.label, tr.target_amount_minor, tr.currency, tr.status, tr.scheduled_for, tr.expires_at,
         tr.on_hold, tr.refunded_minor, tr.funds_state, tr.first_viewed_at, tr.paid_at, tr.created_at, tr.updated_at
  from tranches tr;
revoke all on payment_requests from anon, public;
grant select on payment_requests to authenticated;

-- ---------- 5. Machines d’états (sections 3.1 et 3.2) ----------
delete from allowed_transitions;
insert into allowed_transitions(from_status, to_status, role, validator_only) values
 ('DRAFT','ACTIVE','INITIATOR',false),           -- soumission, platform_review = NEVER (ou sans risque)
 ('DRAFT','PENDING_REVIEW','INITIATOR',false),   -- soumission, revue par le bureau
 ('PENDING_REVIEW','IN_REVIEW','SYSTEM',true),   -- prise en charge par le bureau (file du lot 5)
 ('PENDING_REVIEW','ACTIVE','SYSTEM',true),
 ('IN_REVIEW','ACTIVE','SYSTEM',true),
 ('PENDING_REVIEW','CANCELLED','SYSTEM',true),
 ('IN_REVIEW','CANCELLED','SYSTEM',true),
 ('ACTIVE','SUSPENDED','SYSTEM',false),          -- litige avant paiement
 ('ACTIVE','SUSPENDED','SYSTEM',true),           -- blocage pour fraude par le bureau
 ('SUSPENDED','ACTIVE','SYSTEM',true),           -- levée par le personnel
 ('SUSPENDED','ACTIVE','SYSTEM',false),          -- litige avant paiement résolu
 ('ACTIVE','CLOSED','SYSTEM',false),
 ('DRAFT','CANCELLED','INITIATOR',false),
 ('ACTIVE','CANCELLED','INITIATOR',false);

delete from tranche_transitions;
insert into tranche_transitions(from_status, to_status, role, validator_only) values
 ('DRAFT','SUBMITTED','INITIATOR',false), ('DRAFT','SUBMITTED','SYSTEM',false),
 ('SUBMITTED','INFO_REQUESTED','PAYER',false),
 ('INFO_REQUESTED','SUBMITTED','INITIATOR',false),
 ('SUBMITTED','ACCEPTED','PAYER',false),
 ('ACCEPTED','PAID','SYSTEM',false),
 ('ACCEPTED','SUBMITTED','SYSTEM',false),
 ('SUBMITTED','REJECTED','PAYER',false), ('INFO_REQUESTED','REJECTED','PAYER',false),
 ('DRAFT','CANCELLED','INITIATOR',false), ('SUBMITTED','CANCELLED','INITIATOR',false), ('INFO_REQUESTED','CANCELLED','INITIATOR',false),
 ('SUBMITTED','EXPIRED','SYSTEM',false), ('INFO_REQUESTED','EXPIRED','SYSTEM',false),
 ('PAID','REFUNDED','SYSTEM',false);

-- ---------- 6. Outils ----------
create or replace function _is_initiator(p_tx uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from transactions where id = p_tx and coalesce(initiator_id, created_by) = auth.uid())
$$;

-- Statuts finaux d’une demande (clôture de l’opération) ; en CONDITIONAL, une demande payée attend la fin de ses fonds.
create or replace function _request_final(tr tranches) returns boolean
language sql immutable as $$
  select tr.status in ('REFUNDED','REJECTED','CANCELLED','EXPIRED') or (tr.status = 'PAID' and tr.funds_state in ('NONE','RELEASED','RETURNED'))
$$;

-- Changement de statut d’une opération (interne) : contrôle de la table 3.1 par l’appelant, journal, alertes (déclencheur).
create or replace function _set_tx_status(p_tx uuid, p_to tx_status, p_actor uuid, p_event text, p_payload jsonb default '{}')
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; old tx_status;
begin
  select * into t from transactions where id = p_tx for update;
  old := t.status;
  if old = p_to then return t; end if;
  perform set_config('app.via_transition', 'on', true);
  update transactions set status = p_to where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (p_tx, p_actor, p_event, old, p_to, p_payload);
  return t;
end $$;

-- Clôture : opération active dont toutes les demandes sont dans un état final.
create or replace function _close_operation_if_done(p_tx uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select status from transactions where id = p_tx) = 'ACTIVE'
     and exists (select 1 from tranches where tx_id = p_tx)
     and not exists (select 1 from tranches tr where tr.tx_id = p_tx and not _request_final(tr)) then
    perform _set_tx_status(p_tx, 'CLOSED', p_actor, 'TX_CLOSED');
  end if;
end $$;

-- Changement de statut d’une demande (interne) : journal (tranche_from, tranche_to), clôture de l’opération.
create or replace function _set_tranche_status(
  p_tranche uuid, p_to tranche_status, p_actor uuid, p_event text, p_payload jsonb default '{}')
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; old tranche_status;
begin
  select * into tr from tranches where id = p_tranche for update;
  old := tr.status;
  perform set_config('app.via_transition','on', true);
  update tranches set status = p_to, paid_at = case when p_to = 'PAID' then coalesce(paid_at, now()) else paid_at end
   where id = p_tranche returning * into tr;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, p_actor, p_event, jsonb_build_object('tranche_from', old, 'tranche_to', p_to) || p_payload);
  perform _close_operation_if_done(tr.tx_id, p_actor);
  select * into tr from tranches where id = p_tranche;
  return tr;
end $$;

-- État des fonds (CONDITIONAL seulement) : HELD → RELEASED (versement au prestataire) ou RETURNED (rendus au payeur).
create or replace function _set_funds_state(p_tranche uuid, p_state text, p_actor uuid, p_event text, p_payload jsonb default '{}')
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; old text;
begin
  select * into tr from tranches where id = p_tranche for update;
  old := tr.funds_state;
  update tranches set funds_state = p_state, released_at = case when p_state = 'RELEASED' then now() else released_at end
   where id = p_tranche returning * into tr;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, p_actor, p_event, jsonb_build_object('funds_from', old, 'funds_to', p_state) || p_payload);
  if p_state = 'RELEASED' then
    insert into release_events(tx_id, tranche_id, trigger) values (tr.tx_id, tr.id, coalesce(p_payload->>'trigger', 'ADMIN'));
  end if;
  perform _close_operation_if_done(tr.tx_id, p_actor);
  select * into tr from tranches where id = p_tranche;
  return tr;
end $$;

-- Soumission d’une demande (DRAFT → SUBMITTED) : visible du payeur ; expiration selon le module (point ouvert 3) ;
-- jeton de la demande en CONDITIONAL seulement (QR présenté au prestataire après paiement).
create or replace function _submit_request(p_tranche uuid, p_actor uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; v_days int;
begin
  select * into tr from tranches where id = p_tranche for update;
  select * into t from transactions where id = tr.tx_id;
  select request_expiry_days into v_days from request_modules where code = t.vertical;
  update tranches set expires_at = case when v_days is not null then now() + make_interval(days => v_days) end where id = p_tranche;
  if t.settlement_mode = 'CONDITIONAL' then perform _issue_tranche_token(p_tranche); end if;
  return _set_tranche_status(p_tranche, 'SUBMITTED', p_actor, 'REQUEST_SUBMITTED', '{}');
end $$;

-- Activation d’une opération : ACTIVE, puis soumission des demandes dues (RG-12 : échéance dans les jours de prévenance, ou
-- jalon dont aucune demande précédente n’est en cours).
create or replace function _activate_operation(p_tx uuid, p_actor uuid, p_event text, p_payload jsonb default '{}') returns transactions
language plpgsql security definer set search_path = public as $$
declare v_lead int; r record;
begin
  perform _set_tx_status(p_tx, 'ACTIVE', p_actor, p_event, p_payload);
  select coalesce(value::int, 7) into v_lead from app_config where key = 'activation_lead_days';
  for r in select tr.id from tranches tr where tr.tx_id = p_tx and tr.status = 'DRAFT'
             and ((tr.due_date is not null and tr.due_date <= current_date + v_lead)
               or (tr.due_date is null and not exists (select 1 from tranches p where p.tx_id = tr.tx_id and p.seq < tr.seq and not _request_final(p))))
           order by tr.seq loop
    perform _submit_request(r.id, null);
  end loop;
  return (select t from transactions t where t.id = p_tx);
end $$;

-- ---------- 7. Revue par la plateforme (platform_review, défaut NEVER) ----------
-- RISK_BASED : revue si deux validateurs sont exigés, si c’est la première demande de l’initiateur, en cas de doublon, ou si le
-- montant atteint le seuil (réglage risk_review_threshold, JSON par devise : point ouvert 4). Seuil absent : revue (prudence).
create or replace function _platform_review(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t transactions; m request_modules; v_reasons text[] := '{}'; v_thr bigint; v_cfg jsonb;
begin
  select * into t from transactions where id = p_tx;
  select * into m from request_modules where code = t.vertical;
  if m.code is null or m.platform_review = 'ALWAYS' then v_reasons := array_append(v_reasons, 'ALWAYS'); end if;
  if required_validations(p_tx) >= 2 then v_reasons := array_append(v_reasons, 'DUAL_VALIDATION'); end if;
  if m.platform_review = 'RISK_BASED' then
    begin v_cfg := (select value::jsonb from app_config where key = 'risk_review_threshold'); exception when others then v_cfg := null; end;
    v_thr := (v_cfg->>(t.currency::text))::bigint;
    if v_thr is null then v_reasons := array_append(v_reasons, 'THRESHOLD_NOT_CONFIGURED');
    elsif t.amount_minor >= v_thr then v_reasons := array_append(v_reasons, 'AMOUNT_THRESHOLD'); end if;
    if not exists (select 1 from transactions o where coalesce(o.initiator_id, o.created_by) = coalesce(t.initiator_id, t.created_by)
                   and o.id <> t.id and o.status in ('ACTIVE','SUSPENDED','CLOSED')) then
      v_reasons := array_append(v_reasons, 'FIRST_REQUEST');
    end if;
    if cardinality(_duplicate_refs(p_tx)) > 0 then v_reasons := array_append(v_reasons, 'DUPLICATE'); end if;
  end if;
  return jsonb_build_object('review', cardinality(v_reasons) > 0, 'mode', coalesce(m.platform_review, 'ALWAYS'), 'reasons', to_jsonb(v_reasons));
end $$;

-- ---------- 8. Soumission et transitions d’une opération ----------
-- Contrôles de soumission (inchangés depuis 0011), puis ACTIVE (AUTO_ACTIVATED) ou PENDING_REVIEW selon platform_review.
create or replace function submit_operation(p_tx uuid) returns transactions
language plpgsql security definer set search_path = public as $$
declare t transactions; total bigint; missing text; v_review jsonb;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if t.status <> 'DRAFT' then perform _err('TRANSITION_UNKNOWN', format('Transition %s -> soumission inconnue', t.status)); end if;
  if not _is_initiator(p_tx) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if not exists (select 1 from request_modules where code = t.vertical and enabled) then
    perform _err('VERTICAL_UNAVAILABLE', 'Ce type de besoin n’est pas encore ouvert');
  end if;
  if t.purpose is null or t.amount_minor is null or t.currency is null then perform _err('VALIDATION', 'Dossier incomplet'); end if;
  if not exists (select 1 from transaction_parties where tx_id = p_tx and role = 'PAYER') then
    perform _err('VALIDATION', 'Téléphone du payeur requis');
  end if;
  select sum(amount_minor) into total from tranches where tx_id = p_tx;
  if total is null then perform _err('PLAN_EMPTY', 'Au moins une tranche est requise'); end if;
  if total <> t.amount_minor then
    perform _err('PLAN_SUM_MISMATCH', format('La somme des tranches (%s) doit égaler le montant total (%s)', total, t.amount_minor),
                 json_build_object('sum', total, 'total', t.amount_minor, 'gap', t.amount_minor - total)::text);
  end if;
  if not exists (select 1 from documents where tx_id = p_tx and tranche_id is null and deleted_at is null) then
    perform _err('TX_NO_DOCUMENT', 'Au moins une pièce justificative est requise');
  end if;
  select rd.kind into missing from required_documents rd
   where rd.vertical = t.vertical and rd.required
     and not exists (select 1 from documents d where d.tx_id = p_tx and d.kind = rd.kind and d.tranche_id is null and d.deleted_at is null)
   order by rd.kind limit 1;
  if missing is not null then perform _err('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', missing); end if;

  update transactions set reject_reason = null where id = p_tx;
  v_review := _platform_review(p_tx);
  if (v_review->>'review')::boolean then
    return _set_tx_status(p_tx, 'PENDING_REVIEW', auth.uid(), 'STATUS_CHANGE', jsonb_build_object('review', v_review));
  end if;
  return _activate_operation(p_tx, auth.uid(), 'AUTO_ACTIVATED', jsonb_build_object('mode', v_review->>'mode'));
end $$;

-- Transitions génériques d’une opération (table 3.1). « SUBMITTED » reste accepté : c’est la soumission (submit_operation).
-- Annulation par l’initiateur : en ACTIVE, les demandes non payées sont annulées ; l’opération est annulée si aucune n’est
-- payée, close sinon.
create or replace function transition_tx(p_tx uuid, p_to tx_status, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ok boolean := false; r record;
begin
  perform _require_user();
  if p_to = 'SUBMITTED' then return submit_operation(p_tx); end if;
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx) or is_validator()) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if not exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to) then
    perform _err('TRANSITION_UNKNOWN', format('Transition %s -> %s inconnue', t.status, p_to));
  end if;
  if exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to and validator_only) then
    if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
    if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas agir sur un dossier dont il est partie'); end if;
    ok := true;
  elsif _is_initiator(p_tx) and exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to and role = 'INITIATOR') then
    ok := true;
  end if;
  if not ok then perform _err('TRANSITION_FORBIDDEN', format('Transition %s -> %s non autorisée', t.status, p_to)); end if;

  if p_to = 'ACTIVE' then
    return _activate_operation(p_tx, auth.uid(), 'STATUS_CHANGE', jsonb_build_object('reason', p_reason));
  end if;
  if p_to = 'CANCELLED' then
    if t.status in ('PENDING_REVIEW','IN_REVIEW') then
      if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif obligatoire'); end if;
      update transactions set reject_reason = trim(p_reason) where id = p_tx;
    end if;
    for r in select id from tranches where tx_id = p_tx and status in ('DRAFT','SUBMITTED','INFO_REQUESTED') loop
      perform set_config('app.via_transition','on', true);
      update tranches set status = 'CANCELLED' where id = r.id;
      insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
      values (p_tx, r.id, auth.uid(), 'REQUEST_CANCELLED', jsonb_build_object('tranche_to', 'CANCELLED'));
    end loop;
    if exists (select 1 from tranches where tx_id = p_tx and status in ('ACCEPTED','PAID','REFUNDED')) then
      perform _close_operation_if_done(p_tx, auth.uid());
      return (select x from transactions x where x.id = p_tx);
    end if;
  end if;
  return _set_tx_status(p_tx, p_to, auth.uid(), 'STATUS_CHANGE', jsonb_build_object('reason', p_reason));
end $$;

-- Prise en charge par le bureau (lot 5, D8) : PENDING_REVIEW → IN_REVIEW.
create or replace function claim_dossier(p_tx uuid) returns transactions
language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  perform _require_validator();
  select * into t from transactions where id = p_tx for update;
  if not found then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne prend pas en charge un dossier dont il est partie'); end if;
  if t.status = 'PENDING_REVIEW' then select * into t from transition_tx(p_tx, 'IN_REVIEW', null); end if;
  return t;
end $$;

-- Début du tour de revue : la dernière entrée en PENDING_REVIEW (avant : SUBMITTED).
create or replace function _round_start(p_tx uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(max(created_at), '-infinity'::timestamptz) from audit_log where tx_id = p_tx and to_status in ('PENDING_REVIEW','SUBMITTED')
$$;

-- Décision du bureau (lot 5) : approbation → ACTIVE (demandes dues soumises) ; rejet → CANCELLED avec motif (D4 remplacée).
create or replace function decide_tx(p_tx uuid, p_approved boolean, p_amount_checked boolean, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; need int; got int; since timestamptz; v_reason text;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into t from transactions where id = p_tx for update;
  if not found then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas valider un dossier dont il est partie'); end if;
  if t.status <> 'IN_REVIEW' then perform _err('NOT_IN_REVIEW', 'Le dossier n’est pas en validation'); end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if not p_approved and coalesce(length(v_reason), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
  if p_approved and not coalesce(p_amount_checked, false) then
    perform _err('AMOUNT_NOT_CHECKED', 'Cochez « J’ai vérifié que le montant correspond aux pièces » avant d’approuver');
  end if;
  since := _round_start(p_tx);
  if exists (select 1 from validations where tx_id = p_tx and tranche_id is null and validator_id = auth.uid() and decided_at >= since) then
    perform _err('ALREADY_DECIDED', 'Vous avez déjà donné votre décision sur ce dossier');
  end if;
  insert into validations(tx_id, validator_id, approved, reason, amount_checked) values (p_tx, auth.uid(), p_approved, v_reason, coalesce(p_amount_checked, false));
  need := required_validations(p_tx);
  select count(distinct validator_id) into got from validations where tx_id = p_tx and tranche_id is null and approved and decided_at >= since;
  insert into audit_log(tx_id, actor_id, event, payload)
  values (p_tx, auth.uid(), 'VALIDATION_DECISION', jsonb_build_object('approved', p_approved, 'amount_checked', coalesce(p_amount_checked, false),
          'reason', v_reason, 'got', got, 'need', need));
  if not p_approved then
    update transactions set reject_reason = v_reason where id = p_tx;
    perform _set_tx_status(p_tx, 'CANCELLED', auth.uid(), 'STATUS_CHANGE', jsonb_build_object('reason', v_reason));
    perform set_config('app.via_transition','on', true);
    update tranches set status = 'CANCELLED' where tx_id = p_tx and status = 'DRAFT';
  elsif got >= need then
    perform _activate_operation(p_tx, auth.uid(), 'STATUS_CHANGE', '{}');
  end if;
  select * into t from transactions where id = p_tx;
  return t;
end $$;

-- ---------- 9. Demandes : transitions de l’initiateur, décisions du payeur ----------
create or replace function _request_tranche(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not (is_party(tr.tx_id) or _is_initiator(tr.tx_id)) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if (select status from transactions where id = tr.tx_id) <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  return tr;
end $$;

-- Initiateur : soumettre plus tôt une demande programmée, ou annuler une demande non payée. Les décisions du payeur et les
-- paiements passent par leurs fonctions dédiées (motifs, contributions, tentatives).
create or replace function transition_tranche(p_tranche uuid, p_to tranche_status, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  tr := _request_tranche(p_tranche);
  if not exists (select 1 from tranche_transitions where from_status = tr.status and to_status = p_to) then
    perform _err('TRANSITION_UNKNOWN', format('Transition de demande %s -> %s inconnue', tr.status, p_to));
  end if;
  if not exists (select 1 from tranche_transitions where from_status = tr.status and to_status = p_to and role = 'INITIATOR')
     or (tr.status = 'INFO_REQUESTED' and p_to = 'SUBMITTED') then
    perform _err('TRANSITION_FORBIDDEN', 'Utiliser la fonction dédiée (answer_info, request_info, reject_request, paiement)');
  end if;
  if not _is_initiator(tr.tx_id) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if p_to = 'SUBMITTED' then return _submit_request(p_tranche, auth.uid()); end if;
  perform _revoke_active_token(p_tranche, 'Demande annulée par l’initiateur', auth.uid());
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'REQUEST_CANCELLED', jsonb_build_object('reason', p_reason));
end $$;

create or replace function request_info(p_tranche uuid, p_message text) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_text text; m request_messages;
begin
  tr := _request_tranche(p_tranche);
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  if tr.status <> 'SUBMITTED' then perform _err('TRANSITION_UNKNOWN', format('Transition de demande %s -> INFO_REQUESTED inconnue', tr.status)); end if;
  if _is_initiator(tr.tx_id) then perform _err('TRANSITION_FORBIDDEN', 'Vous êtes l’initiateur de cette demande'); end if;
  if tr.on_hold then perform _err('REQUEST_ON_HOLD', 'Demande suspendue par un litige'); end if;
  v_text := _check_message(p_message);
  insert into request_messages(tx_id, tranche_id, author_id, kind, body) values (tr.tx_id, tr.id, auth.uid(), 'INFO_REQUEST', v_text) returning * into m;
  return _set_tranche_status(p_tranche, 'INFO_REQUESTED', auth.uid(), 'INFO_REQUESTED', jsonb_build_object('message_id', m.id));
end $$;

create or replace function answer_info(p_tranche uuid, p_message text) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_text text; m request_messages;
begin
  tr := _request_tranche(p_tranche);
  if not _is_initiator(tr.tx_id) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if tr.status <> 'INFO_REQUESTED' then perform _err('TRANSITION_UNKNOWN', format('Transition de demande %s -> SUBMITTED inconnue', tr.status)); end if;
  v_text := _check_message(p_message);
  insert into request_messages(tx_id, tranche_id, author_id, kind, body) values (tr.tx_id, tr.id, auth.uid(), 'INFO_ANSWER', v_text) returning * into m;
  return _set_tranche_status(p_tranche, 'SUBMITTED', auth.uid(), 'INFO_ANSWERED', jsonb_build_object('message_id', m.id));
end $$;

create or replace function reject_request(p_tranche uuid, p_reason text) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_text text; m request_messages;
begin
  tr := _request_tranche(p_tranche);
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  if tr.status not in ('SUBMITTED','INFO_REQUESTED') then
    perform _err('TRANSITION_UNKNOWN', format('Transition de demande %s -> REJECTED inconnue', tr.status));
  end if;
  v_text := _check_message(p_reason);
  insert into request_messages(tx_id, tranche_id, author_id, kind, body) values (tr.tx_id, tr.id, auth.uid(), 'NOTE', v_text) returning * into m;
  perform _revoke_active_token(p_tranche, 'Demande rejetée par le payeur', auth.uid());
  return _set_tranche_status(p_tranche, 'REJECTED', auth.uid(), 'REQUEST_REJECTED', jsonb_build_object('message_id', m.id, 'reason', v_text));
end $$;

-- Jetons : l’initiateur révoque tant que la demande n’est pas payée (DRAFT, SUBMITTED, INFO_REQUESTED, ACCEPTED).
create or replace function _check_token_manager(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_admin boolean;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  v_admin := is_admin();
  if not (is_party(tr.tx_id) or _is_initiator(tr.tx_id) or v_admin) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if v_admin and not is_party(tr.tx_id) then return tr; end if;
  if not _is_initiator(tr.tx_id) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if tr.status not in ('DRAFT','SUBMITTED','INFO_REQUESTED','ACCEPTED') then
    perform _err('NOT_REVOCABLE', 'Demande déjà payée : seul un administrateur peut révoquer son jeton');
  end if;
  return tr;
end $$;

create or replace function reissue_token(p_tranche uuid, p_reason text default 'Réémission du jeton') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_old uuid; k tranche_tokens;
begin
  tr := _check_token_manager(p_tranche);
  if tr.status = 'DRAFT' then perform _err('NO_TOKEN', 'Demande pas encore soumise : aucun jeton'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif de réémission obligatoire'); end if;
  v_old := _revoke_active_token(p_tranche, p_reason, auth.uid());
  perform _issue_tranche_token(p_tranche);
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'TOKEN_REISSUED', jsonb_build_object('token_id', k.id, 'replaces', v_old));
  return jsonb_build_object('trancheId', tr.id, 'tokenId', k.id, 'expiresAt', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Jeton lisible par le payeur seulement, pour une demande soumise (CONDITIONAL : QR présenté au prestataire après paiement).
drop policy if exists ttokens_read on tranche_tokens;
create policy ttokens_read on tranche_tokens for select using (
  revoked_at is null and exists (select 1 from tranches tr where tr.id = tranche_id and tr.status <> 'DRAFT' and has_role(tr.tx_id, 'PAYER')));

-- ---------- 10. Libération conditionnelle (CONDITIONAL seulement, sur funds_state) ----------
-- Confirmation : délai de contestation ouvert ; preuve : file du bureau ; libération : versement au prestataire.
create or replace function _conditional_tranche(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  tr := _request_tranche(p_tranche);
  if (select settlement_mode from transactions where id = tr.tx_id) <> 'CONDITIONAL' then
    perform _err('WRONG_MODE', 'Règlement direct : ni confirmation ni libération');
  end if;
  if tr.status <> 'PAID' or tr.funds_state <> 'HELD' then perform _err('NOT_PAID', format('Demande non payée ou fonds déjà traités (%s, %s)', tr.status, tr.funds_state)); end if;
  if exists (select 1 from disputes where tranche_id = p_tranche and status <> 'RESOLVED') then
    perform _err('DISPUTE_OPEN', 'Un litige est en cours sur cette demande');
  end if;
  return tr;
end $$;

create or replace function _confirm_service(tr tranches, p_actor uuid, p_event text, p_payload jsonb) returns tranches
language plpgsql security definer set search_path = public as $$
begin
  if tr.confirmed_at is not null then perform _err('ALREADY_CONFIRMED', 'Prestation déjà confirmée'); end if;
  update tranches set confirmed_at = now(), contest_ends_at = now() + make_interval(hours => contest_hours) where id = tr.id returning * into tr;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, p_actor, p_event, jsonb_build_object('contest_ends_at', tr.contest_ends_at) || p_payload);
  return tr;
end $$;

-- Payeur, mode PAYER_CONFIRM (agro) : confirme la réception.
create or replace function confirm_service(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  tr := _conditional_tranche(p_tranche);
  if tr.release_mode <> 'PAYER_CONFIRM' or not has_role(tr.tx_id, 'PAYER') then
    perform _err('WRONG_CONFIRMER', format('Ce rôle ne peut pas confirmer cette demande (mode %s)', tr.release_mode));
  end if;
  return _confirm_service(tr, auth.uid(), 'SERVICE_CONFIRMED', '{}');
end $$;

-- Prestataire, mode EVIDENCE_REVIEW : dépose ses preuves (documents de la demande), puis demande leur examen.
create or replace function submit_evidence(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  tr := _conditional_tranche(p_tranche);
  if not has_role(tr.tx_id, 'PROVIDER') then perform _err('PROVIDER_ONLY', 'Réservé au prestataire'); end if;
  if tr.release_mode <> 'EVIDENCE_REVIEW' then perform _err('NO_EVIDENCE_NEEDED', 'Cette demande ne requiert pas de preuve'); end if;
  if not exists (select 1 from documents where tranche_id = p_tranche and deleted_at is null) then perform _err('EVIDENCE_MISSING', 'Déposez au moins une pièce probante'); end if;
  update tranches set evidence_submitted_at = now() where id = p_tranche returning * into tr;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (tr.tx_id, tr.id, auth.uid(), 'EVIDENCE_SUBMITTED', '{}');
  return tr;
end $$;

-- Payeur : libération anticipée après confirmation (avant la fin du délai de contestation).
create or replace function approve_release(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  tr := _conditional_tranche(p_tranche);
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Seul le payeur peut approuver la libération anticipée'); end if;
  if tr.confirmed_at is null then perform _err('NOT_CONFIRMED', 'La prestation n’est pas encore confirmée'); end if;
  return _set_funds_state(p_tranche, 'RELEASED', auth.uid(), 'FUNDS_RELEASED', jsonb_build_object('trigger', 'PAYER_APPROVAL'));
end $$;

create or replace function _evidence_round_start(p_tranche uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(max(created_at), '-infinity'::timestamptz) from audit_log
  where tranche_id = p_tranche and (event = 'EVIDENCE_SUBMITTED' or payload->>'tranche_to' = 'EVIDENCE_SUBMITTED')
$$;

-- Bureau : décision sur les preuves ; approbation (double validation si exigée) → fonds libérés.
create or replace function decide_tranche(p_tranche uuid, p_approved boolean, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; need int; got int; since timestamptz;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if is_party(tr.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas valider une preuve d’un dossier dont il est partie'); end if;
  if tr.evidence_submitted_at is null or tr.funds_state <> 'HELD' then perform _err('NO_EVIDENCE_PENDING', 'Aucune preuve en attente'); end if;
  if not p_approved and coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
  since := _evidence_round_start(p_tranche);
  if exists (select 1 from validations where tranche_id = p_tranche and validator_id = auth.uid() and decided_at >= since) then
    perform _err('ALREADY_DECIDED', 'Vous avez déjà donné votre décision');
  end if;
  insert into validations(tx_id, tranche_id, validator_id, approved, reason) values (tr.tx_id, p_tranche, auth.uid(), p_approved, p_reason);
  if not p_approved then
    update tranches set evidence_submitted_at = null where id = p_tranche returning * into tr;
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (tr.tx_id, tr.id, auth.uid(), 'EVIDENCE_REJECTED', jsonb_build_object('reason', p_reason));
    return tr;
  end if;
  need := required_validations(tr.tx_id, p_tranche);
  select count(distinct validator_id) into got from validations where tranche_id = p_tranche and approved and decided_at >= since;
  if got < need then
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (tr.tx_id, p_tranche, auth.uid(), 'EVIDENCE_PARTIAL', jsonb_build_object('got', got, 'need', need));
    return tr;
  end if;
  update tranches set confirmed_at = coalesce(confirmed_at, now()) where id = p_tranche;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (tr.tx_id, p_tranche, auth.uid(), 'EVIDENCE_APPROVED', '{}');
  return _set_funds_state(p_tranche, 'RELEASED', auth.uid(), 'FUNDS_RELEASED', jsonb_build_object('trigger','VALIDATOR_APPROVAL'));
end $$;

-- Prestataire : confirmation par scan du QR du payeur (CONDITIONAL, mode PROVIDER_CONFIRM). En DIRECT : WRONG_MODE.
create or replace function confirm_by_reference(p_ref text, p_device_time timestamptz default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare k tranche_tokens; tr tranches; at_time timestamptz;
begin
  perform _require_user();
  perform _reference_guard();
  k := _party_token(p_ref);
  if k.id is null then perform _err('UNKNOWN_REFERENCE', 'Référence inconnue'); end if;
  select * into k from tranche_tokens where id = k.id for update;
  if k.revoked_at is not null then perform _err('TOKEN_REVOKED', 'Ce QR a été révoqué'); end if;
  select * into tr from tranches where id = k.tranche_id for update;
  if not has_role(tr.tx_id,'PROVIDER') then perform _err('PROVIDER_ONLY', 'Réservé au prestataire'); end if;
  if k.used_at is not null then perform _err('TOKEN_USED', 'Ce QR a déjà été utilisé'); end if;
  at_time := coalesce(p_device_time, now());
  if at_time > now() + interval '5 minutes' then perform _err('DEVICE_TIME_INVALID', 'Heure de l’appareil invalide'); end if;
  if at_time > k.expires_at then perform _err('TOKEN_EXPIRED', 'QR expiré'); end if;
  if (select settlement_mode from transactions where id = tr.tx_id) <> 'CONDITIONAL' then
    perform _err('WRONG_MODE', 'Règlement direct : aucune confirmation par scan');
  end if;
  if tr.status <> 'PAID' or tr.funds_state <> 'HELD' then perform _err('NOT_PAID', format('Demande non payée ou déjà traitée (%s)', tr.status)); end if;
  if tr.release_mode <> 'PROVIDER_CONFIRM' then perform _err('WRONG_MODE', 'Cette demande ne se confirme pas par scan prestataire'); end if;
  update tranche_tokens set used_at = now() where id = k.id;
  return _confirm_service(tr, auth.uid(), 'PROVIDER_SCAN', jsonb_build_object('device_time', at_time, 'offline', p_device_time is not null));
end $$;

-- ---------- 11. Tâches planifiées ----------
create or replace function release_due_tranches() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select tr.id from tranches tr where tr.status = 'PAID' and tr.funds_state = 'HELD' and tr.release_mode <> 'EVIDENCE_REVIEW'
             and tr.confirmed_at is not null and tr.contest_ends_at <= now()
             and not exists (select 1 from disputes d where d.tranche_id = tr.id and d.status <> 'RESOLVED') loop
    perform _set_funds_state(r.id, 'RELEASED', null, 'FUNDS_RELEASED', jsonb_build_object('trigger','AUTO_TIMEOUT'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function activate_due_tranches() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_lead int;
begin
  select coalesce(value::int, 7) into v_lead from app_config where key = 'activation_lead_days';
  for r in select tr.id from tranches tr join transactions t on t.id = tr.tx_id
           where t.status = 'ACTIVE' and tr.status = 'DRAFT'
             and ((tr.due_date is not null and tr.due_date <= current_date + v_lead)
               or (tr.due_date is null and not exists (select 1 from tranches p where p.tx_id = tr.tx_id and p.seq < tr.seq and not _request_final(p))))
           order by tr.tx_id, tr.seq loop
    perform _submit_request(r.id, null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Demandes soumises dont la date d’expiration est passée (durée par module : point ouvert 3).
create or replace function expire_due_requests() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from tranches where status in ('SUBMITTED','INFO_REQUESTED') and expires_at <= now() and not on_hold loop
    perform _revoke_active_token(r.id, 'Demande expirée', null);
    perform _set_tranche_status(r.id, 'EXPIRED', null, 'REQUEST_EXPIRED', '{}');
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('diaspay-expire-due-requests', '15 * * * *', 'select public.expire_due_requests()');

-- ---------- 12. Paiements (0010, statuts v2) ----------
-- Le payeur paie une demande soumise (SUBMITTED → ACCEPTED) ; l’événement du partenaire la passe à PAID, ou la rend payable
-- (ACCEPTED → SUBMITTED) si toutes les tentatives échouent. X5 ajoute contributions, cotations et plafonds (accept_and_pay).
create or replace function start_payment(p_tranche uuid, p_idempotency_key text, p_method text default 'SIMULATED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := trim(coalesce(p_idempotency_key, '')); a payment_attempts; tr tranches; t transactions; v_provider text;
begin
  perform _require_user();
  if length(v_key) not between 8 and 200 then perform _err('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)'); end if;
  select * into a from payment_attempts where idempotency_key = v_key;
  if found then
    if a.tranche_id <> p_tranche or a.created_by is distinct from auth.uid() then
      perform _err('IDEMPOTENCY_CONFLICT', 'Clé d’idempotence déjà utilisée pour un autre paiement');
    end if;
    return _attempt_json(a);
  end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  select * into t from transactions where id = tr.tx_id;
  if t.status <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  if tr.on_hold then perform _err('REQUEST_ON_HOLD', 'Demande suspendue par un litige'); end if;
  if exists (select 1 from payment_attempts where tranche_id = p_tranche and status = 'PENDING') then
    perform _err('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
  end if;
  if tr.status <> 'SUBMITTED' then perform _err('NOT_PAYABLE', 'Cette demande n’est pas à payer'); end if;
  if coalesce(p_method, '') not in ('SIMULATED','MOBILE_MONEY','CARD','BANK_TRANSFER') then perform _err('VALIDATION', 'Moyen de paiement inconnu'); end if;
  v_provider := coalesce((select value from app_config where key = 'payment_provider'), 'SIMULATED');
  insert into payment_attempts(tx_id, tranche_id, idempotency_key, provider, method, amount_minor, currency, provider_ref, created_by)
  values (tr.tx_id, tr.id, v_key, v_provider, p_method, tr.amount_minor, t.currency,
          case when v_provider = 'SIMULATED' then 'SIM-' || replace(gen_random_uuid()::text, '-', '') end, auth.uid())
  returning * into a;
  perform _set_tranche_status(tr.id, 'ACCEPTED', auth.uid(), 'REQUEST_ACCEPTED', jsonb_build_object('attempt_id', a.id));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'PAYMENT_STARTED', jsonb_build_object('attempt_id', a.id, 'method', a.method, 'provider', a.provider));
  return _attempt_json(a);
end $$;

create or replace function _process_payment_event(p_event bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e webhook_events; p jsonb; v_type text; a payment_attempts; r refunds; tr tranches; t transactions; v_result text := 'APPLIED'; v_error text;
        v_journal uuid; v_fee bigint;
begin
  select * into e from webhook_events where id = p_event for update;
  p := e.payload; v_type := p->>'type';
  if v_type like 'PAYMENT_%' then
    select * into a from payment_attempts
     where idempotency_key = p->>'idempotencyKey' or (provider = e.provider and provider_ref = p->>'providerRef' and provider_ref is not null)
     order by created_at limit 1 for update;
    if not found then v_result := 'REJECTED'; v_error := 'UNKNOWN_ATTEMPT';
    elsif v_type = 'PAYMENT_PENDING' then
      if a.status = 'PENDING' then update payment_attempts set provider_ref = coalesce(provider_ref, p->>'providerRef'), updated_at = now() where id = a.id;
      else v_result := 'IGNORED'; v_error := 'STALE_EVENT'; end if;
    elsif v_type = 'PAYMENT_SUCCEEDED' then
      if a.status = 'SUCCEEDED' then v_result := 'IGNORED'; v_error := 'ALREADY_APPLIED';
      elsif a.status = 'FAILED' then v_result := 'REJECTED'; v_error := 'CONTRADICTS_FINAL_STATE';
      elsif (p->>'amountMinor')::bigint is distinct from a.amount_minor or (p->>'currency') is distinct from a.currency::text then
        v_result := 'REJECTED'; v_error := 'AMOUNT_MISMATCH';
      else
        v_fee := greatest(coalesce((p->>'feeMinor')::bigint, 0), 0);
        update payment_attempts set status = 'SUCCEEDED', provider_ref = coalesce(provider_ref, p->>'providerRef'), updated_at = now(), completed_at = now()
         where id = a.id returning * into a;
        insert into payments(tx_id, tranche_id, provider, external_id, status, fee_minor)
        select a.tx_id, a.tranche_id, a.provider, a.provider_ref, 'SUCCEEDED', v_fee
        where not exists (select 1 from payments where tranche_id = a.tranche_id and status = 'SUCCEEDED');
        v_journal := _post_journal('PAYMENT', a.tranche_id, a.currency, jsonb_build_array(
            jsonb_build_object('account','PARTNER_CASH','debit', a.amount_minor + v_fee),
            jsonb_build_object('account','DUE_TO_PROVIDER','credit', a.amount_minor),
            jsonb_build_object('account','FEES','credit', v_fee)), a.id, null, null, e.id, 'Paiement reçu par le partenaire');
        insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
        values (a.tx_id, a.tranche_id, null, 'PAYMENT_SUCCEEDED', jsonb_build_object('attempt_id', a.id, 'provider', a.provider));
        select * into tr from tranches where id = a.tranche_id for update;
        select * into t from transactions where id = tr.tx_id;
        if tr.status = 'ACCEPTED' then
          if t.settlement_mode = 'CONDITIONAL' then
            update tranches set funds_state = 'HELD' where id = tr.id;
            perform _set_tranche_status(tr.id, 'PAID', null, 'REQUEST_PAID', jsonb_build_object('attempt_id', a.id, 'funds', 'HELD'));
          else
            -- Règlement direct : le paiement exécuté est versé au prestataire (journal RELEASE par release_events).
            insert into release_events(tx_id, tranche_id, trigger) values (tr.tx_id, tr.id, 'DIRECT_PAYMENT');
            perform _set_tranche_status(tr.id, 'PAID', null, 'REQUEST_PAID', jsonb_build_object('attempt_id', a.id));
          end if;
        else
          v_error := 'TRANCHE_NOT_AWAITING';   -- argent reçu, demande plus en attente de paiement : le rapprochement le signale
        end if;
      end if;
    elsif v_type = 'PAYMENT_FAILED' then
      if a.status = 'FAILED' then v_result := 'IGNORED'; v_error := 'ALREADY_APPLIED';
      elsif a.status = 'SUCCEEDED' then v_result := 'REJECTED'; v_error := 'CONTRADICTS_FINAL_STATE';
      else
        update payment_attempts set status = 'FAILED', error_code = coalesce(p->>'errorCode', 'DECLINED'), updated_at = now(), completed_at = now()
         where id = a.id returning * into a;
        insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
        values (a.tx_id, a.tranche_id, null, 'PAYMENT_FAILED', jsonb_build_object('attempt_id', a.id, 'error', a.error_code));
        -- Toutes les tentatives ont échoué : la demande redevient payable.
        if (select status from tranches where id = a.tranche_id) = 'ACCEPTED'
           and not exists (select 1 from payment_attempts where tranche_id = a.tranche_id and status in ('PENDING','SUCCEEDED')) then
          perform _set_tranche_status(a.tranche_id, 'SUBMITTED', null, 'PAYMENT_RETRY_ALLOWED', jsonb_build_object('attempt_id', a.id));
        end if;
      end if;
    else v_result := 'REJECTED'; v_error := 'UNKNOWN_TYPE';
    end if;
  elsif v_type in ('REFUND_SUCCEEDED','REFUND_FAILED') then
    select * into r from refunds where idempotency_key = p->>'refundKey' or (provider_ref = p->>'providerRef' and provider_ref is not null)
     order by created_at limit 1 for update;
    if not found then v_result := 'REJECTED'; v_error := 'UNKNOWN_REFUND';
    elsif r.status <> 'PENDING' then
      v_result := case when r.status = substr(v_type, 8) then 'IGNORED' else 'REJECTED' end;
      v_error := case when r.status = substr(v_type, 8) then 'ALREADY_APPLIED' else 'CONTRADICTS_FINAL_STATE' end;
    elsif (p->>'amountMinor')::bigint is distinct from r.amount_minor then v_result := 'REJECTED'; v_error := 'AMOUNT_MISMATCH';
    else
      select * into a from payment_attempts where id = r.attempt_id;
      v_journal := (select id from ledger_journals where refund_id = r.id and kind = 'REFUND_REQUESTED' limit 1);
      if v_type = 'REFUND_SUCCEEDED' then
        update refunds set status = 'SUCCEEDED', completed_at = now(), provider_ref = coalesce(provider_ref, p->>'providerRef') where id = r.id returning * into r;
        perform _post_journal('REFUND_SETTLED', r.tranche_id, r.currency, jsonb_build_array(
            jsonb_build_object('account','REFUNDS_PAYABLE','debit', r.amount_minor),
            jsonb_build_object('account','PARTNER_CASH','credit', r.amount_minor)), a.id, r.id, v_journal, e.id, 'Remboursement versé au payeur');
        if (select coalesce(sum(amount_minor), 0) from refunds where attempt_id = a.id and status = 'SUCCEEDED') >= a.amount_minor then
          update payments set status = 'REFUNDED' where tranche_id = a.tranche_id and status = 'SUCCEEDED';
        end if;
        -- Demande : PAID → REFUNDED (partiel ou total, refunded_minor). Un litige ne change jamais ce statut ; le remboursement si.
        update tranches set refunded_minor = refunded_minor + r.amount_minor where id = r.tranche_id;
        if (select status from tranches where id = r.tranche_id) = 'PAID' then
          perform _set_tranche_status(r.tranche_id, 'REFUNDED', null, 'REQUEST_REFUNDED', jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor));
        end if;
      else
        update refunds set status = 'FAILED', completed_at = now(), error_code = coalesce(p->>'errorCode', 'DECLINED') where id = r.id returning * into r;
        perform _post_journal('REFUND_REVERSED', r.tranche_id, r.currency, jsonb_build_array(
            jsonb_build_object('account','REFUNDS_PAYABLE','debit', r.amount_minor),
            jsonb_build_object('account','DUE_TO_PROVIDER','credit', r.amount_minor)), a.id, r.id, v_journal, e.id, 'Remboursement refusé');
      end if;
      insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
      values (r.tx_id, r.tranche_id, null, v_type, jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor));
    end if;
  else v_result := 'REJECTED'; v_error := 'UNKNOWN_TYPE';
  end if;
  update webhook_events set processed_at = now(), result = v_result, error = v_error, attempt_id = coalesce(a.id, r.attempt_id), refund_id = r.id
   where id = e.id;
  return jsonb_strip_nulls(jsonb_build_object('eventId', e.event_id, 'result', v_result, 'error', v_error,
    'attemptId', coalesce(a.id, r.attempt_id), 'refundId', r.id));
end $$;

-- Remboursement (interne) : jamais au-delà de « payé moins déjà engagé » ; contrepassation du paiement d’origine.
create or replace function _create_refund(p_tranche uuid, p_amount_minor bigint, p_key text, p_reason text, p_actor uuid) returns refunds
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; r refunds; tr tranches;
begin
  select * into tr from tranches where id = p_tranche;
  select * into a from payment_attempts where tranche_id = p_tranche and status = 'SUCCEEDED' for update;
  if not found then perform _err('NOT_REFUNDABLE', 'Aucun paiement réussi pour cette demande'); end if;
  if tr.funds_state = 'RELEASED' then perform _err('NOT_REFUNDABLE', 'Fonds libérés au prestataire : remboursement impossible par cette voie'); end if;
  if p_amount_minor is null or p_amount_minor <= 0 then perform _err('AMOUNT_INVALID', 'Montant invalide'); end if;
  if _refunded(a.id) + p_amount_minor > a.amount_minor then
    perform _err('REFUND_EXCEEDS_PAID', format('Remboursement au-delà du montant payé (déjà engagé : %s, payé : %s)', _refunded(a.id), a.amount_minor),
                 json_build_object('refunded', _refunded(a.id), 'paid', a.amount_minor)::text);
  end if;
  insert into refunds(attempt_id, tx_id, tranche_id, idempotency_key, amount_minor, currency, reason, requested_by, provider_ref)
  values (a.id, a.tx_id, a.tranche_id, p_key, p_amount_minor, a.currency, trim(p_reason), p_actor,
          case when a.provider = 'SIMULATED' then 'SIMR-' || replace(gen_random_uuid()::text, '-', '') end)
  returning * into r;
  perform _post_journal('REFUND_REQUESTED', r.tranche_id, r.currency, jsonb_build_array(
      jsonb_build_object('account','DUE_TO_PROVIDER','debit', r.amount_minor), jsonb_build_object('account','REFUNDS_PAYABLE','credit', r.amount_minor)),
    a.id, r.id, (select id from ledger_journals where attempt_id = a.id and kind = 'PAYMENT' limit 1), null, trim(p_reason));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (r.tx_id, r.tranche_id, p_actor, 'REFUND_REQUESTED', jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor));
  return r;
end $$;

create or replace function request_refund(p_tranche uuid, p_amount_minor bigint, p_idempotency_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := trim(coalesce(p_idempotency_key, '')); r refunds; tr tranches;
begin
  perform _require_user();
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  if length(v_key) not between 8 and 200 then perform _err('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)'); end if;
  select * into r from refunds where idempotency_key = v_key;
  if found then
    if r.tranche_id <> p_tranche or r.amount_minor <> p_amount_minor then perform _err('IDEMPOTENCY_CONFLICT', 'Clé d’idempotence déjà utilisée pour un autre remboursement'); end if;
    return jsonb_build_object('id', r.id, 'status', r.status, 'amountMinor', r.amount_minor, 'currency', r.currency);
  end if;
  select * into tr from tranches where id = p_tranche;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if is_party(tr.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas rembourser'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du remboursement obligatoire'); end if;
  r := _create_refund(p_tranche, p_amount_minor, v_key, p_reason, auth.uid());
  return jsonb_build_object('id', r.id, 'status', r.status, 'amountMinor', r.amount_minor, 'currency', r.currency);
end $$;

-- Paiement simulé (mock_mode) pour les tests et la démonstration : tentative puis événement, par le même chemin.
create or replace function simulate_tranche_system(p_tranche uuid, p_to tranche_status)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; a jsonb;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if (select status from transactions where id = tr.tx_id) <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  if p_to = 'SUBMITTED' and tr.status = 'DRAFT' then return _submit_request(p_tranche, auth.uid()); end if;
  if p_to = 'EXPIRED' and tr.status in ('SUBMITTED','INFO_REQUESTED') then
    return _set_tranche_status(p_tranche, 'EXPIRED', null, 'REQUEST_EXPIRED', '{}');
  end if;
  if p_to = 'PAID' then
    a := start_payment(p_tranche, 'sim-' || replace(gen_random_uuid()::text, '-', ''));
    perform demo_settle_payment((a->>'id')::uuid);
    return (select x from tranches x where x.id = p_tranche);
  end if;
  -- Libération à l’échéance du délai de contestation (CONDITIONAL), simulée.
  if p_to = 'RELEASED' and tr.funds_state = 'HELD' and tr.confirmed_at is not null then
    return _set_funds_state(p_tranche, 'RELEASED', null, 'FUNDS_RELEASED', jsonb_build_object('trigger','AUTO_TIMEOUT'));
  end if;
  perform _err('TRANSITION_UNKNOWN', format('Transition système %s -> %s invalide', tr.status, p_to));
  return null;
end $$;

-- Rapprochement (0010, statuts v2) : mêmes codes ; les états de demande changent de nom.
drop view if exists v_reconciliation;
create view v_reconciliation with (security_invoker = true) as
select a.id as attempt_id, a.tranche_id, a.tx_id, _tx_ref(a.tx_id) as reference, a.provider, a.status as attempt_status,
       a.amount_minor, a.currency::text as currency, tr.status::text as tranche_status, tr.funds_state,
       x.success_events, x.paid_ledger, x.released_ledger, x.refunded_requested, x.refunded_settled, x.rejected_events,
       array_remove(array[
         case when a.status = 'SUCCEEDED' and x.success_events = 0 then 'SUCCEEDED_WITHOUT_EVENT' end,
         case when a.status = 'SUCCEEDED' and x.paid_ledger = 0 then 'SUCCEEDED_WITHOUT_LEDGER' end,
         case when a.status <> 'SUCCEEDED' and x.paid_ledger > 0 then 'LEDGER_WITHOUT_SUCCESS' end,
         case when a.status = 'SUCCEEDED' and x.paid_ledger > 0 and x.paid_ledger <> a.amount_minor then 'LEDGER_AMOUNT_MISMATCH' end,
         case when a.status = 'SUCCEEDED' and tr.status in ('DRAFT','SUBMITTED','INFO_REQUESTED','ACCEPTED','REJECTED','EXPIRED') then 'TRANCHE_NOT_PAID' end,
         case when a.status <> 'SUCCEEDED' and tr.status in ('PAID','REFUNDED')
                   and not exists (select 1 from payment_attempts o where o.tranche_id = a.tranche_id and o.status = 'SUCCEEDED')
                   and x.succeeded_payments = 0 then 'PAID_WITHOUT_ATTEMPT' end,
         case when a.status = 'SUCCEEDED' and (tr.funds_state = 'RELEASED' or (tr.status = 'PAID' and tr.funds_state = 'NONE'))
                   and x.released_ledger = 0 and a.amount_minor > x.refunded_requested then 'RELEASED_NOT_IN_LEDGER' end,
         case when a.status = 'SUCCEEDED' and tr.status = 'CANCELLED' and x.refunded_settled < a.amount_minor then 'CANCELLED_NOT_REFUNDED' end,
         case when a.status = 'SUCCEEDED' and x.refunded_settled > 0 and tr.status <> 'REFUNDED' then 'REFUNDED_TRANCHE_OPEN' end,
         case when x.refunded_requested > a.amount_minor then 'REFUND_EXCEEDS_PAID' end,
         case when x.rejected_events > 0 then 'EVENT_REJECTED' end
       ], null) as issues
from payment_attempts a
join tranches tr on tr.id = a.tranche_id
cross join lateral (
  select
    (select count(*) from webhook_events w where w.attempt_id = a.id and w.result = 'APPLIED' and w.payload->>'type' = 'PAYMENT_SUCCEEDED')::int as success_events,
    (select count(*) from webhook_events w where w.attempt_id = a.id and w.result = 'REJECTED' and w.signature_valid)::int as rejected_events,
    (select count(*) from payments p where p.tranche_id = a.tranche_id and p.status in ('SUCCEEDED','REFUNDED'))::int as succeeded_payments,
    coalesce((select sum(e.credit_minor) from ledger_journals j join ledger_entries e on e.journal_id = j.id
              where j.attempt_id = a.id and j.kind = 'PAYMENT' and e.account_code = 'DUE_TO_PROVIDER'), 0)::bigint as paid_ledger,
    coalesce((select sum(e.debit_minor) from ledger_journals j join ledger_entries e on e.journal_id = j.id
              where j.attempt_id = a.id and j.kind = 'RELEASE' and e.account_code = 'DUE_TO_PROVIDER'), 0)::bigint as released_ledger,
    coalesce((select sum(amount_minor) from refunds f where f.attempt_id = a.id and f.status in ('PENDING','SUCCEEDED')), 0)::bigint as refunded_requested,
    coalesce((select sum(amount_minor) from refunds f where f.attempt_id = a.id and f.status = 'SUCCEEDED'), 0)::bigint as refunded_settled
) x
where is_validator();
revoke all on v_reconciliation from public, anon;
grant select on v_reconciliation to authenticated;

-- ---------- 13. Litige distinct (K5, K7) ----------
alter table disputes drop constraint if exists disputes_status_check;
alter table disputes add column if not exists outcome text;
alter table disputes add column if not exists before_payment boolean not null default false;
alter table disputes add column if not exists refund_amount_minor bigint;
alter table disputes add column if not exists refund_id uuid references refunds(id) on delete set null;
update disputes set outcome = case status when 'RELEASED_TO_PROVIDER' then 'FUNDS_RELEASED' when 'REFUNDED_TO_PAYER' then 'REFUND_FULL' end,
                    status = 'RESOLVED' where status in ('RELEASED_TO_PROVIDER','REFUNDED_TO_PAYER');
alter table disputes add constraint disputes_status_check check (status in ('OPEN','AWAITING_RESPONSE','IN_MEDIATION','RESOLVED'));
alter table disputes drop constraint if exists disputes_outcome_check;
alter table disputes add constraint disputes_outcome_check check (
  (status = 'RESOLVED') = (outcome is not null)
  and (outcome is null or outcome in ('NO_ACTION','REFUND_FULL','REFUND_PARTIAL','FUNDS_RELEASED','FUNDS_RETURNED')));
drop index if exists one_open_dispute_per_tranche;
create unique index one_open_dispute_per_tranche on disputes(tranche_id) where status <> 'RESOLVED';

create table if not exists dispute_messages (
  id         uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  tx_id      uuid not null references transactions(id) on delete cascade,
  author_id  uuid references profiles(id),
  kind       text not null check (kind in ('STATEMENT','RESPONSE','STAFF_REQUEST','STAFF_NOTE','DECISION')),
  body       text not null check (length(trim(body)) between 3 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists dispute_messages_dispute on dispute_messages(dispute_id, created_at);
alter table dispute_messages enable row level security;
drop policy if exists dispute_messages_read on dispute_messages;
create policy dispute_messages_read on dispute_messages for select using (is_party(tx_id) or is_validator());
revoke all on dispute_messages from anon;
revoke insert, update, delete on dispute_messages from authenticated;
grant select on dispute_messages to authenticated;
create or replace function _dispute_messages_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then return old; end if;
  raise exception 'dispute_messages est en ajout seul';
end $$;
drop trigger if exists dispute_messages_immutable on dispute_messages;
create trigger dispute_messages_immutable before update or delete on dispute_messages for each row execute function _dispute_messages_immutable();

-- Ouverture par le payeur ou le prestataire. Avant paiement (SUBMITTED, INFO_REQUESTED, ACCEPTED) : la demande est suspendue
-- (on_hold) et l’opération passe en SUSPENDED. Après paiement (PAID, REFUNDED) : le statut ne change pas (K7).
create or replace function open_dispute(p_tranche uuid, p_reason text, p_reason_code text default null)
returns disputes language plpgsql security definer set search_path = public as $$
declare tr tranches; d disputes; v_before boolean;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if not (has_role(tr.tx_id,'PAYER') or has_role(tr.tx_id,'PROVIDER')) then perform _err('NOT_A_PARTY', 'Seuls le payeur et le prestataire ouvrent un litige'); end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then perform _err('REASON_TOO_SHORT', 'Décrivez le problème (10 caractères minimum)'); end if;
  if p_reason_code is not null and p_reason_code not in ('NOT_DELIVERED','INCOMPLETE','WRONG_AMOUNT','OTHER') then perform _err('VALIDATION', 'Motif de litige inconnu'); end if;
  if tr.status in ('SUBMITTED','INFO_REQUESTED','ACCEPTED') then v_before := true;
  elsif tr.status in ('PAID','REFUNDED') then v_before := false;
  else perform _err('DISPUTE_NOT_ALLOWED', format('Litige impossible dans l’état %s', tr.status)); end if;
  if exists (select 1 from disputes where tranche_id = p_tranche and status <> 'RESOLVED') then perform _err('DISPUTE_NOT_ALLOWED', 'Un litige est déjà en cours'); end if;
  insert into disputes(tx_id, tranche_id, opened_by, reason, reason_code, before_payment)
  values (tr.tx_id, p_tranche, auth.uid(), trim(p_reason), p_reason_code, v_before) returning * into d;
  insert into dispute_messages(dispute_id, tx_id, author_id, kind, body) values (d.id, d.tx_id, auth.uid(), 'STATEMENT', trim(p_reason));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'DISPUTE_OPENED', jsonb_build_object('dispute_id', d.id, 'before_payment', v_before, 'tranche_status', tr.status));
  if v_before then
    update tranches set on_hold = true where id = p_tranche;
    if (select status from transactions where id = tr.tx_id) = 'ACTIVE' then
      perform _set_tx_status(tr.tx_id, 'SUSPENDED', null, 'OPERATION_SUSPENDED', jsonb_build_object('dispute_id', d.id));
    end if;
  end if;
  return d;
end $$;

-- Réponse de la partie adverse (lot 5) : une fois ; le litige passe en médiation.
create or replace function respond_dispute(p_dispute uuid, p_text text) returns disputes
language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  perform _require_user();
  select * into d from disputes where id = p_dispute for update;
  if not found or not is_party(d.tx_id) then perform _err('NO_OPEN_DISPUTE', 'Litige introuvable'); end if;
  if d.status = 'RESOLVED' then perform _err('NO_OPEN_DISPUTE', 'Litige déjà clos'); end if;
  if d.opened_by = auth.uid() or not (has_role(d.tx_id, 'PAYER') or has_role(d.tx_id, 'PROVIDER')) then
    perform _err('NOT_RESPONDENT', 'Seule la partie adverse répond au litige');
  end if;
  if d.response is not null then perform _err('ALREADY_ANSWERED', 'Une réponse a déjà été donnée'); end if;
  if coalesce(length(trim(p_text)), 0) < 10 then perform _err('REASON_TOO_SHORT', 'Réponse trop courte (10 caractères minimum)'); end if;
  update disputes set response = trim(p_text), responded_by = auth.uid(), responded_at = now(), status = 'IN_MEDIATION' where id = p_dispute returning * into d;
  insert into dispute_messages(dispute_id, tx_id, author_id, kind, body) values (d.id, d.tx_id, auth.uid(), 'RESPONSE', trim(p_text));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (d.tx_id, d.tranche_id, auth.uid(), 'DISPUTE_ANSWERED', jsonb_build_object('dispute_id', d.id));
  return d;
end $$;

-- Le bureau demande une précision à une partie : AWAITING_RESPONSE ; un message d’une partie le remet en médiation.
create or replace function request_dispute_response(p_dispute uuid, p_message text) returns disputes
language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  perform _require_user();
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status = 'RESOLVED' then perform _err('NO_OPEN_DISPUTE', 'Litige introuvable ou déjà clos'); end if;
  if is_party(d.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas intervenir'); end if;
  update disputes set status = 'AWAITING_RESPONSE' where id = p_dispute returning * into d;
  insert into dispute_messages(dispute_id, tx_id, author_id, kind, body) values (d.id, d.tx_id, auth.uid(), 'STAFF_REQUEST', _check_message(p_message));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (d.tx_id, d.tranche_id, auth.uid(), 'DISPUTE_RESPONSE_REQUESTED', jsonb_build_object('dispute_id', d.id));
  return d;
end $$;

create or replace function add_dispute_message(p_dispute uuid, p_message text) returns disputes
language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  perform _require_user();
  select * into d from disputes where id = p_dispute for update;
  if not found or not is_party(d.tx_id) then perform _err('NO_OPEN_DISPUTE', 'Litige introuvable'); end if;
  if d.status = 'RESOLVED' then perform _err('NO_OPEN_DISPUTE', 'Litige déjà clos'); end if;
  insert into dispute_messages(dispute_id, tx_id, author_id, kind, body) values (d.id, d.tx_id, auth.uid(), 'STATEMENT', _check_message(p_message));
  if d.status = 'AWAITING_RESPONSE' then update disputes set status = 'IN_MEDIATION' where id = p_dispute returning * into d; end if;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (d.tx_id, d.tranche_id, auth.uid(), 'DISPUTE_MESSAGE', jsonb_build_object('dispute_id', d.id));
  return d;
end $$;

-- Issue d’un litige (interne). Remboursement : remboursement lié au paiement d’origine, avec contrepassation (exécution
-- par le partenaire). FUNDS_RELEASED / FUNDS_RETURNED : CONDITIONAL, fonds encore bloqués. Avant paiement : NO_ACTION
-- lève la suspension. Le statut d’une demande payée ne change jamais ici.
create or replace function _resolve_dispute_v2(p_dispute uuid, p_outcome text, p_note text, p_actor uuid, p_amount_minor bigint default null)
returns disputes language plpgsql security definer set search_path = public as $$
declare d disputes; tr tranches; v_paid bigint; v_refund refunds; v_amount bigint;
begin
  select * into d from disputes where id = p_dispute for update;
  select * into tr from tranches where id = d.tranche_id for update;
  if p_outcome not in ('NO_ACTION','REFUND_FULL','REFUND_PARTIAL','FUNDS_RELEASED','FUNDS_RETURNED') then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  if p_outcome <> 'NO_ACTION' and tr.status not in ('PAID','REFUNDED') then perform _err('INVALID_OUTCOME', 'Issue impossible avant paiement'); end if;
  if p_outcome in ('FUNDS_RELEASED','FUNDS_RETURNED') and tr.funds_state <> 'HELD' then perform _err('INVALID_OUTCOME', 'Fonds non bloqués (règlement direct ou déjà traités)'); end if;
  select coalesce(sum(amount_minor), 0) into v_paid from payment_attempts where tranche_id = tr.id and status = 'SUCCEEDED';
  if p_outcome in ('REFUND_FULL','FUNDS_RETURNED') then
    v_amount := v_paid - coalesce((select sum(amount_minor) from refunds where tranche_id = tr.id and status in ('PENDING','SUCCEEDED')), 0);
    if v_amount <= 0 then perform _err('REFUND_EXCEEDS_PAID', 'Rien à rembourser'); end if;
  elsif p_outcome = 'REFUND_PARTIAL' then
    if p_amount_minor is null or p_amount_minor <= 0 then perform _err('AMOUNT_INVALID', 'Montant du remboursement partiel obligatoire'); end if;
    v_amount := p_amount_minor;
  end if;
  if v_amount is not null then
    v_refund := _create_refund(tr.id, v_amount, 'litige-' || d.id::text || '-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(trim(p_note), ''), 'Litige'), p_actor);
  end if;
  if p_outcome = 'FUNDS_RELEASED' then
    perform _set_funds_state(tr.id, 'RELEASED', p_actor, 'FUNDS_RELEASED', jsonb_build_object('trigger', 'DISPUTE_RESOLUTION'));
  elsif p_outcome = 'FUNDS_RETURNED' then
    perform _set_funds_state(tr.id, 'RETURNED', p_actor, 'FUNDS_RETURNED', jsonb_build_object('refund_id', v_refund.id));
  end if;
  update disputes set status = 'RESOLVED', outcome = p_outcome, refund_amount_minor = v_amount, refund_id = v_refund.id,
         resolution_note = trim(p_note), resolved_by = p_actor, resolved_at = now() where id = p_dispute returning * into d;
  insert into dispute_messages(dispute_id, tx_id, author_id, kind, body) values (d.id, d.tx_id, p_actor, 'DECISION', trim(p_note));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (d.tx_id, d.tranche_id, p_actor, 'DISPUTE_RESOLVED', jsonb_build_object('dispute_id', d.id, 'outcome', p_outcome, 'refund_id', v_refund.id,
          'amount_minor', v_amount));
  -- Litige avant paiement : la suspension est levée (la demande reste payable, rejetable ou annulable).
  if d.before_payment then
    update tranches set on_hold = false where id = tr.id;
    if (select status from transactions where id = d.tx_id) = 'SUSPENDED'
       and not exists (select 1 from tranches where tx_id = d.tx_id and on_hold) then
      perform _set_tx_status(d.tx_id, 'ACTIVE', p_actor, 'OPERATION_RESUMED', jsonb_build_object('dispute_id', d.id));
    end if;
  end if;
  return d;
end $$;

drop function if exists resolve_dispute(uuid, text, text);
create or replace function resolve_dispute(p_dispute uuid, p_outcome text, p_note text, p_amount_minor bigint default null)
returns disputes language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  perform _require_user();
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status = 'RESOLVED' then perform _err('NO_OPEN_DISPUTE', 'Litige introuvable ou déjà clos'); end if;
  if is_party(d.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas trancher'); end if;
  if coalesce(length(trim(p_note)), 0) < 3 then perform _err('REASON_REQUIRED', 'Note de décision obligatoire'); end if;
  return _resolve_dispute_v2(d.id, p_outcome, p_note, auth.uid(), p_amount_minor);
end $$;

-- Levée d’une suspension par le personnel (fraude levée) : SUSPENDED → ACTIVE, s’il ne reste aucune demande suspendue.
create or replace function lift_suspension(p_tx uuid, p_reason text) returns transactions
language plpgsql security definer set search_path = public as $$
begin
  perform _require_validator();
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas agir sur un dossier dont il est partie'); end if;
  if (select status from transactions where id = p_tx) is distinct from 'SUSPENDED' then perform _err('TRANSITION_UNKNOWN', 'L’opération n’est pas suspendue'); end if;
  if exists (select 1 from tranches where tx_id = p_tx and on_hold) then perform _err('DISPUTE_OPEN', 'Un litige avant paiement est en cours'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif obligatoire'); end if;
  return _set_tx_status(p_tx, 'ACTIVE', auth.uid(), 'OPERATION_RESUMED', jsonb_build_object('reason', trim(p_reason)));
end $$;

-- Suspension pour fraude par le personnel : ACTIVE → SUSPENDED.
create or replace function suspend_operation(p_tx uuid, p_reason text) returns transactions
language plpgsql security definer set search_path = public as $$
begin
  perform _require_validator();
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas agir sur un dossier dont il est partie'); end if;
  if (select status from transactions where id = p_tx) is distinct from 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif obligatoire'); end if;
  return _set_tx_status(p_tx, 'SUSPENDED', auth.uid(), 'OPERATION_SUSPENDED', jsonb_build_object('reason', trim(p_reason)));
end $$;

create or replace function get_dispute(p_tranche uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tr tranches; d disputes;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into d from disputes where tranche_id = p_tranche order by opened_at desc limit 1;
  if not found then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', d.id, 'txId', d.tx_id, 'trancheId', d.tranche_id, 'reason', coalesce(d.reason_code, 'OTHER'), 'description', d.reason,
    'openedBy', case when exists (select 1 from transaction_parties p where p.tx_id = d.tx_id and p.user_id = d.opened_by and p.role = 'PROVIDER')
                     then 'PROVIDER' else 'PAYER' end,
    'openedAt', to_char(d.opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'status', d.status, 'outcome', d.outcome,
    'beforePayment', d.before_payment, 'refundAmountMinor', d.refund_amount_minor,
    'resolvedAt', case when d.resolved_at is not null then to_char(d.resolved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'resolutionNote', d.resolution_note));
end $$;

do $demo$
begin
  if not _mock_mode() then return; end if;
  -- Décision simulée d’un administrateur non partie (démonstration). Issues du modèle cible.
  execute $f$
  create or replace function demo_resolve_dispute(p_tranche uuid, p_outcome text, p_note text)
  returns disputes language plpgsql security definer set search_path = public as $$
  declare tr tranches; d disputes; v_admin uuid;
  begin
    perform _require_user();
    if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
    select * into tr from tranches where id = p_tranche;
    if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
    select * into d from disputes where tranche_id = p_tranche and status <> 'RESOLVED';
    if not found then perform _err('NO_OPEN_DISPUTE', 'Aucun litige en cours sur cette tranche'); end if;
    if coalesce(length(trim(p_note)), 0) < 3 then perform _err('REASON_REQUIRED', 'Note de décision obligatoire'); end if;
    select id into v_admin from profiles p where platform_role = 'ADMIN'
      and not exists (select 1 from transaction_parties x where x.tx_id = tr.tx_id and x.user_id = p.id) order by created_at limit 1;
    return _resolve_dispute_v2(d.id, p_outcome, p_note, v_admin);
  end $$;
  $f$;
  -- Revue simulée par le bureau (PENDING_REVIEW, IN_REVIEW) : approbation → ACTIVE, rejet → CANCELLED.
  execute $f$
  create or replace function demo_review(p_tx uuid, p_approved boolean, p_reason text default null)
  returns transactions language plpgsql security definer set search_path = public as $$
  declare t transactions; v_val uuid; need int; v uuid;
  begin
    perform _require_user();
    if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
    select * into t from transactions where id = p_tx for update;
    if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
    if t.status not in ('PENDING_REVIEW','IN_REVIEW') then perform _err('NOT_IN_REVIEW', 'Le dossier n’est pas en validation'); end if;
    select id into v_val from profiles p where platform_role in ('VALIDATOR','ADMIN')
      and not exists (select 1 from transaction_parties x where x.tx_id = p_tx and x.user_id = p.id) order by platform_role, created_at limit 1;
    if v_val is null then perform _err('DEMO_NO_VALIDATOR', 'Aucun validateur de démonstration (exécuter seed.sql)'); end if;
    if t.status = 'PENDING_REVIEW' then perform _set_tx_status(p_tx, 'IN_REVIEW', v_val, 'DEMO_REVIEW', '{"demo":true}'); end if;
    if not p_approved then
      if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
      insert into validations(tx_id, validator_id, approved, reason) values (p_tx, v_val, false, trim(p_reason));
      update transactions set reject_reason = trim(p_reason) where id = p_tx;
      perform _set_tx_status(p_tx, 'CANCELLED', v_val, 'DEMO_REVIEW', jsonb_build_object('reason', trim(p_reason), 'demo', true));
      perform set_config('app.via_transition','on', true);
      update tranches set status = 'CANCELLED' where tx_id = p_tx and status = 'DRAFT';
      return (select x from transactions x where x.id = p_tx);
    end if;
    need := required_validations(p_tx);
    for v in select id from profiles p where platform_role in ('VALIDATOR','ADMIN')
               and not exists (select 1 from transaction_parties x where x.tx_id = p_tx and x.user_id = p.id) order by platform_role, created_at limit need loop
      insert into validations(tx_id, validator_id, approved, amount_checked) values (p_tx, v, true, true);
    end loop;
    perform _activate_operation(p_tx, v_val, 'DEMO_REVIEW', jsonb_build_object('need', need, 'demo', true));
    return (select x from transactions x where x.id = p_tx);
  end $$;
  $f$;
  execute 'revoke all on function demo_resolve_dispute(uuid, text, text), demo_review(uuid, boolean, text) from public, anon';
  execute 'grant execute on function demo_resolve_dispute(uuid, text, text), demo_review(uuid, boolean, text) to authenticated';
end $demo$;

-- ---------- 14. Reçu, alertes, files du bureau ----------
-- Reçu disponible dès PAID (règlement direct) ; en CONDITIONAL, à la libération des fonds. « releasedAt » = date d’exécution.
create or replace function get_receipt(p_tranche uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tr tranches; t transactions; v_last text; v_count int; v_payer text; v_at timestamptz;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into t from transactions where id = tr.tx_id;
  if tr.status not in ('PAID','REFUNDED') or (t.settlement_mode = 'CONDITIONAL' and tr.funds_state <> 'RELEASED') then
    perform _err('NOT_RELEASED', 'Le reçu n’existe que pour une demande payée');
  end if;
  v_at := case when t.settlement_mode = 'CONDITIONAL' then tr.released_at else tr.paid_at end;
  select hash, n into v_last, v_count from (select hash, count(*) over () as n, id from audit_log where tx_id = t.id order by id desc limit 1) x;
  select pr.full_name into v_payer from transaction_parties p join profiles pr on pr.id = p.user_id where p.tx_id = t.id and p.role = 'PAYER' limit 1;
  return jsonb_build_object(
    'trancheId', tr.id, 'txId', t.id, 'label', tr.label, 'amountMinor', tr.amount_minor, 'currency', t.currency,
    'releasedAt', to_char(coalesce(v_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payerName', coalesce(v_payer, ''), 'providerName', coalesce(t.provider_name, ''), 'purpose', coalesce(t.purpose, ''),
    'reference', coalesce((select reference from tranche_tokens where tranche_id = tr.id order by revoked_at desc nulls first, created_at desc limit 1), ''),
    'lastHash', coalesce(v_last, ''), 'chainValid', verify_audit(t.id), 'entryCount', coalesce(v_count, 0),
    'refundedMinor', tr.refunded_minor);
end $$;

-- Alertes (sans texte ni montant) : opération validée ou refusée par le bureau ; demande soumise (au payeur : PAYMENT_READY s’il
-- est l’initiateur, PAYMENT_REQUEST_RECEIVED sinon) ; décisions du payeur ; paiement exécuté (REQUEST_PAID) ; libération en
-- CONDITIONAL ; litiges.
create or replace function _notify_from_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_payload jsonb; v_to text; v_from text; v_outcome text; v_release timestamptz; v_who text := 'ALL'; v_initiator uuid;
begin
  v_to := new.payload->>'tranche_to'; v_from := new.payload->>'tranche_from';
  select coalesce(initiator_id, created_by) into v_initiator from transactions where id = new.tx_id;
  if new.tranche_id is null then
    if new.to_status = 'ACTIVE' and new.from_status in ('PENDING_REVIEW','IN_REVIEW') then v_type := 'TX_VALIDATED';
    elsif new.to_status = 'CANCELLED' and new.from_status in ('PENDING_REVIEW','IN_REVIEW') then v_type := 'TX_REJECTED';
    elsif new.event = 'PLAN_ACCEPTED' then v_type := 'PLAN_ACCEPTED'; v_who := 'OTHERS';   -- X3 (0016)
    end if;
  elsif new.event = 'DISPUTE_OPENED' then v_type := 'DISPUTE_OPENED';
  elsif new.event = 'DISPUTE_RESOLVED' then
    v_type := 'DISPUTE_RESOLVED';
    v_outcome := case new.payload->>'outcome' when 'NO_ACTION' then 'NO_ACTION' when 'FUNDS_RELEASED' then 'RELEASED' else 'REFUNDED' end;
  elsif new.event in ('INFO_REQUESTED','INFO_ANSWERED','REQUEST_REJECTED') then v_type := new.event; v_who := 'OTHERS';
  elsif v_to = 'SUBMITTED' and v_from = 'DRAFT' then
    v_who := 'PAYER';
    v_type := case when exists (select 1 from transaction_parties p where p.tx_id = new.tx_id and p.role = 'PAYER' and p.user_id = v_initiator)
                   then 'PAYMENT_READY' else 'PAYMENT_REQUEST_RECEIVED' end;
  elsif v_to = 'PAID' then v_type := 'REQUEST_PAID';
  elsif new.event in ('SERVICE_CONFIRMED','PROVIDER_SCAN') then
    v_type := 'TRANCHE_CONFIRMED';
    select contest_ends_at into v_release from tranches where id = new.tranche_id;
  elsif new.event = 'FUNDS_RELEASED' then v_type := 'TRANCHE_RELEASED';
  end if;
  if v_type is null then return new; end if;
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'type', v_type, 'txId', new.tx_id, 'trancheId', case when v_type not in ('TX_VALIDATED','TX_REJECTED','PLAN_ACCEPTED') then new.tranche_id end,
    'reason', case when v_type = 'TX_REJECTED' then coalesce(new.payload->>'reason', '') end,
    'releaseAt', case when v_release is not null then to_char(v_release at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'outcome', v_outcome));
  insert into notifications(user_id, tx_id, event, payload)
  select distinct p.user_id, new.tx_id, v_type, v_payload from transaction_parties p
  where p.tx_id = new.tx_id and p.user_id is not null
    and (v_who = 'ALL' or (v_who = 'OTHERS' and p.user_id is distinct from new.actor_id) or (v_who = 'PAYER' and p.role = 'PAYER'));
  return new;
end $$;

-- Files du bureau (lot 5) : les dossiers en revue (PENDING_REVIEW, IN_REVIEW), les preuves en attente (CONDITIONAL).
-- Vues recréées depuis leur définition en base, avec les nouveaux statuts.
drop view if exists bo_dossiers;
create view bo_dossiers with (security_invoker = true) as
select t.id, _tx_ref(t.id) as reference, t.vertical, t.purpose, t.amount_minor, t.currency::text as currency,
       t.status::text as status, t.created_at, t.updated_at, r.since as submitted_at,
       _party_name(t.id, 'REQUESTER') as requester_name, _party_name(t.id, 'PAYER') as payer_name,
       coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER')) as provider_name, t.beneficiary_name,
       required_validations(t.id) as validations_required,
       (select count(distinct v.validator_id)::int from validations v
         where v.tx_id = t.id and v.tranche_id is null and v.approved and v.decided_at >= r.since) as validations_received,
       exists (select 1 from validations v where v.tx_id = t.id and v.tranche_id is null and v.validator_id = auth.uid() and v.decided_at >= r.since) as decided_by_me,
       is_party(t.id) as is_party
from transactions t
cross join lateral (select _round_start(t.id) as since) r
where t.status in ('PENDING_REVIEW','IN_REVIEW') and is_validator();

drop view if exists bo_evidence_queue;
create view bo_evidence_queue with (security_invoker = true) as
select tr.id as tranche_id, tr.tx_id, _tx_ref(t.id) as reference, tr.seq, tr.label, tr.amount_minor, t.currency::text as currency,
       t.vertical, t.purpose, coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER')) as provider_name,
       r.since as submitted_at, required_validations(tr.tx_id, tr.id) as validations_required,
       (select count(distinct v.validator_id)::int from validations v where v.tranche_id = tr.id and v.approved and v.decided_at >= r.since) as validations_received,
       exists (select 1 from validations v where v.tranche_id = tr.id and v.validator_id = auth.uid() and v.decided_at >= r.since) as decided_by_me,
       is_party(tr.tx_id) as is_party
from tranches tr
join transactions t on t.id = tr.tx_id
cross join lateral (select _evidence_round_start(tr.id) as since) r
where tr.status = 'PAID' and tr.funds_state = 'HELD' and tr.evidence_submitted_at is not null and is_validator();

drop view if exists bo_disputes;
create view bo_disputes with (security_invoker = true) as
select d.id, d.tx_id, d.tranche_id, _tx_ref(t.id) as reference, tr.seq as tranche_seq, tr.label as tranche_label,
       tr.amount_minor, tr.status::text as tranche_status, t.currency::text as currency, t.vertical, t.purpose,
       coalesce(d.reason_code, 'OTHER') as reason_code, d.reason as description,
       case when exists (select 1 from transaction_parties p where p.tx_id = d.tx_id and p.user_id = d.opened_by and p.role = 'PROVIDER')
            then 'PROVIDER' else 'PAYER' end as opened_by_role,
       d.opened_at, d.status, d.response, d.responded_at, _dispute_notified_at(d.id) as notified_at,
       d.resolution_note, d.resolved_at, _staff_name(d.resolved_by) as resolved_by_name,
       _party_name(t.id, 'PAYER') as payer_name, coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER')) as provider_name,
       is_party(d.tx_id) as is_party,
       d.outcome, d.before_payment, tr.on_hold, t.settlement_mode::text as settlement_mode, tr.funds_state, tr.refunded_minor
from disputes d
join tranches tr on tr.id = d.tranche_id
join transactions t on t.id = d.tx_id
where is_admin();
revoke all on bo_dossiers, bo_evidence_queue, bo_disputes from public, anon;
grant select on bo_dossiers, bo_evidence_queue, bo_disputes to authenticated;

-- Preuves d’un jalon (CONDITIONAL) : déposées par le prestataire quand les fonds sont bloqués.
drop policy if exists docs_insert_evidence on documents;
create policy docs_insert_evidence on documents for insert with check (
  uploaded_by = auth.uid() and tranche_id is not null
  and exists (select 1 from tranches tr where tr.id = tranche_id and tr.status = 'PAID' and tr.funds_state = 'HELD' and has_role(tr.tx_id,'PROVIDER')));

-- Pièces : modifiables tant que l’opération est un brouillon (plus de dossier rejeté en correction) ; pièce de réponse pendant
-- INFO_REQUESTED.
create or replace function _documents_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status tx_status; v_tr tranche_status;
begin
  if tg_op = 'UPDATE' and (new.content_hash is distinct from old.content_hash or new.hash_algo is distinct from old.hash_algo) then
    perform _err('HASH_IMMUTABLE', 'L’empreinte d’une pièce ne se modifie pas');
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then return old; end if;
  select status into v_status from transactions where id = old.tx_id;
  if not found then return case when tg_op = 'DELETE' then old else new end; end if;
  if v_status = 'DRAFT' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.tranche_id is not null then
    select status into v_tr from tranches where id = old.tranche_id;
    if v_tr = 'INFO_REQUESTED' then return case when tg_op = 'DELETE' then old else new end; end if;
  end if;
  perform _err('DOCUMENT_LOCKED', 'Pièce d’une demande soumise : ni modification ni suppression');
  return null;
end $$;

-- ---------- 15. Brouillon : mode de règlement du module, initiateur ----------
create or replace function _draft_settlement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'DRAFT' and (tg_op = 'INSERT' or new.vertical is distinct from old.vertical) then
    new.settlement_mode := coalesce((select settlement_mode from request_modules where code = new.vertical), 'DIRECT');
  end if;
  return new;
end $$;
drop trigger if exists transactions_draft_settlement on transactions;
create trigger transactions_draft_settlement before insert or update of vertical on transactions for each row execute function _draft_settlement();

-- ---------- Droits (X2) ----------
revoke all on function _transactions_defaults(), _tranches_defaults(), _is_initiator(uuid), _request_final(tranches),
  _set_tx_status(uuid, tx_status, uuid, text, jsonb), _close_operation_if_done(uuid, uuid), _set_tranche_status(uuid, tranche_status, uuid, text, jsonb),
  _set_funds_state(uuid, text, uuid, text, jsonb), _submit_request(uuid, uuid), _activate_operation(uuid, uuid, text, jsonb), _platform_review(uuid),
  _conditional_tranche(uuid), _confirm_service(tranches, uuid, text, jsonb), _create_refund(uuid, bigint, text, text, uuid),
  _resolve_dispute_v2(uuid, text, text, uuid, bigint), _dispute_messages_immutable(), _draft_settlement(), _documents_immutable(),
  _check_token_manager(uuid), _request_tranche(uuid), _notify_from_audit(), _process_payment_event(bigint),
  release_due_tranches(), activate_due_tranches(), expire_due_requests()
  from public, anon, authenticated;
-- Évaluée dans les politiques et vues avec les droits de l’utilisateur.
grant execute on function _is_initiator(uuid), _round_start(uuid), _evidence_round_start(uuid) to authenticated;
revoke all on function submit_operation(uuid), transition_tx(uuid, tx_status, text), claim_dossier(uuid), decide_tx(uuid, boolean, boolean, text),
  transition_tranche(uuid, tranche_status, text), request_info(uuid, text), answer_info(uuid, text), reject_request(uuid, text), reissue_token(uuid, text),
  confirm_service(uuid), submit_evidence(uuid), approve_release(uuid), decide_tranche(uuid, boolean, text), confirm_by_reference(text, timestamptz),
  start_payment(uuid, text, text), request_refund(uuid, bigint, text, text), simulate_tranche_system(uuid, tranche_status),
  open_dispute(uuid, text, text), respond_dispute(uuid, text), request_dispute_response(uuid, text), add_dispute_message(uuid, text),
  resolve_dispute(uuid, text, text, bigint), lift_suspension(uuid, text), suspend_operation(uuid, text), get_dispute(uuid), get_receipt(uuid)
  from public, anon;
grant execute on function submit_operation(uuid), transition_tx(uuid, tx_status, text), claim_dossier(uuid), decide_tx(uuid, boolean, boolean, text),
  transition_tranche(uuid, tranche_status, text), request_info(uuid, text), answer_info(uuid, text), reject_request(uuid, text), reissue_token(uuid, text),
  confirm_service(uuid), submit_evidence(uuid), approve_release(uuid), decide_tranche(uuid, boolean, text), confirm_by_reference(text, timestamptz),
  start_payment(uuid, text, text), request_refund(uuid, bigint, text, text), simulate_tranche_system(uuid, tranche_status),
  open_dispute(uuid, text, text), respond_dispute(uuid, text), request_dispute_response(uuid, text), add_dispute_message(uuid, text),
  resolve_dispute(uuid, text, text, bigint), lift_suspension(uuid, text), suspend_operation(uuid, text), get_dispute(uuid), get_receipt(uuid)
  to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dispute_messages') then
    alter publication supabase_realtime add table dispute_messages;
  end if;
end $$;
