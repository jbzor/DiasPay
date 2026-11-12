-- =====================================================================
-- DiasPay : migration 0008 (lot X, passe 1) — fondations du cahier d’extension, sans changer le flux par défaut.
-- À appliquer SUR 0001 à 0007. Ne modifie aucune migration précédente : fonctions redéfinies, tables étendues.
-- Test : supabase/tests/03_lotx.sql (variante éditeur SQL : 03_lotx_editor.sql).
--
-- X1. Sécurité du TrustLink
--   1. Réglage eqr_image_enabled (image du QR facultative, défaut 'true')
--   2. Révocation et réémission des jetons (revoke_token, reissue_token), jeton révoqué refusé (TOKEN_REVOKED)
--   3. Jeton lisible par le payeur seulement ; référence inconnue et dossier étranger : même réponse
--   4. Événements de sécurité (security_events) et limitation des résolutions échouées (TOO_MANY_ATTEMPTS)
--   5. Ouverture d’une demande par le payeur (mark_received, REQUEST_VIEWED)
-- Droits à la fin de chaque partie : rien d’exécutable par anon, fonctions internes réservées.
-- =====================================================================

-- ---------- X1.1 Image du QR facultative ----------
-- 'true' : le scan du prestataire reste possible. Décision du client attendue (liste de contrôle de publication).
insert into app_config(key, value) values ('eqr_image_enabled', 'true') on conflict (key) do nothing;

-- ---------- X1.2 Révocation des jetons ----------
-- Un jeton révoqué est conservé (traçabilité, refus explicite TOKEN_REVOKED) : la tranche peut donc avoir
-- plusieurs jetons, dont un seul actif. La clé primaire passe de tranche_id à un identifiant propre.
alter table tranche_tokens add column if not exists id uuid not null default gen_random_uuid();
alter table tranche_tokens add column if not exists revoked_at timestamptz;
alter table tranche_tokens add column if not exists revoked_by uuid references profiles(id);
alter table tranche_tokens add column if not exists revoke_reason text;
alter table tranche_tokens drop constraint if exists tranche_tokens_pkey;
alter table tranche_tokens add constraint tranche_tokens_pkey primary key (id);
create unique index if not exists tranche_tokens_one_active on tranche_tokens(tranche_id) where revoked_at is null;
create index if not exists tranche_tokens_tranche on tranche_tokens(tranche_id);
alter table tranche_tokens drop constraint if exists tranche_tokens_revocation;
alter table tranche_tokens add constraint tranche_tokens_revocation
  check (revoked_at is null or (revoke_reason is not null and length(trim(revoke_reason)) >= 3));

-- Émission (inchangée pour l’appelant) : un seul jeton actif par tranche.
create or replace function _issue_tranche_token(p_tranche uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ttl int;
begin
  select value::int into ttl from app_config where key = 'token_ttl_days';
  insert into tranche_tokens(tranche_id, kid, signature, expires_at)
  values (p_tranche, 'SIMULATED', 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''), now() + make_interval(days => ttl))
  on conflict (tranche_id) where revoked_at is null do nothing;
end $$;

-- Le jeton n’est lisible que par le payeur de la tranche, actif et une fois la tranche ouverte.
-- (Avant : toutes les parties. Le prestataire n’obtient la référence qu’en scannant le QR présenté par le payeur.)
drop policy if exists ttokens_read on tranche_tokens;
create policy ttokens_read on tranche_tokens for select using (
  revoked_at is null and exists (
    select 1 from tranches tr where tr.id = tranche_id and tr.status <> 'PLANNED' and has_role(tr.tx_id, 'PAYER')));

-- Révocation interne : renvoie l’identifiant du jeton révoqué (null si aucun jeton actif). Journalisée.
create or replace function _revoke_active_token(p_tranche uuid, p_reason text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare k tranche_tokens;
begin
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null for update;
  if not found then return null; end if;
  update tranche_tokens set revoked_at = now(), revoked_by = p_actor, revoke_reason = trim(p_reason) where id = k.id;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  select tr.tx_id, tr.id, p_actor, 'TOKEN_REVOKED', jsonb_build_object('token_id', k.id, 'reason', trim(p_reason))
  from tranches tr where tr.id = p_tranche;
  return k.id;
end $$;

-- Qui peut révoquer : l’initiateur de la demande tant que la tranche n’est pas payée, ou un administrateur non partie.
create or replace function _check_token_manager(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; v_admin boolean;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  v_admin := is_admin();
  if not (is_party(tr.tx_id) or v_admin) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if v_admin and not is_party(tr.tx_id) then return tr; end if;
  select * into t from transactions where id = tr.tx_id;
  if t.created_by <> auth.uid() then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if tr.status not in ('PLANNED','AWAITING_PAYMENT','INFO_REQUESTED') then
    perform _err('NOT_REVOCABLE', 'Tranche déjà payée : seul un administrateur peut révoquer son jeton');
  end if;
  return tr;
end $$;

create or replace function revoke_token(p_tranche uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_id uuid;
begin
  tr := _check_token_manager(p_tranche);
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif de révocation obligatoire'); end if;
  v_id := _revoke_active_token(p_tranche, p_reason, auth.uid());
  if v_id is null then perform _err('NO_TOKEN', 'Aucun jeton actif pour cette tranche'); end if;
  return jsonb_build_object('trancheId', tr.id, 'tokenId', v_id, 'revoked', true);
end $$;

-- Révoque le jeton actif et en émet un nouveau (nouvelle référence). La nouvelle référence n’est jamais journalisée.
create or replace function reissue_token(p_tranche uuid, p_reason text default 'Réémission du jeton') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_old uuid; k tranche_tokens;
begin
  tr := _check_token_manager(p_tranche);
  if tr.status = 'PLANNED' then perform _err('NO_TOKEN', 'Tranche pas encore ouverte : aucun jeton'); end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif de réémission obligatoire'); end if;
  v_old := _revoke_active_token(p_tranche, p_reason, auth.uid());
  perform _issue_tranche_token(p_tranche);
  select * into k from tranche_tokens where tranche_id = p_tranche and revoked_at is null;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, auth.uid(), 'TOKEN_REISSUED', jsonb_build_object('token_id', k.id, 'replaces', v_old));
  return jsonb_build_object('trancheId', tr.id, 'tokenId', k.id,
    'expiresAt', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- ---------- X1.4 Événements de sécurité et limitation ----------
create table if not exists security_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references profiles(id) on delete set null,
  kind       text not null check (kind in ('REFERENCE_FAILED','SUSPICIOUS_ACTIVITY')),
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists security_events_user on security_events(user_id, kind, created_at);
alter table security_events enable row level security;
drop policy if exists security_events_staff_read on security_events;
create policy security_events_staff_read on security_events for select using (is_validator());
revoke insert, update, delete on security_events from anon, authenticated;

create or replace function _security_events_immutable() returns trigger language plpgsql as $$
begin raise exception 'security_events est en ajout seul'; end $$;
drop trigger if exists security_events_immutable on security_events;
create trigger security_events_immutable before update or delete on security_events
  for each row execute function _security_events_immutable();

-- Plus de 10 résolutions échouées par utilisateur et par heure : refus (TOO_MANY_ATTEMPTS).
insert into app_config(key, value) values ('reference_failure_limit', '10') on conflict (key) do nothing;

create or replace function _reference_failures() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from security_events
  where user_id = auth.uid() and kind = 'REFERENCE_FAILED' and created_at > now() - interval '1 hour'
$$;

create or replace function _reference_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if _reference_failures() >= coalesce((select value::int from app_config where key = 'reference_failure_limit'), 10) then
    perform _err('TOO_MANY_ATTEMPTS', 'Trop de tentatives : réessayez plus tard');
  end if;
end $$;

-- Échec d’une résolution : enregistré (la fonction appelante répond normalement, sinon l’annulation l’effacerait).
-- Au seuil, un événement SUSPICIOUS_ACTIVITY est écrit une fois.
create or replace function _reference_failed(p_ref text, p_via text) returns void
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  insert into security_events(user_id, kind, detail)
  values (auth.uid(), 'REFERENCE_FAILED', jsonb_build_object('via', p_via, 'prefix', left(coalesce(p_ref, ''), 4)));
  lim := coalesce((select value::int from app_config where key = 'reference_failure_limit'), 10);
  if _reference_failures() = lim then
    insert into security_events(user_id, kind, detail)
    values (auth.uid(), 'SUSPICIOUS_ACTIVITY', jsonb_build_object('reason', 'REFERENCE_FAILURES', 'count', lim, 'window', '1 hour'));
  end if;
end $$;

-- Jeton d’une référence, pour une partie au dossier seulement (null : inconnue, ou dossier étranger — même réponse).
create or replace function _party_token(p_ref text) returns tranche_tokens
language sql stable security definer set search_path = public as $$
  select k.* from tranche_tokens k join tranches tr on tr.id = k.tranche_id
  where k.reference = lower(regexp_replace(coalesce(p_ref, ''), '[^0-9a-fA-F]', '', 'g')) and is_party(tr.tx_id)
$$;

-- ---------- X1.3 Résolution et confirmation ----------
-- Référence inconnue ou dossier étranger : réponse null (même réponse), échec enregistré. Jeton révoqué : TOKEN_REVOKED.
create or replace function resolve_reference_info(p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k tranche_tokens; tr tranches; t transactions;
begin
  perform _require_user();
  perform _reference_guard();
  k := _party_token(p_ref);
  if k.id is null then perform _reference_failed(p_ref, 'resolve_reference_info'); return null; end if;
  if k.revoked_at is not null then perform _err('TOKEN_REVOKED', 'Ce QR a été révoqué'); end if;
  select * into tr from tranches where id = k.tranche_id;
  select * into t from transactions where id = tr.tx_id;
  return jsonb_build_object(
    'trancheId', tr.id, 'txId', t.id, 'label', tr.label, 'amountMinor', tr.amount_minor, 'currency', t.currency, 'status', tr.status,
    'expiresAt', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'used', k.used_at is not null,
    'providerName', coalesce(t.provider_name, ''), 'beneficiaryName', coalesce(t.beneficiary_name, ''), 'purpose', coalesce(t.purpose, ''),
    'seq', tr.seq, 'contestHours', tr.contest_hours);
end $$;

-- Ancienne fonction de 0003 (toujours exposée) : mêmes règles ; aucune ligne si inconnue ou étrangère.
create or replace function resolve_tranche_reference(p_ref text)
returns table (tranche_id uuid, tx_id uuid, label text, amount_minor bigint, status tranche_status,
               expires_at timestamptz, used boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare k tranche_tokens;
begin
  perform _require_user();
  perform _reference_guard();
  k := _party_token(p_ref);
  if k.id is null then perform _reference_failed(p_ref, 'resolve_tranche_reference'); return; end if;
  if k.revoked_at is not null then perform _err('TOKEN_REVOKED', 'Ce QR a été révoqué'); end if;
  return query select tr.id, tr.tx_id, tr.label, tr.amount_minor, tr.status, k.expires_at, k.used_at is not null
    from tranches tr where tr.id = k.tranche_id;
end $$;

-- Confirmation par le prestataire. Inconnue ou dossier étranger : UNKNOWN_REFERENCE (même réponse ; l’échec n’est pas
-- enregistré, l’erreur annulant la transaction, mais la limite s’applique). Ordre des contrôles inchangé ensuite.
create or replace function confirm_by_reference(p_ref text, p_device_time timestamptz default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare k tranche_tokens; tr tranches; at_time timestamptz;
begin
  perform _require_user();
  perform _reference_guard();
  k := _party_token(p_ref);
  if k.id is null then perform _err('UNKNOWN_REFERENCE', 'Référence inconnue'); end if;
  select * into k from tranche_tokens where id = k.id for update;
  if k.revoked_at is not null then perform _err('TOKEN_REVOKED', 'Ce QR a été révoqué'); end if;
  select * into tr from tranches where id = k.tranche_id for update;
  if not has_role(tr.tx_id,'PROVIDER') then perform _err('PROVIDER_ONLY', 'Réservé au prestataire'); end if;
  if k.used_at is not null then perform _err('TOKEN_USED', 'Ce QR a déjà été utilisé'); end if;
  at_time := coalesce(p_device_time, now());
  if at_time > now() + interval '5 minutes' then perform _err('DEVICE_TIME_INVALID', 'Heure de l’appareil invalide'); end if;
  if at_time > k.expires_at then perform _err('TOKEN_EXPIRED', 'QR expiré'); end if;
  if tr.status <> 'PAID_LOCKED' then perform _err('NOT_PAID', format('Tranche non payée ou déjà traitée (%s)', tr.status)); end if;
  if tr.release_mode <> 'PROVIDER_CONFIRM' then perform _err('WRONG_MODE', 'Cette tranche ne se confirme pas par scan prestataire'); end if;
  update tranche_tokens set used_at = now() where id = k.id;
  return _set_tranche_status(tr.id, 'CONFIRMED', auth.uid(), 'PROVIDER_SCAN',
           jsonb_build_object('device_time', at_time, 'offline', p_device_time is not null));
end $$;

-- Reçu : référence du jeton actif (ou du dernier émis).
create or replace function get_receipt(p_tranche uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tr tranches; t transactions; k tranche_tokens; v_last text; v_count int; v_payer text;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if tr.status <> 'RELEASED' or tr.released_at is null then perform _err('NOT_RELEASED', 'Le reçu n’existe que pour une tranche débloquée'); end if;
  select * into t from transactions where id = tr.tx_id;
  select * into k from tranche_tokens where tranche_id = tr.id order by revoked_at desc nulls first, created_at desc limit 1;
  select hash, n into v_last, v_count from (
    select hash, count(*) over () as n, id from audit_log where tx_id = t.id order by id desc limit 1) x;
  select pr.full_name into v_payer from transaction_parties p join profiles pr on pr.id = p.user_id
    where p.tx_id = t.id and p.role = 'PAYER';
  return jsonb_build_object(
    'trancheId', tr.id, 'txId', t.id, 'label', tr.label, 'amountMinor', tr.amount_minor, 'currency', t.currency,
    'releasedAt', to_char(tr.released_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payerName', coalesce(v_payer, ''), 'providerName', coalesce(t.provider_name, ''), 'purpose', coalesce(t.purpose, ''),
    'reference', coalesce(k.reference, ''), 'lastHash', coalesce(v_last, ''), 'chainValid', verify_audit(t.id),
    'entryCount', coalesce(v_count, 0));
end $$;

-- ---------- X1.5 Ouverture de la demande par le payeur ----------
alter table tranches add column if not exists first_viewed_at timestamptz;

-- Payeur seulement, idempotente : la première ouverture est journalisée (REQUEST_VIEWED), les suivantes ne changent rien.
create or replace function mark_received(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  if tr.first_viewed_at is null then
    update tranches set first_viewed_at = now() where id = p_tranche returning * into tr;
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
    values (tr.tx_id, tr.id, auth.uid(), 'REQUEST_VIEWED', '{}');
  end if;
  return tr;
end $$;

-- ---------- Droits (X1) : rien d’exécutable par anon, fonctions internes réservées ----------
revoke all on function _revoke_active_token(uuid, text, uuid), _check_token_manager(uuid), _reference_failures(), _reference_guard(),
  _reference_failed(text, text), _party_token(text), _security_events_immutable(), _issue_tranche_token(uuid)
  from public, anon, authenticated;
revoke all on function revoke_token(uuid, text), reissue_token(uuid, text), mark_received(uuid) from public, anon;
grant execute on function revoke_token(uuid, text), reissue_token(uuid, text), mark_received(uuid) to authenticated;
revoke all on function resolve_reference_info(text), resolve_tranche_reference(text), confirm_by_reference(text, timestamptz), get_receipt(uuid)
  from public, anon;
grant execute on function resolve_reference_info(text), resolve_tranche_reference(text), confirm_by_reference(text, timestamptz), get_receipt(uuid)
  to authenticated;
revoke all on security_events from anon;
grant select on security_events to authenticated;
