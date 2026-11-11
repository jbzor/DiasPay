-- =====================================================================
-- DiasPay : migration 0005 (lot 4) — ce que l’application attend du serveur.
-- À appliquer SUR 0001 à 0004. Ne modifie aucune migration précédente :
-- les fonctions sont redéfinies (create or replace), les tables étendues.
-- Test : supabase/tests/01_lot4.sql.
--
--  1. Codes d’erreur stables (hint) sur toutes les fonctions publiques
--  2. Brouillons côté serveur : save_draft, get_draft, get_drafts, delete_draft
--  3. Invitations rattachées à l’inscription
--  4. Prestataires et recherche sans accents
--  5. Pièces : limites en base, suppression et archivage, bucket
--  6. Notifications créées par le serveur à partir du journal d’audit
--  7. Reçu, litige, référence d’eQR
--  8. Litiges tranchés par un administrateur non partie (inchangé, codes ajoutés)
--  9. Fonctions de démonstration (mock_mode uniquement)
-- 10. Tâches planifiées (pg_cron)
-- =====================================================================

-- ---------- 0. Outils ----------

-- Erreur métier : le client lit le code dans « hint », jamais le texte du message.
create or replace function _err(p_code text, p_message text, p_detail text default null) returns void
language plpgsql immutable as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code, detail = coalesce(p_detail, '');
end $$;

-- Numéro réduit à ses chiffres : auth.users enregistre « 33639980001 », l’application envoie « +33639980001 ».
create or replace function _norm_phone(p text) returns text
language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

create or replace function _valid_phone(p text) returns boolean
language sql immutable as $$ select coalesce(_norm_phone(p) ~ '^[1-9][0-9]{7,14}$', false) $$;

create or replace function _require_user() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then perform _err('NOT_AUTHENTICATED', 'Connexion requise'); end if;
  return auth.uid();
end $$;

create or replace function _mock_mode() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_config where key = 'mock_mode'), 'false') = 'true'
$$;

-- Verticales ouvertes à la création (vague 1) : miroir de WAVE1_VERTICALS (@diaspay/domain).
insert into app_config(key, value) values ('open_verticals', 'EDUCATION,HEALTH,RENT') on conflict (key) do nothing;

-- Pièces requises par verticale : miroir de REQUIRED_DOCUMENTS (@diaspay/domain, décision D2).
create table if not exists required_documents (
  vertical text not null,
  kind     text not null,
  required boolean not null,
  primary key (vertical, kind)
);
insert into required_documents(vertical, kind, required) values
 ('HEALTH','QUOTE',true), ('HEALTH','BENEFICIARY_ID',true), ('HEALTH','MEDICAL_CERTIFICATE',false),
 ('EDUCATION','ENROLMENT_CERTIFICATE',true), ('EDUCATION','SCHOOL_SCHEDULE',false),
 ('RENT','LEASE',true), ('RENT','LAST_RECEIPT',false),
 ('AGRO','SUPPORTING_DOCUMENT',true), ('REAL_ESTATE','SUPPORTING_DOCUMENT',true), ('LAND','SUPPORTING_DOCUMENT',true)
on conflict do nothing;
alter table required_documents enable row level security;
drop policy if exists required_docs_read on required_documents;
create policy required_docs_read on required_documents for select using (true);

-- ---------- 4. Prestataires ----------
create extension if not exists unaccent with schema extensions;

-- unaccent n’est pas « immutable » ; enveloppe à dictionnaire qualifié (indépendante du search_path).
create or replace function _fold(p text) returns text
language sql immutable as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))) $$;

create table if not exists providers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) >= 2),
  city       text not null,
  verticals  text[] not null default '{}',
  verified   boolean not null default false,
  phone      text,                                   -- numéro du compte prestataire (rattachement)
  user_id    uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table providers enable row level security;
drop policy if exists providers_read on providers;
create policy providers_read on providers for select to authenticated using (true);
drop policy if exists providers_admin_write on providers;
create policy providers_admin_write on providers for all to authenticated using (is_admin()) with check (is_admin());
revoke all on providers from anon;

create or replace function search_providers(p_query text, p_vertical text)
returns table (id uuid, name text, city text, verticals text[], verified boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user();
  return query
    select p.id, p.name, p.city, p.verticals, p.verified from providers p
    where p_vertical = any(p.verticals)
      and (coalesce(trim(p_query), '') = ''
           or _fold(p.name) like '%' || _fold(trim(p_query)) || '%'
           or _fold(p.city) like '%' || _fold(trim(p_query)) || '%')
    order by p.verified desc, p.name;
end $$;

-- ---------- Transactions : brouillon partiel, colonnes de l’assistant ----------
-- Un brouillon peut être incomplet (étape 1 : seul le type est connu). Les colonnes
-- obligatoires d’un dossier soumis ne le sont plus en DRAFT ; une contrainte l’impose ailleurs.
alter table transactions alter column purpose drop not null;
alter table transactions alter column amount_minor drop not null;
alter table transactions alter column currency drop not null;
alter table transactions drop constraint if exists tx_complete_unless_draft;
alter table transactions add constraint tx_complete_unless_draft
  check (status = 'DRAFT' or (purpose is not null and amount_minor is not null and currency is not null));
alter table transactions add column if not exists beneficiary_name text;
alter table transactions add column if not exists provider_id uuid references providers(id) on delete set null;
alter table transactions add column if not exists provider_name text;
alter table transactions add column if not exists plan_type text
  check (plan_type in ('SINGLE','PARTIAL','INSTALLMENTS','RECURRING'));
-- État brut de l’assistant (étape, saisies en cours) : restitué tel quel au créateur.
alter table transactions add column if not exists draft_data jsonb not null default '{}';

alter table documents add column if not exists file_name text;
alter table documents add column if not exists deleted_at timestamptz;   -- archivage (dossier audité)

alter table notifications add column if not exists payload jsonb not null default '{}';

-- ---------- 1. Machine d’états : codes stables ----------
create or replace function transition_tx(p_tx uuid, p_to tx_status, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ok boolean := false; r tx_role; old_status tx_status; total bigint; missing text;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx) or is_validator()) then
    perform _err('TX_NOT_FOUND', 'Transaction introuvable');
  end if;
  old_status := t.status;
  if not exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to) then
    perform _err('TRANSITION_UNKNOWN', format('Transition %s -> %s inconnue', t.status, p_to));
  end if;

  if exists (select 1 from allowed_transitions
             where from_status = t.status and to_status = p_to and validator_only) then
    if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
    if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas agir sur un dossier dont il est partie'); end if;
    ok := true;
  else
    foreach r in array array['PAYER','REQUESTER','PROVIDER']::tx_role[] loop
      if has_role(p_tx, r) and exists (select 1 from allowed_transitions
          where from_status = t.status and to_status = p_to and role = r) then
        ok := true;
      end if;
    end loop;
  end if;
  if not ok then perform _err('TRANSITION_FORBIDDEN', format('Transition %s -> %s non autorisée', t.status, p_to)); end if;

  if old_status = 'DRAFT' and p_to = 'SUBMITTED' then
    if not (t.vertical::text = any(string_to_array((select value from app_config where key = 'open_verticals'), ','))) then
      perform _err('VERTICAL_UNAVAILABLE', 'Ce type de besoin n’est pas encore ouvert');
    end if;
    if t.purpose is null or t.amount_minor is null or t.currency is null then
      perform _err('VALIDATION', 'Dossier incomplet');
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
     where rd.vertical = t.vertical::text and rd.required
       and not exists (select 1 from documents d where d.tx_id = p_tx and d.kind = rd.kind and d.tranche_id is null and d.deleted_at is null)
     order by rd.kind limit 1;
    if missing is not null then perform _err('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', missing); end if;
  end if;

  perform set_config('app.via_transition','on', true);
  update transactions set status = p_to,
         reject_reason = case when p_to = 'REJECTED' then p_reason when p_to = 'SUBMITTED' then null else reject_reason end
   where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'STATUS_CHANGE', old_status, p_to, jsonb_build_object('reason', p_reason));
  return t;
end $$;

create or replace function decide_tx(p_tx uuid, p_approved boolean, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; need int; got int; since timestamptz;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into t from transactions where id = p_tx for update;
  if not found then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas valider un dossier dont il est partie'); end if;
  if t.status <> 'IN_REVIEW' then perform _err('NOT_IN_REVIEW', 'Le dossier n’est pas en validation'); end if;
  if not p_approved and coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;

  select coalesce(max(created_at), '-infinity') into since from audit_log where tx_id = p_tx and to_status = 'SUBMITTED';
  if exists (select 1 from validations where tx_id = p_tx and tranche_id is null
             and validator_id = auth.uid() and decided_at >= since) then
    perform _err('ALREADY_DECIDED', 'Vous avez déjà donné votre décision sur ce dossier');
  end if;
  insert into validations(tx_id, validator_id, approved, reason) values (p_tx, auth.uid(), p_approved, p_reason);

  if not p_approved then
    select * into t from transition_tx(p_tx, 'REJECTED', p_reason);
    return t;
  end if;
  need := required_validations(p_tx);
  select count(distinct validator_id) into got from validations
    where tx_id = p_tx and tranche_id is null and approved and decided_at >= since;
  if got >= need then
    select * into t from transition_tx(p_tx, 'VALIDATED', p_reason);
  else
    insert into audit_log(tx_id, actor_id, event, payload)
    values (p_tx, auth.uid(), 'VALIDATION_PARTIAL', jsonb_build_object('got', got, 'need', need));
  end if;
  return t;
end $$;

create or replace function simulate_system_transition(p_tx uuid, p_to tx_status)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ttl int; old_status tx_status;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  select * into t from transactions where id = p_tx for update;
  if not found or not (is_party(p_tx) or is_validator()) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if not exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to and role = 'SYSTEM') then
    perform _err('TRANSITION_UNKNOWN', format('Transition système %s -> %s invalide', t.status, p_to));
  end if;
  perform set_config('app.via_transition','on', true);
  if p_to = 'TOKEN_ISSUED' then
    select value::int into ttl from app_config where key = 'token_ttl_days';
    insert into trust_tokens(tx_id, signature, expires_at)
    values (p_tx, 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''), now() + make_interval(days => ttl))
    on conflict (tx_id) do nothing;
    update transactions set expires_at = now() + make_interval(days => ttl) where id = p_tx;
  end if;
  old_status := t.status;
  update transactions set status = p_to where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'SYSTEM_SIMULATED', old_status, p_to, '{}');
  return t;
end $$;

create or replace function create_tranches(p_tx uuid, p_items jsonb)
returns setof tranches language plpgsql security definer set search_path = public as $$
declare t transactions; rule release_rules; it jsonb; n int := 0;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if t.status not in ('DRAFT','REJECTED') then perform _err('NOT_EDITABLE', 'Plan de paiement non modifiable'); end if;
  if not (has_role(p_tx,'REQUESTER') or has_role(p_tx,'PAYER')) then perform _err('TRANSITION_FORBIDDEN', 'Réservé au payeur ou au demandeur'); end if;
  select * into rule from release_rules where vertical = t.vertical::text;
  if not found then perform _err('VALIDATION', format('Aucune règle de déblocage pour %s', t.vertical)); end if;
  delete from tranches where tx_id = p_tx;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce((it->>'amount_minor')::bigint, 0) <= 0 then perform _err('PLAN_BAD_AMOUNT', 'Chaque tranche doit avoir un montant positif'); end if;
    n := n + 1;
    insert into tranches(tx_id, seq, label, amount_minor, due_date, release_mode, contest_hours)
    values (p_tx, n, it->>'label', (it->>'amount_minor')::bigint, nullif(it->>'due_date','')::date, rule.release_mode, rule.contest_hours);
  end loop;
  return query select * from tranches where tx_id = p_tx order by seq;
end $$;

create or replace function generate_recurring_tranches(
  p_tx uuid, p_freq recurrence_freq, p_n int, p_start date, p_label text default 'Échéance')
returns setof tranches language plpgsql security definer set search_path = public as $$
declare t transactions; base bigint; items jsonb := '[]'::jsonb; i int; step interval; amt bigint;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if p_n is null or p_n < 2 or p_n > 60 then perform _err('PLAN_BAD_COUNT', 'Le nombre d’échéances doit être entre 2 et 60'); end if;
  if t.amount_minor is null or t.amount_minor / p_n <= 0 then perform _err('PLAN_TOO_SMALL', 'Montant trop faible pour ce nombre d’échéances'); end if;
  step := case p_freq when 'WEEKLY' then interval '1 week' when 'MONTHLY' then interval '1 month' else interval '3 months' end;
  base := t.amount_minor / p_n;
  for i in 1..p_n loop
    amt := case when i = p_n then t.amount_minor - base * (p_n - 1) else base end;
    items := items || jsonb_build_object('label', p_label || ' ' || i, 'amount_minor', amt, 'due_date', (p_start + step * (i-1))::date);
  end loop;
  insert into recurrence_plans(tx_id, frequency, installments, start_date) values (p_tx, p_freq, p_n, p_start)
  on conflict (tx_id) do update set frequency = excluded.frequency, installments = excluded.installments, start_date = excluded.start_date;
  return query select * from create_tranches(p_tx, items);
end $$;

create or replace function transition_tranche(p_tranche uuid, p_to tranche_status, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; ok boolean := false; r tx_role; trig text;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into t from transactions where id = tr.tx_id;
  if t.status <> 'IN_PROGRESS' then perform _err('TX_NOT_ACTIVE', 'La transaction n’est pas active'); end if;
  if not exists (select 1 from tranche_transitions where from_status = tr.status and to_status = p_to) then
    perform _err('TRANSITION_UNKNOWN', format('Transition de tranche %s -> %s inconnue', tr.status, p_to));
  end if;
  foreach r in array array['PAYER','PROVIDER']::tx_role[] loop
    if has_role(tr.tx_id, r) and exists (select 1 from tranche_transitions
        where from_status = tr.status and to_status = p_to and role = r and not validator_only) then
      ok := true;
    end if;
  end loop;
  if not ok then perform _err('TRANSITION_FORBIDDEN', format('Transition de tranche %s -> %s non autorisée', tr.status, p_to)); end if;
  if tr.status = 'PAID_LOCKED' and p_to = 'CONFIRMED' then
    if not ((tr.release_mode = 'PROVIDER_CONFIRM' and has_role(tr.tx_id,'PROVIDER'))
         or (tr.release_mode = 'PAYER_CONFIRM'    and has_role(tr.tx_id,'PAYER'))) then
      perform _err('WRONG_CONFIRMER', format('Ce rôle ne peut pas confirmer cette tranche (mode %s)', tr.release_mode));
    end if;
  end if;
  if tr.status = 'PAID_LOCKED' and p_to = 'EVIDENCE_SUBMITTED' then
    if tr.release_mode <> 'EVIDENCE_REVIEW' then perform _err('NO_EVIDENCE_NEEDED', 'Cette tranche ne requiert pas de preuve'); end if;
    if not exists (select 1 from documents where tranche_id = p_tranche and deleted_at is null) then
      perform _err('EVIDENCE_MISSING', 'Déposez au moins une pièce probante');
    end if;
  end if;
  if tr.status = 'CONFIRMED' and p_to = 'RELEASED' and not has_role(tr.tx_id,'PAYER') then
    perform _err('PAYER_ONLY', 'Seul le payeur peut approuver le déblocage anticipé');
  end if;
  trig := case when p_to = 'RELEASED' then 'PAYER_APPROVAL' else null end;
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'TRANCHE_CHANGE', jsonb_build_object('reason', p_reason, 'trigger', trig));
end $$;

create or replace function decide_tranche(p_tranche uuid, p_approved boolean, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; need int; got int; since timestamptz;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if is_party(tr.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas valider une preuve d’un dossier dont il est partie'); end if;
  if tr.status <> 'EVIDENCE_SUBMITTED' then perform _err('NO_EVIDENCE_PENDING', 'Aucune preuve en attente'); end if;
  if not p_approved and coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
  select coalesce(max(created_at), '-infinity') into since from audit_log
    where tranche_id = p_tranche and payload->>'tranche_to' = 'EVIDENCE_SUBMITTED';
  if exists (select 1 from validations where tranche_id = p_tranche and validator_id = auth.uid() and decided_at >= since) then
    perform _err('ALREADY_DECIDED', 'Vous avez déjà donné votre décision');
  end if;
  insert into validations(tx_id, tranche_id, validator_id, approved, reason) values (tr.tx_id, p_tranche, auth.uid(), p_approved, p_reason);
  if not p_approved then
    return _set_tranche_status(p_tranche, 'PAID_LOCKED', auth.uid(), 'EVIDENCE_REJECTED', jsonb_build_object('reason', p_reason));
  end if;
  need := required_validations(tr.tx_id, p_tranche);
  select count(distinct validator_id) into got from validations where tranche_id = p_tranche and approved and decided_at >= since;
  if got < need then
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
    values (tr.tx_id, p_tranche, auth.uid(), 'EVIDENCE_PARTIAL', jsonb_build_object('got', got, 'need', need));
    return tr;
  end if;
  perform _set_tranche_status(p_tranche, 'CONFIRMED', auth.uid(), 'EVIDENCE_APPROVED', '{}');
  return _set_tranche_status(p_tranche, 'RELEASED', auth.uid(), 'TRANCHE_RELEASED', jsonb_build_object('trigger','VALIDATOR_APPROVAL'));
end $$;

-- Ordre des contrôles identique au simulateur (MockApi.confirmByReference).
create or replace function confirm_by_reference(p_ref text, p_device_time timestamptz default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare k tranche_tokens; tr tranches; at_time timestamptz; v_ref text;
begin
  perform _require_user();
  v_ref := lower(regexp_replace(coalesce(p_ref, ''), '[^0-9a-fA-F]', '', 'g'));
  select * into k from tranche_tokens where reference = v_ref for update;
  if not found then perform _err('UNKNOWN_REFERENCE', 'Référence inconnue'); end if;
  select * into tr from tranches where id = k.tranche_id for update;
  if not is_party(tr.tx_id) then perform _err('NOT_A_PARTY', 'Vous n’êtes pas partie à cette transaction'); end if;
  if not has_role(tr.tx_id,'PROVIDER') then perform _err('PROVIDER_ONLY', 'Réservé au prestataire'); end if;
  if k.used_at is not null then perform _err('TOKEN_USED', 'Ce QR a déjà été utilisé'); end if;
  at_time := coalesce(p_device_time, now());
  if at_time > now() + interval '5 minutes' then perform _err('DEVICE_TIME_INVALID', 'Heure de l’appareil invalide'); end if;
  if at_time > k.expires_at then perform _err('TOKEN_EXPIRED', 'QR expiré'); end if;
  if tr.status <> 'PAID_LOCKED' then perform _err('NOT_PAID', format('Tranche non payée ou déjà traitée (%s)', tr.status)); end if;
  if tr.release_mode <> 'PROVIDER_CONFIRM' then perform _err('WRONG_MODE', 'Cette tranche ne se confirme pas par scan prestataire'); end if;
  update tranche_tokens set used_at = now() where tranche_id = k.tranche_id;
  return _set_tranche_status(tr.id, 'CONFIRMED', auth.uid(), 'PROVIDER_SCAN',
           jsonb_build_object('device_time', at_time, 'offline', p_device_time is not null));
end $$;

create or replace function open_dispute(p_tranche uuid, p_reason text, p_reason_code text default null)
returns disputes language plpgsql security definer set search_path = public as $$
declare tr tranches; d disputes; is_payer boolean; is_provider boolean;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  is_payer := has_role(tr.tx_id,'PAYER');
  is_provider := has_role(tr.tx_id,'PROVIDER');
  if not (is_payer or is_provider) then perform _err('NOT_A_PARTY', 'Seuls le payeur et le prestataire ouvrent un litige'); end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then perform _err('REASON_TOO_SHORT', 'Décrivez le problème (10 caractères minimum)'); end if;
  if p_reason_code is not null and p_reason_code not in ('NOT_DELIVERED','INCOMPLETE','WRONG_AMOUNT','OTHER') then
    perform _err('VALIDATION', 'Motif de litige inconnu');
  end if;
  if tr.status in ('PAID_LOCKED','EVIDENCE_SUBMITTED') then
    null;
  elsif tr.status = 'CONFIRMED' and is_payer and tr.contest_ends_at is not null and now() <= tr.contest_ends_at then
    null;
  else
    perform _err('DISPUTE_NOT_ALLOWED', format('Litige impossible dans l’état %s (ou délai de contestation écoulé)', tr.status));
  end if;
  insert into disputes(tx_id, tranche_id, opened_by, reason, reason_code)
  values (tr.tx_id, p_tranche, auth.uid(), trim(p_reason), p_reason_code) returning * into d;
  perform _set_tranche_status(p_tranche, 'DISPUTED', auth.uid(), 'DISPUTE_OPENED', jsonb_build_object('dispute_id', d.id));
  return d;
end $$;

-- RG-09 : un litige est tranché par un administrateur non partie au dossier.
create or replace function resolve_dispute(p_dispute uuid, p_outcome text, p_note text)
returns disputes language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  perform _require_user();
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status <> 'OPEN' then perform _err('NO_OPEN_DISPUTE', 'Litige introuvable ou déjà clos'); end if;
  if is_party(d.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas trancher'); end if;
  if p_outcome not in ('RELEASE_TO_PROVIDER','REFUND_PAYER') then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  if coalesce(length(trim(p_note)), 0) < 3 then perform _err('REASON_REQUIRED', 'Note de décision obligatoire'); end if;
  return _resolve_dispute_core(d.id, p_outcome, p_note, auth.uid());
end $$;

-- Cœur commun à resolve_dispute et demo_resolve_dispute (interne).
create or replace function _resolve_dispute_core(p_dispute uuid, p_outcome text, p_note text, p_actor uuid)
returns disputes language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  select * into d from disputes where id = p_dispute for update;
  if p_outcome = 'RELEASE_TO_PROVIDER' then
    perform _set_tranche_status(d.tranche_id, 'RELEASED', p_actor, 'DISPUTE_RESOLVED',
              jsonb_build_object('trigger','DISPUTE_RESOLUTION','outcome',p_outcome));
  else
    update payments set status = 'REFUNDED' where tranche_id = d.tranche_id and status = 'SUCCEEDED';
    perform _set_tranche_status(d.tranche_id, 'CANCELLED', p_actor, 'DISPUTE_RESOLVED', jsonb_build_object('outcome',p_outcome));
  end if;
  update disputes set
    status = case p_outcome when 'RELEASE_TO_PROVIDER' then 'RELEASED_TO_PROVIDER' else 'REFUNDED_TO_PAYER' end,
    resolution_note = trim(p_note), resolved_by = p_actor, resolved_at = now()
  where id = p_dispute returning * into d;
  return d;
end $$;

create or replace function simulate_tranche_system(p_tranche uuid, p_to tranche_status)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into t from transactions where id = tr.tx_id;
  if t.status <> 'IN_PROGRESS' then perform _err('TX_NOT_ACTIVE', 'La transaction n’est pas active'); end if;
  if p_to = 'PAID_LOCKED' and tr.status <> 'AWAITING_PAYMENT' then perform _err('NOT_PAYABLE', 'Cette tranche n’est pas à payer'); end if;
  if not exists (select 1 from tranche_transitions
      where from_status = tr.status and to_status = p_to and role = 'SYSTEM' and not validator_only) then
    perform _err('TRANSITION_UNKNOWN', format('Transition système %s -> %s invalide', tr.status, p_to));
  end if;
  if p_to = 'AWAITING_PAYMENT' then perform _issue_tranche_token(p_tranche); end if;
  if p_to = 'PAID_LOCKED' then
    insert into payments(tx_id, tranche_id, provider, status) values (tr.tx_id, p_tranche, 'MOCK', 'SUCCEEDED');
  end if;
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'SYSTEM_SIMULATED',
           jsonb_build_object('trigger', case when p_to = 'RELEASED' then 'AUTO_TIMEOUT' end));
end $$;

-- ---------- 2. Brouillons côté serveur ----------

-- Représentation d’un brouillon pour l’application (forme NeedDraft de @diaspay/domain).
create or replace function _draft_json(p_tx uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(
    coalesce(t.draft_data, '{}'::jsonb)
    || jsonb_build_object(
      'id', t.id,
      'vertical', t.vertical,
      'ownerId', t.created_by,
      'updatedAt', to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'correctionOf', case when has_audit(t.id) then t.id end,
      'rejectionReason', case when has_audit(t.id) then t.reject_reason end,
      'step', coalesce(t.draft_data->>'step', case when has_audit(t.id) then 'recap' else 'type' end),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'kind', d.kind, 'name', coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')),
          'mimeType', d.mime_type, 'sizeBytes', d.size_bytes, 'status', 'UPLOADED', 'storagePath', d.storage_path,
          'uploadedAt', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by d.created_at)
        from documents d where d.tx_id = t.id and d.tranche_id is null and d.deleted_at is null), '[]'::jsonb)))
  from transactions t where t.id = p_tx
$$;

-- Résout un numéro vers un utilisateur existant.
create or replace function _user_by_phone(p_phone text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where _norm_phone(phone) = _norm_phone(p_phone) limit 1
$$;

-- Crée ou met à jour, en une seule transaction, le brouillon, ses parties et ses tranches.
-- Réservée au créateur ; refuse un dossier qui n’est ni DRAFT ni REJECTED.
create or replace function save_draft(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_id uuid; t transactions; v_role tx_role; v_vertical text; v_amount bigint; v_purpose text;
  v_currency text; v_date date; v_plan text; v_prov jsonb; v_prov_row providers; v_prov_user uuid;
  v_prov_phone text; v_payer_phone text; v_payer_user uuid; rule release_rules; it jsonb; n int := 0;
begin
  v_uid := _require_user();
  begin v_id := (p_draft->>'id')::uuid; exception when others then perform _err('VALIDATION', 'Identifiant de brouillon invalide'); end;
  if v_id is null then perform _err('VALIDATION', 'Identifiant de brouillon manquant'); end if;
  v_vertical := p_draft->>'vertical';
  if v_vertical is null or not exists (select 1 from release_rules where vertical = v_vertical) then
    perform _err('VALIDATION', 'Type de besoin manquant ou inconnu');
  end if;

  select * into t from transactions where id = v_id for update;
  if found then
    if t.created_by <> v_uid then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
    if t.status not in ('DRAFT','REJECTED') then perform _err('NOT_EDITABLE', 'Seul un brouillon ou un dossier rejeté se modifie'); end if;
  end if;

  -- Valeurs structurées : une saisie incomplète reste dans draft_data, la colonne vaut NULL.
  v_amount := case when (p_draft->>'amountMinor') ~ '^[0-9]+$' and (p_draft->>'amountMinor')::bigint > 0
                   then (p_draft->>'amountMinor')::bigint end;
  v_currency := case when p_draft->>'currency' in ('EUR','USD','XAF') then p_draft->>'currency' end;
  v_purpose := case when length(trim(coalesce(p_draft->>'purpose', ''))) between 3 and 500 then trim(p_draft->>'purpose') end;
  v_date := case when (p_draft->>'desiredDate') ~ '^\d{4}-\d{2}-\d{2}$' then (p_draft->>'desiredDate')::date end;
  v_plan := case when p_draft->>'planType' in ('SINGLE','PARTIAL','INSTALLMENTS','RECURRING') then p_draft->>'planType' end;
  v_prov := p_draft->'provider';

  if v_prov is not null and nullif(v_prov->>'id', '') is not null then
    begin select * into v_prov_row from providers where id = (v_prov->>'id')::uuid; exception when others then v_prov_row := null; end;
  end if;
  if v_prov is not null and nullif(v_prov->>'invitedPhone', '') is not null and not _valid_phone(v_prov->>'invitedPhone') then
    perform _err('PHONE_INVALID', 'Numéro du prestataire invalide');
  end if;
  v_payer_phone := nullif(trim(coalesce(p_draft->>'counterpartyPhone', '')), '');
  if v_payer_phone is not null and not _valid_phone(v_payer_phone) then perform _err('PHONE_INVALID', 'Numéro du payeur invalide'); end if;

  if t.id is null then
    insert into transactions(id, vertical, purpose, amount_minor, currency, status, created_by, due_date,
                             beneficiary_name, provider_id, provider_name, plan_type, draft_data)
    values (v_id, v_vertical::vertical, v_purpose, v_amount, v_currency::currency, 'DRAFT', v_uid, v_date,
            nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''), v_prov_row.id,
            coalesce(v_prov_row.name, nullif(trim(coalesce(v_prov->>'name', '')), '')), v_plan, p_draft - 'documents' - 'id');
  else
    update transactions set vertical = v_vertical::vertical, purpose = v_purpose, amount_minor = v_amount, currency = v_currency::currency,
      due_date = v_date, beneficiary_name = nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''),
      provider_id = v_prov_row.id, provider_name = coalesce(v_prov_row.name, nullif(trim(coalesce(v_prov->>'name', '')), '')),
      plan_type = v_plan, draft_data = p_draft - 'documents' - 'id'
    where id = v_id;
  end if;

  -- Parties : le créateur (payeur, ou demandeur selon son profil), le payeur invité, le prestataire.
  v_role := case when (select primary_role from profiles where id = v_uid) = 'REQUESTER' then 'REQUESTER'::tx_role else 'PAYER'::tx_role end;
  delete from transaction_parties where tx_id = v_id;
  insert into transaction_parties(tx_id, user_id, role) values (v_id, v_uid, v_role);
  if v_role = 'REQUESTER' and v_payer_phone is not null then
    v_payer_user := _user_by_phone(v_payer_phone);
    insert into transaction_parties(tx_id, user_id, role, invited_phone)
    values (v_id, v_payer_user, 'PAYER', case when v_payer_user is null then '+' || _norm_phone(v_payer_phone) end);
  end if;
  v_prov_user := v_prov_row.user_id;
  v_prov_phone := coalesce(v_prov_row.phone, v_prov->>'invitedPhone');
  if v_prov_user is null and v_prov_phone is not null then v_prov_user := _user_by_phone(v_prov_phone); end if;
  if v_prov_user is not null and v_prov_user <> v_uid then
    insert into transaction_parties(tx_id, user_id, role) values (v_id, v_prov_user, 'PROVIDER');
  elsif v_prov_user is null and _valid_phone(v_prov_phone) then
    insert into transaction_parties(tx_id, role, invited_phone) values (v_id, 'PROVIDER', '+' || _norm_phone(v_prov_phone));
  end if;

  -- Tranches : seules les lignes complètes (montant positif, libellé) sont matérialisées ; le plan brut reste dans draft_data.
  select * into rule from release_rules where vertical = v_vertical;
  delete from tranches where tx_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_draft->'tranches', '[]'::jsonb)) loop
    if (it->>'amountMinor') ~ '^[0-9]+$' and (it->>'amountMinor')::bigint > 0 and length(trim(coalesce(it->>'label', ''))) > 0 then
      n := n + 1;
      insert into tranches(tx_id, seq, label, amount_minor, due_date, release_mode, contest_hours)
      values (v_id, n, trim(it->>'label'), (it->>'amountMinor')::bigint,
              case when (it->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'dueDate')::date end, rule.release_mode, rule.contest_hours);
    end if;
  end loop;
  if v_plan = 'RECURRING' and p_draft ? 'recurrence' and (p_draft->'recurrence'->>'installments') ~ '^[0-9]+$'
     and (p_draft->'recurrence'->>'installments')::int between 2 and 60 and (p_draft->'recurrence'->>'startDate') ~ '^\d{4}-\d{2}-\d{2}$' then
    insert into recurrence_plans(tx_id, frequency, installments, start_date)
    values (v_id, (p_draft->'recurrence'->>'frequency')::recurrence_freq, (p_draft->'recurrence'->>'installments')::int,
            (p_draft->'recurrence'->>'startDate')::date)
    on conflict (tx_id) do update set frequency = excluded.frequency, installments = excluded.installments, start_date = excluded.start_date;
  else
    delete from recurrence_plans where tx_id = v_id;
  end if;
  return _draft_json(v_id);
end $$;

create or replace function get_draft(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user();
  if not exists (select 1 from transactions where id = p_tx and created_by = auth.uid() and status in ('DRAFT','REJECTED')) then
    perform _err('TX_NOT_FOUND', 'Brouillon introuvable');
  end if;
  return _draft_json(p_tx);
end $$;

create or replace function get_drafts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user();
  return coalesce((select jsonb_agg(_draft_json(id) order by updated_at desc)
                   from transactions where created_by = auth.uid() and status = 'DRAFT'), '[]'::jsonb);
end $$;

-- Décision D4 : seul un brouillon jamais audité se supprime. L’application supprime d’abord
-- les fichiers du bucket (chemins lus dans documents), puis appelle cette fonction.
create or replace function delete_draft(p_tx uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or t.created_by <> auth.uid() then perform _err('TX_NOT_FOUND', 'Brouillon introuvable'); end if;
  if has_audit(p_tx) then perform _err('AUDITED_FILE', 'Ce dossier a un historique : il ne peut pas être supprimé'); end if;
  if t.status <> 'DRAFT' then perform _err('NOT_EDITABLE', 'Seul un brouillon se supprime'); end if;
  delete from transactions where id = p_tx;
end $$;

-- ---------- 3. Invitations ----------
-- Un payeur ou un prestataire invité par téléphone retrouve ses dossiers dès son inscription.
create or replace function _attach_invitations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _norm_phone(new.phone) is not null then
    update transaction_parties set user_id = new.id
    where user_id is null and _norm_phone(invited_phone) = _norm_phone(new.phone);
    update providers set user_id = new.id where user_id is null and _norm_phone(phone) = _norm_phone(new.phone);
  end if;
  return new;
end $$;
drop trigger if exists attach_invitations_trg on profiles;
create trigger attach_invitations_trg after insert on profiles for each row execute function _attach_invitations();

-- ---------- 5. Pièces ----------
-- Limites imposées en base (décision D2) : 3 fichiers par type et par dossier, 10 Mo, JPEG / PNG / PDF.
create or replace function _documents_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mime_type not in ('image/jpeg','image/png','application/pdf') then perform _err('FILE_TYPE', 'Format accepté : JPEG, PNG ou PDF'); end if;
  if new.size_bytes is null or new.size_bytes <= 0 or new.size_bytes > 10*1024*1024 then perform _err('FILE_TOO_LARGE', 'Fichier vide ou de plus de 10 Mo'); end if;
  if new.storage_path not like new.tx_id::text || '/%' then perform _err('VALIDATION', 'Chemin de stockage invalide'); end if;
  if new.tranche_id is null and (select count(*) from documents
      where tx_id = new.tx_id and kind = new.kind and tranche_id is null and deleted_at is null) >= 3 then
    perform _err('TOO_MANY_FILES', 'Au plus 3 fichiers par pièce');
  end if;
  return new;
end $$;
drop trigger if exists documents_guard_trg on documents;
create trigger documents_guard_trg before insert on documents for each row execute function _documents_guard();

-- Ajout d’une pièce après l’envoi du fichier dans le bucket « dossiers » (<tx_id>/<kind>/<uuid>.<ext>).
create or replace function add_document(p_tx uuid, p_kind text, p_path text, p_name text, p_mime text, p_size int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t transactions; d documents;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if not (t.created_by = auth.uid() or has_role(p_tx,'REQUESTER') or has_role(p_tx,'PAYER')) then
    perform _err('TRANSITION_FORBIDDEN', 'Réservé au payeur ou au demandeur');
  end if;
  if t.status not in ('DRAFT','REJECTED') then perform _err('NOT_EDITABLE', 'Dossier non modifiable'); end if;
  insert into documents(tx_id, kind, storage_path, mime_type, size_bytes, uploaded_by, file_name)
  values (p_tx, p_kind, p_path, p_mime, p_size, auth.uid(), p_name) returning * into d;
  return jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.file_name, 'mimeType', d.mime_type, 'sizeBytes', d.size_bytes,
                            'status', 'UPLOADED', 'storagePath', d.storage_path,
                            'uploadedAt', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Retrait d’une pièce : suppression si le dossier n’a jamais été audité (l’application supprime ensuite le fichier),
-- archivage sinon (deleted_at ; le fichier d’un dossier audité n’est jamais supprimé). Renvoie 'DELETED' ou 'ARCHIVED'.
create or replace function remove_document(p_doc uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d documents; t transactions;
begin
  perform _require_user();
  select * into d from documents where id = p_doc and deleted_at is null for update;
  if not found then perform _err('NOT_FOUND', 'Pièce introuvable'); end if;
  select * into t from transactions where id = d.tx_id;
  if not (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER')) then perform _err('NOT_FOUND', 'Pièce introuvable'); end if;
  if t.status not in ('DRAFT','REJECTED') or d.tranche_id is not null then perform _err('NOT_EDITABLE', 'Dossier non modifiable'); end if;
  if has_audit(t.id) then
    update documents set deleted_at = now() where id = p_doc;
    return 'ARCHIVED';
  end if;
  delete from documents where id = p_doc;
  return 'DELETED';
end $$;

drop policy if exists docs_delete on documents;
create policy docs_delete on documents for delete using (
  exists (select 1 from transactions t where t.id = tx_id and t.status in ('DRAFT','REJECTED') and not has_audit(t.id)
          and (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER'))));

-- Bucket privé : limites de taille et de type, suppression des fichiers d’un brouillon jamais audité.
update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','application/pdf'] where id = 'dossiers';

create or replace function _storage_tx(p_name text) returns uuid
language plpgsql immutable as $$
begin return ((storage.foldername(p_name))[1])::uuid; exception when others then return null; end $$;

drop policy if exists dossiers_delete on storage.objects;
create policy dossiers_delete on storage.objects for delete using (
  bucket_id = 'dossiers' and exists (
    select 1 from transactions t where t.id = _storage_tx(name) and t.status in ('DRAFT','REJECTED') and not has_audit(t.id)
      and (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER'))));

-- Le créateur doit pouvoir déposer dans son brouillon avant d’en être partie (comme tx_read en 0004).
drop policy if exists dossiers_insert on storage.objects;
create policy dossiers_insert on storage.objects for insert with check (
  bucket_id = 'dossiers' and exists (
    select 1 from transactions t where t.id = _storage_tx(name) and t.status in ('DRAFT','REJECTED')
      and (t.created_by = auth.uid() or has_role(t.id,'REQUESTER') or has_role(t.id,'PAYER'))));
drop policy if exists dossiers_read on storage.objects;
create policy dossiers_read on storage.objects for select using (
  bucket_id = 'dossiers' and (is_validator() or exists (
    select 1 from transactions t where t.id = _storage_tx(name) and (t.created_by = auth.uid() or is_party(t.id)))));

-- ---------- 6. Notifications créées par le serveur ----------
-- Le client ne crée ni ne supprime jamais de notification ; il ne modifie que read_at.
revoke insert, update, delete on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;

create or replace function _notify_from_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_payload jsonb; v_to text; v_outcome text; v_release timestamptz;
begin
  v_to := new.payload->>'tranche_to';
  if new.tranche_id is null then
    if new.to_status = 'VALIDATED' then v_type := 'TX_VALIDATED';
    elsif new.to_status = 'REJECTED' then v_type := 'TX_REJECTED';
    end if;
  elsif new.event = 'DISPUTE_OPENED' then v_type := 'DISPUTE_OPENED';
  elsif new.event = 'DISPUTE_RESOLVED' then
    v_type := 'DISPUTE_RESOLVED';
    v_outcome := case new.payload->>'outcome' when 'RELEASE_TO_PROVIDER' then 'RELEASED' else 'REFUNDED' end;
  elsif v_to = 'AWAITING_PAYMENT' then v_type := 'PAYMENT_READY';
  elsif v_to = 'CONFIRMED' then
    v_type := 'TRANCHE_CONFIRMED';
    select contest_ends_at into v_release from tranches where id = new.tranche_id;
  elsif v_to = 'RELEASED' then v_type := 'TRANCHE_RELEASED';
  end if;
  if v_type is null then return new; end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'type', v_type, 'txId', new.tx_id, 'trancheId', new.tranche_id,
    'reason', case when v_type = 'TX_REJECTED' then coalesce(new.payload->>'reason', '') end,
    'releaseAt', case when v_release is not null then to_char(v_release at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'outcome', v_outcome));
  insert into notifications(user_id, tx_id, event, payload)
  select distinct p.user_id, new.tx_id, v_type, v_payload from transaction_parties p
  where p.tx_id = new.tx_id and p.user_id is not null;
  return new;
end $$;
drop trigger if exists notify_from_audit_trg on audit_log;
create trigger notify_from_audit_trg after insert on audit_log for each row execute function _notify_from_audit();

-- ---------- 7. Reçu, litige, référence ----------
create or replace function get_receipt(p_tranche uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tr tranches; t transactions; k tranche_tokens; v_last text; v_count int; v_payer text;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if tr.status <> 'RELEASED' or tr.released_at is null then perform _err('NOT_RELEASED', 'Le reçu n’existe que pour une tranche débloquée'); end if;
  select * into t from transactions where id = tr.tx_id;
  select * into k from tranche_tokens where tranche_id = tr.id;
  select hash, n into v_last, v_count from (
    select hash, count(*) over () as n, id from audit_log where tx_id = t.id order by id desc limit 1) x;
  select pr.full_name into v_payer from transaction_parties p join profiles pr on pr.id = p.user_id
    where p.tx_id = t.id and p.role = 'PAYER';
  return jsonb_build_object(
    'trancheId', tr.id, 'txId', t.id, 'label', tr.label, 'amountMinor', tr.amount_minor, 'currency', t.currency,
    'releasedAt', to_char(tr.released_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payerName', coalesce(v_payer, ''), 'providerName', coalesce(t.provider_name, ''), 'purpose', coalesce(t.purpose, ''),
    'reference', coalesce(k.reference, ''), 'lastHash', coalesce(v_last, ''), 'chainValid', verify_audit(t.id),
    'entryCount', coalesce(v_count, 0));
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
    'openedAt', to_char(d.opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'status', d.status,
    'resolvedAt', case when d.resolved_at is not null then to_char(d.resolved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'resolutionNote', d.resolution_note));
end $$;

-- Référence d’un eQR : informations affichées avant la confirmation (forme ReferenceInfo).
create or replace function resolve_reference_info(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k tranche_tokens; tr tranches; t transactions; v_ref text;
begin
  perform _require_user();
  v_ref := lower(regexp_replace(coalesce(p_ref, ''), '[^0-9a-fA-F]', '', 'g'));
  select * into k from tranche_tokens where reference = v_ref;
  if not found then perform _err('UNKNOWN_REFERENCE', 'Référence inconnue'); end if;
  select * into tr from tranches where id = k.tranche_id;
  if not is_party(tr.tx_id) then perform _err('NOT_A_PARTY', 'Vous n’êtes pas partie à cette transaction'); end if;
  select * into t from transactions where id = tr.tx_id;
  return jsonb_build_object(
    'trancheId', tr.id, 'txId', t.id, 'label', tr.label, 'amountMinor', tr.amount_minor, 'currency', t.currency, 'status', tr.status,
    'expiresAt', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'used', k.used_at is not null,
    'providerName', coalesce(t.provider_name, ''), 'beneficiaryName', coalesce(t.beneficiary_name, ''), 'purpose', coalesce(t.purpose, ''),
    'seq', tr.seq, 'contestHours', tr.contest_hours);
end $$;

-- ---------- 9. Fonctions de démonstration (mock_mode uniquement) ----------
-- Le journal d’audit reste en ajout seul ; seule la réinitialisation de démonstration peut effacer
-- les lignes des dossiers de l’utilisateur, en mock_mode et dans sa propre transaction.
create or replace function audit_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then
    return old;
  end if;
  raise exception 'audit_log est en ajout seul';
end $$;

do $demo$
begin
  if not _mock_mode() then
    raise notice 'mock_mode <> true : fonctions de démonstration non créées';
    return;
  end if;

  -- Le bureau de contrôle simulé : approbation (jeton, IN_PROGRESS, première tranche selon RG-12) ou rejet.
  execute $f$
  create or replace function demo_review(p_tx uuid, p_approved boolean, p_reason text default null)
  returns transactions language plpgsql security definer set search_path = public as $$
  declare t transactions; v_val uuid; need int; i int := 0; v uuid; ttl int; lead int; first tranches;
  begin
    perform _require_user();
    if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
    select * into t from transactions where id = p_tx for update;
    if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
    if t.status not in ('SUBMITTED','IN_REVIEW') then perform _err('NOT_IN_REVIEW', 'Le dossier n’est pas en validation'); end if;
    select id into v_val from profiles p where platform_role in ('VALIDATOR','ADMIN')
      and not exists (select 1 from transaction_parties x where x.tx_id = p_tx and x.user_id = p.id)
      order by platform_role, created_at limit 1;
    if v_val is null then perform _err('DEMO_NO_VALIDATOR', 'Aucun validateur de démonstration (exécuter seed.sql)'); end if;
    perform set_config('app.via_transition', 'on', true);
    if t.status = 'SUBMITTED' then
      update transactions set status = 'IN_REVIEW' where id = p_tx;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
      values (p_tx, v_val, 'DEMO_REVIEW', 'SUBMITTED', 'IN_REVIEW', '{"demo":true}');
    end if;
    if not p_approved then
      if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
      insert into validations(tx_id, validator_id, approved, reason) values (p_tx, v_val, false, trim(p_reason));
      update transactions set status = 'REJECTED', reject_reason = trim(p_reason) where id = p_tx;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
      values (p_tx, v_val, 'DEMO_REVIEW', 'IN_REVIEW', 'REJECTED', jsonb_build_object('reason', trim(p_reason), 'demo', true));
      select * into t from transactions where id = p_tx;
      return t;
    end if;
    need := required_validations(p_tx);
    for v in select id from profiles p where platform_role in ('VALIDATOR','ADMIN')
               and not exists (select 1 from transaction_parties x where x.tx_id = p_tx and x.user_id = p.id)
             order by platform_role, created_at limit need loop
      insert into validations(tx_id, validator_id, approved) values (p_tx, v, true);
      i := i + 1;
    end loop;
    update transactions set status = 'VALIDATED' where id = p_tx;
    insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
    values (p_tx, v_val, 'DEMO_REVIEW', 'IN_REVIEW', 'VALIDATED', jsonb_build_object('validations', i, 'need', need, 'demo', true));
    select value::int into ttl from app_config where key = 'token_ttl_days';
    insert into trust_tokens(tx_id, signature, expires_at)
    values (p_tx, 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''), now() + make_interval(days => ttl)) on conflict (tx_id) do nothing;
    update transactions set status = 'TOKEN_ISSUED', expires_at = now() + make_interval(days => ttl) where id = p_tx;
    insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (p_tx, null, 'SYSTEM_SIMULATED', 'VALIDATED', 'TOKEN_ISSUED', '{}');
    update transactions set status = 'IN_PROGRESS' where id = p_tx;
    insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (p_tx, null, 'SYSTEM_SIMULATED', 'TOKEN_ISSUED', 'IN_PROGRESS', '{}');
    -- RG-12 : la première tranche est activée si son échéance tombe dans les 7 jours (ou si c’est un jalon).
    select value::int into lead from app_config where key = 'activation_lead_days';
    select * into first from tranches where tx_id = p_tx order by seq limit 1;
    if found and first.status = 'PLANNED' and (first.due_date is null or first.due_date <= current_date + lead) then
      perform _set_tranche_status(first.id, 'AWAITING_PAYMENT', null, 'TRANCHE_ACTIVATED', '{}');
      perform _issue_tranche_token(first.id);
    end if;
    select * into t from transactions where id = p_tx;
    return t;
  end $$;
  $f$;

  -- Décision simulée d’un administrateur sur un litige : 'RELEASED' (fonds remis) ou 'REFUNDED' (remboursement).
  execute $f$
  create or replace function demo_resolve_dispute(p_tranche uuid, p_outcome text, p_note text)
  returns disputes language plpgsql security definer set search_path = public as $$
  declare tr tranches; d disputes; v_admin uuid;
  begin
    perform _require_user();
    if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
    select * into tr from tranches where id = p_tranche;
    if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
    select * into d from disputes where tranche_id = p_tranche and status = 'OPEN';
    if not found then perform _err('NO_OPEN_DISPUTE', 'Aucun litige en cours sur cette tranche'); end if;
    if p_outcome not in ('RELEASED','REFUNDED') then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
    if coalesce(length(trim(p_note)), 0) < 3 then perform _err('REASON_REQUIRED', 'Note de décision obligatoire'); end if;
    select id into v_admin from profiles p where platform_role = 'ADMIN'
      and not exists (select 1 from transaction_parties x where x.tx_id = tr.tx_id and x.user_id = p.id) order by created_at limit 1;
    return _resolve_dispute_core(d.id, case p_outcome when 'RELEASED' then 'RELEASE_TO_PROVIDER' else 'REFUND_PAYER' end, p_note, v_admin);
  end $$;
  $f$;

  -- Réinitialisation : supprime les dossiers créés par l’utilisateur courant, leur journal et ses alertes.
  -- L’application supprime d’abord les fichiers du bucket de ces dossiers.
  execute $f$
  create or replace function demo_reset() returns int
  language plpgsql security definer set search_path = public as $$
  declare v_uid uuid; n int;
  begin
    v_uid := _require_user();
    if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
    perform set_config('app.demo_reset', 'on', true);
    delete from audit_log where tx_id in (select id from transactions where created_by = v_uid);
    delete from notifications where user_id = v_uid;
    delete from transactions where created_by = v_uid;
    get diagnostics n = row_count;
    perform set_config('app.demo_reset', 'off', true);
    return n;
  end $$;
  $f$;

  execute 'revoke all on function demo_review(uuid, boolean, text), demo_resolve_dispute(uuid, text, text), demo_reset() from public, anon';
  execute 'grant execute on function demo_review(uuid, boolean, text), demo_resolve_dispute(uuid, text, text), demo_reset() to authenticated';
end $demo$;

-- ---------- 10. Tâches planifiées ----------
-- pg_cron (disponible sur Supabase ; installation recommandée dans pg_catalog). Planification idempotente par nom.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule('diaspay-release-due-tranches', '*/10 * * * *', 'select public.release_due_tranches()');
select cron.schedule('diaspay-activate-due-tranches', '0 6 * * *', 'select public.activate_due_tranches()');

-- ---------- Droits d’exécution ----------
-- Aucune fonction nouvelle n’est exécutable par anon ; les fonctions internes ne le sont par personne.
revoke all on function _err(text, text, text), _norm_phone(text), _valid_phone(text), _require_user(), _mock_mode(),
  _fold(text), _draft_json(uuid), _user_by_phone(text), _attach_invitations(), _documents_guard(), _storage_tx(text),
  _notify_from_audit(), _resolve_dispute_core(uuid, text, text, uuid) from public, anon, authenticated;
-- _storage_tx est évaluée par les politiques du stockage avec les droits de l’utilisateur.
grant execute on function _storage_tx(text) to authenticated;
revoke all on function search_providers(text, text), save_draft(jsonb), get_draft(uuid), get_drafts(), delete_draft(uuid),
  add_document(uuid, text, text, text, text, int), remove_document(uuid), get_receipt(uuid), get_dispute(uuid),
  resolve_reference_info(text) from public, anon;
grant execute on function search_providers(text, text), save_draft(jsonb), get_draft(uuid), get_drafts(), delete_draft(uuid),
  add_document(uuid, text, text, text, text, int), remove_document(uuid), get_receipt(uuid), get_dispute(uuid),
  resolve_reference_info(text) to authenticated;
-- Fonctions publiques redéfinies : rappel des droits (create or replace les conserve).
revoke all on function transition_tx(uuid, tx_status, text), decide_tx(uuid, boolean, text), simulate_system_transition(uuid, tx_status),
  create_tranches(uuid, jsonb), generate_recurring_tranches(uuid, recurrence_freq, int, date, text), transition_tranche(uuid, tranche_status, text),
  decide_tranche(uuid, boolean, text), confirm_by_reference(text, timestamptz), open_dispute(uuid, text, text),
  resolve_dispute(uuid, text, text), simulate_tranche_system(uuid, tranche_status) from public, anon;
grant execute on function transition_tx(uuid, tx_status, text), decide_tx(uuid, boolean, text), simulate_system_transition(uuid, tx_status),
  create_tranches(uuid, jsonb), generate_recurring_tranches(uuid, recurrence_freq, int, date, text), transition_tranche(uuid, tranche_status, text),
  decide_tranche(uuid, boolean, text), confirm_by_reference(text, timestamptz), open_dispute(uuid, text, text),
  resolve_dispute(uuid, text, text), simulate_tranche_system(uuid, tranche_status) to authenticated;
revoke all on function release_due_tranches(), activate_due_tranches() from public, anon, authenticated;

-- Tables lues en temps réel (déjà publiées par 0001 et 0003) : transactions, tranches, disputes, notifications.
