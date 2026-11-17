-- Lot X-C (T6) : libération automatique et demande échue (R6 et J1 de l’état des lieux du 16 novembre).
--  1. release_due_tranches (0014) libérait les fonds d’une opération SUSPENDED (litige ouvert avant paiement sur une
--     autre demande du même dossier) : plus aucune libération pour une opération suspendue. Une opération CLOSED avec
--     des fonds encore HELD est impossible par construction : une demande PAID n’est finale que quand ses fonds sont
--     NONE, RELEASED ou RETURNED (_request_final, 0014), et _close_operation_if_done ne clôt qu’avec toutes les
--     demandes finales ; guard_status interdit tout autre changement de statut.
--  2. Une demande dont expires_at est passée n’est plus payable, même avant le passage horaire d’expire_due_requests
--     (cron à h+15) : get_quote et accept_and_pay la refusent (REQUEST_EXPIRED, nouveau code, même nom que
--     l’événement de journal posé par expire_due_requests). Après le passage du cron (statut EXPIRED), le code reste
--     NOT_PAYABLE, comme aujourd’hui. Parité : simulateur (getQuote, acceptAndPay ; expiresAt posée à la soumission
--     depuis requestExpiryDays du module, comme _submit_request).
-- Tests : supabase/tests/07_lotxc.sql (section T6).

create or replace function release_due_tranches() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select tr.id from tranches tr where tr.status = 'PAID' and tr.funds_state = 'HELD' and tr.release_mode <> 'EVIDENCE_REVIEW'
             and tr.confirmed_at is not null and tr.contest_ends_at <= now()
             and not exists (select 1 from disputes d where d.tranche_id = tr.id and d.status <> 'RESOLVED')
             -- Lot X-C (T6) : jamais de libération pour une opération suspendue (litige avant paiement sur une autre demande).
             and (select t.status from transactions t where t.id = tr.tx_id) <> 'SUSPENDED' loop
    perform _set_funds_state(r.id, 'RELEASED', null, 'FUNDS_RELEASED', jsonb_build_object('trigger','AUTO_TIMEOUT'));
    n := n + 1;
  end loop;
  return n;
end $$;

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
  -- Lot X-C (T6) : une demande échue n’est plus payable, même avant le passage horaire d’expire_due_requests.
  if tr.expires_at is not null and tr.expires_at <= now() and tr.status in ('SUBMITTED','INFO_REQUESTED') then
    perform _err('REQUEST_EXPIRED', 'Demande expirée : elle ne peut plus être payée');
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
  -- Lot X-C (T6) : une demande échue n’est plus payable, même avant le passage horaire d’expire_due_requests.
  if tr.expires_at is not null and tr.expires_at <= now() and tr.status in ('SUBMITTED','INFO_REQUESTED') then
    perform _err('REQUEST_EXPIRED', 'Demande expirée : elle ne peut plus être payée');
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
