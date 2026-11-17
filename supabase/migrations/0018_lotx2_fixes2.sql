-- =====================================================================
-- DiasPay : migration 0018 (lot X version 2) — correctifs de 0014, appliquée par-dessus. À appliquer SUR 0001 à 0017.
-- Test : supabase/tests/05_lotx2_p1.sql.
--
--  1. reissue_token : refusé en règlement direct (NO_TOKEN) ; les jetons de demande n’existent qu’en CONDITIONAL.
--  2. Demande suspendue par un litige avant paiement : REQUEST_ON_HOLD est renvoyé avant TX_NOT_ACTIVE (l’opération est
--     SUSPENDED précisément à cause de cette demande), dans _request_tranche et start_payment.
-- =====================================================================

create or replace function _request_tranche(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not (is_party(tr.tx_id) or _is_initiator(tr.tx_id)) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  -- Demande suspendue par un litige avant paiement : code explicite (l’opération est SUSPENDED à cause d’elle).
  if tr.on_hold then perform _err('REQUEST_ON_HOLD', 'Demande suspendue par un litige'); end if;
  if (select status from transactions where id = tr.tx_id) <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  return tr;
end $$;

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
  if tr.on_hold then perform _err('REQUEST_ON_HOLD', 'Demande suspendue par un litige'); end if;
  if t.status <> 'ACTIVE' then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
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

create or replace function reissue_token(p_tranche uuid, p_reason text default 'Réémission du jeton') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_old uuid; k tranche_tokens;
begin
  tr := _check_token_manager(p_tranche);
  if tr.status = 'DRAFT' then perform _err('NO_TOKEN', 'Demande pas encore soumise : aucun jeton'); end if;
  if (select settlement_mode from transactions where id = tr.tx_id) <> 'CONDITIONAL' then
    perform _err('NO_TOKEN', 'Règlement direct : aucun jeton de demande');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif de réémission obligatoire'); end if;
  v_old := _revoke_active_token(p_tranche, p_reason, auth.uid());
  perform _issue_tranche_token(p_tranche);
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'TOKEN_REISSUED', jsonb_build_object('token_id', k.id, 'replaces', v_old));
  return jsonb_build_object('trancheId', tr.id, 'tokenId', k.id, 'expiresAt', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

revoke all on function _request_tranche(uuid) from public, anon, authenticated;
revoke all on function start_payment(uuid, text, text), reissue_token(uuid, text) from public, anon;
grant execute on function start_payment(uuid, text, text), reissue_token(uuid, text) to authenticated;
