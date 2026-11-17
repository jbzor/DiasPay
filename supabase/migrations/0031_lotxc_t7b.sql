-- Lot X-C (compléments de T7).
--  1. Échéance du jeton en CONDITIONAL. 0028 donnait au jeton émis à la soumission l’échéance now() + token_ttl_days :
--     le délai de confirmation courait dès la soumission. Une demande payée au 8e jour avait déjà un jeton expiré
--     (confirmation par scan refusée : TOKEN_EXPIRED ; écran du payeur « expiré »). Règle (Xc-7) : jusqu’au paiement,
--     le jeton suit l’échéance de la demande, dans les deux modes ; token_ttl_days ne s’applique qu’à la phase de
--     confirmation, après le paiement en CONDITIONAL (échéance posée au passage à PAID, et à toute réémission pendant
--     cette phase). Données : les jetons CONDITIONAL actifs non payés reprennent l’échéance de leur demande.
--  2. auto_issue_token : plus lu par aucune fonction depuis 0014 (seule _simulate_token_issue, de l’ancien parcours de
--     validation v1, le lisait, et plus rien ne l’appelle). L’émission du TrustToken à la soumission est inconditionnelle
--     (0028). Le réglage et la fonction morte sont supprimés ; seed.sql et les tests ne le posent plus.
-- Tests : supabase/tests/07_lotxc.sql (section T7b).

create or replace function _issue_tranche_token(p_tranche uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_mode settlement_mode; v_status tranche_status; v_req_exp timestamptz; v_ttl int; v_exp timestamptz;
begin
  select t.settlement_mode, tr.status, tr.expires_at into v_mode, v_status, v_req_exp
    from tranches tr join transactions t on t.id = tr.tx_id where tr.id = p_tranche;
  if v_mode = 'CONDITIONAL' and v_status = 'PAID' then
    select value::int into v_ttl from app_config where key = 'token_ttl_days';
    v_exp := now() + make_interval(days => v_ttl);   -- phase de confirmation (après paiement)
  else
    v_exp := v_req_exp;                               -- jusqu’au paiement : l’échéance de la demande (vide si non fixée)
  end if;
  insert into tranche_tokens(tranche_id, kid, signature, expires_at)
  values (p_tranche, 'SIMULATED', 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''), v_exp)
  on conflict (tranche_id) where revoked_at is null do nothing;
end $$;

-- Statut d’une demande et jeton : révocation à chaque statut final (0028) ; en CONDITIONAL, passage à PAID = début de la
-- phase de confirmation, le jeton actif prend l’échéance token_ttl_days.
create or replace function _revoke_token_on_final() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_mode settlement_mode; v_ttl int;
begin
  select settlement_mode into v_mode from transactions where id = new.tx_id;
  if new.status in ('REJECTED','CANCELLED','EXPIRED') or (new.status in ('PAID','REFUNDED') and v_mode = 'DIRECT') then
    perform _revoke_active_token(new.id, 'Statut final de la demande : ' || new.status::text, null);
  elsif new.status = 'PAID' and v_mode = 'CONDITIONAL' then
    select value::int into v_ttl from app_config where key = 'token_ttl_days';
    update tranche_tokens set expires_at = now() + make_interval(days => v_ttl) where tranche_id = new.id and revoked_at is null;
  end if;
  return new;
end $$;
revoke all on function _revoke_token_on_final() from public, anon, authenticated;

update tranche_tokens k set expires_at = tr.expires_at
  from tranches tr join transactions t on t.id = tr.tx_id
 where k.tranche_id = tr.id and k.revoked_at is null and t.settlement_mode = 'CONDITIONAL' and tr.status <> 'PAID';

delete from app_config where key = 'auto_issue_token';
drop function if exists _simulate_token_issue(uuid);
