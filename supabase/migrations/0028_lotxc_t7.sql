-- Lot X-C (T7) : un TrustToken pour chaque demande, y compris en règlement direct.
-- Source : cahier d’extension du client (section 1 : tout paiement est associé à un TrustToken et à un TrustLink ; cas 3 et 8 :
-- chaque demande et chaque échéance a son propre TrustToken ; section 3.C : « TrustToken généré » après la soumission ;
-- exigence 5.1). Le lot X v2 avait supprimé le jeton en DIRECT (0014 l.240, NO_TOKEN en 0018) avec le lien partageable et
-- l’image du QR : écart corrigé ici. Le lien partageable et l’image du QR restent supprimés (eqr_image_enabled faux).
--  1. Validité (docs/decisions.md, Xc-7) : en DIRECT, le jeton suit le cycle de vie de la demande — expires_at du jeton =
--     expires_at de la demande (vide tant que la durée des demandes n’est pas fixée, point ouvert 3 : le jeton en héritera),
--     révocation à chaque statut final (PAID, REFUSÉ, ANNULÉ, ÉCHU, REMBOURSÉ) et à l’annulation de l’opération.
--     token_ttl_days ne s’applique qu’en CONDITIONAL (confirmation par scan). Aucune durée inventée.
--  2. Émission à la soumission (_submit_request) quel que soit le mode, journalisée (TOKEN_ISSUED).
--  3. reissue_token et revoke_token fonctionnent en DIRECT (NO_TOKEN reste pour une demande non soumise).
--  4. Résolution inchangée (_party_token, 0015) : payeur et initiateur ; prestataire seulement en CONDITIONAL.
--  5. accept_and_pay refuse une demande sans jeton actif (TOKEN_REVOKED).
--  6. Révocation centralisée : déclencheur sur le statut des demandes (couvre l’annulation de l’opération par
--     transition_tx, qui ne révoquait rien) ; en CONDITIONAL, le jeton reste actif après PAID (QR présenté au prestataire).
--  7. Données : un jeton pour chaque demande DIRECT soumise et non finale qui n’en a pas.
-- Tests : supabase/tests/07_lotxc.sql (section T7).

alter table tranche_tokens alter column expires_at drop not null;

create or replace function _issue_tranche_token(p_tranche uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_mode settlement_mode; v_req_exp timestamptz; v_ttl int; v_exp timestamptz;
begin
  select t.settlement_mode, tr.expires_at into v_mode, v_req_exp
    from tranches tr join transactions t on t.id = tr.tx_id where tr.id = p_tranche;
  if v_mode = 'CONDITIONAL' then
    select value::int into v_ttl from app_config where key = 'token_ttl_days';
    v_exp := now() + make_interval(days => v_ttl);
  else
    v_exp := v_req_exp;   -- DIRECT : le jeton suit la demande (vide tant que la durée des demandes n’est pas fixée)
  end if;
  insert into tranche_tokens(tranche_id, kid, signature, expires_at)
  values (p_tranche, 'SIMULATED', 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''), v_exp)
  on conflict (tranche_id) where revoked_at is null do nothing;
end $$;

-- Soumission d’une demande : expiration selon le module, puis TrustToken (tous modes), journalisé.
create or replace function _submit_request(p_tranche uuid, p_actor uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; v_days int; k tranche_tokens;
begin
  select * into tr from tranches where id = p_tranche for update;
  select * into t from transactions where id = tr.tx_id;
  select request_expiry_days into v_days from request_modules where code = t.vertical;
  update tranches set expires_at = case when v_days is not null then now() + make_interval(days => v_days) end where id = p_tranche;
  perform _issue_tranche_token(p_tranche);
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, p_actor, 'TOKEN_ISSUED', jsonb_build_object('token_id', k.id, 'mode', t.settlement_mode));
  return _set_tranche_status(p_tranche, 'SUBMITTED', p_actor, 'REQUEST_SUBMITTED', '{}');
end $$;

-- Réémission : en DIRECT aussi (le refus de 0018 est retiré) ; NO_TOKEN reste pour une demande non soumise.
create or replace function reissue_token(p_tranche uuid, p_reason text default 'Réémission du jeton') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_old uuid; k tranche_tokens;
begin
  tr := _check_token_manager(p_tranche);
  if tr.status = 'DRAFT' then perform _err('NO_TOKEN', 'Demande pas encore soumise : aucun jeton'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif de réémission obligatoire'); end if;
  v_old := _revoke_active_token(p_tranche, p_reason, auth.uid());
  perform _issue_tranche_token(p_tranche);
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'TOKEN_REISSUED', jsonb_build_object('token_id', k.id, 'replaces', v_old));
  return jsonb_build_object('trancheId', tr.id, 'tokenId', k.id,
    'expiresAt', case when k.expires_at is not null then to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
end $$;

-- Révocation à chaque statut final : refusé, annulé (y compris par l’annulation de l’opération), échu ; en DIRECT aussi
-- payé et remboursé (le jeton a servi). En CONDITIONAL, le jeton payé reste actif pour la confirmation par scan.
create or replace function _revoke_token_on_final() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('REJECTED','CANCELLED','EXPIRED')
     or (new.status in ('PAID','REFUNDED') and (select settlement_mode from transactions where id = new.tx_id) = 'DIRECT') then
    perform _revoke_active_token(new.id, 'Statut final de la demande : ' || new.status::text, null);
  end if;
  return new;
end $$;
revoke all on function _revoke_token_on_final() from public, anon, authenticated;
drop trigger if exists tranches_revoke_token_on_final on tranches;
create trigger tranches_revoke_token_on_final after update of status on tranches
  for each row when (new.status is distinct from old.status) execute function _revoke_token_on_final();

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
  -- Lot X-C (T7) : tout paiement est associé au TrustToken actif de la demande (exigence 5.1) ; révoqué ou absent : refusé.
  if not exists (select 1 from tranche_tokens where tranche_id = tr.id and revoked_at is null) then
    perform _err('TOKEN_REVOKED', 'Jeton de la demande révoqué : paiement impossible');
  end if;
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

-- Données : un jeton pour chaque demande DIRECT déjà soumise et non finale qui n’en a pas (journalisé).
do $$
declare r record; k tranche_tokens;
begin
  for r in select tr.id, tr.tx_id from tranches tr join transactions t on t.id = tr.tx_id
           where t.settlement_mode = 'DIRECT' and tr.status in ('SUBMITTED','INFO_REQUESTED','ACCEPTED')
             and not exists (select 1 from tranche_tokens x where x.tranche_id = tr.id and x.revoked_at is null) loop
    perform _issue_tranche_token(r.id);
    select * into k from tranche_tokens where tranche_id = r.id and revoked_at is null;
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
    values (r.tx_id, r.id, null, 'TOKEN_ISSUED', jsonb_build_object('token_id', k.id, 'mode', 'DIRECT', 'backfill', true));
  end loop;
end $$;
