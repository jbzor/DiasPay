-- =====================================================================
-- DiasPay & DiasPayQR : schéma Supabase (PostgreSQL) v0.1 - MVP
-- Hypothèses : fonds chez le partenaire, validation humaine, en ligne.
-- Exécuter dans l'éditeur SQL Supabase (ou en migration).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Types ----------
create type tx_status as enum (
  'DRAFT','SUBMITTED','IN_REVIEW','REJECTED','VALIDATED','TOKEN_ISSUED',
  'AWAITING_PAYMENT','EXPIRED','CANCELLED','PAID_LOCKED','SERVICE_CONFIRMED',
  'RELEASED','CLOSED','DISPUTED'
);
create type vertical     as enum ('EDUCATION','HEALTH');
create type tx_role      as enum ('PAYER','REQUESTER','PROVIDER','SYSTEM');
create type platform_role as enum ('USER','VALIDATOR','ADMIN');
create type currency     as enum ('EUR','USD','XAF');
create type payment_status as enum ('PENDING','SUCCEEDED','FAILED','REFUNDED');

-- ---------- Profils ----------
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  phone         text unique,
  country       text,
  locale        text not null default 'fr' check (locale in ('fr','en')),
  platform_role platform_role not null default 'USER',
  kyc_status    text not null default 'NONE'
                check (kyc_status in ('NONE','PENDING','VERIFIED','REJECTED')),
  created_at    timestamptz not null default now()
);

-- Création automatique du profil à l'inscription
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.phone);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Configuration (mode simulation) ----------
create table app_config (
  key text primary key,
  value text not null
);
insert into app_config values ('mock_mode','true'), ('token_ttl_days','7');

-- ---------- Transactions ----------
create table transactions (
  id            uuid primary key default gen_random_uuid(),
  vertical      vertical not null,
  purpose       text not null check (length(purpose) between 3 and 500),
  amount_minor  bigint not null check (amount_minor > 0),
  currency      currency not null,
  status        tx_status not null default 'DRAFT',
  created_by    uuid not null references profiles(id),
  due_date      date,
  expires_at    timestamptz,
  reject_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on transactions(status);

-- Rôles par transaction (un utilisateur peut avoir plusieurs rôles)
create table transaction_parties (
  tx_id    uuid not null references transactions(id) on delete cascade,
  user_id  uuid references profiles(id),
  role     tx_role not null,
  invited_phone text,                      -- invitation avant inscription
  primary key (tx_id, role),
  check (user_id is not null or invited_phone is not null)
);
create index on transaction_parties(user_id);

-- ---------- Justificatifs ----------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  tx_id        uuid not null references transactions(id) on delete cascade,
  kind         text not null,              -- ex: PROFORMA, ENROLLMENT_CERT
  storage_path text not null,              -- bucket privé 'dossiers'
  mime_type    text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  size_bytes   int  not null check (size_bytes <= 10*1024*1024),
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index on documents(tx_id);

-- ---------- Validations ----------
create table validations (
  id           uuid primary key default gen_random_uuid(),
  tx_id        uuid not null references transactions(id) on delete cascade,
  validator_id uuid not null references profiles(id),
  approved     boolean not null,
  reason       text,
  decided_at   timestamptz not null default now(),
  check (approved or reason is not null)
);

-- ---------- TrustToken / eQR / DiasPay Link ----------
create table trust_tokens (
  tx_id      uuid primary key references transactions(id) on delete cascade,
  reference  text not null unique
             default encode(gen_random_bytes(9),'hex'),   -- court, pour le QR
  signature  text not null,                                -- JWS serveur (simulée en phase 1)
  simulated  boolean not null default true,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Paiements et déblocage ----------
create table payments (
  id          uuid primary key default gen_random_uuid(),
  tx_id       uuid not null references transactions(id) on delete cascade,
  provider    text not null default 'MOCK',     -- 'TRUSTPAYWAY' plus tard
  external_id text,
  status      payment_status not null default 'PENDING',
  fee_minor   bigint not null default 0,
  created_at  timestamptz not null default now()
);
create unique index one_success_per_tx on payments(tx_id) where status = 'SUCCEEDED';

create table release_events (
  id         uuid primary key default gen_random_uuid(),
  tx_id      uuid not null references transactions(id) on delete cascade,
  trigger    text not null check (trigger in ('PROVIDER_CONFIRMATION','AUTO_TIMEOUT','ADMIN')),
  created_at timestamptz not null default now()
);

-- ---------- Notifications ----------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  tx_id      uuid references transactions(id) on delete cascade,
  event      text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(user_id, read_at);

-- ---------- Journal d'audit (ajout seul, chaîné par empreinte) ----------
create table audit_log (
  id          bigint generated always as identity primary key,
  tx_id       uuid not null references transactions(id),
  actor_id    uuid,
  event       text not null,
  from_status tx_status,
  to_status   tx_status,
  payload     jsonb not null default '{}',
  prev_hash   text,
  hash        text not null,
  created_at  timestamptz not null default now()
);
create index on audit_log(tx_id, id);

create or replace function audit_chain() returns trigger
language plpgsql as $$
declare last_hash text;
begin
  perform pg_advisory_xact_lock(hashtext(new.tx_id::text));
  select hash into last_hash from audit_log
    where tx_id = new.tx_id order by id desc limit 1;
  new.prev_hash := last_hash;
  new.created_at := now();
  new.hash := encode(digest(
    coalesce(last_hash,'') || new.tx_id::text || coalesce(new.actor_id::text,'') ||
    new.event || coalesce(new.from_status::text,'') || coalesce(new.to_status::text,'') ||
    new.payload::text || new.created_at::text, 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_chain_trg before insert on audit_log
  for each row execute function audit_chain();

create or replace function audit_immutable() returns trigger
language plpgsql as $$
begin raise exception 'audit_log est en ajout seul'; end $$;
create trigger audit_no_update before update or delete on audit_log
  for each row execute function audit_immutable();

-- Vérification de l'intégrité de la chaîne d'une transaction
create or replace function verify_audit(p_tx uuid) returns boolean
language plpgsql stable as $$
declare r record; prev text := null; expected text;
begin
  for r in select * from audit_log where tx_id = p_tx order by id loop
    expected := encode(digest(
      coalesce(prev,'') || r.tx_id::text || coalesce(r.actor_id::text,'') ||
      r.event || coalesce(r.from_status::text,'') || coalesce(r.to_status::text,'') ||
      r.payload::text || r.created_at::text, 'sha256'), 'hex');
    if r.hash <> expected or r.prev_hash is distinct from prev then return false; end if;
    prev := r.hash;
  end loop;
  return true;
end $$;

-- ---------- Machine d'états côté base ----------
create table allowed_transitions (
  from_status tx_status not null,
  to_status   tx_status not null,
  role        tx_role   not null,        -- SYSTEM = serveur / mock
  validator_only boolean not null default false,
  primary key (from_status, to_status, role, validator_only)
);
insert into allowed_transitions(from_status,to_status,role,validator_only) values
 ('DRAFT','SUBMITTED','REQUESTER',false), ('DRAFT','SUBMITTED','PAYER',false),
 ('SUBMITTED','IN_REVIEW','SYSTEM',true),
 ('IN_REVIEW','VALIDATED','SYSTEM',true), ('IN_REVIEW','REJECTED','SYSTEM',true),
 ('REJECTED','DRAFT','REQUESTER',false), ('REJECTED','DRAFT','PAYER',false),
 ('VALIDATED','TOKEN_ISSUED','SYSTEM',false),
 ('TOKEN_ISSUED','AWAITING_PAYMENT','SYSTEM',false),
 ('AWAITING_PAYMENT','PAID_LOCKED','SYSTEM',false),
 ('AWAITING_PAYMENT','EXPIRED','SYSTEM',false),
 ('AWAITING_PAYMENT','CANCELLED','PAYER',false),
 ('AWAITING_PAYMENT','CANCELLED','REQUESTER',false),
 ('PAID_LOCKED','SERVICE_CONFIRMED','PROVIDER',false),
 ('SERVICE_CONFIRMED','RELEASED','SYSTEM',false),
 ('RELEASED','CLOSED','SYSTEM',false),
 ('PAID_LOCKED','DISPUTED','PAYER',false), ('PAID_LOCKED','DISPUTED','PROVIDER',false),
 ('SERVICE_CONFIRMED','DISPUTED','PAYER',false);

-- Interdit de modifier le statut hors de la fonction de transition
create or replace function guard_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.via_transition', true),'off') <> 'on' then
    raise exception 'Le statut ne peut changer que via transition_tx()';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_status_trg before update on transactions
  for each row execute function guard_status();

-- Fonctions utilitaires
create or replace function is_validator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
    where id = auth.uid() and platform_role in ('VALIDATOR','ADMIN'));
$$;

create or replace function has_role(p_tx uuid, p_role tx_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from transaction_parties
    where tx_id = p_tx and user_id = auth.uid() and role = p_role);
$$;

create or replace function is_party(p_tx uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from transaction_parties
    where tx_id = p_tx and user_id = auth.uid());
$$;

-- Transition utilisateur : vérifie rôle et table des transitions
create or replace function transition_tx(p_tx uuid, p_to tx_status, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ok boolean := false; r tx_role; old_status tx_status;
begin
  select * into t from transactions where id = p_tx for update;
  if not found then raise exception 'Transaction introuvable'; end if;
  old_status := t.status;

  -- Transitions réservées au validateur
  if exists (select 1 from allowed_transitions
             where from_status = t.status and to_status = p_to and validator_only) then
    ok := is_validator();
  else
    foreach r in array array['PAYER','REQUESTER','PROVIDER']::tx_role[] loop
      if has_role(p_tx, r) and exists (select 1 from allowed_transitions
          where from_status = t.status and to_status = p_to and role = r) then
        ok := true;
      end if;
    end loop;
  end if;
  if not ok then raise exception 'Transition % -> % non autorisée', t.status, p_to; end if;

  perform set_config('app.via_transition','on', true);
  update transactions set status = p_to,
         reject_reason = case when p_to = 'REJECTED' then p_reason else reject_reason end
   where id = p_tx returning * into t;

  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'STATUS_CHANGE',
          old_status, p_to,
          jsonb_build_object('reason', p_reason));
  return t;
end $$;

-- Décision du validateur (écrit aussi la validation)
create or replace function decide_tx(p_tx uuid, p_approved boolean, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  if not is_validator() then raise exception 'Réservé aux validateurs'; end if;
  insert into validations(tx_id, validator_id, approved, reason)
  values (p_tx, auth.uid(), p_approved, p_reason);
  select * into t from transition_tx(p_tx, case when p_approved then 'VALIDATED'::tx_status
                                                else 'REJECTED'::tx_status end, p_reason);
  return t;
end $$;

-- Simulation des transitions "SYSTEM" (mock_mode uniquement, à supprimer
-- quand le TrustEngine prend le relais)
create or replace function simulate_system_transition(p_tx uuid, p_to tx_status)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ttl int; old_status tx_status;
begin
  if (select value from app_config where key = 'mock_mode') <> 'true' then
    raise exception 'Simulation désactivée';
  end if;
  if not is_party(p_tx) and not is_validator() then raise exception 'Accès refusé'; end if;
  select * into t from transactions where id = p_tx for update;
  if not exists (select 1 from allowed_transitions
      where from_status = t.status and to_status = p_to and role = 'SYSTEM') then
    raise exception 'Transition système % -> % invalide', t.status, p_to;
  end if;

  perform set_config('app.via_transition','on', true);
  if p_to = 'TOKEN_ISSUED' then
    select value::int into ttl from app_config where key = 'token_ttl_days';
    insert into trust_tokens(tx_id, signature, expires_at)
    values (p_tx, 'SIMULATED.' || encode(gen_random_bytes(16),'hex'),
            now() + make_interval(days => ttl))
    on conflict (tx_id) do nothing;
    update transactions set expires_at = now() + make_interval(days => ttl) where id = p_tx;
  end if;
  old_status := t.status;
  update transactions set status = p_to where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'SYSTEM_SIMULATED', old_status, p_to, '{}');
  return t;
end $$;

-- Rendre la fonction de transition visible aux clients authentifiés uniquement
revoke all on function transition_tx, decide_tx, simulate_system_transition from public;
grant execute on function transition_tx, decide_tx, simulate_system_transition to authenticated;

-- Résolution d'une référence eQR (scan)
create or replace function resolve_reference(p_ref text)
returns table (tx_id uuid, status tx_status, expires_at timestamptz, used boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.status, k.expires_at, k.used_at is not null
  from trust_tokens k join transactions t on t.id = k.tx_id
  where k.reference = p_ref;
$$;
grant execute on function resolve_reference to authenticated;

-- ---------- Row Level Security ----------
alter table profiles            enable row level security;
alter table transactions        enable row level security;
alter table transaction_parties enable row level security;
alter table documents           enable row level security;
alter table validations         enable row level security;
alter table trust_tokens        enable row level security;
alter table payments            enable row level security;
alter table release_events      enable row level security;
alter table notifications       enable row level security;
alter table audit_log           enable row level security;
alter table app_config          enable row level security;
alter table allowed_transitions enable row level security;

-- Profils
create policy profiles_self_read on profiles for select
  using (id = auth.uid() or is_validator());
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and platform_role = 'USER');

-- Transactions : visibles par les parties et les validateurs
create policy tx_read on transactions for select
  using (is_party(id) or is_validator());
create policy tx_insert on transactions for insert
  with check (created_by = auth.uid() and status = 'DRAFT');
create policy tx_update_draft on transactions for update
  using (is_party(id) and status in ('DRAFT','REJECTED'));

-- Parties
create policy parties_read on transaction_parties for select
  using (is_party(tx_id) or is_validator());
create policy parties_insert on transaction_parties for insert
  with check (exists (select 1 from transactions
    where id = tx_id and created_by = auth.uid() and status = 'DRAFT'));

-- Justificatifs : ajout par le demandeur/payeur tant que modifiable
create policy docs_read on documents for select
  using (is_party(tx_id) or is_validator());
create policy docs_insert on documents for insert
  with check (uploaded_by = auth.uid()
    and exists (select 1 from transactions
      where id = tx_id and status in ('DRAFT','REJECTED')
        and (has_role(id,'REQUESTER') or has_role(id,'PAYER'))));

-- Validations et jetons : lecture seule pour les parties
create or replace function status_ok(p_tx uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select status not in ('DRAFT','SUBMITTED','IN_REVIEW','REJECTED')
  from transactions where id = p_tx;
$$;
create policy validations_read on validations for select
  using (is_party(tx_id) or is_validator());
create policy tokens_read on trust_tokens for select
  using (is_party(tx_id) and status_ok(tx_id));

create policy payments_read on payments for select using (is_party(tx_id) or is_validator());
create policy release_read  on release_events for select using (is_party(tx_id) or is_validator());
create policy audit_read    on audit_log for select using (is_party(tx_id) or is_validator());
create policy notif_own     on notifications for select using (user_id = auth.uid());
create policy notif_update  on notifications for update using (user_id = auth.uid());
create policy config_read   on app_config for select using (true);

-- ---------- Stockage des justificatifs ----------
-- Bucket privé, chemin : dossiers/<tx_id>/<fichier>
insert into storage.buckets (id, name, public) values ('dossiers','dossiers', false)
  on conflict do nothing;

create policy dossiers_read on storage.objects for select
  using (bucket_id = 'dossiers'
    and (is_party(((storage.foldername(name))[1])::uuid) or is_validator()));
create policy dossiers_insert on storage.objects for insert
  with check (bucket_id = 'dossiers'
    and is_party(((storage.foldername(name))[1])::uuid));

-- ---------- Temps réel ----------
alter publication supabase_realtime add table transactions, notifications;

-- Notes :
-- 1. Pas d'écriture client sur payments, trust_tokens, audit_log : ces tables
--    sont alimentées par les fonctions (phase 1) puis par le TrustEngine (phase 2).
-- 2. Créer le premier validateur à la main :
--    update profiles set platform_role = 'VALIDATOR' where phone = '+...';
-- 3. En production : mettre mock_mode à 'false' et supprimer
--    simulate_system_transition.
