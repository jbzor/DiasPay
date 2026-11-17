-- =====================================================================
-- DiasPay : migration 0019 (lot X version 2) — correctif de 0014, appliquée par-dessus. À appliquer SUR 0001 à 0018.
-- Test : supabase/tests/05_lotx2_p1.sql.
--
--  1. Litige tranché par un remboursement intégral (REFUND_FULL) alors que les fonds sont encore bloqués (CONDITIONAL) :
--     les fonds passent à RETURNED (avant : ils restaient HELD et pouvaient encore être libérés au prestataire).
-- =====================================================================

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
end $$;

revoke all on function _resolve_dispute_v2(uuid, text, text, uuid, bigint) from public, anon, authenticated;
