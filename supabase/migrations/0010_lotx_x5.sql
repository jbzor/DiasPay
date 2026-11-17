-- =====================================================================
-- DiasPay : migration 0010 (lot X, passe 2, X5) — fondations des paiements (exigence 5.2), sans appeler le partenaire.
-- À appliquer SUR 0001 à 0009. Ne modifie aucune migration précédente.
-- Test : supabase/tests/04_lotx_p2.sql (partie X5). Plan de comptes et règles : docs/specs/ledger.md.
--
--  1. Tentatives de paiement (payment_attempts) : clé d’idempotence unique, au plus une tentative en cours ou réussie
--     par tranche ; start_payment rejoué avec la même clé renvoie la même tentative, sans nouveau paiement.
--  2. Événements du partenaire (webhook_events) : unicité (fournisseur, identifiant) ; apply_payment_event, réservée au
--     service, idempotente, tolérante à l’ordre inversé ; un événement à signature invalide est enregistré, jamais appliqué.
--  3. Journal financier à double entrée, miroir des mouvements du partenaire (DiasPay ne détient pas de fonds) :
--     ledger_accounts, ledger_journals, ledger_entries ; journal équilibré par devise, lignes immuables, écritures posées
--     par les fonctions du serveur seulement ; un remboursement est une contrepassation, jamais une modification.
--  4. Remboursements (refunds, request_refund) : jamais au-delà du montant payé, idempotents.
--  5. Rapprochement : vue v_reconciliation (personnel), qui signale tout écart.
--  6. Paiement simulé par le même chemin (demo_settle_payment, mock_mode) : aucun court-circuit.
-- =====================================================================

-- Fournisseur des nouvelles tentatives : 'SIMULATED' tant que TrustPayWay n’est pas branché.
insert into app_config(key, value) values ('payment_provider', 'SIMULATED') on conflict (key) do nothing;

-- ---------- X5.2 Tentatives de paiement ----------
create table if not exists payment_attempts (
  id              uuid primary key default gen_random_uuid(),
  tx_id           uuid not null references transactions(id) on delete cascade,
  tranche_id      uuid not null references tranches(id) on delete cascade,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  provider        text not null,
  method          text not null check (method in ('SIMULATED','MOBILE_MONEY','CARD','BANK_TRANSFER')),
  status          text not null default 'PENDING' check (status in ('PENDING','SUCCEEDED','FAILED')),
  amount_minor    bigint not null check (amount_minor > 0),
  currency        currency not null,
  provider_ref    text,
  error_code      text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);
-- Au plus une tentative en cours ou réussie par tranche.
create unique index if not exists payment_attempts_one_live on payment_attempts(tranche_id) where status in ('PENDING','SUCCEEDED');
create unique index if not exists payment_attempts_provider_ref on payment_attempts(provider, provider_ref) where provider_ref is not null;
create index if not exists payment_attempts_tx on payment_attempts(tx_id);

create table if not exists refunds (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references payment_attempts(id) on delete cascade,
  tx_id           uuid not null references transactions(id) on delete cascade,
  tranche_id      uuid not null references tranches(id) on delete cascade,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  amount_minor    bigint not null check (amount_minor > 0),
  currency        currency not null,
  status          text not null default 'PENDING' check (status in ('PENDING','SUCCEEDED','FAILED')),
  provider_ref    text,
  reason          text not null check (length(trim(reason)) >= 3),
  error_code      text,
  requested_by    uuid references profiles(id),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists refunds_attempt on refunds(attempt_id);

-- ---------- X5.3 Événements du partenaire ----------
create table if not exists webhook_events (
  id              bigint generated always as identity primary key,
  provider        text not null,
  event_id        text not null,
  signature_valid boolean not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  result          text check (result in ('APPLIED','IGNORED','REJECTED','INVALID_SIGNATURE')),
  error           text,
  attempt_id      uuid,   -- sans clé étrangère : l’événement survit à la réinitialisation de démonstration
  refund_id       uuid,
  unique (provider, event_id)
);
create index if not exists webhook_events_attempt on webhook_events(attempt_id);

-- Seuls les champs du traitement changent, une fois : l’événement reçu est immuable.
create or replace function _webhook_events_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then return old; end if;
    raise exception using errcode = 'P0001', message = 'webhook_events est en ajout seul', hint = 'LEDGER_IMMUTABLE';
  end if;
  if (new.provider, new.event_id, new.signature_valid, new.payload, new.received_at)
     is distinct from (old.provider, old.event_id, old.signature_valid, old.payload, old.received_at)
     or old.processed_at is not null then
    raise exception using errcode = 'P0001', message = 'Événement déjà traité ou contenu immuable', hint = 'LEDGER_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists webhook_events_guard on webhook_events;
create trigger webhook_events_guard before update or delete on webhook_events for each row execute function _webhook_events_guard();

-- ---------- X5.4 Journal financier à double entrée ----------
create table if not exists ledger_accounts (
  code     text primary key,
  kind     text not null check (kind in ('ASSET','LIABILITY','REVENUE')),
  label_fr text not null,
  label_en text not null
);
insert into ledger_accounts(code, kind, label_fr, label_en) values
 ('PARTNER_CASH',    'ASSET',     'Fonds chez le partenaire de paiement', 'Funds held by the payment partner'),
 ('DUE_TO_PROVIDER', 'LIABILITY', 'Dû aux prestataires',                   'Due to providers'),
 ('REFUNDS_PAYABLE', 'LIABILITY', 'Remboursements à effectuer',           'Refunds payable'),
 ('FEES',            'REVENUE',   'Frais',                                 'Fees')
on conflict (code) do nothing;

create table if not exists ledger_journals (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('PAYMENT','RELEASE','REFUND_REQUESTED','REFUND_SETTLED','REFUND_REVERSED')),
  tx_id               uuid not null references transactions(id) on delete cascade,
  tranche_id          uuid not null references tranches(id) on delete cascade,
  attempt_id          uuid references payment_attempts(id) on delete cascade,
  refund_id           uuid references refunds(id) on delete cascade,
  reverses_journal_id uuid references ledger_journals(id) on delete cascade,   -- contrepassation : journal d’origine
  event_id            bigint,                                                  -- événement du partenaire à l’origine
  memo                text,
  created_at          timestamptz not null default now()
);
create index if not exists ledger_journals_tranche on ledger_journals(tranche_id, kind);

create table if not exists ledger_entries (
  id           bigint generated always as identity primary key,
  journal_id   uuid not null references ledger_journals(id) on delete cascade,
  account_code text not null references ledger_accounts(code),
  currency     currency not null,
  debit_minor  bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  created_at   timestamptz not null default now(),
  check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0))
);
create index if not exists ledger_entries_journal on ledger_entries(journal_id);

-- Équilibre par devise, vérifié à la fin de la transaction (contrainte différée) : un journal a au moins deux lignes et,
-- pour chaque devise, autant de débits que de crédits.
create or replace function _ledger_check_balanced() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_journal uuid; v_lines int; v_bad int;
begin
  if tg_table_name = 'ledger_entries' then v_journal := new.journal_id; else v_journal := new.id; end if;
  if not exists (select 1 from ledger_journals where id = v_journal) then return null; end if;
  select count(*) into v_lines from ledger_entries where journal_id = v_journal;
  select count(*) into v_bad from (
    select currency from ledger_entries where journal_id = v_journal group by currency having sum(debit_minor) <> sum(credit_minor)) x;
  if v_lines < 2 or v_bad > 0 then
    raise exception using errcode = 'P0001', message = format('Journal %s déséquilibré (%s lignes)', v_journal, v_lines), hint = 'LEDGER_UNBALANCED';
  end if;
  return null;
end $$;
drop trigger if exists ledger_entries_balanced on ledger_entries;
create constraint trigger ledger_entries_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function _ledger_check_balanced();
drop trigger if exists ledger_journals_balanced on ledger_journals;
create constraint trigger ledger_journals_balanced after insert on ledger_journals
  deferrable initially deferred for each row execute function _ledger_check_balanced();

-- Lignes et journaux immuables : ni modification, ni suppression (sauf réinitialisation de démonstration, mock_mode).
create or replace function _ledger_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then return old; end if;
  raise exception using errcode = 'P0001', message = 'Le journal financier est en ajout seul : une correction est une contrepassation',
    hint = 'LEDGER_IMMUTABLE';
end $$;
drop trigger if exists ledger_journals_immutable on ledger_journals;
create trigger ledger_journals_immutable before update or delete on ledger_journals for each row execute function _ledger_immutable();
drop trigger if exists ledger_entries_immutable on ledger_entries;
create trigger ledger_entries_immutable before update or delete on ledger_entries for each row execute function _ledger_immutable();

-- Écriture d’un journal (interne) : p_lines = [{ "account": …, "debit": n } | { "account": …, "credit": n }] dans une devise.
create or replace function _post_journal(p_kind text, p_tranche uuid, p_currency currency, p_lines jsonb,
  p_attempt uuid default null, p_refund uuid default null, p_reverses uuid default null, p_event bigint default null, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tx uuid; l jsonb;
begin
  select tx_id into v_tx from tranches where id = p_tranche;
  insert into ledger_journals(kind, tx_id, tranche_id, attempt_id, refund_id, reverses_journal_id, event_id, memo)
  values (p_kind, v_tx, p_tranche, p_attempt, p_refund, p_reverses, p_event, p_memo) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'debit')::bigint, 0) > 0 or coalesce((l->>'credit')::bigint, 0) > 0 then
      insert into ledger_entries(journal_id, account_code, currency, debit_minor, credit_minor)
      values (v_id, l->>'account', p_currency, coalesce((l->>'debit')::bigint, 0), coalesce((l->>'credit')::bigint, 0));
    end if;
  end loop;
  return v_id;
end $$;

-- Montant déjà engagé en remboursement (demandé ou effectué) pour une tentative.
create or replace function _refunded(p_attempt uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_minor), 0)::bigint from refunds where attempt_id = p_attempt and status in ('PENDING','SUCCEEDED')
$$;

-- Déblocage d’une tranche payée par une tentative : le dû au prestataire sort des fonds du partenaire (versement).
create or replace function _ledger_on_release() returns trigger
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; v_amount bigint;
begin
  select * into a from payment_attempts where tranche_id = new.tranche_id and status = 'SUCCEEDED';
  if not found or exists (select 1 from ledger_journals where tranche_id = new.tranche_id and kind = 'RELEASE') then return new; end if;
  v_amount := a.amount_minor - _refunded(a.id);
  if v_amount > 0 then
    perform _post_journal('RELEASE', new.tranche_id, a.currency,
      jsonb_build_array(jsonb_build_object('account','DUE_TO_PROVIDER','debit',v_amount), jsonb_build_object('account','PARTNER_CASH','credit',v_amount)),
      a.id, null, (select id from ledger_journals where attempt_id = a.id and kind = 'PAYMENT' limit 1), null,
      'Déblocage : ' || coalesce(new.trigger, ''));
  end if;
  return new;
end $$;
drop trigger if exists ledger_on_release on release_events;
create trigger ledger_on_release after insert on release_events for each row execute function _ledger_on_release();

-- ---------- X5.2 Démarrage d’un paiement par le payeur ----------
create or replace function _attempt_json(a payment_attempts) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', a.id, 'trancheId', a.tranche_id, 'txId', a.tx_id, 'status', a.status, 'provider', a.provider,
    'method', a.method, 'amountMinor', a.amount_minor, 'currency', a.currency, 'providerRef', a.provider_ref, 'errorCode', a.error_code,
    'createdAt', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

-- Rejouer la même clé renvoie la même tentative (même résultat, aucun nouveau paiement). Une autre clé est refusée tant
-- qu’une tentative est en cours (PAYMENT_IN_PROGRESS) ou si la tranche n’est plus à payer (NOT_PAYABLE).
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
  if t.status <> 'IN_PROGRESS' then perform _err('TX_NOT_ACTIVE', 'La transaction n’est pas active'); end if;
  if exists (select 1 from payment_attempts where tranche_id = p_tranche and status = 'PENDING') then
    perform _err('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
  end if;
  if tr.status <> 'AWAITING_PAYMENT' then perform _err('NOT_PAYABLE', 'Cette tranche n’est pas à payer'); end if;
  if coalesce(p_method, '') not in ('SIMULATED','MOBILE_MONEY','CARD','BANK_TRANSFER') then perform _err('VALIDATION', 'Moyen de paiement inconnu'); end if;
  v_provider := coalesce((select value from app_config where key = 'payment_provider'), 'SIMULATED');
  insert into payment_attempts(tx_id, tranche_id, idempotency_key, provider, method, amount_minor, currency, provider_ref, created_by)
  values (tr.tx_id, tr.id, v_key, v_provider, p_method, tr.amount_minor, t.currency,
          case when v_provider = 'SIMULATED' then 'SIM-' || replace(gen_random_uuid()::text, '-', '') end, auth.uid())
  returning * into a;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'PAYMENT_STARTED', jsonb_build_object('attempt_id', a.id, 'method', a.method, 'provider', a.provider));
  return _attempt_json(a);
end $$;

-- ---------- X5.3 Application d’un événement du partenaire (service seulement) ----------
-- Traitement interne d’un événement enregistré. Résultat : APPLIED, IGNORED (déjà appliqué, ou état plus ancien reçu
-- après un état final : ordre inversé), REJECTED (incohérent : tentative inconnue, montant différent, état contradictoire).
create or replace function _process_payment_event(p_event bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e webhook_events; p jsonb; v_type text; a payment_attempts; r refunds; tr tranches; v_result text := 'APPLIED'; v_error text;
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
      if a.status = 'PENDING' then
        update payment_attempts set provider_ref = coalesce(provider_ref, p->>'providerRef'), updated_at = now() where id = a.id;
      else v_result := 'IGNORED'; v_error := 'STALE_EVENT'; end if;
    elsif v_type = 'PAYMENT_SUCCEEDED' then
      if a.status = 'SUCCEEDED' then v_result := 'IGNORED'; v_error := 'ALREADY_APPLIED';
      elsif a.status = 'FAILED' then v_result := 'REJECTED'; v_error := 'CONTRADICTS_FINAL_STATE';
      elsif (p->>'amountMinor')::bigint is distinct from a.amount_minor or (p->>'currency') is distinct from a.currency::text then
        v_result := 'REJECTED'; v_error := 'AMOUNT_MISMATCH';
      else
        v_fee := greatest(coalesce((p->>'feeMinor')::bigint, 0), 0);
        update payment_attempts set status = 'SUCCEEDED', provider_ref = coalesce(provider_ref, p->>'providerRef'), updated_at = now(),
               completed_at = now() where id = a.id returning * into a;
        insert into payments(tx_id, tranche_id, provider, external_id, status, fee_minor)
        select a.tx_id, a.tranche_id, a.provider, a.provider_ref, 'SUCCEEDED', v_fee
        where not exists (select 1 from payments where tranche_id = a.tranche_id and status = 'SUCCEEDED');
        -- Fonds reçus par le partenaire : dus au prestataire (et frais éventuels).
        v_journal := _post_journal('PAYMENT', a.tranche_id, a.currency, jsonb_build_array(
            jsonb_build_object('account','PARTNER_CASH','debit', a.amount_minor + v_fee),
            jsonb_build_object('account','DUE_TO_PROVIDER','credit', a.amount_minor),
            jsonb_build_object('account','FEES','credit', v_fee)), a.id, null, null, e.id, 'Paiement reçu par le partenaire');
        insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
        values (a.tx_id, a.tranche_id, null, 'PAYMENT_SUCCEEDED', jsonb_build_object('attempt_id', a.id, 'provider', a.provider));
        select * into tr from tranches where id = a.tranche_id for update;
        if tr.status = 'AWAITING_PAYMENT' and (select status from transactions where id = tr.tx_id) = 'IN_PROGRESS' then
          if tr.release_mode = 'IMMEDIATE' then
            perform _set_tranche_status(tr.id, 'RELEASED', null, 'DIRECT_PAYMENT', jsonb_build_object('trigger', 'DIRECT_PAYMENT', 'attempt_id', a.id));
          else
            perform _set_tranche_status(tr.id, 'PAID_LOCKED', null, 'PAYMENT_RECEIVED', jsonb_build_object('attempt_id', a.id));
          end if;
        else
          v_error := 'TRANCHE_NOT_AWAITING';   -- argent reçu, tranche plus à payer : le rapprochement le signale
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
        -- Remboursement versé par le partenaire : contrepassation des fonds reçus.
        perform _post_journal('REFUND_SETTLED', r.tranche_id, r.currency, jsonb_build_array(
            jsonb_build_object('account','REFUNDS_PAYABLE','debit', r.amount_minor),
            jsonb_build_object('account','PARTNER_CASH','credit', r.amount_minor)), a.id, r.id, v_journal, e.id, 'Remboursement versé au payeur');
        if (select coalesce(sum(amount_minor), 0) from refunds where attempt_id = a.id and status = 'SUCCEEDED') >= a.amount_minor then
          update payments set status = 'REFUNDED' where tranche_id = a.tranche_id and status = 'SUCCEEDED';
        end if;
      else
        update refunds set status = 'FAILED', completed_at = now(), error_code = coalesce(p->>'errorCode', 'DECLINED') where id = r.id returning * into r;
        -- Remboursement refusé : contrepassation de la demande, le montant redevient dû au prestataire.
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

-- Point d’entrée des événements du partenaire (fonction Edge ou TrustEngine, rôle service_role). La signature est vérifiée
-- par l’appelant (PaymentPort.verifyWebhook) ; un événement à signature invalide est enregistré, jamais appliqué.
-- Un événement déjà reçu (même fournisseur, même identifiant) renvoie DUPLICATE et le résultat d’origine.
create or replace function apply_payment_event(p_provider text, p_event_id text, p_signature_valid boolean, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; e webhook_events;
begin
  if coalesce(trim(p_provider), '') = '' or coalesce(trim(p_event_id), '') = '' or p_payload is null then
    perform _err('VALIDATION', 'Événement incomplet (fournisseur, identifiant, contenu)');
  end if;
  insert into webhook_events(provider, event_id, signature_valid, payload)
  values (trim(p_provider), trim(p_event_id), coalesce(p_signature_valid, false), p_payload)
  on conflict (provider, event_id) do nothing returning id into v_id;
  if v_id is null then
    select * into e from webhook_events where provider = trim(p_provider) and event_id = trim(p_event_id);
    return jsonb_strip_nulls(jsonb_build_object('eventId', e.event_id, 'result', 'DUPLICATE', 'original', e.result, 'error', e.error));
  end if;
  if not coalesce(p_signature_valid, false) then
    update webhook_events set processed_at = now(), result = 'INVALID_SIGNATURE' where id = v_id;
    return jsonb_build_object('eventId', trim(p_event_id), 'result', 'INVALID_SIGNATURE');
  end if;
  return _process_payment_event(v_id);
end $$;

-- ---------- X5.4 Remboursements ----------
-- Administrateur non partie (comme la décision d’un litige). Jamais au-delà du montant payé ; même clé : même remboursement.
-- Une tranche débloquée (fonds versés au prestataire) ne se rembourse pas par cette voie.
create or replace function request_refund(p_tranche uuid, p_amount_minor bigint, p_idempotency_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := trim(coalesce(p_idempotency_key, '')); a payment_attempts; r refunds; tr tranches;
begin
  perform _require_user();
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  if length(v_key) not between 8 and 200 then perform _err('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)'); end if;
  select * into r from refunds where idempotency_key = v_key;
  if found then
    if r.tranche_id <> p_tranche or r.amount_minor <> p_amount_minor then
      perform _err('IDEMPOTENCY_CONFLICT', 'Clé d’idempotence déjà utilisée pour un autre remboursement');
    end if;
    return jsonb_build_object('id', r.id, 'status', r.status, 'amountMinor', r.amount_minor, 'currency', r.currency);
  end if;
  select * into tr from tranches where id = p_tranche;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if is_party(tr.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas rembourser'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du remboursement obligatoire'); end if;
  select * into a from payment_attempts where tranche_id = p_tranche and status = 'SUCCEEDED' for update;
  if not found then perform _err('NOT_REFUNDABLE', 'Aucun paiement réussi pour cette tranche'); end if;
  if tr.status = 'RELEASED' then perform _err('NOT_REFUNDABLE', 'Tranche débloquée : les fonds ont été versés au prestataire'); end if;
  if p_amount_minor is null or p_amount_minor <= 0 then perform _err('AMOUNT_INVALID', 'Montant invalide'); end if;
  if _refunded(a.id) + p_amount_minor > a.amount_minor then
    perform _err('REFUND_EXCEEDS_PAID', format('Remboursement au-delà du montant payé (déjà engagé : %s, payé : %s)', _refunded(a.id), a.amount_minor),
                 json_build_object('refunded', _refunded(a.id), 'paid', a.amount_minor)::text);
  end if;
  insert into refunds(attempt_id, tx_id, tranche_id, idempotency_key, amount_minor, currency, reason, requested_by, provider_ref)
  values (a.id, a.tx_id, a.tranche_id, v_key, p_amount_minor, a.currency, trim(p_reason), auth.uid(),
          case when a.provider = 'SIMULATED' then 'SIMR-' || replace(gen_random_uuid()::text, '-', '') end)
  returning * into r;
  -- Contrepassation partielle du paiement : le montant n’est plus dû au prestataire, il est à rembourser.
  perform _post_journal('REFUND_REQUESTED', r.tranche_id, r.currency, jsonb_build_array(
      jsonb_build_object('account','DUE_TO_PROVIDER','debit', r.amount_minor),
      jsonb_build_object('account','REFUNDS_PAYABLE','credit', r.amount_minor)),
    a.id, r.id, (select id from ledger_journals where attempt_id = a.id and kind = 'PAYMENT' limit 1), null, trim(p_reason));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (r.tx_id, r.tranche_id, auth.uid(), 'REFUND_REQUESTED', jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor));
  return jsonb_build_object('id', r.id, 'status', r.status, 'amountMinor', r.amount_minor, 'currency', r.currency);
end $$;

-- ---------- X5.6 Paiement simulé par le même chemin (mock_mode) ----------
-- Le partenaire simulé « répond » par un événement, appliqué par apply_payment_event comme le serait celui de TrustPayWay.
create or replace function demo_settle_payment(p_attempt uuid, p_outcome text default 'SUCCEEDED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare a payment_attempts;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  select * into a from payment_attempts where id = p_attempt;
  if not found or not (is_party(a.tx_id) or is_validator()) then perform _err('PAYMENT_NOT_FOUND', 'Paiement introuvable'); end if;
  if p_outcome not in ('SUCCEEDED','FAILED') then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  return apply_payment_event(a.provider, 'sim-' || replace(gen_random_uuid()::text, '-', ''), true, jsonb_build_object(
    'type', 'PAYMENT_' || p_outcome, 'idempotencyKey', a.idempotency_key, 'providerRef', a.provider_ref,
    'amountMinor', a.amount_minor, 'currency', a.currency, 'errorCode', case when p_outcome = 'FAILED' then 'SIMULATED_DECLINE' end));
end $$;

create or replace function demo_settle_refund(p_refund uuid, p_outcome text default 'SUCCEEDED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r refunds;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  select * into r from refunds where id = p_refund;
  if not found then perform _err('NOT_FOUND', 'Remboursement introuvable'); end if;
  if p_outcome not in ('SUCCEEDED','FAILED') then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  return apply_payment_event((select provider from payment_attempts where id = r.attempt_id), 'simr-' || replace(gen_random_uuid()::text, '-', ''), true,
    jsonb_build_object('type', 'REFUND_' || p_outcome, 'refundKey', r.idempotency_key, 'providerRef', r.provider_ref, 'amountMinor', r.amount_minor,
                       'currency', r.currency));
end $$;

-- ---------- X5.5 Rapprochement ----------
-- Une ligne par tentative : tentative, événements du partenaire, écritures et état de la tranche ; « issues » liste les écarts.
create or replace view v_reconciliation with (security_invoker = true) as
select a.id as attempt_id, a.tranche_id, a.tx_id, _tx_ref(a.tx_id) as reference, a.provider, a.status as attempt_status,
       a.amount_minor, a.currency::text as currency, tr.status::text as tranche_status,
       x.success_events, x.paid_ledger, x.released_ledger, x.refunded_requested, x.refunded_settled, x.rejected_events,
       array_remove(array[
         case when a.status = 'SUCCEEDED' and x.success_events = 0 then 'SUCCEEDED_WITHOUT_EVENT' end,
         case when a.status = 'SUCCEEDED' and x.paid_ledger = 0 then 'SUCCEEDED_WITHOUT_LEDGER' end,
         case when a.status <> 'SUCCEEDED' and x.paid_ledger > 0 then 'LEDGER_WITHOUT_SUCCESS' end,
         case when a.status = 'SUCCEEDED' and x.paid_ledger > 0 and x.paid_ledger <> a.amount_minor then 'LEDGER_AMOUNT_MISMATCH' end,
         case when a.status = 'SUCCEEDED' and tr.status in ('PLANNED','AWAITING_PAYMENT','INFO_REQUESTED','REJECTED','EXPIRED') then 'TRANCHE_NOT_PAID' end,
         case when a.status <> 'SUCCEEDED' and tr.status in ('PAID_LOCKED','EVIDENCE_SUBMITTED','CONFIRMED','RELEASED','DISPUTED')
                   and not exists (select 1 from payment_attempts o where o.tranche_id = a.tranche_id and o.status = 'SUCCEEDED')
                   and x.succeeded_payments = 0 then 'PAID_WITHOUT_ATTEMPT' end,
         case when a.status = 'SUCCEEDED' and tr.status = 'RELEASED' and x.released_ledger = 0 and a.amount_minor > x.refunded_requested then 'RELEASED_NOT_IN_LEDGER' end,
         case when a.status = 'SUCCEEDED' and tr.status = 'CANCELLED' and x.refunded_settled < a.amount_minor then 'CANCELLED_NOT_REFUNDED' end,
         case when a.status = 'SUCCEEDED' and x.refunded_settled >= a.amount_minor and tr.status not in ('CANCELLED','REJECTED','EXPIRED')
              then 'REFUNDED_TRANCHE_OPEN' end,
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

-- ---------- RLS et droits (X5) ----------
alter table payment_attempts enable row level security;
alter table refunds          enable row level security;
alter table webhook_events   enable row level security;
alter table ledger_accounts  enable row level security;
alter table ledger_journals  enable row level security;
alter table ledger_entries   enable row level security;
drop policy if exists payment_attempts_read on payment_attempts;
create policy payment_attempts_read on payment_attempts for select using (is_party(tx_id) or is_validator());
drop policy if exists refunds_read on refunds;
create policy refunds_read on refunds for select using (is_party(tx_id) or is_validator());
drop policy if exists webhook_events_staff_read on webhook_events;
create policy webhook_events_staff_read on webhook_events for select using (is_validator());
drop policy if exists ledger_accounts_read on ledger_accounts;
create policy ledger_accounts_read on ledger_accounts for select using (is_validator());
drop policy if exists ledger_journals_staff_read on ledger_journals;
create policy ledger_journals_staff_read on ledger_journals for select using (is_validator());
drop policy if exists ledger_entries_staff_read on ledger_entries;
create policy ledger_entries_staff_read on ledger_entries for select using (is_validator());
-- Écritures par les fonctions du serveur seulement.
revoke all on payment_attempts, refunds, webhook_events, ledger_accounts, ledger_journals, ledger_entries from anon;
revoke insert, update, delete on payment_attempts, refunds, webhook_events, ledger_accounts, ledger_journals, ledger_entries from authenticated;
grant select on payment_attempts, refunds, webhook_events, ledger_accounts, ledger_journals, ledger_entries to authenticated;
revoke all on v_reconciliation from public, anon;
grant select on v_reconciliation to authenticated;

revoke all on function _webhook_events_guard(), _ledger_check_balanced(), _ledger_immutable(), _post_journal(text, uuid, currency, jsonb, uuid, uuid, uuid, bigint, text),
  _refunded(uuid), _ledger_on_release(), _attempt_json(payment_attempts), _process_payment_event(bigint) from public, anon, authenticated;
-- Réservée au service (fonction Edge, TrustEngine) : ni anon ni authenticated.
revoke all on function apply_payment_event(text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function apply_payment_event(text, text, boolean, jsonb) to service_role;
revoke all on function start_payment(uuid, text, text), request_refund(uuid, bigint, text, text), demo_settle_payment(uuid, text),
  demo_settle_refund(uuid, text) from public, anon;
grant execute on function start_payment(uuid, text, text), request_refund(uuid, bigint, text, text), demo_settle_payment(uuid, text),
  demo_settle_refund(uuid, text) to authenticated;
-- La vue de rapprochement évalue _tx_ref (déjà accordée à authenticated, lot 5).
