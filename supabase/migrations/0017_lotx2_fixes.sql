-- =====================================================================
-- DiasPay : migration 0017 (lot X version 2) — correctifs de 0014, appliquée par-dessus (0014 n’est jamais modifiée).
-- À appliquer SUR 0001 à 0016. Test : supabase/tests/01_lot4.sql (« pas de TRANCHE_RELEASED en double après un litige »).
--
--  1. Alertes : une libération des fonds décidée par un litige (FUNDS_RELEASED, trigger DISPUTE_RESOLUTION) n’envoie plus
--     TRANCHE_RELEASED en plus de DISPUTE_RESOLVED (comportement du lot 4 rétabli).
-- =====================================================================

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
  -- Libération décidée par un litige : l’alerte DISPUTE_RESOLVED (issue RELEASED) suffit, pas de TRANCHE_RELEASED en double.
  elsif new.event = 'FUNDS_RELEASED' and coalesce(new.payload->>'trigger', '') <> 'DISPUTE_RESOLUTION' then v_type := 'TRANCHE_RELEASED';
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

revoke all on function _notify_from_audit() from public, anon, authenticated;
