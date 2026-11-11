-- v0.2 partie B : tranches, règles de déblocage, double validation, litiges, jetons.
-- =====================  PARTIE B  =====================================

-- ---------- Types ----------
create type tranche_status as enum (
  'PLANNED','AWAITING_PAYMENT','PAID_LOCKED','EVIDENCE_SUBMITTED',
  'CONFIRMED','RELEASED','DISPUTED','CANCELLED','EXPIRED'
);
create type release_mode as enum (
  'PROVIDER_CONFIRM',   -- le prestataire scanne l'eQR
  'PAYER_CONFIRM',      -- le payeur confirme la réception (agro)
  'EVIDENCE_REVIEW',    -- pièce probante validée par le bureau de contrôle
  'AUTO'
);
create type recurrence_freq as enum ('WEEKLY','MONTHLY','QUARTERLY');

-- ---------- Règles de déblocage par verticale ----------
create table release_rules (
  vertical        text primary key,
  release_mode    release_mode not null,
  contest_hours   int not null default 0,        -- délai de contestation du payeur
  dual_validation boolean not null default false -- deux validateurs obligatoires
);
insert into release_rules(vertical, release_mode, contest_hours, dual_validation) values
 ('EDUCATION',   'PROVIDER_CONFIRM', 72, false),
 ('HEALTH',      'PROVIDER_CONFIRM', 48, false),
 ('RENT',        'PROVIDER_CONFIRM', 72, false),
 ('AGRO',        'PAYER_CONFIRM',    72, false),
 ('REAL_ESTATE', 'EVIDENCE_REVIEW',   0, true),
 ('LAND',        'EVIDENCE_REVIEW',   0, true);

-- Seuils de double validation par devise (XAF sans décimales : 1 = 1 FCFA)
create table dual_thresholds (
  currency        currency primary key,
  threshold_minor bigint not null
);
insert into dual_thresholds values ('EUR', 500000), ('USD', 550000), ('XAF', 3000000);

insert into app_config values ('activation_lead_days','7') on conflict do nothing;

-- ---------- Tranches ----------
create table tranches (
  id              uuid primary key default gen_random_uuid(),
  tx_id           uuid not null references transactions(id) on delete cascade,
  seq             int  not null,
  label           text not null,
  amount_minor    bigint not null check (amount_minor > 0),
  due_date        date,                       -- null = jalon, activé à la suite de la tranche précédente
  status          tranche_status not null default 'PLANNED',
  release_mode    release_mode not null,
  contest_hours   int not null default 0,
  contest_ends_at timestamptz,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tx_id, seq)
);
create index on tranches(tx_id);
create index on tranches(status);

create table recurrence_plans (
  tx_id        uuid primary key references transactions(id) on delete cascade,
  frequency    recurrence_freq not null,
  installments int not null check (installments between 2 and 60),
  start_date   date not null
);

-- Liens des tables existantes vers les tranches
alter table documents      add column tranche_id uuid references tranches(id) on delete cascade;
alter table validations    add column tranche_id uuid references tranches(id) on delete cascade;
alter table payments       add column tranche_id uuid references tranches(id) on delete cascade;
alter table release_events add column tranche_id uuid references tranches(id) on delete cascade;
alter table audit_log      add column tranche_id uuid;

drop index if exists one_success_per_tx;
create unique index one_success_per_tranche on payments(tranche_id) where status = 'SUCCEEDED';

alter table release_events drop constraint if exists release_events_trigger_check;
alter table release_events add constraint release_events_trigger_check check (trigger in
  ('PROVIDER_CONFIRMATION','AUTO_TIMEOUT','ADMIN','PAYER_APPROVAL',
   'VALIDATOR_APPROVAL','DISPUTE_RESOLUTION'));

-- ---------- Audit : la chaîne inclut désormais tranche_id ----------
-- (ajouté en fin de concaténation : les anciennes lignes restent vérifiables)
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
    new.payload::text || new.created_at::text || coalesce(new.tranche_id::text,''),
    'sha256'), 'hex');
  return new;
end $$;

create or replace function verify_audit(p_tx uuid) returns boolean
language plpgsql stable as $$
declare r record; prev text := null; expected text;
begin
  for r in select * from audit_log where tx_id = p_tx order by id loop
    expected := encode(digest(
      coalesce(prev,'') || r.tx_id::text || coalesce(r.actor_id::text,'') ||
      r.event || coalesce(r.from_status::text,'') || coalesce(r.to_status::text,'') ||
      r.payload::text || r.created_at::text || coalesce(r.tranche_id::text,''),
      'sha256'), 'hex');
    if r.hash <> expected or r.prev_hash is distinct from prev then return false; end if;
    prev := r.hash;
  end loop;
  return true;
end $$;

-- ---------- Machine d'états : niveau transaction ----------
-- La transaction ne porte plus le paiement : elle passe par IN_PROGRESS,
-- chaque tranche a son propre cycle. Les états PAID_LOCKED, SERVICE_CONFIRMED,
-- RELEASED, AWAITING_PAYMENT de tx_status sont désormais obsolètes (conservés
-- pour compatibilité).
insert into allowed_transitions(from_status,to_status,role,validator_only) values
 ('TOKEN_ISSUED','IN_PROGRESS','SYSTEM',false),
 ('IN_PROGRESS','CLOSED','SYSTEM',false),
 ('IN_PROGRESS','DISPUTED','PAYER',false),
 ('IN_PROGRESS','DISPUTED','PROVIDER',false)
on conflict do nothing;

-- ---------- Machine d'états : niveau tranche ----------
create table tranche_transitions (
  from_status    tranche_status not null,
  to_status      tranche_status not null,
  role           tx_role not null,
  validator_only boolean not null default false,
  primary key (from_status, to_status, role, validator_only)
);
insert into tranche_transitions values
 ('PLANNED','AWAITING_PAYMENT','SYSTEM',false),
 ('AWAITING_PAYMENT','PAID_LOCKED','SYSTEM',false),
 ('AWAITING_PAYMENT','EXPIRED','SYSTEM',false),
 ('AWAITING_PAYMENT','CANCELLED','PAYER',false),
 ('PAID_LOCKED','CONFIRMED','PROVIDER',false),
 ('PAID_LOCKED','CONFIRMED','PAYER',false),
 ('PAID_LOCKED','CONFIRMED','SYSTEM',false),
 ('PAID_LOCKED','EVIDENCE_SUBMITTED','PROVIDER',false),
 ('EVIDENCE_SUBMITTED','CONFIRMED','SYSTEM',true),
 ('EVIDENCE_SUBMITTED','PAID_LOCKED','SYSTEM',true),
 ('CONFIRMED','RELEASED','PAYER',false),
 ('CONFIRMED','RELEASED','SYSTEM',false);

create or replace function guard_tranche_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.via_transition', true),'off') <> 'on' then
    raise exception 'Le statut d''une tranche ne change que via les fonctions dédiées';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_tranche_status_trg before update on tranches
  for each row execute function guard_tranche_status();

-- ---------- Outils ----------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and platform_role = 'ADMIN');
$$;

-- Nombre de validateurs requis (1 ou 2)
create or replace function required_validations(p_tx uuid, p_tranche uuid default null)
returns int language plpgsql stable security definer set search_path = public as $$
declare t transactions; amt bigint; dual boolean; thr bigint;
begin
  select * into t from transactions where id = p_tx;
  amt := coalesce((select amount_minor from tranches where id = p_tranche), t.amount_minor);
  select dual_validation into dual from release_rules where vertical = t.vertical::text;
  select threshold_minor into thr from dual_thresholds where currency = t.currency;
  if coalesce(dual,false) or amt >= coalesce(thr, 9223372036854775807) then return 2; end if;
  return 1;
end $$;

-- Écriture centralisée d'un changement de statut de tranche + audit
-- (interne : non appelable par les clients)
create or replace function _set_tranche_status(
  p_tranche uuid, p_to tranche_status, p_actor uuid, p_event text,
  p_payload jsonb default '{}')
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; old tranche_status; open_count int; tx_status_now tx_status;
begin
  select * into tr from tranches where id = p_tranche for update;
  old := tr.status;
  perform set_config('app.via_transition','on', true);

  update tranches set
    status = p_to,
    contest_ends_at = case when p_to = 'CONFIRMED' and release_mode <> 'EVIDENCE_REVIEW'
                           then now() + make_interval(hours => contest_hours)
                           else contest_ends_at end,
    released_at = case when p_to = 'RELEASED' then now() else released_at end
  where id = p_tranche returning * into tr;

  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, p_actor, p_event,
          jsonb_build_object('tranche_from', old, 'tranche_to', p_to) || p_payload);

  if p_to = 'RELEASED' then
    insert into release_events(tx_id, tranche_id, trigger)
    values (tr.tx_id, tr.id, coalesce(p_payload->>'trigger','ADMIN'));
  end if;

  -- Clôture de la transaction quand toutes les tranches sont terminées
  if p_to in ('RELEASED','CANCELLED','EXPIRED') then
    select count(*) into open_count from tranches
      where tx_id = tr.tx_id and status not in ('RELEASED','CANCELLED','EXPIRED');
    select status into tx_status_now from transactions where id = tr.tx_id;
    if open_count = 0 and tx_status_now = 'IN_PROGRESS' then
      update transactions set status = 'CLOSED' where id = tr.tx_id;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status)
      values (tr.tx_id, p_actor, 'TX_CLOSED', 'IN_PROGRESS', 'CLOSED');
    end if;
  end if;
  return tr;
end $$;

-- Jeton simulé d'une tranche (le TrustEngine le signera pour de bon en phase 2)
create table signing_keys (
  kid        text primary key,
  public_key text not null,               -- Ed25519, base64 ; permet la vérification hors-ligne
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into signing_keys(kid, public_key) values ('SIMULATED','') on conflict do nothing;

create table tranche_tokens (
  tranche_id uuid primary key references tranches(id) on delete cascade,
  reference  text not null unique default encode(gen_random_bytes(9),'hex'),
  kid        text not null references signing_keys(kid),
  signature  text not null,
  simulated  boolean not null default true,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create or replace function _issue_tranche_token(p_tranche uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ttl int;
begin
  select value::int into ttl from app_config where key = 'token_ttl_days';
  insert into tranche_tokens(tranche_id, kid, signature, expires_at)
  values (p_tranche, 'SIMULATED', 'SIMULATED.' || encode(gen_random_bytes(16),'hex'),
          now() + make_interval(days => ttl))
  on conflict (tranche_id) do nothing;
end $$;

-- ---------- Création du plan de tranches ----------
create or replace function create_tranches(p_tx uuid, p_items jsonb)
returns setof tranches language plpgsql security definer set search_path = public as $$
declare t transactions; rule release_rules; it jsonb; n int := 0;
begin
  select * into t from transactions where id = p_tx;
  if not found then raise exception 'Transaction introuvable'; end if;
  if t.status not in ('DRAFT','REJECTED')
     or not (has_role(p_tx,'REQUESTER') or has_role(p_tx,'PAYER')) then
    raise exception 'Plan de paiement non modifiable';
  end if;
  select * into rule from release_rules where vertical = t.vertical::text;
  if not found then raise exception 'Aucune règle de déblocage pour %', t.vertical; end if;

  delete from tranches where tx_id = p_tx;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    insert into tranches(tx_id, seq, label, amount_minor, due_date, release_mode, contest_hours)
    values (p_tx, n, it->>'label', (it->>'amount_minor')::bigint,
            nullif(it->>'due_date','')::date, rule.release_mode, rule.contest_hours);
  end loop;
  return query select * from tranches where tx_id = p_tx order by seq;
end $$;

-- Génère N tranches égales (loyer récurrent, scolarité échelonnée)
create or replace function generate_recurring_tranches(
  p_tx uuid, p_freq recurrence_freq, p_n int, p_start date, p_label text default 'Échéance')
returns setof tranches language plpgsql security definer set search_path = public as $$
declare t transactions; base bigint; items jsonb := '[]'::jsonb; i int; step interval; amt bigint;
begin
  select * into t from transactions where id = p_tx;
  if not found then raise exception 'Transaction introuvable'; end if;
  step := case p_freq when 'WEEKLY' then interval '1 week'
                      when 'MONTHLY' then interval '1 month'
                      else interval '3 months' end;
  base := t.amount_minor / p_n;
  for i in 1..p_n loop
    amt := case when i = p_n then t.amount_minor - base * (p_n - 1) else base end;
    items := items || jsonb_build_object('label', p_label || ' ' || i,
              'amount_minor', amt, 'due_date', (p_start + step * (i-1))::date);
  end loop;
  insert into recurrence_plans(tx_id, frequency, installments, start_date)
  values (p_tx, p_freq, p_n, p_start)
  on conflict (tx_id) do update set frequency = excluded.frequency,
    installments = excluded.installments, start_date = excluded.start_date;
  return query select * from create_tranches(p_tx, items);
end $$;

-- ---------- transition_tx v0.2 (contrôle du plan avant soumission) ----------
create or replace function transition_tx(p_tx uuid, p_to tx_status, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ok boolean := false; r tx_role; old_status tx_status; total bigint;
begin
  select * into t from transactions where id = p_tx for update;
  if not found then raise exception 'Transaction introuvable'; end if;
  old_status := t.status;

  if exists (select 1 from allowed_transitions
             where from_status = t.status and to_status = p_to and validator_only) then
    ok := is_validator() and not is_party(p_tx);
  else
    foreach r in array array['PAYER','REQUESTER','PROVIDER']::tx_role[] loop
      if has_role(p_tx, r) and exists (select 1 from allowed_transitions
          where from_status = t.status and to_status = p_to and role = r) then
        ok := true;
      end if;
    end loop;
  end if;
  if not ok then raise exception 'Transition % -> % non autorisée', t.status, p_to; end if;

  if old_status = 'DRAFT' and p_to = 'SUBMITTED' then
    select sum(amount_minor) into total from tranches where tx_id = p_tx;
    if total is null then raise exception 'Au moins une tranche est requise'; end if;
    if total <> t.amount_minor then
      raise exception 'La somme des tranches (%) doit égaler le montant total (%)', total, t.amount_minor;
    end if;
    if not exists (select 1 from documents where tx_id = p_tx and tranche_id is null) then
      raise exception 'Au moins une pièce justificative est requise';
    end if;
  end if;

  perform set_config('app.via_transition','on', true);
  update transactions set status = p_to,
         reject_reason = case when p_to = 'REJECTED' then p_reason else reject_reason end
   where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'STATUS_CHANGE', old_status, p_to,
          jsonb_build_object('reason', p_reason));
  return t;
end $$;

-- ---------- Validation du dossier (double validation si requise) ----------
create or replace function decide_tx(p_tx uuid, p_approved boolean, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; need int; got int; since timestamptz;
begin
  if not is_validator() then raise exception 'Réservé aux validateurs'; end if;
  if is_party(p_tx) then raise exception 'Un validateur ne peut pas valider un dossier dont il est partie'; end if;
  select * into t from transactions where id = p_tx for update;
  if t.status <> 'IN_REVIEW' then raise exception 'Le dossier n''est pas en validation'; end if;

  select coalesce(max(created_at), '-infinity') into since from audit_log
    where tx_id = p_tx and to_status = 'SUBMITTED';
  if exists (select 1 from validations where tx_id = p_tx and tranche_id is null
             and validator_id = auth.uid() and decided_at >= since) then
    raise exception 'Vous avez déjà donné votre décision sur ce dossier';
  end if;

  insert into validations(tx_id, validator_id, approved, reason)
  values (p_tx, auth.uid(), p_approved, p_reason);

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

-- ---------- Transitions de tranche (utilisateurs) ----------
create or replace function transition_tranche(p_tranche uuid, p_to tranche_status, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; ok boolean := false; r tx_role; trig text;
begin
  select * into tr from tranches where id = p_tranche for update;
  if not found then raise exception 'Tranche introuvable'; end if;
  select * into t from transactions where id = tr.tx_id;
  if t.status <> 'IN_PROGRESS' then raise exception 'La transaction n''est pas active'; end if;

  foreach r in array array['PAYER','PROVIDER']::tx_role[] loop
    if has_role(tr.tx_id, r) and exists (select 1 from tranche_transitions
        where from_status = tr.status and to_status = p_to and role = r and not validator_only) then
      ok := true;
    end if;
  end loop;
  if not ok then raise exception 'Transition de tranche % -> % non autorisée', tr.status, p_to; end if;

  if tr.status = 'PAID_LOCKED' and p_to = 'CONFIRMED' then
    if not ((tr.release_mode = 'PROVIDER_CONFIRM' and has_role(tr.tx_id,'PROVIDER'))
         or (tr.release_mode = 'PAYER_CONFIRM'    and has_role(tr.tx_id,'PAYER'))) then
      raise exception 'Ce rôle ne peut pas confirmer cette tranche (mode %)', tr.release_mode;
    end if;
  end if;
  if tr.status = 'PAID_LOCKED' and p_to = 'EVIDENCE_SUBMITTED' then
    if tr.release_mode <> 'EVIDENCE_REVIEW' then raise exception 'Cette tranche ne requiert pas de preuve'; end if;
    if not exists (select 1 from documents where tranche_id = p_tranche) then
      raise exception 'Déposez au moins une pièce probante';
    end if;
  end if;
  if tr.status = 'CONFIRMED' and p_to = 'RELEASED' and not has_role(tr.tx_id,'PAYER') then
    raise exception 'Seul le payeur peut approuver le déblocage anticipé';
  end if;

  trig := case when p_to = 'RELEASED' then 'PAYER_APPROVAL' else null end;
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'TRANCHE_CHANGE',
           jsonb_build_object('reason', p_reason, 'trigger', trig));
end $$;

-- ---------- Validation d'une preuve (jalon) ----------
create or replace function decide_tranche(p_tranche uuid, p_approved boolean, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; need int; got int; since timestamptz;
begin
  if not is_validator() then raise exception 'Réservé aux validateurs'; end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found then raise exception 'Tranche introuvable'; end if;
  if is_party(tr.tx_id) then raise exception 'Un validateur ne peut pas valider une preuve d''un dossier dont il est partie'; end if;
  if tr.status <> 'EVIDENCE_SUBMITTED' then raise exception 'Aucune preuve en attente'; end if;

  select coalesce(max(created_at), '-infinity') into since from audit_log
    where tranche_id = p_tranche and payload->>'tranche_to' = 'EVIDENCE_SUBMITTED';
  if exists (select 1 from validations where tranche_id = p_tranche
             and validator_id = auth.uid() and decided_at >= since) then
    raise exception 'Vous avez déjà donné votre décision';
  end if;
  insert into validations(tx_id, tranche_id, validator_id, approved, reason)
  values (tr.tx_id, p_tranche, auth.uid(), p_approved, p_reason);

  if not p_approved then
    return _set_tranche_status(p_tranche, 'PAID_LOCKED', auth.uid(), 'EVIDENCE_REJECTED',
             jsonb_build_object('reason', p_reason));
  end if;

  need := required_validations(tr.tx_id, p_tranche);
  select count(distinct validator_id) into got from validations
    where tranche_id = p_tranche and approved and decided_at >= since;
  if got < need then
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
    values (tr.tx_id, p_tranche, auth.uid(), 'EVIDENCE_PARTIAL',
            jsonb_build_object('got', got, 'need', need));
    return tr;
  end if;

  perform _set_tranche_status(p_tranche, 'CONFIRMED', auth.uid(), 'EVIDENCE_APPROVED', '{}');
  return _set_tranche_status(p_tranche, 'RELEASED', auth.uid(), 'TRANCHE_RELEASED',
           jsonb_build_object('trigger','VALIDATOR_APPROVAL'));
end $$;

-- ---------- Scan eQR : confirmation par le prestataire (en ligne ou synchronisée) ----------
create or replace function resolve_tranche_reference(p_ref text)
returns table (tranche_id uuid, tx_id uuid, label text, amount_minor bigint, status tranche_status,
               expires_at timestamptz, used boolean)
language sql stable security definer set search_path = public as $$
  select tr.id, tr.tx_id, tr.label, tr.amount_minor, tr.status, k.expires_at, k.used_at is not null
  from tranche_tokens k join tranches tr on tr.id = k.tranche_id
  where k.reference = p_ref and is_party(tr.tx_id);
$$;

-- p_device_time : heure du téléphone au moment du scan hors-ligne
create or replace function confirm_by_reference(p_ref text, p_device_time timestamptz default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare k tranche_tokens; tr tranches; at_time timestamptz;
begin
  select * into k from tranche_tokens where reference = p_ref for update;
  if not found then raise exception 'Référence inconnue'; end if;
  select * into tr from tranches where id = k.tranche_id for update;
  if not has_role(tr.tx_id,'PROVIDER') then raise exception 'Réservé au prestataire'; end if;
  if tr.release_mode <> 'PROVIDER_CONFIRM' then raise exception 'Cette tranche ne se confirme pas par scan prestataire'; end if;
  if k.used_at is not null then raise exception 'Ce QR a déjà été utilisé'; end if;
  if tr.status <> 'PAID_LOCKED' then raise exception 'Tranche non payée ou déjà traitée (%)', tr.status; end if;

  at_time := coalesce(p_device_time, now());
  if at_time > now() + interval '5 minutes' then raise exception 'Heure de l''appareil invalide'; end if;
  if at_time > k.expires_at then raise exception 'QR expiré'; end if;

  update tranche_tokens set used_at = now() where tranche_id = k.tranche_id;
  return _set_tranche_status(tr.id, 'CONFIRMED', auth.uid(), 'PROVIDER_SCAN',
           jsonb_build_object('device_time', at_time, 'offline', p_device_time is not null));
end $$;

-- ---------- Litiges ----------
create table disputes (
  id           uuid primary key default gen_random_uuid(),
  tx_id        uuid not null references transactions(id) on delete cascade,
  tranche_id   uuid not null references tranches(id) on delete cascade,
  opened_by    uuid not null references profiles(id),
  reason       text not null check (length(reason) >= 10),
  status       text not null default 'OPEN' check (status in ('OPEN','RELEASED_TO_PROVIDER','REFUNDED_TO_PAYER')),
  resolution_note text,
  resolved_by  uuid references profiles(id),
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz
);
create unique index one_open_dispute_per_tranche on disputes(tranche_id) where status = 'OPEN';

create or replace function open_dispute(p_tranche uuid, p_reason text)
returns disputes language plpgsql security definer set search_path = public as $$
declare tr tranches; d disputes; is_payer boolean; is_provider boolean;
begin
  select * into tr from tranches where id = p_tranche for update;
  if not found then raise exception 'Tranche introuvable'; end if;
  is_payer := has_role(tr.tx_id,'PAYER');
  is_provider := has_role(tr.tx_id,'PROVIDER');
  if not (is_payer or is_provider) then raise exception 'Accès refusé'; end if;

  if tr.status in ('PAID_LOCKED','EVIDENCE_SUBMITTED') then
    null;
  elsif tr.status = 'CONFIRMED' and is_payer and tr.contest_ends_at is not null
        and now() <= tr.contest_ends_at then
    null;
  else
    raise exception 'Litige impossible dans l''état % (ou délai de contestation écoulé)', tr.status;
  end if;

  insert into disputes(tx_id, tranche_id, opened_by, reason)
  values (tr.tx_id, p_tranche, auth.uid(), p_reason) returning * into d;
  perform _set_tranche_status(p_tranche, 'DISPUTED', auth.uid(), 'DISPUTE_OPENED',
           jsonb_build_object('dispute_id', d.id));
  return d;
end $$;

create or replace function resolve_dispute(p_dispute uuid, p_outcome text, p_note text)
returns disputes language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  if not is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status <> 'OPEN' then raise exception 'Litige introuvable ou déjà clos'; end if;
  if is_party(d.tx_id) then raise exception 'Un administrateur partie au dossier ne peut pas trancher'; end if;
  if p_outcome not in ('RELEASE_TO_PROVIDER','REFUND_PAYER') then raise exception 'Issue invalide'; end if;

  if p_outcome = 'RELEASE_TO_PROVIDER' then
    perform _set_tranche_status(d.tranche_id, 'RELEASED', auth.uid(), 'DISPUTE_RESOLVED',
              jsonb_build_object('trigger','DISPUTE_RESOLUTION','outcome',p_outcome));
  else
    update payments set status = 'REFUNDED' where tranche_id = d.tranche_id and status = 'SUCCEEDED';
    perform _set_tranche_status(d.tranche_id, 'CANCELLED', auth.uid(), 'DISPUTE_RESOLVED',
              jsonb_build_object('outcome',p_outcome));
  end if;
  update disputes set
    status = case p_outcome when 'RELEASE_TO_PROVIDER' then 'RELEASED_TO_PROVIDER' else 'REFUNDED_TO_PAYER' end,
    resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now()
  where id = p_dispute returning * into d;
  return d;
end $$;

-- ---------- Tâches planifiées (service_role / pg_cron) ----------
create or replace function release_due_tranches() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from tranches
           where status = 'CONFIRMED' and release_mode <> 'EVIDENCE_REVIEW'
             and contest_ends_at <= now() loop
    perform _set_tranche_status(r.id, 'RELEASED', null, 'TRANCHE_RELEASED',
              jsonb_build_object('trigger','AUTO_TIMEOUT'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function activate_due_tranches() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; lead int;
begin
  select value::int into lead from app_config where key = 'activation_lead_days';
  for r in
    select tr.id from tranches tr join transactions t on t.id = tr.tx_id
    where t.status = 'IN_PROGRESS' and tr.status = 'PLANNED'
      and ( (tr.due_date is not null and tr.due_date <= current_date + lead)
         or (tr.due_date is null and not exists (
               select 1 from tranches p where p.tx_id = tr.tx_id and p.seq < tr.seq
                 and p.status <> 'RELEASED')) )
  loop
    perform _set_tranche_status(r.id, 'AWAITING_PAYMENT', null, 'TRANCHE_ACTIVATED', '{}');
    perform _issue_tranche_token(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
-- Exemple de planification (extension pg_cron activée dans Supabase) :
--   select cron.schedule('release-tranches','*/10 * * * *','select release_due_tranches()');
--   select cron.schedule('activate-tranches','0 6 * * *','select activate_due_tranches()');

-- ---------- Simulation (mock_mode uniquement) ----------
create or replace function simulate_tranche_system(p_tranche uuid, p_to tranche_status)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  if (select value from app_config where key = 'mock_mode') <> 'true' then
    raise exception 'Simulation désactivée';
  end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found then raise exception 'Tranche introuvable'; end if;
  if not is_party(tr.tx_id) and not is_validator() then raise exception 'Accès refusé'; end if;
  if not exists (select 1 from tranche_transitions
      where from_status = tr.status and to_status = p_to and role = 'SYSTEM' and not validator_only) then
    raise exception 'Transition système % -> % invalide', tr.status, p_to;
  end if;

  if p_to = 'AWAITING_PAYMENT' then perform _issue_tranche_token(p_tranche); end if;
  if p_to = 'PAID_LOCKED' then
    insert into payments(tx_id, tranche_id, provider, status)
    values (tr.tx_id, p_tranche, 'MOCK', 'SUCCEEDED');
  end if;
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'SYSTEM_SIMULATED',
           jsonb_build_object('trigger', case when p_to = 'RELEASED' then 'AUTO_TIMEOUT' end));
end $$;

-- ---------- RLS ----------
alter table release_rules       enable row level security;
alter table dual_thresholds     enable row level security;
alter table tranches            enable row level security;
alter table recurrence_plans    enable row level security;
alter table tranche_transitions enable row level security;
alter table signing_keys        enable row level security;
alter table tranche_tokens      enable row level security;
alter table disputes            enable row level security;

create policy rules_read      on release_rules   for select using (true);
create policy thresholds_read on dual_thresholds for select using (true);
create policy keys_read       on signing_keys    for select using (true);
create policy tranches_read   on tranches        for select using (is_party(tx_id) or is_validator());
create policy recur_read      on recurrence_plans for select using (is_party(tx_id) or is_validator());
create policy ttokens_read    on tranche_tokens  for select using (
  exists (select 1 from tranches tr where tr.id = tranche_id and is_party(tr.tx_id)
          and tr.status <> 'PLANNED'));
create policy disputes_read   on disputes        for select using (is_party(tx_id) or is_validator());

-- Preuves d'un jalon : déposées par le prestataire quand la tranche est payée
create policy docs_insert_evidence on documents for insert with check (
  uploaded_by = auth.uid() and tranche_id is not null
  and exists (select 1 from tranches tr where tr.id = tranche_id
              and tr.status = 'PAID_LOCKED' and has_role(tr.tx_id,'PROVIDER')));

-- Corrections v0.1 : seuls payeur et demandeur modifient un brouillon
drop policy if exists tx_update_draft on transactions;
create policy tx_update_draft on transactions for update
  using  (status in ('DRAFT','REJECTED') and (has_role(id,'REQUESTER') or has_role(id,'PAYER')))
  with check (status in ('DRAFT','REJECTED') and created_by = auth.uid());

-- ---------- Droits d'exécution ----------
-- Les fonctions ne sont appelables que par les utilisateurs connectés ;
-- les fonctions internes et planifiées sont réservées au service_role.
revoke all on function transition_tx, decide_tx, simulate_system_transition, resolve_reference
  from public, anon;
revoke all on function create_tranches, generate_recurring_tranches, transition_tranche,
  decide_tranche, resolve_tranche_reference, confirm_by_reference, open_dispute,
  resolve_dispute, simulate_tranche_system from public, anon;
grant execute on function create_tranches, generate_recurring_tranches, transition_tranche,
  decide_tranche, resolve_tranche_reference, confirm_by_reference, open_dispute,
  resolve_dispute, simulate_tranche_system to authenticated;
revoke all on function _set_tranche_status, _issue_tranche_token,
  release_due_tranches, activate_due_tranches from public, anon, authenticated;

alter publication supabase_realtime add table tranches, disputes;

-- Notes :
-- 1. Production : mock_mode = 'false', supprimer simulate_system_transition et
--    simulate_tranche_system ; le TrustEngine appelle les fonctions internes
--    (service_role) pour activer, payer et débloquer.
-- 2. signing_keys.public_key : renseigner la clé publique Ed25519 réelle pour
--    permettre à l'app prestataire de vérifier un eQR sans réseau.
-- 3. Amzara (tokenisation) et Adaptive Payment Routing : vague 3, tables à
--    définir avec les partenaires.
