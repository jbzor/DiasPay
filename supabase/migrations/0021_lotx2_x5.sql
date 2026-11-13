-- =====================================================================
-- DiasPay : migration 0021 (lot X version 2, X5) — paiements, devises, remboursements (K7, K9, K10, K12).
-- À appliquer SUR 0001 à 0020. Test : supabase/tests/06_lotx2_p2.sql (partie X5).
-- Reprend les fondations de 0010 (tentatives, événements, journal, rapprochement), alignées sur le modèle cible :
--
--  1. Statuts de tentative du modèle cible (3.3) : INITIATED → PENDING → CONFIRMED ou FAILED, uniquement par des
--     événements du partenaire (ou du simulateur) ; anciens SUCCEEDED convertis en CONFIRMED.
--     Statuts de remboursement : REQUESTED, EXECUTED, FAILED (anciens PENDING, SUCCEEDED convertis).
--  2. contributions (K9) : une demande est payée quand la somme des contributions confirmées atteint son montant cible ;
--     en phase 1, une seule contribution du montant total, créée à l’acceptation. Tentatives rattachées à une contribution.
--  3. fx_quotes (K10) : devis demandé avant l’autorisation (get_quote), figé jusqu’à son expiration, conservé avec le
--     paiement : devises, taux, source, horodatage, frais par poste (service, change, moyen de paiement), total débité.
--     Devise canonique : celle de la demande. Partenaire sans devis : le simulateur le fait et le marque simulated.
--     Durée de vie (fx_quote_ttl_seconds), taux simulés et barème des frais : réglages (points ouverts 7 à 9).
--  4. accept_and_pay(p_request, p_idempotency_key, p_quote_id) : droits, suspension, devis valide, plafond du niveau
--     (_check_payer_limits, 0020) ; demande ACCEPTED, contribution et tentative INITIATED. start_payment devient un
--     raccourci (devis dans la devise de la demande, puis accept_and_pay), gardé pour les écrans existants.
--  5. Remboursements : statut REQUESTED à la demande, EXECUTED par l’événement du partenaire ou, pour le pilote, par
--     mark_refund_executed(p_refund, p_partner_ref) (administrateur, exécution manuelle) ; contrepassation automatique.
--  6. Journal : les frais (devise débitée) sont des lignes du journal PAYMENT ; équilibre par devise inchangé.
--  7. v_reconciliation : mêmes onze codes, statuts v2.
-- =====================================================================

-- ---------- X5.1 Statuts du modèle cible ----------
alter table payment_attempts drop constraint if exists payment_attempts_status_check;
drop index if exists payment_attempts_one_live;
update payment_attempts set status = 'CONFIRMED' where status = 'SUCCEEDED';
alter table payment_attempts alter column status set default 'INITIATED';
alter table payment_attempts add constraint payment_attempts_status_check check (status in ('INITIATED','PENDING','CONFIRMED','FAILED'));
create unique index payment_attempts_one_live on payment_attempts(tranche_id) where status in ('INITIATED','PENDING','CONFIRMED');

alter table refunds drop constraint if exists refunds_status_check;
update refunds set status = case status when 'PENDING' then 'REQUESTED' when 'SUCCEEDED' then 'EXECUTED' else status end;
alter table refunds alter column status set default 'REQUESTED';
alter table refunds add constraint refunds_status_check check (status in ('REQUESTED','EXECUTED','FAILED'));
alter table refunds add column if not exists executed_by uuid references profiles(id);

-- ---------- X5.3 Devis ----------
create table if not exists fx_quotes (
  id                   uuid primary key default gen_random_uuid(),
  tx_id                uuid not null references transactions(id) on delete cascade,
  tranche_id           uuid not null references tranches(id) on delete cascade,
  payer_id             uuid not null references profiles(id),
  request_currency     currency not null,
  request_amount_minor bigint not null check (request_amount_minor > 0),
  debit_currency       currency not null,
  rate                 numeric not null check (rate > 0),          -- unités de la devise débitée pour 1 unité de la devise de la demande
  source               text not null,                              -- IDENTITY (même devise), SIMULATED, ou le partenaire
  simulated            boolean not null,
  method               text not null check (method in ('SIMULATED','MOBILE_MONEY','CARD','BANK_TRANSFER')),
  debit_amount_minor   bigint not null check (debit_amount_minor > 0),
  fee_service_minor    bigint not null default 0 check (fee_service_minor >= 0),
  fee_fx_minor         bigint not null default 0 check (fee_fx_minor >= 0),
  fee_method_minor     bigint not null default 0 check (fee_method_minor >= 0),
  total_debit_minor    bigint not null,
  quoted_at            timestamptz not null default now(),
  expires_at           timestamptz not null,
  used_at              timestamptz,
  attempt_id           uuid references payment_attempts(id) on delete set null,
  check (total_debit_minor = debit_amount_minor + fee_service_minor + fee_fx_minor + fee_method_minor),
  check (expires_at > quoted_at)
);
create index if not exists fx_quotes_tranche on fx_quotes(tranche_id, quoted_at);
alter table fx_quotes enable row level security;
drop policy if exists fx_quotes_read on fx_quotes;
create policy fx_quotes_read on fx_quotes for select using (payer_id = auth.uid() or is_validator());
revoke all on fx_quotes from anon;
revoke insert, update, delete on fx_quotes from authenticated;
grant select on fx_quotes to authenticated;

-- Un devis ne change jamais (figé) ; seule sa consommation (used_at, attempt_id) est posée, une fois.
create or replace function _fx_quotes_frozen() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from tranches where id = old.tranche_id) then return old; end if;   -- cascade
    raise exception using errcode = 'P0001', message = 'Devis conservé avec le paiement', hint = 'QUOTE_FROZEN';
  end if;
  if (to_jsonb(new) - 'used_at' - 'attempt_id') is distinct from (to_jsonb(old) - 'used_at' - 'attempt_id')
     or (old.used_at is not null and new.used_at is distinct from old.used_at) then
    raise exception using errcode = 'P0001', message = 'Devis figé', hint = 'QUOTE_FROZEN';
  end if;
  return new;
end $$;
drop trigger if exists fx_quotes_frozen on fx_quotes;
create trigger fx_quotes_frozen before update or delete on fx_quotes for each row execute function _fx_quotes_frozen();

do $$ begin
  if _mock_mode() then
    -- DÉVELOPPEMENT : durée de vie d’un devis, et parité fixe EUR/XAF (franc CFA) pour le devis simulé. Aucun autre taux.
    insert into app_config(key, value) values ('fx_quote_ttl_seconds', '300') on conflict (key) do nothing;
    insert into app_config(key, value) values ('simulated_fx_rates', '{"EUR/XAF": "655.957"}') on conflict (key) do nothing;
  end if;
end $$;

create or replace function _currency_decimals(p_currency currency) returns int language sql immutable as $$
  select case p_currency::text when 'XAF' then 0 else 2 end
$$;

-- Frais par poste (domaine : computeFees) : barème app_config.fee_schedule (JSON : serviceBps, fxBps, methodBps par moyen),
-- point ouvert 9 ; absent : aucun frais. Arrondi au supérieur, en unités mineures de la devise débitée.
create or replace function _quote_fees(p_debit_minor bigint, p_method text, p_cross boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := coalesce((select value::jsonb from app_config where key = 'fee_schedule'), '{}'::jsonb);
        v_service int; v_fx int; v_method int;
begin
  v_service := coalesce((s->>'serviceBps')::int, 0);
  v_fx := case when p_cross then coalesce((s->>'fxBps')::int, 0) else 0 end;
  v_method := coalesce((s->'methodBps'->>p_method)::int, 0);
  return jsonb_build_object('service', ceil(p_debit_minor * v_service / 10000.0)::bigint,
                            'fx', ceil(p_debit_minor * v_fx / 10000.0)::bigint,
                            'method', ceil(p_debit_minor * v_method / 10000.0)::bigint);
end $$;

create or replace function _quote_json(q fx_quotes) returns jsonb language sql stable as $$
  select jsonb_build_object('id', q.id, 'trancheId', q.tranche_id, 'requestCurrency', q.request_currency, 'requestAmountMinor', q.request_amount_minor,
    'debitCurrency', q.debit_currency, 'rate', q.rate::text, 'source', q.source, 'simulated', q.simulated, 'method', q.method,
    'debitAmountMinor', q.debit_amount_minor,
    'fees', jsonb_build_object('serviceMinor', q.fee_service_minor, 'fxMinor', q.fee_fx_minor, 'methodMinor', q.fee_method_minor),
    'totalDebitMinor', q.total_debit_minor,
    'quotedAt', to_char(q.quoted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(q.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

-- Payeur : devis pour une demande à payer (aucun paiement). Montant converti arrondi au supérieur (le payeur couvre
-- toujours le montant de la demande).
create or replace function get_quote(p_request uuid, p_debit_currency text default null, p_method text default 'SIMULATED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; v_ttl int; v_debit currency; v_rate numeric; v_source text; v_sim boolean; v_debit_minor bigint;
        v_rates jsonb; v_pair text; v_fees jsonb; v_provider text; q fx_quotes;
begin
  perform _require_user();
  select * into tr from tranches where id = p_request;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  select * into t from transactions where id = tr.tx_id;
  if tr.on_hold then perform _err('REQUEST_ON_HOLD', 'Demande suspendue par un litige'); end if;
  if t.status <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  if exists (select 1 from payment_attempts where tranche_id = p_request and status in ('INITIATED','PENDING')) then
    perform _err('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
  end if;
  if tr.status <> 'SUBMITTED' then perform _err('NOT_PAYABLE', 'Cette demande n’est pas à payer'); end if;
  if coalesce(p_method, '') not in ('SIMULATED','MOBILE_MONEY','CARD','BANK_TRANSFER') then perform _err('VALIDATION', 'Moyen de paiement inconnu'); end if;
  if p_debit_currency is not null and p_debit_currency not in ('XAF','EUR','USD') then perform _err('VALIDATION', 'Devise inconnue'); end if;
  v_ttl := (select value::int from app_config where key = 'fx_quote_ttl_seconds');
  if v_ttl is null or v_ttl <= 0 then perform _err('NOT_CONFIGURED', 'Durée de vie des devis non configurée'); end if;
  v_debit := coalesce(p_debit_currency, t.currency::text)::currency;
  v_provider := coalesce((select value from app_config where key = 'payment_provider'), 'SIMULATED');
  if v_debit = t.currency then
    v_rate := 1; v_source := 'IDENTITY'; v_sim := v_provider = 'SIMULATED';
    v_debit_minor := tr.amount_minor;
  else
    -- Le partenaire réel ne fournit pas encore de devis (point ouvert 7) : seul le simulateur cote, et le marque.
    if v_provider <> 'SIMULATED' then perform _err('QUOTE_UNAVAILABLE', 'Cotation indisponible pour ces devises'); end if;
    v_rates := coalesce((select value::jsonb from app_config where key = 'simulated_fx_rates'), '{}'::jsonb);
    v_pair := v_debit::text || '/' || t.currency::text;              -- 1 unité débitée = x unités de la demande
    if v_rates ? v_pair then v_rate := 1 / (v_rates->>v_pair)::numeric;
    elsif v_rates ? (t.currency::text || '/' || v_debit::text) then v_rate := (v_rates->>(t.currency::text || '/' || v_debit::text))::numeric;
    else perform _err('QUOTE_UNAVAILABLE', 'Cotation indisponible pour ces devises'); end if;
    v_source := 'SIMULATED'; v_sim := true;
    -- Conversion exacte puis arrondi au supérieur (domaine : convertMinor).
    if v_rates ? v_pair then
      v_debit_minor := ceil(tr.amount_minor * power(10::numeric, _currency_decimals(v_debit))
                            / (power(10::numeric, _currency_decimals(t.currency)) * (v_rates->>v_pair)::numeric))::bigint;
    else
      v_debit_minor := ceil(tr.amount_minor * power(10::numeric, _currency_decimals(v_debit)) * v_rate
                            / power(10::numeric, _currency_decimals(t.currency)))::bigint;
    end if;
    v_rate := round(v_rate, 12);
  end if;
  v_fees := _quote_fees(v_debit_minor, p_method, v_debit <> t.currency);
  insert into fx_quotes(tx_id, tranche_id, payer_id, request_currency, request_amount_minor, debit_currency, rate, source, simulated, method,
                        debit_amount_minor, fee_service_minor, fee_fx_minor, fee_method_minor, total_debit_minor, expires_at)
  values (t.id, tr.id, auth.uid(), t.currency, tr.amount_minor, v_debit, v_rate, v_source, v_sim, p_method, v_debit_minor,
          (v_fees->>'service')::bigint, (v_fees->>'fx')::bigint, (v_fees->>'method')::bigint,
          v_debit_minor + (v_fees->>'service')::bigint + (v_fees->>'fx')::bigint + (v_fees->>'method')::bigint,
          now() + make_interval(secs => v_ttl))
  returning * into q;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (t.id, tr.id, auth.uid(), 'QUOTE_ISSUED', jsonb_build_object('quote_id', q.id, 'debit_currency', q.debit_currency,
          'total_debit_minor', q.total_debit_minor, 'source', q.source, 'simulated', q.simulated));
  return _quote_json(q);
end $$;

-- ---------- X5.2 Contributions et tentatives ----------
create table if not exists contributions (
  id           uuid primary key default gen_random_uuid(),
  tx_id        uuid not null references transactions(id) on delete cascade,
  tranche_id   uuid not null references tranches(id) on delete cascade,
  payer_id     uuid references profiles(id),
  invited_phone text,
  amount_minor bigint not null check (amount_minor > 0),
  currency     currency not null,
  status       text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','FAILED','REFUNDED')),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  check (payer_id is not null or invited_phone is not null)
);
create unique index if not exists contributions_one_live on contributions(tranche_id, payer_id) where status in ('PENDING','CONFIRMED');
create index if not exists contributions_tranche on contributions(tranche_id);
alter table contributions enable row level security;
drop policy if exists contributions_read on contributions;
create policy contributions_read on contributions for select using (is_party(tx_id) or is_validator());
revoke all on contributions from anon;
revoke insert, update, delete on contributions from authenticated;
grant select on contributions to authenticated;

alter table payment_attempts add column if not exists contribution_id uuid references contributions(id) on delete cascade;
alter table payment_attempts add column if not exists quote_id uuid references fx_quotes(id);
alter table payment_attempts add column if not exists debit_currency currency;
alter table payment_attempts add column if not exists debit_amount_minor bigint;
alter table payment_attempts add column if not exists fees_minor bigint not null default 0 check (fees_minor >= 0);

-- Tentatives existantes (développement) : une contribution chacune, statut correspondant.
insert into contributions(id, tx_id, tranche_id, payer_id, amount_minor, currency, status, created_at, confirmed_at)
select a.id, a.tx_id, a.tranche_id, a.created_by, a.amount_minor, a.currency,
       case a.status when 'CONFIRMED' then (case when coalesce((select sum(amount_minor) from refunds f where f.attempt_id = a.id and f.status = 'EXECUTED'), 0) >= a.amount_minor
                                                 then 'REFUNDED' else 'CONFIRMED' end)
                     when 'FAILED' then 'FAILED' else 'PENDING' end,
       a.created_at, case when a.status = 'CONFIRMED' then a.completed_at end
  from payment_attempts a where a.contribution_id is null and a.created_by is not null
on conflict (id) do nothing;
update payment_attempts a set contribution_id = a.id, debit_currency = a.currency, debit_amount_minor = a.amount_minor
 where a.contribution_id is null and exists (select 1 from contributions c where c.id = a.id);
create unique index if not exists payment_attempts_contribution_live on payment_attempts(contribution_id) where status in ('INITIATED','PENDING','CONFIRMED');

create or replace function _attempt_json(a payment_attempts) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', a.id, 'trancheId', a.tranche_id, 'txId', a.tx_id, 'status', a.status, 'provider', a.provider,
    'method', a.method, 'amountMinor', a.amount_minor, 'currency', a.currency, 'providerRef', a.provider_ref, 'errorCode', a.error_code,
    'contributionId', a.contribution_id, 'quoteId', a.quote_id, 'debitCurrency', a.debit_currency, 'debitAmountMinor', a.debit_amount_minor,
    'feesMinor', a.fees_minor, 'createdAt', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
$$;

-- ---------- X5.4 Accepter et payer ----------
create or replace function accept_and_pay(p_request uuid, p_idempotency_key text, p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := trim(coalesce(p_idempotency_key, '')); a payment_attempts; tr tranches; t transactions; q fx_quotes; c contributions;
        v_provider text; v_due bigint;
begin
  perform _require_user();
  if length(v_key) not between 8 and 200 then perform _err('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)'); end if;
  -- Rejeu de la même clé : même résultat, sans nouveau paiement (avant tout autre contrôle).
  select * into a from payment_attempts where idempotency_key = v_key;
  if found then
    if a.tranche_id <> p_request or a.created_by is distinct from auth.uid() then
      perform _err('IDEMPOTENCY_CONFLICT', 'Clé d’idempotence déjà utilisée pour un autre paiement');
    end if;
    return _attempt_json(a);
  end if;
  select * into tr from tranches where id = p_request for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  select * into t from transactions where id = tr.tx_id;
  if tr.on_hold then perform _err('REQUEST_ON_HOLD', 'Demande suspendue par un litige'); end if;
  if t.status <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  if exists (select 1 from payment_attempts where tranche_id = p_request and status in ('INITIATED','PENDING')) then
    perform _err('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette tranche');
  end if;
  if tr.status <> 'SUBMITTED' then perform _err('NOT_PAYABLE', 'Cette demande n’est pas à payer'); end if;
  -- Devis : du payeur, pour cette demande et ce montant, non utilisé, non expiré.
  select * into q from fx_quotes where id = p_quote_id for update;
  if not found or q.tranche_id <> tr.id or q.payer_id <> auth.uid() or q.request_amount_minor <> tr.amount_minor or q.request_currency <> t.currency then
    perform _err('QUOTE_INVALID', 'Devis inconnu ou d’une autre demande');
  end if;
  if q.used_at is not null then perform _err('QUOTE_USED', 'Devis déjà utilisé'); end if;
  if q.expires_at <= now() then perform _err('QUOTE_EXPIRED', 'Devis expiré : demandez-en un nouveau'); end if;
  -- Plafond du niveau d’enrôlement du payeur (0020), dans la devise de la demande.
  v_due := tr.amount_minor - coalesce((select sum(amount_minor) from contributions where tranche_id = tr.id and status = 'CONFIRMED'), 0);
  perform _check_payer_limits(auth.uid(), t.currency, v_due);

  insert into contributions(tx_id, tranche_id, payer_id, amount_minor, currency)
  values (t.id, tr.id, auth.uid(), v_due, t.currency) returning * into c;
  v_provider := coalesce((select value from app_config where key = 'payment_provider'), 'SIMULATED');
  insert into payment_attempts(tx_id, tranche_id, contribution_id, quote_id, idempotency_key, provider, method, status, amount_minor, currency,
                               debit_currency, debit_amount_minor, fees_minor, provider_ref, created_by)
  values (t.id, tr.id, c.id, q.id, v_key, v_provider, q.method, 'INITIATED', v_due, t.currency,
          q.debit_currency, q.debit_amount_minor, q.total_debit_minor - q.debit_amount_minor,
          case when v_provider = 'SIMULATED' then 'SIM-' || replace(gen_random_uuid()::text, '-', '') end, auth.uid())
  returning * into a;
  update fx_quotes set used_at = now(), attempt_id = a.id where id = q.id;
  perform _set_tranche_status(tr.id, 'ACCEPTED', auth.uid(), 'REQUEST_ACCEPTED', jsonb_build_object('attempt_id', a.id));
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'PAYMENT_STARTED', jsonb_build_object('attempt_id', a.id, 'method', a.method, 'provider', a.provider,
          'quote_id', q.id, 'debit_currency', q.debit_currency, 'total_debit_minor', q.total_debit_minor));
  return _attempt_json(a);
end $$;

-- Raccourci des écrans existants (lot 2) : devis dans la devise de la demande, puis accept_and_pay. Même idempotence.
create or replace function start_payment(p_tranche uuid, p_idempotency_key text, p_method text default 'SIMULATED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := trim(coalesce(p_idempotency_key, '')); q jsonb;
begin
  perform _require_user();
  if length(v_key) between 8 and 200 and exists (select 1 from payment_attempts where idempotency_key = v_key) then
    return accept_and_pay(p_tranche, v_key, null);
  end if;
  if length(v_key) not between 8 and 200 then perform _err('VALIDATION', 'Clé d’idempotence invalide (8 à 200 caractères)'); end if;
  q := get_quote(p_tranche, null, p_method);
  return accept_and_pay(p_tranche, v_key, (q->>'id')::uuid);
end $$;

-- ---------- Journal : lignes en devise propre (frais dans la devise débitée) ----------
create or replace function _post_journal(p_kind text, p_tranche uuid, p_currency currency, p_lines jsonb, p_attempt uuid default null,
  p_refund uuid default null, p_reverses uuid default null, p_event bigint default null, p_memo text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tx uuid; l jsonb;
begin
  select tx_id into v_tx from tranches where id = p_tranche;
  insert into ledger_journals(kind, tx_id, tranche_id, attempt_id, refund_id, reverses_journal_id, event_id, memo)
  values (p_kind, v_tx, p_tranche, p_attempt, p_refund, p_reverses, p_event, p_memo) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'debit')::bigint, 0) > 0 or coalesce((l->>'credit')::bigint, 0) > 0 then
      insert into ledger_entries(journal_id, account_code, currency, debit_minor, credit_minor)
      values (v_id, l->>'account', coalesce((l->>'currency')::currency, p_currency), coalesce((l->>'debit')::bigint, 0), coalesce((l->>'credit')::bigint, 0));
    end if;
  end loop;
  return v_id;
end $$;

-- ---------- X5.5 Remboursements ----------
create or replace function _refunded(p_attempt uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_minor), 0)::bigint from refunds where attempt_id = p_attempt and status in ('REQUESTED','EXECUTED')
$$;

create or replace function _create_refund(p_tranche uuid, p_amount_minor bigint, p_key text, p_reason text, p_actor uuid) returns refunds
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; r refunds; tr tranches;
begin
  select * into tr from tranches where id = p_tranche;
  select * into a from payment_attempts where tranche_id = p_tranche and status = 'CONFIRMED' for update;
  if not found then perform _err('NOT_REFUNDABLE', 'Aucun paiement confirmé pour cette demande'); end if;
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

-- Exécution d’un remboursement (événement du partenaire, ou saisie manuelle pour le pilote) : contrepassation, demande
-- REFUNDED (partiel ou total), contribution remboursée quand tout est rendu.
create or replace function _refund_executed(p_refund uuid, p_partner_ref text, p_event bigint, p_actor uuid) returns refunds
language plpgsql security definer set search_path = public as $$
declare r refunds; a payment_attempts;
begin
  update refunds set status = 'EXECUTED', completed_at = now(), provider_ref = coalesce(nullif(trim(p_partner_ref), ''), provider_ref), executed_by = p_actor
   where id = p_refund returning * into r;
  select * into a from payment_attempts where id = r.attempt_id;
  perform _post_journal('REFUND_SETTLED', r.tranche_id, r.currency, jsonb_build_array(
      jsonb_build_object('account','REFUNDS_PAYABLE','debit', r.amount_minor),
      jsonb_build_object('account','PARTNER_CASH','credit', r.amount_minor)), a.id, r.id,
    (select id from ledger_journals where refund_id = r.id and kind = 'REFUND_REQUESTED' limit 1), p_event, 'Remboursement versé au payeur');
  if (select coalesce(sum(amount_minor), 0) from refunds where attempt_id = a.id and status = 'EXECUTED') >= a.amount_minor then
    update payments set status = 'REFUNDED' where tranche_id = a.tranche_id and status = 'SUCCEEDED';
    update contributions set status = 'REFUNDED' where id = a.contribution_id and status = 'CONFIRMED';
  end if;
  update tranches set refunded_minor = refunded_minor + r.amount_minor where id = r.tranche_id;
  if (select status from tranches where id = r.tranche_id) = 'PAID' then
    perform _set_tranche_status(r.tranche_id, 'REFUNDED', p_actor, 'REQUEST_REFUNDED', jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor));
  end if;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (r.tx_id, r.tranche_id, p_actor, 'REFUND_SUCCEEDED', jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor,
          'via', case when p_event is null then 'MANUAL' else 'PARTNER_EVENT' end));
  return r;
end $$;

-- Pilote : exécution manuelle par un administrateur non partie, avec la référence du partenaire. Idempotente pour la même référence.
create or replace function mark_refund_executed(p_refund uuid, p_partner_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r refunds;
begin
  perform _require_user();
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  select * into r from refunds where id = p_refund for update;
  if not found then perform _err('NOT_FOUND', 'Remboursement introuvable'); end if;
  if is_party(r.tx_id) then perform _err('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas rembourser'); end if;
  if length(trim(coalesce(p_partner_ref, ''))) < 3 then perform _err('VALIDATION', 'Référence du partenaire obligatoire'); end if;
  if r.status = 'EXECUTED' and r.provider_ref = trim(p_partner_ref) then
    return jsonb_build_object('id', r.id, 'status', r.status, 'amountMinor', r.amount_minor, 'currency', r.currency, 'partnerRef', r.provider_ref);
  end if;
  if r.status <> 'REQUESTED' then perform _err('REFUND_NOT_PENDING', 'Remboursement déjà exécuté ou refusé'); end if;
  r := _refund_executed(r.id, p_partner_ref, null, auth.uid());
  return jsonb_build_object('id', r.id, 'status', r.status, 'amountMinor', r.amount_minor, 'currency', r.currency, 'partnerRef', r.provider_ref);
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

-- ---------- X5.3 Réception des événements ----------
create or replace function _process_payment_event(p_event bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e webhook_events; p jsonb; v_type text; a payment_attempts; r refunds; tr tranches; t transactions; q fx_quotes;
        v_result text := 'APPLIED'; v_error text; v_fee bigint; v_lines jsonb; v_paid bigint;
begin
  select * into e from webhook_events where id = p_event for update;
  p := e.payload; v_type := p->>'type';
  if v_type like 'PAYMENT_%' then
    select * into a from payment_attempts
     where idempotency_key = p->>'idempotencyKey' or (provider = e.provider and provider_ref = p->>'providerRef' and provider_ref is not null)
     order by created_at limit 1 for update;
    if not found then v_result := 'REJECTED'; v_error := 'UNKNOWN_ATTEMPT';
    elsif v_type = 'PAYMENT_PENDING' then
      if a.status in ('INITIATED','PENDING') then
        update payment_attempts set status = 'PENDING', provider_ref = coalesce(provider_ref, p->>'providerRef'), updated_at = now() where id = a.id returning * into a;
      else v_result := 'IGNORED'; v_error := 'STALE_EVENT'; end if;
    elsif v_type = 'PAYMENT_SUCCEEDED' then
      if a.status = 'CONFIRMED' then v_result := 'IGNORED'; v_error := 'ALREADY_APPLIED';
      elsif a.status = 'FAILED' then v_result := 'REJECTED'; v_error := 'CONTRADICTS_FINAL_STATE';
      elsif (p->>'amountMinor')::bigint is distinct from a.amount_minor or (p->>'currency') is distinct from a.currency::text then
        v_result := 'REJECTED'; v_error := 'AMOUNT_MISMATCH';
      else
        update payment_attempts set status = 'CONFIRMED', provider_ref = coalesce(provider_ref, p->>'providerRef'), updated_at = now(), completed_at = now()
         where id = a.id returning * into a;
        update contributions set status = 'CONFIRMED', confirmed_at = now() where id = a.contribution_id and status = 'PENDING';
        select * into q from fx_quotes where id = a.quote_id;
        insert into payments(tx_id, tranche_id, provider, external_id, status, fee_minor)
        select a.tx_id, a.tranche_id, a.provider, a.provider_ref, 'SUCCEEDED', a.fees_minor
        where not exists (select 1 from payments where tranche_id = a.tranche_id and status = 'SUCCEEDED');
        -- Montant de la demande (devise de la demande) ; frais du devis (devise débitée). Ancienne tentative sans devis :
        -- frais annoncés par l’événement, dans la devise de la demande.
        v_fee := case when q.id is not null then a.fees_minor else greatest(coalesce((p->>'feeMinor')::bigint, 0), 0) end;
        v_lines := jsonb_build_array(
            jsonb_build_object('account','PARTNER_CASH','debit', a.amount_minor),
            jsonb_build_object('account','DUE_TO_PROVIDER','credit', a.amount_minor),
            jsonb_build_object('account','PARTNER_CASH','debit', v_fee, 'currency', coalesce(a.debit_currency, a.currency)),
            jsonb_build_object('account','FEES','credit', v_fee, 'currency', coalesce(a.debit_currency, a.currency)));
        perform _post_journal('PAYMENT', a.tranche_id, a.currency, v_lines, a.id, null, null, e.id, 'Paiement reçu par le partenaire');
        insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
        values (a.tx_id, a.tranche_id, null, 'PAYMENT_SUCCEEDED', jsonb_build_object('attempt_id', a.id, 'provider', a.provider));
        select * into tr from tranches where id = a.tranche_id for update;
        select * into t from transactions where id = tr.tx_id;
        -- Payée quand la somme des contributions confirmées atteint le montant cible (K9).
        select coalesce(sum(amount_minor), 0) into v_paid from contributions where tranche_id = tr.id and status = 'CONFIRMED';
        if tr.status = 'ACCEPTED' and v_paid >= tr.target_amount_minor then
          if t.settlement_mode = 'CONDITIONAL' then
            update tranches set funds_state = 'HELD' where id = tr.id;
            perform _set_tranche_status(tr.id, 'PAID', null, 'REQUEST_PAID', jsonb_build_object('attempt_id', a.id, 'funds', 'HELD'));
          else
            insert into release_events(tx_id, tranche_id, trigger) values (tr.tx_id, tr.id, 'DIRECT_PAYMENT');
            perform _set_tranche_status(tr.id, 'PAID', null, 'REQUEST_PAID', jsonb_build_object('attempt_id', a.id));
          end if;
        elsif tr.status <> 'ACCEPTED' then
          v_error := 'TRANCHE_NOT_AWAITING';   -- argent reçu, demande plus en attente de paiement : le rapprochement le signale
        end if;
      end if;
    elsif v_type = 'PAYMENT_FAILED' then
      if a.status = 'FAILED' then v_result := 'IGNORED'; v_error := 'ALREADY_APPLIED';
      elsif a.status = 'CONFIRMED' then v_result := 'REJECTED'; v_error := 'CONTRADICTS_FINAL_STATE';
      else
        update payment_attempts set status = 'FAILED', error_code = coalesce(p->>'errorCode', 'DECLINED'), updated_at = now(), completed_at = now()
         where id = a.id returning * into a;
        update contributions set status = 'FAILED' where id = a.contribution_id and status = 'PENDING';
        insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
        values (a.tx_id, a.tranche_id, null, 'PAYMENT_FAILED', jsonb_build_object('attempt_id', a.id, 'error', a.error_code));
        if (select status from tranches where id = a.tranche_id) = 'ACCEPTED'
           and not exists (select 1 from payment_attempts where tranche_id = a.tranche_id and status in ('INITIATED','PENDING','CONFIRMED')) then
          perform _set_tranche_status(a.tranche_id, 'SUBMITTED', null, 'PAYMENT_RETRY_ALLOWED', jsonb_build_object('attempt_id', a.id));
        end if;
      end if;
    else v_result := 'REJECTED'; v_error := 'UNKNOWN_TYPE';
    end if;
  elsif v_type in ('REFUND_SUCCEEDED','REFUND_FAILED') then
    select * into r from refunds where idempotency_key = p->>'refundKey' or (provider_ref = p->>'providerRef' and provider_ref is not null)
     order by created_at limit 1 for update;
    if not found then v_result := 'REJECTED'; v_error := 'UNKNOWN_REFUND';
    elsif r.status <> 'REQUESTED' then
      v_result := case when (r.status = 'EXECUTED') = (v_type = 'REFUND_SUCCEEDED') then 'IGNORED' else 'REJECTED' end;
      v_error := case when v_result = 'IGNORED' then 'ALREADY_APPLIED' else 'CONTRADICTS_FINAL_STATE' end;
    elsif (p->>'amountMinor')::bigint is distinct from r.amount_minor then v_result := 'REJECTED'; v_error := 'AMOUNT_MISMATCH';
    elsif v_type = 'REFUND_SUCCEEDED' then
      r := _refund_executed(r.id, p->>'providerRef', e.id, null);
    else
      select * into a from payment_attempts where id = r.attempt_id;
      update refunds set status = 'FAILED', completed_at = now(), error_code = coalesce(p->>'errorCode', 'DECLINED') where id = r.id returning * into r;
      perform _post_journal('REFUND_REVERSED', r.tranche_id, r.currency, jsonb_build_array(
          jsonb_build_object('account','REFUNDS_PAYABLE','debit', r.amount_minor),
          jsonb_build_object('account','DUE_TO_PROVIDER','credit', r.amount_minor)), a.id, r.id,
        (select id from ledger_journals where refund_id = r.id and kind = 'REFUND_REQUESTED' limit 1), e.id, 'Remboursement refusé');
      insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
      values (r.tx_id, r.tranche_id, null, 'REFUND_FAILED', jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor));
    end if;
  else v_result := 'REJECTED'; v_error := 'UNKNOWN_TYPE';
  end if;
  update webhook_events set processed_at = now(), result = v_result, error = v_error, attempt_id = coalesce(a.id, r.attempt_id), refund_id = r.id
   where id = e.id;
  return jsonb_strip_nulls(jsonb_build_object('eventId', e.event_id, 'result', v_result, 'error', v_error,
    'attemptId', coalesce(a.id, r.attempt_id), 'refundId', r.id));
end $$;

-- Démonstration : issues CONFIRMED (ou SUCCEEDED, ancien nom) et FAILED, par le chemin des événements.
create or replace function demo_settle_payment(p_attempt uuid, p_outcome text default 'CONFIRMED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; v_type text;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  select * into a from payment_attempts where id = p_attempt;
  if not found or not (is_party(a.tx_id) or is_validator()) then perform _err('PAYMENT_NOT_FOUND', 'Paiement introuvable'); end if;
  v_type := case p_outcome when 'CONFIRMED' then 'PAYMENT_SUCCEEDED' when 'SUCCEEDED' then 'PAYMENT_SUCCEEDED' when 'FAILED' then 'PAYMENT_FAILED'
                           when 'PENDING' then 'PAYMENT_PENDING' end;
  if v_type is null then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  return apply_payment_event(a.provider, 'sim-' || replace(gen_random_uuid()::text, '-', ''), true, jsonb_build_object(
    'type', v_type, 'idempotencyKey', a.idempotency_key, 'providerRef', a.provider_ref,
    'amountMinor', a.amount_minor, 'currency', a.currency, 'errorCode', case when v_type = 'PAYMENT_FAILED' then 'SIMULATED_DECLINE' end));
end $$;

create or replace function demo_settle_refund(p_refund uuid, p_outcome text default 'EXECUTED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r refunds; v_type text;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  if not is_admin() then perform _err('ADMIN_ONLY', 'Réservé aux administrateurs'); end if;
  select * into r from refunds where id = p_refund;
  if not found then perform _err('NOT_FOUND', 'Remboursement introuvable'); end if;
  v_type := case p_outcome when 'EXECUTED' then 'REFUND_SUCCEEDED' when 'SUCCEEDED' then 'REFUND_SUCCEEDED' when 'FAILED' then 'REFUND_FAILED' end;
  if v_type is null then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  return apply_payment_event((select provider from payment_attempts where id = r.attempt_id), 'simr-' || replace(gen_random_uuid()::text, '-', ''), true,
    jsonb_build_object('type', v_type, 'refundKey', r.idempotency_key, 'providerRef', r.provider_ref, 'amountMinor', r.amount_minor,
                       'currency', r.currency));
end $$;

-- ---------- Déblocage et litiges : statuts v2 ----------
create or replace function _ledger_on_release() returns trigger
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; v_amount bigint;
begin
  select * into a from payment_attempts where tranche_id = new.tranche_id and status = 'CONFIRMED';
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

create or replace function _resolve_dispute_v2(p_dispute uuid, p_outcome text, p_note text, p_actor uuid, p_amount_minor bigint DEFAULT NULL::bigint)
 RETURNS disputes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare d disputes; tr tranches; v_paid bigint; v_refund refunds; v_amount bigint;
begin
  select * into d from disputes where id = p_dispute for update;
  select * into tr from tranches where id = d.tranche_id for update;
  if p_outcome not in ('NO_ACTION','REFUND_FULL','REFUND_PARTIAL','FUNDS_RELEASED','FUNDS_RETURNED') then perform _err('INVALID_OUTCOME', 'Issue invalide'); end if;
  if p_outcome <> 'NO_ACTION' and tr.status not in ('PAID','REFUNDED') then perform _err('INVALID_OUTCOME', 'Issue impossible avant paiement'); end if;
  if p_outcome in ('FUNDS_RELEASED','FUNDS_RETURNED') and tr.funds_state <> 'HELD' then perform _err('INVALID_OUTCOME', 'Fonds non bloqués (règlement direct ou déjà traités)'); end if;
  select coalesce(sum(amount_minor), 0) into v_paid from payment_attempts where tranche_id = tr.id and status = 'CONFIRMED';
  if p_outcome in ('REFUND_FULL','FUNDS_RETURNED') then
    v_amount := v_paid - coalesce((select sum(amount_minor) from refunds where tranche_id = tr.id and status in ('REQUESTED','EXECUTED')), 0);
    if v_amount <= 0 then perform _err('REFUND_EXCEEDS_PAID', 'Rien à rembourser'); end if;
  elsif p_outcome = 'REFUND_PARTIAL' then
    if p_amount_minor is null or p_amount_minor <= 0 then perform _err('AMOUNT_INVALID', 'Montant du remboursement partiel obligatoire'); end if;
    v_amount := p_amount_minor;
  end if;
  if v_amount is not null then
    v_refund := _create_refund(tr.id, v_amount, 'litige-' || d.id::text || '-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(trim(p_note), ''), 'Litige'), p_actor);
  end if;
  -- Remboursement intégral de fonds encore bloqués (CONDITIONAL) : les fonds reviennent au payeur, jamais libérés ensuite.
  if p_outcome = 'REFUND_FULL' and tr.funds_state = 'HELD' then p_outcome := 'FUNDS_RETURNED_BY_REFUND'; end if;
  if p_outcome = 'FUNDS_RELEASED' then
    perform _set_funds_state(tr.id, 'RELEASED', p_actor, 'FUNDS_RELEASED', jsonb_build_object('trigger', 'DISPUTE_RESOLUTION'));
  elsif p_outcome in ('FUNDS_RETURNED','FUNDS_RETURNED_BY_REFUND') then
    perform _set_funds_state(tr.id, 'RETURNED', p_actor, 'FUNDS_RETURNED', jsonb_build_object('refund_id', v_refund.id));
  end if;
  if p_outcome = 'FUNDS_RETURNED_BY_REFUND' then p_outcome := 'REFUND_FULL'; end if;
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
end $$

;

-- ---------- X5.7 Rapprochement (mêmes codes, statuts v2 ; le code SUCCEEDED_* garde son nom stable) ----------
create or replace view v_reconciliation with (security_invoker = true) as
SELECT a.id AS attempt_id,
    a.tranche_id,
    a.tx_id,
    _tx_ref(a.tx_id) AS reference,
    a.provider,
    a.status AS attempt_status,
    a.amount_minor,
    (a.currency)::text AS currency,
    (tr.status)::text AS tranche_status,
    tr.funds_state,
    x.success_events,
    x.paid_ledger,
    x.released_ledger,
    x.refunded_requested,
    x.refunded_settled,
    x.rejected_events,
    array_remove(ARRAY[
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND (x.success_events = 0)) THEN 'SUCCEEDED_WITHOUT_EVENT'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND (x.paid_ledger = 0)) THEN 'SUCCEEDED_WITHOUT_LEDGER'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status <> 'CONFIRMED'::text) AND (x.paid_ledger > 0)) THEN 'LEDGER_WITHOUT_SUCCESS'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND (x.paid_ledger > 0) AND (x.paid_ledger <> a.amount_minor)) THEN 'LEDGER_AMOUNT_MISMATCH'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND (tr.status = ANY (ARRAY['DRAFT'::tranche_status, 'SUBMITTED'::tranche_status, 'INFO_REQUESTED'::tranche_status, 'ACCEPTED'::tranche_status, 'REJECTED'::tranche_status, 'EXPIRED'::tranche_status]))) THEN 'TRANCHE_NOT_PAID'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status <> 'CONFIRMED'::text) AND (tr.status = ANY (ARRAY['PAID'::tranche_status, 'REFUNDED'::tranche_status])) AND (NOT (EXISTS ( SELECT 1
               FROM payment_attempts o
              WHERE ((o.tranche_id = a.tranche_id) AND (o.status = 'CONFIRMED'::text))))) AND (x.succeeded_payments = 0)) THEN 'PAID_WITHOUT_ATTEMPT'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND ((tr.funds_state = 'RELEASED'::text) OR ((tr.status = 'PAID'::tranche_status) AND (tr.funds_state = 'NONE'::text))) AND (x.released_ledger = 0) AND (a.amount_minor > x.refunded_requested)) THEN 'RELEASED_NOT_IN_LEDGER'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND (tr.status = 'CANCELLED'::tranche_status) AND (x.refunded_settled < a.amount_minor)) THEN 'CANCELLED_NOT_REFUNDED'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.status = 'CONFIRMED'::text) AND (x.refunded_settled > 0) AND (tr.status <> 'REFUNDED'::tranche_status)) THEN 'REFUNDED_TRANCHE_OPEN'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (x.refunded_requested > a.amount_minor) THEN 'REFUND_EXCEEDS_PAID'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (x.rejected_events > 0) THEN 'EVENT_REJECTED'::text
            ELSE NULL::text
        END], NULL::text) AS issues
   FROM ((payment_attempts a
     JOIN tranches tr ON ((tr.id = a.tranche_id)))
     CROSS JOIN LATERAL ( SELECT (( SELECT count(*) AS count
                   FROM webhook_events w
                  WHERE ((w.attempt_id = a.id) AND (w.result = 'APPLIED'::text) AND ((w.payload ->> 'type'::text) = 'PAYMENT_SUCCEEDED'::text))))::integer AS success_events,
            (( SELECT count(*) AS count
                   FROM webhook_events w
                  WHERE ((w.attempt_id = a.id) AND (w.result = 'REJECTED'::text) AND w.signature_valid)))::integer AS rejected_events,
            (( SELECT count(*) AS count
                   FROM payments p
                  WHERE ((p.tranche_id = a.tranche_id) AND (p.status = ANY (ARRAY['SUCCEEDED'::payment_status, 'REFUNDED'::payment_status])))))::integer AS succeeded_payments,
            (COALESCE(( SELECT sum(e.credit_minor) AS sum
                   FROM (ledger_journals j
                     JOIN ledger_entries e ON ((e.journal_id = j.id)))
                  WHERE ((j.attempt_id = a.id) AND (j.kind = 'PAYMENT'::text) AND (e.account_code = 'DUE_TO_PROVIDER'::text))), (0)::numeric))::bigint AS paid_ledger,
            (COALESCE(( SELECT sum(e.debit_minor) AS sum
                   FROM (ledger_journals j
                     JOIN ledger_entries e ON ((e.journal_id = j.id)))
                  WHERE ((j.attempt_id = a.id) AND (j.kind = 'RELEASE'::text) AND (e.account_code = 'DUE_TO_PROVIDER'::text))), (0)::numeric))::bigint AS released_ledger,
            (COALESCE(( SELECT sum(f.amount_minor) AS sum
                   FROM refunds f
                  WHERE ((f.attempt_id = a.id) AND (f.status = ANY (ARRAY['REQUESTED'::text, 'EXECUTED'::text])))), (0)::numeric))::bigint AS refunded_requested,
            (COALESCE(( SELECT sum(f.amount_minor) AS sum
                   FROM refunds f
                  WHERE ((f.attempt_id = a.id) AND (f.status = 'EXECUTED'::text))), (0)::numeric))::bigint AS refunded_settled) x)
  WHERE is_validator();

-- ---------- Droits (X5) : rien pour anon ; fonctions internes réservées ----------
revoke all on function _fx_quotes_frozen(), _currency_decimals(currency), _quote_fees(bigint, text, boolean), _quote_json(fx_quotes),
  _refund_executed(uuid, text, bigint, uuid), _refunded(uuid), _create_refund(uuid, bigint, text, text, uuid), _process_payment_event(bigint),
  _post_journal(text, uuid, currency, jsonb, uuid, uuid, uuid, bigint, text), _attempt_json(payment_attempts)
  from public, anon, authenticated;
revoke all on function get_quote(uuid, text, text), accept_and_pay(uuid, text, uuid), start_payment(uuid, text, text), mark_refund_executed(uuid, text),
  request_refund(uuid, bigint, text, text), demo_settle_payment(uuid, text), demo_settle_refund(uuid, text) from public, anon;
grant execute on function get_quote(uuid, text, text), accept_and_pay(uuid, text, uuid), start_payment(uuid, text, text), mark_refund_executed(uuid, text),
  request_refund(uuid, bigint, text, text), demo_settle_payment(uuid, text), demo_settle_refund(uuid, text) to authenticated;
