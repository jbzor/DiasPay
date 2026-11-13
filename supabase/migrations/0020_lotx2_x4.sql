-- =====================================================================
-- DiasPay : migration 0020 (lot X version 2, X4) — enrôlement et niveaux (K3).
-- À appliquer SUR 0001 à 0019. Test : supabase/tests/06_lotx2_p2.sql (partie X4).
--
--  1. profiles.enrolment_level (N0 à N3, défaut N0), protégé comme platform_role : personne ne modifie son propre niveau.
--     Remplace profiles.can_initiate_requests (lot X, 0008), supprimée après conversion (données de développement seulement).
--  2. enrolment_cases (dossier : niveau demandé, statut SUBMITTED, IN_REVIEW, APPROVED, REJECTED, relecteur, dates, motif),
--     enrolment_documents (pièces d’identité, selfie, immatriculation… dans le bucket distinct « identity »),
--     enrolment_events (journal immuable : soumission, résultat KYC, prise en charge, décision, consultation d’une pièce).
--  3. KycPort : N1 et N2 passent par l’adaptateur (simulé en mock_mode : résultat configurable kyc_simulated_result ;
--     sinon apply_kyc_result, réservée au rôle service, appelée par l’adaptateur réel) ; N3 par la revue manuelle.
--  4. Initiation : N1 minimum pour initier une demande en demandeur, N2 en prestataire (commerçant) ; le payeur qui crée
--     son propre besoin reste en N0. Contrôlé par save_draft et à la soumission (ENROLMENT_REQUIRED).
--  5. enrolment_limits (plafonds par niveau et devise : par opération, par jour, par mois) : table VIDE en production.
--     Plafonds absents → refus prudent (LIMITS_NOT_CONFIGURED), réglage limits_when_missing (REFUSE par défaut).
--     En mock_mode seulement : lignes de développement SANS plafond (valeurs nulles, dev_only), aucun nombre inventé.
--     Contrôle par _check_payer_limits, appelé à l’acceptation d’une demande (accept_and_pay, X5, 0021).
--  6. Fonctions du personnel : claim_enrolment_case, decide_enrolment (approuver, refuser avec motif), journalisées ;
--     pas d’écran (lot Y).
-- =====================================================================

-- ---------- X4.1 Niveau ----------
alter table profiles add column if not exists enrolment_level text not null default 'N0';
do $$ begin
  alter table profiles add constraint profiles_enrolment_level_check check (enrolment_level in ('N0','N1','N2','N3'));
exception when duplicate_object then null; end $$;

-- Conversion (données de développement seulement, aucune donnée de production) : l’ancienne autorisation provisoire
-- d’initier en prestataire devient N2 ; un demandeur (rôle principal ou déjà initiateur d’un dossier) devient N1.
do $$ begin
  if _mock_mode() and exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'can_initiate_requests') then
    execute $q$update profiles set enrolment_level = 'N2' where can_initiate_requests and enrolment_level < 'N2'$q$;
    update profiles p set enrolment_level = 'N1' where enrolment_level = 'N0'
       and (p.primary_role = 'REQUESTER' or exists (select 1 from transaction_parties tp where tp.user_id = p.id and tp.role = 'REQUESTER'));
  end if;
end $$;

create or replace function guard_profile() returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated')
     and (new.platform_role is distinct from old.platform_role
          or new.kyc_status is distinct from old.kyc_status
          or new.enrolment_level is distinct from old.enrolment_level) then
    raise exception using errcode = 'P0001', message = 'Le rôle de plateforme, le statut KYC et le niveau d’enrôlement ne sont pas modifiables',
                          hint = 'PROFILE_PROTECTED';
  end if;
  return new;
end $$;

-- Un utilisateur ne s’accorde pas un niveau à l’inscription non plus.
create or replace function _profile_insert_level() returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated') then new.enrolment_level := 'N0'; end if;
  return new;
end $$;
drop trigger if exists profile_insert_level_trg on profiles;
create trigger profile_insert_level_trg before insert on profiles for each row execute function _profile_insert_level();

create or replace function _level_rank(p_level text) returns int language sql immutable as $$
  select case p_level when 'N0' then 0 when 'N1' then 1 when 'N2' then 2 when 'N3' then 3 end
$$;

-- Niveau requis pour initier (domaine : requiredLevelToInitiate) : REQUESTER N1, PROVIDER N2, PAYER N0.
create or replace function _required_level(p_role text) returns text language sql immutable as $$
  select case p_role when 'PROVIDER' then 'N2' when 'REQUESTER' then 'N1' else 'N0' end
$$;

create or replace function _require_enrolment(p_me profiles, p_role text) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_req text := _required_level(p_role);
begin
  if _level_rank(coalesce(p_me.enrolment_level, 'N0')) < _level_rank(v_req) then
    perform _err('ENROLMENT_REQUIRED', format('Niveau d’enrôlement %s requis pour initier une demande', v_req),
                 json_build_object('required', v_req, 'current', coalesce(p_me.enrolment_level, 'N0'))::text);
  end if;
end $$;

-- ---------- X4.2 Dossiers, pièces, journal ----------
create table if not exists enrolment_cases (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles(id) on delete cascade,
  requested_level  text not null check (requested_level in ('N1','N2','N3')),
  status           text not null default 'SUBMITTED' check (status in ('SUBMITTED','IN_REVIEW','APPROVED','REJECTED')),
  route            text not null check (route in ('KYC','MANUAL')),
  kyc_provider     text,
  kyc_reference    text,
  kyc_result       text check (kyc_result in ('APPROVED','REJECTED','REVIEW')),
  data             jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  reviewer_id      uuid references profiles(id),
  rejection_reason text,
  submitted_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  check (status <> 'REJECTED' or length(trim(coalesce(rejection_reason, ''))) >= 3)
);
create unique index if not exists enrolment_cases_one_open on enrolment_cases(profile_id) where status in ('SUBMITTED','IN_REVIEW');
create index if not exists enrolment_cases_status on enrolment_cases(status, submitted_at);

create table if not exists enrolment_documents (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references enrolment_cases(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('ID_DOCUMENT','SELFIE','BUSINESS_REGISTRATION','ACTIVITY_PROOF','LEGAL_DOCUMENTS','REPRESENTATIVE_MANDATE')),
  storage_path text not null unique,
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type    text,
  size_bytes   int check (size_bytes > 0),
  uploaded_at  timestamptz not null default now()
);
create index if not exists enrolment_documents_case on enrolment_documents(case_id);

create table if not exists enrolment_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  case_id    uuid references enrolment_cases(id) on delete cascade,
  actor_id   uuid references profiles(id),
  event      text not null check (event in ('CASE_SUBMITTED','KYC_RESULT','CASE_CLAIMED','CASE_APPROVED','CASE_REJECTED','DOCUMENT_VIEWED','LEVEL_CHANGED')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists enrolment_events_profile on enrolment_events(profile_id, created_at);
create index if not exists enrolment_events_view on enrolment_events(actor_id, event, created_at);

create or replace function _enrolment_events_immutable() returns trigger language plpgsql as $$
begin
  -- Suppression du compte (cascade depuis profiles) : le journal du titulaire part avec lui.
  if tg_op = 'DELETE' and not exists (select 1 from profiles where id = old.profile_id) then return old; end if;
  raise exception using errcode = 'P0001', message = 'Journal d’enrôlement immuable', hint = 'AUDIT_IMMUTABLE';
end $$;
drop trigger if exists enrolment_events_immutable on enrolment_events;
create trigger enrolment_events_immutable before update or delete on enrolment_events for each row execute function _enrolment_events_immutable();

alter table enrolment_cases enable row level security;
alter table enrolment_documents enable row level security;
alter table enrolment_events enable row level security;
drop policy if exists enrolment_cases_read on enrolment_cases;
create policy enrolment_cases_read on enrolment_cases for select using (profile_id = auth.uid() or is_validator());
drop policy if exists enrolment_documents_read on enrolment_documents;
create policy enrolment_documents_read on enrolment_documents for select using (profile_id = auth.uid() or is_validator());
drop policy if exists enrolment_events_read on enrolment_events;
create policy enrolment_events_read on enrolment_events for select using (profile_id = auth.uid() or is_validator());
revoke all on enrolment_cases, enrolment_documents, enrolment_events from anon;
revoke insert, update, delete on enrolment_cases, enrolment_documents, enrolment_events from authenticated;
grant select on enrolment_cases, enrolment_documents, enrolment_events to authenticated;

-- Pièces exigées par niveau (domaine : ENROLMENT_REQUIREMENTS). N2 et N3 exigent aussi le niveau N1 du représentant.
create or replace function _enrolment_required_kinds(p_level text) returns text[] language sql immutable as $$
  select case p_level
    when 'N1' then array['ID_DOCUMENT','SELFIE']
    when 'N2' then array['BUSINESS_REGISTRATION','ACTIVITY_PROOF']
    when 'N3' then array['LEGAL_DOCUMENTS','REPRESENTATIVE_MANDATE'] end
$$;

-- ---------- X4.3 Bucket distinct des pièces d’identité ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity', 'identity', false, 10485760, array['image/jpeg','image/png','image/heic','application/pdf'])
on conflict (id) do update set public = false;

-- Dépôt : le titulaire, dans son propre dossier <uid>/… ; ni modification ni suppression (pièces conservées).
drop policy if exists identity_insert on storage.objects;
create policy identity_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'identity' and (storage.foldername(name))[1] = auth.uid()::text);
-- Lecture : après une consultation journalisée (get_enrolment_document_access) du titulaire ou du relecteur du dossier.
create or replace function _identity_recently_opened(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrolment_events e
    where e.event = 'DOCUMENT_VIEWED' and e.actor_id = auth.uid() and e.payload->>'path' = p_path
      and e.created_at > now() - interval '2 minutes')
$$;
drop policy if exists identity_read on storage.objects;
create policy identity_read on storage.objects for select using (bucket_id = 'identity' and _identity_recently_opened(name));

-- ---------- X4.5 Plafonds ----------
create table if not exists enrolment_limits (
  level             text not null check (level in ('N0','N1','N2','N3')),
  currency          currency not null,
  per_operation_minor bigint check (per_operation_minor > 0),
  per_day_minor     bigint check (per_day_minor > 0),
  per_month_minor   bigint check (per_month_minor > 0),
  dev_only          boolean not null default false,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references profiles(id),
  primary key (level, currency)
);
comment on table enrolment_limits is 'Plafonds par niveau et devise (point ouvert 1). Valeur nulle : pas de plafond pour cette fenêtre. Ligne absente : plafonds non configurés.';
alter table enrolment_limits enable row level security;
drop policy if exists enrolment_limits_read on enrolment_limits;
create policy enrolment_limits_read on enrolment_limits for select to authenticated using (true);
drop policy if exists enrolment_limits_admin_write on enrolment_limits;
create policy enrolment_limits_admin_write on enrolment_limits for all to authenticated using (is_admin()) with check (is_admin());
revoke all on enrolment_limits from anon;

do $$ begin
  if _mock_mode() then
    -- DÉVELOPPEMENT : aucun plafond (valeurs nulles), pour que les parcours de démonstration restent payables.
    insert into enrolment_limits(level, currency, dev_only)
    select l, c::currency, true from unnest(array['N0','N1','N2','N3']) l, unnest(array['XAF','EUR','USD']) c
    on conflict do nothing;
    insert into app_config(key, value) values ('kyc_simulated_result', 'APPROVED') on conflict (key) do nothing;   -- DÉVELOPPEMENT
  end if;
end $$;

-- Plafonds du payeur (domaine : checkLimits). Montants en devise de la demande ; jour et mois civils UTC ; tentatives
-- en cours ou confirmées (statuts de 0021 : INITIATED, PENDING, CONFIRMED).
create or replace function _check_payer_limits(p_payer uuid, p_currency currency, p_amount bigint) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_level text; l enrolment_limits; v_day bigint; v_month bigint;
begin
  select enrolment_level into v_level from profiles where id = p_payer;
  select * into l from enrolment_limits where level = coalesce(v_level, 'N0') and currency = p_currency;
  if not found then
    if coalesce((select value from app_config where key = 'limits_when_missing'), 'REFUSE') = 'ALLOW' then return; end if;
    perform _err('LIMITS_NOT_CONFIGURED', 'Plafonds non configurés pour ce niveau : paiement refusé par prudence',
                 json_build_object('level', coalesce(v_level, 'N0'), 'currency', p_currency)::text);
  end if;
  if l.per_operation_minor is not null and p_amount > l.per_operation_minor then
    perform _err('LIMIT_EXCEEDED', 'Plafond par paiement dépassé', json_build_object('window', 'OPERATION', 'limit', l.per_operation_minor, 'level', l.level)::text);
  end if;
  select coalesce(sum(amount_minor) filter (where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'), 0),
         coalesce(sum(amount_minor) filter (where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'), 0)
    into v_day, v_month
    from payment_attempts where created_by = p_payer and currency = p_currency and status in ('INITIATED','PENDING','CONFIRMED');
  if l.per_day_minor is not null and v_day + p_amount > l.per_day_minor then
    perform _err('LIMIT_EXCEEDED', 'Plafond journalier dépassé', json_build_object('window', 'DAY', 'limit', l.per_day_minor, 'used', v_day, 'level', l.level)::text);
  end if;
  if l.per_month_minor is not null and v_month + p_amount > l.per_month_minor then
    perform _err('LIMIT_EXCEEDED', 'Plafond mensuel dépassé', json_build_object('window', 'MONTH', 'limit', l.per_month_minor, 'used', v_month, 'level', l.level)::text);
  end if;
end $$;

-- ---------- X4.3 Soumission, KYC, revue ----------
create or replace function _enrolment_json(c enrolment_cases) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'requestedLevel', c.requested_level, 'status', c.status, 'route', c.route,
    'kycResult', c.kyc_result, 'rejectionReason', c.rejection_reason,
    'submittedAt', to_char(c.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reviewedAt', to_char(c.reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

create or replace function _approve_enrolment(p_case uuid, p_actor uuid, p_via text) returns enrolment_cases
language plpgsql security definer set search_path = public as $$
declare c enrolment_cases; v_old text;
begin
  update enrolment_cases set status = 'APPROVED', reviewed_at = now(), reviewer_id = coalesce(reviewer_id, p_actor)
   where id = p_case returning * into c;
  select enrolment_level into v_old from profiles where id = c.profile_id;
  if _level_rank(c.requested_level) > _level_rank(v_old) then
    update profiles set enrolment_level = c.requested_level where id = c.profile_id;
    insert into enrolment_events(profile_id, case_id, actor_id, event, payload)
    values (c.profile_id, c.id, p_actor, 'LEVEL_CHANGED', jsonb_build_object('from', v_old, 'to', c.requested_level, 'via', p_via));
  end if;
  insert into enrolment_events(profile_id, case_id, actor_id, event, payload)
  values (c.profile_id, c.id, p_actor, 'CASE_APPROVED', jsonb_build_object('level', c.requested_level, 'via', p_via));
  return c;
end $$;

create or replace function _reject_enrolment(p_case uuid, p_actor uuid, p_reason text, p_via text) returns enrolment_cases
language plpgsql security definer set search_path = public as $$
declare c enrolment_cases;
begin
  update enrolment_cases set status = 'REJECTED', reviewed_at = now(), rejection_reason = trim(p_reason), reviewer_id = coalesce(reviewer_id, p_actor)
   where id = p_case returning * into c;
  insert into enrolment_events(profile_id, case_id, actor_id, event, payload)
  values (c.profile_id, c.id, p_actor, 'CASE_REJECTED', jsonb_build_object('reason', trim(p_reason), 'via', p_via));
  return c;
end $$;

-- Résultat de l’adaptateur KYC (APPROVED, REJECTED, REVIEW : revue manuelle). Idempotent : un dossier clos ne change plus.
create or replace function _apply_kyc(p_case uuid, p_result text, p_reference text, p_reason text, p_provider text) returns enrolment_cases
language plpgsql security definer set search_path = public as $$
declare c enrolment_cases;
begin
  select * into c from enrolment_cases where id = p_case for update;
  if not found then perform _err('NOT_FOUND', 'Dossier d’enrôlement introuvable'); end if;
  if p_result not in ('APPROVED','REJECTED','REVIEW') then perform _err('INVALID_OUTCOME', 'Résultat KYC invalide'); end if;
  if c.status not in ('SUBMITTED','IN_REVIEW') or c.route <> 'KYC' then return c; end if;
  update enrolment_cases set kyc_result = p_result, kyc_reference = coalesce(p_reference, kyc_reference), kyc_provider = p_provider
   where id = p_case returning * into c;
  insert into enrolment_events(profile_id, case_id, actor_id, event, payload)
  values (c.profile_id, c.id, null, 'KYC_RESULT', jsonb_strip_nulls(jsonb_build_object('result', p_result, 'provider', p_provider, 'reference', p_reference)));
  if p_result = 'APPROVED' then c := _approve_enrolment(c.id, null, 'KYC');
  elsif p_result = 'REJECTED' then c := _reject_enrolment(c.id, null, coalesce(nullif(trim(p_reason), ''), 'Vérification d’identité refusée'), 'KYC');
  end if;
  return c;
end $$;

-- Adaptateur réel (fonction Edge, rôle service) : jamais appelable par un utilisateur.
create or replace function apply_kyc_result(p_case uuid, p_result text, p_reference text, p_reason text default null, p_provider text default 'KYC')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return _enrolment_json(_apply_kyc(p_case, p_result, p_reference, p_reason, p_provider));
end $$;

-- Titulaire : dépôt d’un dossier. p_documents : [{kind, path, contentHash?, mimeType?, sizeBytes?}], chemins sous <uid>/.
create or replace function submit_enrolment(p_level text, p_documents jsonb, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; me profiles; c enrolment_cases; d jsonb; v_kinds text[] := '{}'; v_missing text; v_result text;
begin
  v_uid := _require_user();
  select * into me from profiles where id = v_uid for update;
  if p_level not in ('N1','N2','N3') then perform _err('VALIDATION', 'Niveau demandé invalide'); end if;
  if _level_rank(p_level) <= _level_rank(me.enrolment_level) then perform _err('ALREADY_ENROLLED', 'Niveau déjà atteint'); end if;
  if p_level in ('N2','N3') and _level_rank(me.enrolment_level) < 1 then
    perform _err('ENROLMENT_REQUIRED', 'Le niveau N1 du représentant est requis d’abord', json_build_object('required', 'N1', 'current', me.enrolment_level)::text);
  end if;
  if exists (select 1 from enrolment_cases where profile_id = v_uid and status in ('SUBMITTED','IN_REVIEW')) then
    perform _err('ENROLMENT_PENDING', 'Un dossier d’enrôlement est déjà en cours');
  end if;
  if jsonb_typeof(coalesce(p_documents, 'null')) <> 'array' or jsonb_array_length(p_documents) = 0 or jsonb_array_length(p_documents) > 10 then
    perform _err('VALIDATION', 'Pièces du dossier manquantes');
  end if;
  if jsonb_typeof(coalesce(p_data, '{}'::jsonb)) <> 'object' then perform _err('VALIDATION', 'Données du dossier invalides'); end if;
  for d in select * from jsonb_array_elements(p_documents) loop
    if coalesce(d->>'path', '') !~ ('^' || v_uid::text || '/[A-Za-z0-9._/-]{1,200}$') or position('..' in d->>'path') > 0 then
      perform _err('VALIDATION', 'Chemin de pièce invalide');
    end if;
    if d ? 'contentHash' and coalesce(d->>'contentHash', '') !~ '^[0-9a-fA-F]{64}$' then perform _err('HASH_INVALID', 'Empreinte invalide'); end if;
    v_kinds := v_kinds || (d->>'kind');
  end loop;
  select k into v_missing from unnest(_enrolment_required_kinds(p_level)) k where k <> all(v_kinds) limit 1;
  if v_missing is not null then perform _err('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', v_missing); end if;

  insert into enrolment_cases(profile_id, requested_level, route, data)
  values (v_uid, p_level, case when p_level = 'N3' then 'MANUAL' else 'KYC' end, coalesce(p_data, '{}'::jsonb)) returning * into c;
  begin
    insert into enrolment_documents(case_id, profile_id, kind, storage_path, content_hash, mime_type, size_bytes)
    select c.id, v_uid, x->>'kind', x->>'path', lower(nullif(x->>'contentHash', '')), nullif(x->>'mimeType', ''),
           case when (x->>'sizeBytes') ~ '^[0-9]+$' then (x->>'sizeBytes')::int end
      from jsonb_array_elements(p_documents) x;
  exception when check_violation then perform _err('VALIDATION', 'Type de pièce inconnu');
            when unique_violation then perform _err('VALIDATION', 'Pièce déjà déposée');
  end;
  insert into enrolment_events(profile_id, case_id, actor_id, event, payload)
  values (v_uid, c.id, v_uid, 'CASE_SUBMITTED', jsonb_build_object('level', p_level, 'route', c.route, 'documents', jsonb_array_length(p_documents)));
  -- Adaptateur simulé (mock_mode) : résultat configurable, par le même chemin que l’adaptateur réel.
  if c.route = 'KYC' and _mock_mode() then
    v_result := coalesce((select value from app_config where key = 'kyc_simulated_result'), 'REVIEW');
    c := _apply_kyc(c.id, v_result, 'SIMKYC-' || replace(gen_random_uuid()::text, '-', ''), case when v_result = 'REJECTED' then 'Refus simulé' end, 'SIMULATED');
  end if;
  return _enrolment_json(c);
end $$;

-- Titulaire : niveau et dernier dossier.
create or replace function my_enrolment() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid; c enrolment_cases;
begin
  v_uid := _require_user();
  select * into c from enrolment_cases where profile_id = v_uid order by submitted_at desc limit 1;
  return jsonb_strip_nulls(jsonb_build_object('level', (select enrolment_level from profiles where id = v_uid),
    'case', case when c.id is not null then _enrolment_json(c) end));
end $$;

-- Personnel : prise en charge (relecteur), décision. Jamais sur son propre dossier.
create or replace function claim_enrolment_case(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c enrolment_cases;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into c from enrolment_cases where id = p_case for update;
  if not found then perform _err('NOT_FOUND', 'Dossier d’enrôlement introuvable'); end if;
  if c.profile_id = auth.uid() then perform _err('SELF_REVIEW', 'Vous ne pouvez pas examiner votre propre dossier'); end if;
  if c.status not in ('SUBMITTED','IN_REVIEW') then perform _err('CASE_CLOSED', 'Dossier déjà tranché'); end if;
  if c.route = 'KYC' and coalesce(c.kyc_result, '') <> 'REVIEW' then perform _err('KYC_PENDING', 'Résultat de la vérification automatique attendu'); end if;
  if c.status = 'IN_REVIEW' and c.reviewer_id = auth.uid() then return _enrolment_json(c); end if;
  if c.status = 'IN_REVIEW' then perform _err('ALREADY_CLAIMED', 'Dossier pris en charge par un autre relecteur'); end if;
  update enrolment_cases set status = 'IN_REVIEW', reviewer_id = auth.uid() where id = p_case returning * into c;
  insert into enrolment_events(profile_id, case_id, actor_id, event) values (c.profile_id, c.id, auth.uid(), 'CASE_CLAIMED');
  return _enrolment_json(c);
end $$;

create or replace function decide_enrolment(p_case uuid, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c enrolment_cases;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into c from enrolment_cases where id = p_case for update;
  if not found then perform _err('NOT_FOUND', 'Dossier d’enrôlement introuvable'); end if;
  if c.profile_id = auth.uid() then perform _err('SELF_REVIEW', 'Vous ne pouvez pas examiner votre propre dossier'); end if;
  if c.status <> 'IN_REVIEW' then
    perform _err(case when c.status in ('APPROVED','REJECTED') then 'CASE_CLOSED' else 'NOT_CLAIMED' end, 'Dossier non pris en charge ou déjà tranché');
  end if;
  if c.reviewer_id <> auth.uid() then perform _err('ALREADY_CLAIMED', 'Dossier pris en charge par un autre relecteur'); end if;
  if p_approve then
    c := _approve_enrolment(c.id, auth.uid(), 'REVIEW');
  else
    if length(trim(coalesce(p_reason, ''))) < 3 then perform _err('REASON_REQUIRED', 'Motif du refus obligatoire'); end if;
    c := _reject_enrolment(c.id, auth.uid(), p_reason, 'REVIEW');
  end if;
  return _enrolment_json(c);
end $$;

-- Consultation d’une pièce d’identité : titulaire, ou relecteur du dossier (pris en charge). Journalisée avant l’accès.
create or replace function get_enrolment_document_access(p_document uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d enrolment_documents; c enrolment_cases;
begin
  perform _require_user();
  select * into d from enrolment_documents where id = p_document;
  if found then select * into c from enrolment_cases where id = d.case_id; end if;
  if d.id is null or not coalesce(d.profile_id = auth.uid() or (is_validator() and c.reviewer_id = auth.uid() and c.profile_id <> auth.uid()), false) then
    perform _err('NOT_FOUND', 'Pièce introuvable');
  end if;
  insert into enrolment_events(profile_id, case_id, actor_id, event, payload)
  values (d.profile_id, d.case_id, auth.uid(), 'DOCUMENT_VIEWED',
          jsonb_build_object('document_id', d.id, 'kind', d.kind, 'path', d.storage_path,
                             'role', case when d.profile_id = auth.uid() then 'HOLDER' else 'REVIEWER' end));
  return jsonb_strip_nulls(jsonb_build_object('id', d.id, 'path', d.storage_path, 'kind', d.kind, 'mimeType', d.mime_type, 'contentHash', d.content_hash));
end $$;

-- ---------- X4.4 Initiation par niveau (remplace can_initiate_requests) ----------
create or replace function save_draft(p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_uid uuid; v_id uuid; t transactions; v_role tx_role; v_vertical text; v_amount bigint; v_purpose text;
  v_currency text; v_date date; v_plan text; v_prov jsonb; v_prov_row providers; v_prov_user uuid; v_prov_name text;
  v_prov_phone text; v_payer_phone text; v_payer_user uuid; v_creator text; me profiles; rule release_rules; it jsonb; n int := 0;
begin
  v_uid := _require_user();
  begin v_id := (p_draft->>'id')::uuid; exception when others then perform _err('VALIDATION', 'Identifiant de brouillon invalide'); end;
  if v_id is null then perform _err('VALIDATION', 'Identifiant de brouillon manquant'); end if;
  v_vertical := p_draft->>'vertical';
  if v_vertical is null or not exists (select 1 from request_modules where code = v_vertical) then
    perform _err('VALIDATION', 'Type de besoin manquant ou inconnu');
  end if;
  v_creator := nullif(p_draft->>'creatorRole', '');
  if v_creator is not null and v_creator not in ('PAYER','REQUESTER','PROVIDER') then
    perform _err('VALIDATION', 'Rôle du créateur inconnu');
  end if;

  select * into t from transactions where id = v_id for update;
  if found then
    if t.created_by <> v_uid then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
    if t.status not in ('DRAFT','REJECTED') then perform _err('NOT_EDITABLE', 'Seul un brouillon ou un dossier rejeté se modifie'); end if;
  end if;

  select * into me from profiles where id = v_uid;
  v_role := coalesce(v_creator, case when me.primary_role = 'REQUESTER' then 'REQUESTER' else 'PAYER' end)::tx_role;
  if v_role = 'REQUESTER' then perform _require_enrolment(me, 'REQUESTER'); end if;

  v_amount := case when (p_draft->>'amountMinor') ~ '^[0-9]+$' and (p_draft->>'amountMinor')::bigint > 0
                   then (p_draft->>'amountMinor')::bigint end;
  v_currency := case when p_draft->>'currency' in ('EUR','USD','XAF') then p_draft->>'currency' end;
  v_purpose := case when length(trim(coalesce(p_draft->>'purpose', ''))) between 3 and 500 then trim(p_draft->>'purpose') end;
  v_date := case when (p_draft->>'desiredDate') ~ '^\d{4}-\d{2}-\d{2}$' then (p_draft->>'desiredDate')::date end;
  v_plan := case when p_draft->>'planType' in ('SINGLE','PARTIAL','INSTALLMENTS','RECURRING') then p_draft->>'planType' end;
  v_prov := p_draft->'provider';
  v_payer_phone := nullif(trim(coalesce(p_draft->>'counterpartyPhone', '')), '');
  if v_payer_phone is not null and not _valid_phone(v_payer_phone) then perform _err('PHONE_INVALID', 'Numéro du payeur invalide'); end if;

  if v_role = 'PROVIDER' then
    perform _require_enrolment(me, 'PROVIDER');
    if v_payer_phone is not null and (_norm_phone(v_payer_phone) = _norm_phone(me.phone) or _user_by_phone(v_payer_phone) = v_uid) then
      perform _err('SELF_PAYER', 'Vous ne pouvez pas être le payeur de votre propre demande');
    end if;
    v_prov_name := coalesce(nullif(trim(coalesce(v_prov->>'name', '')), ''), nullif(trim(me.full_name), ''));
  else
    if v_prov is not null and nullif(v_prov->>'id', '') is not null then
      begin select * into v_prov_row from providers where id = (v_prov->>'id')::uuid; exception when others then v_prov_row := null; end;
    end if;
    if v_prov is not null and nullif(v_prov->>'invitedPhone', '') is not null and not _valid_phone(v_prov->>'invitedPhone') then
      perform _err('PHONE_INVALID', 'Numéro du prestataire invalide');
    end if;
    v_prov_name := coalesce(v_prov_row.name, nullif(trim(coalesce(v_prov->>'name', '')), ''));
  end if;

  if t.id is null then
    insert into transactions(id, vertical, purpose, amount_minor, currency, status, created_by, due_date,
                             beneficiary_name, provider_id, provider_name, plan_type, draft_data)
    values (v_id, v_vertical, v_purpose, v_amount, v_currency::currency, 'DRAFT', v_uid, v_date,
            nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''), v_prov_row.id, v_prov_name, v_plan, p_draft - 'documents' - 'id');
  else
    update transactions set vertical = v_vertical, purpose = v_purpose, amount_minor = v_amount, currency = v_currency::currency,
      due_date = v_date, beneficiary_name = nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''),
      provider_id = v_prov_row.id, provider_name = v_prov_name, plan_type = v_plan, draft_data = p_draft - 'documents' - 'id'
    where id = v_id;
  end if;

  delete from transaction_parties where tx_id = v_id;
  insert into transaction_parties(tx_id, user_id, role) values (v_id, v_uid, v_role);
  if v_role in ('REQUESTER','PROVIDER') and v_payer_phone is not null then
    v_payer_user := _user_by_phone(v_payer_phone);
    insert into transaction_parties(tx_id, user_id, role, invited_phone)
    values (v_id, v_payer_user, 'PAYER', case when v_payer_user is null then '+' || _norm_phone(v_payer_phone) end);
  end if;
  if v_role <> 'PROVIDER' then
    v_prov_user := v_prov_row.user_id;
    v_prov_phone := coalesce(v_prov_row.phone, v_prov->>'invitedPhone');
    if v_prov_user is null and v_prov_phone is not null then v_prov_user := _user_by_phone(v_prov_phone); end if;
    if v_prov_user is not null and v_prov_user <> v_uid then
      insert into transaction_parties(tx_id, user_id, role) values (v_id, v_prov_user, 'PROVIDER');
    elsif v_prov_user is null and _valid_phone(v_prov_phone) then
      insert into transaction_parties(tx_id, role, invited_phone) values (v_id, 'PROVIDER', '+' || _norm_phone(v_prov_phone));
    end if;
  end if;

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
end $$

;

-- Soumission : le niveau est contrôlé de nouveau (il a pu changer depuis le brouillon).
create or replace function _check_initiator_level(p_tx uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_role text; me profiles;
begin
  select tp.role::text into v_role from transaction_parties tp join transactions t on t.id = tp.tx_id
   where tp.tx_id = p_tx and tp.user_id = coalesce(t.initiator_id, t.created_by) and tp.role in ('REQUESTER','PROVIDER','PAYER')
   order by case tp.role when 'PROVIDER' then 1 when 'REQUESTER' then 2 else 3 end limit 1;
  select p.* into me from profiles p join transactions t on p.id = coalesce(t.initiator_id, t.created_by) where t.id = p_tx;
  perform _require_enrolment(me, coalesce(v_role, 'PAYER'));
end $$;

create or replace function submit_operation(p_tx uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare t transactions; total bigint; missing text; v_review jsonb;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if t.status <> 'DRAFT' then perform _err('TRANSITION_UNKNOWN', format('Transition %s -> soumission inconnue', t.status)); end if;
  if not _is_initiator(p_tx) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  perform _check_initiator_level(p_tx);
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
end $$

;

-- L’ancienne autorisation provisoire disparaît (convertie plus haut ; seule save_draft la lisait).
alter table profiles drop column if exists can_initiate_requests;

-- ---------- Droits (X4) : rien pour anon ; fonctions internes et adaptateur réservés ----------
revoke all on function _level_rank(text), _required_level(text), _require_enrolment(profiles, text), _enrolment_required_kinds(text),
  _identity_recently_opened(text), _check_payer_limits(uuid, currency, bigint), _enrolment_json(enrolment_cases),
  _approve_enrolment(uuid, uuid, text), _reject_enrolment(uuid, uuid, text, text), _apply_kyc(uuid, text, text, text, text),
  _check_initiator_level(uuid), _profile_insert_level(), _enrolment_events_immutable()
  from public, anon, authenticated;
-- La politique de stockage appelle _identity_recently_opened avec les droits de l’utilisateur.
grant execute on function _identity_recently_opened(text) to authenticated;
revoke all on function apply_kyc_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function apply_kyc_result(uuid, text, text, text, text) to service_role;
revoke all on function submit_enrolment(text, jsonb, jsonb), my_enrolment(), claim_enrolment_case(uuid), decide_enrolment(uuid, boolean, text),
  get_enrolment_document_access(uuid), save_draft(jsonb), submit_operation(uuid) from public, anon;
grant execute on function submit_enrolment(text, jsonb, jsonb), my_enrolment(), claim_enrolment_case(uuid), decide_enrolment(uuid, boolean, text),
  get_enrolment_document_access(uuid), save_draft(jsonb), submit_operation(uuid) to authenticated;
