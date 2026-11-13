-- =====================================================================
-- DiasPay : migration 0016 (lot X version 2, X3) — décisions du payeur, jeton de présentation.
-- À appliquer SUR 0001 à 0015. Test : supabase/tests/05_lotx2_p1.sql (partie X3).
-- (request_info, answer_info, reject_request, mark_received : statuts v2 dans 0014 ; initiation par un prestataire : 0008,
-- remplacée par le niveau d’enrôlement en X4.)
--
--  1. accept_plan(p_operation) : le payeur accepte le principe de l’échéancier (accepted_at), une fois, sans autoriser aucun
--     paiement à l’avance (K6) ; alerte PLAN_ACCEPTED aux autres parties.
--  2. Jeton de présentation (K4, schéma et fonctions sans interface) : presentation_tokens ; issue_presentation_token
--     (initiateur, durée = réglage presentation_token_ttl_seconds, point ouvert 2) ; claim_presentation_token (usage unique,
--     lie la demande à l’utilisateur connecté, renvoie un résumé minimal, n’autorise aucun paiement) ;
--     revoke_presentation_tokens. Seule l’empreinte SHA-256 de la référence est conservée.
-- =====================================================================

-- ---------- X3.1 Acceptation du plan ----------
create or replace function accept_plan(p_operation uuid) returns transactions
language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  perform _require_user();
  select * into t from transactions where id = p_operation for update;
  if not found or not (is_party(p_operation) or _is_initiator(p_operation)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if not has_role(p_operation, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  if t.status not in ('ACTIVE','SUSPENDED') then perform _err('TX_NOT_ACTIVE', 'L’opération n’est pas active'); end if;
  if t.accepted_at is not null then return t; end if;   -- idempotente
  update transactions set accepted_at = now(), accepted_by = auth.uid() where id = p_operation returning * into t;
  insert into audit_log(tx_id, actor_id, event, payload) values (p_operation, auth.uid(), 'PLAN_ACCEPTED', '{}');
  return t;
end $$;

-- ---------- X3.4 Jeton de présentation ----------
-- Durée de vie (secondes) : point ouvert 2. Valeur de DÉVELOPPEMENT seulement (mock_mode), jamais en production.
do $$ begin
  if _mock_mode() then
    insert into app_config(key, value) values ('presentation_token_ttl_seconds', '90') on conflict (key) do nothing;   -- DÉVELOPPEMENT
  end if;
end $$;

create table if not exists presentation_tokens (
  id          uuid primary key default gen_random_uuid(),
  tranche_id  uuid not null references tranches(id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null,
  claimed_at  timestamptz,
  claimed_by  uuid references profiles(id),
  revoked_at  timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  check ((claimed_at is null) = (claimed_by is null))
);
create index if not exists presentation_tokens_tranche on presentation_tokens(tranche_id);
alter table presentation_tokens enable row level security;
drop policy if exists presentation_tokens_staff_read on presentation_tokens;
create policy presentation_tokens_staff_read on presentation_tokens for select using (is_validator());
revoke all on presentation_tokens from anon;
revoke insert, update, delete on presentation_tokens from authenticated;
grant select on presentation_tokens to authenticated;

create or replace function _token_hash(p_ref text) returns text
language sql immutable as $$
  select encode(extensions.digest(lower(regexp_replace(coalesce(p_ref, ''), '[^0-9a-fA-F]', '', 'g')), 'sha256'), 'hex')
$$;

-- Initiateur : nouveau jeton (les précédents sont révoqués : rotation). La référence n’est renvoyée qu’ici, jamais journalisée.
create or replace function issue_presentation_token(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_ttl int; v_ref text; k presentation_tokens;
begin
  tr := _request_tranche(p_request);
  if not _is_initiator(tr.tx_id) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if tr.status <> 'SUBMITTED' then perform _err('NOT_PAYABLE', 'Seule une demande soumise se présente'); end if;
  v_ttl := (select value::int from app_config where key = 'presentation_token_ttl_seconds');
  if v_ttl is null or v_ttl <= 0 then perform _err('NOT_CONFIGURED', 'Durée de vie du jeton de présentation non configurée'); end if;
  update presentation_tokens set revoked_at = now() where tranche_id = p_request and revoked_at is null and claimed_at is null;
  v_ref := replace(gen_random_uuid()::text, '-', '');
  insert into presentation_tokens(tranche_id, token_hash, expires_at, created_by)
  values (p_request, _token_hash(v_ref), now() + make_interval(secs => v_ttl), auth.uid()) returning * into k;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'PRESENTATION_TOKEN_ISSUED', jsonb_build_object('token_id', k.id, 'expires_at', k.expires_at));
  return jsonb_build_object('reference', v_ref, 'expiresAt', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create or replace function revoke_presentation_tokens(p_request uuid) returns int
language plpgsql security definer set search_path = public as $$
declare tr tranches; n int;
begin
  tr := _request_tranche(p_request);
  if not _is_initiator(tr.tx_id) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  update presentation_tokens set revoked_at = now() where tranche_id = p_request and revoked_at is null and claimed_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (tr.tx_id, tr.id, auth.uid(), 'PRESENTATION_TOKEN_REVOKED', jsonb_build_object('count', n));
  end if;
  return n;
end $$;

-- Prise en charge : usage unique ; lie la demande à l’utilisateur connecté (payeur invité par téléphone, ou payeur encore
-- inconnu) ; résumé minimal (nom de l’initiateur, montant, devise) ; aucun paiement autorisé. Référence inconnue, ou demande
-- déjà liée à un autre payeur : null (même réponse, échec compté pour la limitation). Expiré, révoqué, déjà pris : code stable.
create or replace function claim_presentation_token(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k presentation_tokens; tr tranches; t transactions; v_payer transaction_parties; v_name text;
begin
  perform _require_user();
  perform _reference_guard();
  select * into k from presentation_tokens where token_hash = _token_hash(p_reference) for update;
  if found then
    select * into tr from tranches where id = k.tranche_id;
    select * into t from transactions where id = tr.tx_id;
    select * into v_payer from transaction_parties where tx_id = t.id and role = 'PAYER' order by user_id nulls last limit 1;
  end if;
  if k.id is null or (v_payer.user_id is not null and v_payer.user_id <> auth.uid()) or coalesce(t.initiator_id, t.created_by) = auth.uid() then
    perform _reference_failed(p_reference, 'claim_presentation_token');
    return null;
  end if;
  if k.revoked_at is not null then perform _err('TOKEN_REVOKED', 'Ce QR a été révoqué'); end if;
  if k.claimed_at is not null then perform _err('TOKEN_USED', 'Ce QR a déjà été utilisé'); end if;
  if k.expires_at <= now() then perform _err('TOKEN_EXPIRED', 'QR expiré'); end if;
  if tr.status <> 'SUBMITTED' or t.status <> 'ACTIVE' then perform _err('NOT_PAYABLE', 'Cette demande n’est plus présentable'); end if;
  update presentation_tokens set claimed_at = now(), claimed_by = auth.uid() where id = k.id;
  if v_payer.tx_id is null then
    insert into transaction_parties(tx_id, user_id, role) values (t.id, auth.uid(), 'PAYER');
  elsif v_payer.user_id is null then
    update transaction_parties set user_id = auth.uid() where id = v_payer.id;
  end if;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (t.id, tr.id, auth.uid(), 'PRESENTATION_CLAIMED', jsonb_build_object('token_id', k.id));
  select coalesce(nullif(trim(full_name), ''), '') into v_name from profiles where id = coalesce(t.initiator_id, t.created_by);
  return jsonb_build_object('trancheId', tr.id, 'txId', t.id, 'initiatorName', coalesce(v_name, ''), 'amountMinor', tr.amount_minor, 'currency', t.currency);
end $$;

-- ---------- Droits (X3) ----------
revoke all on function _token_hash(text) from public, anon, authenticated;
revoke all on function accept_plan(uuid), issue_presentation_token(uuid), revoke_presentation_tokens(uuid), claim_presentation_token(text) from public, anon;
grant execute on function accept_plan(uuid), issue_presentation_token(uuid), revoke_presentation_tokens(uuid), claim_presentation_token(text) to authenticated;
