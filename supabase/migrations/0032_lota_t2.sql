-- Lot A (T2) : un jeton ne peut plus être réémis sur une demande terminée.
--
-- Avant : reissue_token refusait seulement une demande en brouillon (NO_TOKEN). Un administrateur non partie pouvait donc
-- réémettre un jeton actif sur une demande payée en DIRECT, rejetée, expirée, annulée ou remboursée, ce qui contredit la
-- spécification validée du TrustToken (livrable 7, règles 3 et 4).
-- Après : REQUEST_CLOSED pour toute demande terminée ; la réémission reste permise pendant la confirmation en CONDITIONAL
-- (demande payée, fonds encore bloqués). Miroir côté domaine : tokenReissueClosed (packages/domain/src/requests.ts).
-- Droits inchangés (authenticated, jamais anon). Tests : supabase/tests/08_lota.sql (section T2).

create or replace function _token_reissue_closed(p_tranche uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tr.status in ('REJECTED','EXPIRED','CANCELLED','REFUNDED')
      or (tr.status = 'PAID' and (t.settlement_mode <> 'CONDITIONAL' or tr.funds_state <> 'HELD'))
    from tranches tr join transactions t on t.id = tr.tx_id
   where tr.id = p_tranche
$$;
revoke all on function _token_reissue_closed(uuid) from public, anon, authenticated;

create or replace function reissue_token(p_tranche uuid, p_reason text default 'Réémission du jeton') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_old uuid; k tranche_tokens;
begin
  tr := _check_token_manager(p_tranche);
  if tr.status = 'DRAFT' then perform _err('NO_TOKEN', 'Demande pas encore soumise : aucun jeton'); end if;
  if _token_reissue_closed(p_tranche) then perform _err('REQUEST_CLOSED', 'Demande terminée : aucun jeton ne peut être réémis'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif de réémission obligatoire'); end if;
  v_old := _revoke_active_token(p_tranche, p_reason, auth.uid());
  perform _issue_tranche_token(p_tranche);
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'TOKEN_REISSUED', jsonb_build_object('token_id', k.id, 'replaces', v_old));
  return jsonb_build_object('trancheId', tr.id, 'tokenId', k.id,
    'expiresAt', case when k.expires_at is not null then to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
end $$;
revoke all on function reissue_token(uuid, text) from public, anon;
grant execute on function reissue_token(uuid, text) to authenticated;
