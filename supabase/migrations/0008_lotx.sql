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
-- X2. Décisions du payeur (serveur seulement, sans écran)
--   6. Statuts INFO_REQUESTED et REJECTED, transitions, clôture
--   7. Messages d’une demande (request_messages), request_info, answer_info, reject_request
--   8. Notifications PAYMENT_REQUEST_RECEIVED, INFO_REQUESTED, INFO_ANSWERED, REQUEST_REJECTED
--   9. Mode de déblocage IMMEDIATE (paiement direct, événement DIRECT_PAYMENT) : aucun type de besoin ne l’utilise
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

-- ---------- X2.6 Statuts et transitions ----------
-- Les transitions de décision du payeur passent par request_info, answer_info et reject_request (motif obligatoire) ;
-- transition_tranche les refuse. AWAITING_PAYMENT → RELEASED (système) n’existe que pour le mode IMMEDIATE.
insert into tranche_transitions values
 ('AWAITING_PAYMENT','INFO_REQUESTED','PAYER',false),
 ('INFO_REQUESTED','AWAITING_PAYMENT','REQUESTER',false),
 ('INFO_REQUESTED','AWAITING_PAYMENT','PROVIDER',false),
 ('AWAITING_PAYMENT','REJECTED','PAYER',false),
 ('INFO_REQUESTED','REJECTED','PAYER',false),
 ('AWAITING_PAYMENT','RELEASED','SYSTEM',false)
on conflict do nothing;

alter table release_events drop constraint if exists release_events_trigger_check;
alter table release_events add constraint release_events_trigger_check check (trigger in
  ('PROVIDER_CONFIRMATION','AUTO_TIMEOUT','ADMIN','PAYER_APPROVAL','VALIDATOR_APPROVAL','DISPUTE_RESOLUTION','DIRECT_PAYMENT'));

-- REJECTED est terminal : il compte pour la clôture de la transaction.
create or replace function _set_tranche_status(
  p_tranche uuid, p_to tranche_status, p_actor uuid, p_event text, p_payload jsonb default '{}')
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; old tranche_status; open_count int; tx_status_now tx_status;
begin
  select * into tr from tranches where id = p_tranche for update;
  old := tr.status;
  perform set_config('app.via_transition','on', true);
  update tranches set
    status = p_to,
    contest_ends_at = case when p_to = 'CONFIRMED' and release_mode <> 'EVIDENCE_REVIEW'
                           then now() + make_interval(hours => contest_hours) else contest_ends_at end,
    released_at = case when p_to = 'RELEASED' then now() else released_at end
  where id = p_tranche returning * into tr;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (tr.tx_id, tr.id, p_actor, p_event, jsonb_build_object('tranche_from', old, 'tranche_to', p_to) || p_payload);
  if p_to = 'RELEASED' then
    insert into release_events(tx_id, tranche_id, trigger) values (tr.tx_id, tr.id, coalesce(p_payload->>'trigger','ADMIN'));
  end if;
  if p_to in ('RELEASED','CANCELLED','EXPIRED','REJECTED') then
    select count(*) into open_count from tranches
      where tx_id = tr.tx_id and status not in ('RELEASED','CANCELLED','EXPIRED','REJECTED');
    select status into tx_status_now from transactions where id = tr.tx_id;
    if open_count = 0 and tx_status_now = 'IN_PROGRESS' then
      update transactions set status = 'CLOSED' where id = tr.tx_id;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status)
      values (tr.tx_id, p_actor, 'TX_CLOSED', 'IN_PROGRESS', 'CLOSED');
    end if;
  end if;
  return tr;
end $$;

-- Transitions des utilisateurs : celles du payeur (informations, rejet) exigent la fonction dédiée.
create or replace function transition_tranche(p_tranche uuid, p_to tranche_status, p_reason text default null)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions; ok boolean := false; r tx_role; trig text;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into t from transactions where id = tr.tx_id;
  if t.status <> 'IN_PROGRESS' then perform _err('TX_NOT_ACTIVE', 'La transaction n’est pas active'); end if;
  if not exists (select 1 from tranche_transitions where from_status = tr.status and to_status = p_to) then
    perform _err('TRANSITION_UNKNOWN', format('Transition de tranche %s -> %s inconnue', tr.status, p_to));
  end if;
  if p_to in ('INFO_REQUESTED','REJECTED') or tr.status = 'INFO_REQUESTED' then
    perform _err('TRANSITION_FORBIDDEN', 'Décision du payeur : utiliser request_info, answer_info ou reject_request');
  end if;
  foreach r in array array['PAYER','PROVIDER']::tx_role[] loop
    if has_role(tr.tx_id, r) and exists (select 1 from tranche_transitions
        where from_status = tr.status and to_status = p_to and role = r and not validator_only) then
      ok := true;
    end if;
  end loop;
  if not ok then perform _err('TRANSITION_FORBIDDEN', format('Transition de tranche %s -> %s non autorisée', tr.status, p_to)); end if;
  if tr.status = 'PAID_LOCKED' and p_to = 'CONFIRMED' then
    if not ((tr.release_mode = 'PROVIDER_CONFIRM' and has_role(tr.tx_id,'PROVIDER'))
         or (tr.release_mode = 'PAYER_CONFIRM'    and has_role(tr.tx_id,'PAYER'))) then
      perform _err('WRONG_CONFIRMER', format('Ce rôle ne peut pas confirmer cette tranche (mode %s)', tr.release_mode));
    end if;
  end if;
  if tr.status = 'PAID_LOCKED' and p_to = 'EVIDENCE_SUBMITTED' then
    if tr.release_mode <> 'EVIDENCE_REVIEW' then perform _err('NO_EVIDENCE_NEEDED', 'Cette tranche ne requiert pas de preuve'); end if;
    if not exists (select 1 from documents where tranche_id = p_tranche and deleted_at is null) then
      perform _err('EVIDENCE_MISSING', 'Déposez au moins une pièce probante');
    end if;
  end if;
  if tr.status = 'CONFIRMED' and p_to = 'RELEASED' and not has_role(tr.tx_id,'PAYER') then
    perform _err('PAYER_ONLY', 'Seul le payeur peut approuver le déblocage anticipé');
  end if;
  trig := case when p_to = 'RELEASED' then 'PAYER_APPROVAL' else null end;
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'TRANCHE_CHANGE', jsonb_build_object('reason', p_reason, 'trigger', trig));
end $$;

-- Paiement simulé (mock_mode) : en mode IMMEDIATE, le paiement débloque directement (DIRECT_PAYMENT).
create or replace function simulate_tranche_system(p_tranche uuid, p_to tranche_status)
returns tranches language plpgsql security definer set search_path = public as $$
declare tr tranches; t transactions;
begin
  perform _require_user();
  if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
  select * into tr from tranches where id = p_tranche for update;
  if not found or not (is_party(tr.tx_id) or is_validator()) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into t from transactions where id = tr.tx_id;
  if t.status <> 'IN_PROGRESS' then perform _err('TX_NOT_ACTIVE', 'La transaction n’est pas active'); end if;
  if p_to = 'PAID_LOCKED' and tr.status <> 'AWAITING_PAYMENT' then perform _err('NOT_PAYABLE', 'Cette tranche n’est pas à payer'); end if;
  if p_to = 'RELEASED' and tr.status = 'AWAITING_PAYMENT' then
    perform _err('NOT_PAID', 'Seul un paiement débloque directement une tranche (mode IMMEDIATE)');
  end if;
  if not exists (select 1 from tranche_transitions
      where from_status = tr.status and to_status = p_to and role = 'SYSTEM' and not validator_only) then
    perform _err('TRANSITION_UNKNOWN', format('Transition système %s -> %s invalide', tr.status, p_to));
  end if;
  if p_to = 'AWAITING_PAYMENT' then perform _issue_tranche_token(p_tranche); end if;
  if p_to = 'PAID_LOCKED' then
    insert into payments(tx_id, tranche_id, provider, status) values (tr.tx_id, p_tranche, 'MOCK', 'SUCCEEDED');
    if tr.release_mode = 'IMMEDIATE' then
      return _set_tranche_status(p_tranche, 'RELEASED', auth.uid(), 'DIRECT_PAYMENT', jsonb_build_object('trigger', 'DIRECT_PAYMENT'));
    end if;
  end if;
  return _set_tranche_status(p_tranche, p_to, auth.uid(), 'SYSTEM_SIMULATED',
           jsonb_build_object('trigger', case when p_to = 'RELEASED' then 'AUTO_TIMEOUT' end));
end $$;

-- ---------- X2.7 Messages d’une demande ----------
create table if not exists request_messages (
  id         uuid primary key default gen_random_uuid(),
  tx_id      uuid not null references transactions(id) on delete cascade,
  tranche_id uuid references tranches(id) on delete cascade,
  author_id  uuid not null references profiles(id),
  kind       text not null check (kind in ('INFO_REQUEST','INFO_ANSWER','NOTE')),
  body       text not null check (length(trim(body)) between 3 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists request_messages_tx on request_messages(tx_id, created_at);
alter table request_messages enable row level security;
drop policy if exists request_messages_read on request_messages;
create policy request_messages_read on request_messages for select using (is_party(tx_id) or is_validator());
revoke insert, update, delete on request_messages from anon, authenticated;

-- Immuable : seule la réinitialisation de démonstration (mock_mode) peut effacer, comme le journal.
create or replace function _request_messages_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then return old; end if;
  raise exception 'request_messages est en ajout seul';
end $$;
drop trigger if exists request_messages_immutable on request_messages;
create trigger request_messages_immutable before update or delete on request_messages
  for each row execute function _request_messages_immutable();

-- Texte d’un message : 3 à 2000 caractères (miroir de messageError, @diaspay/domain).
create or replace function _check_message(p_text text) returns text
language plpgsql immutable as $$
begin
  if coalesce(length(trim(p_text)), 0) < 3 then perform _err('REASON_REQUIRED', 'Message ou motif obligatoire'); end if;
  if length(trim(p_text)) > 2000 then perform _err('VALIDATION', 'Message trop long (2000 caractères au plus)'); end if;
  return trim(p_text);
end $$;

-- Tranche d’une demande en cours, pour une partie (codes communs aux trois décisions).
create or replace function _request_tranche(p_tranche uuid) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches;
begin
  perform _require_user();
  select * into tr from tranches where id = p_tranche for update;
  if not found or not is_party(tr.tx_id) then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  if (select status from transactions where id = tr.tx_id) <> 'IN_PROGRESS' then perform _err('TX_NOT_ACTIVE', 'La transaction n’est pas active'); end if;
  return tr;
end $$;

-- Le payeur demande des informations complémentaires à l’initiateur (qui n’est pas lui-même).
create or replace function request_info(p_tranche uuid, p_message text) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_text text; m request_messages;
begin
  tr := _request_tranche(p_tranche);
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  if tr.status <> 'AWAITING_PAYMENT' then perform _err('TRANSITION_UNKNOWN', format('Transition de tranche %s -> INFO_REQUESTED inconnue', tr.status)); end if;
  if (select created_by from transactions where id = tr.tx_id) = auth.uid() then
    perform _err('TRANSITION_FORBIDDEN', 'Vous êtes l’initiateur de cette demande');
  end if;
  v_text := _check_message(p_message);
  insert into request_messages(tx_id, tranche_id, author_id, kind, body) values (tr.tx_id, tr.id, auth.uid(), 'INFO_REQUEST', v_text) returning * into m;
  return _set_tranche_status(p_tranche, 'INFO_REQUESTED', auth.uid(), 'INFO_REQUESTED', jsonb_build_object('message_id', m.id));
end $$;

-- L’initiateur de la demande répond : la tranche revient à payer. Ses pièces sont des documents de la tranche.
create or replace function answer_info(p_tranche uuid, p_message text) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_text text; m request_messages;
begin
  tr := _request_tranche(p_tranche);
  if (select created_by from transactions where id = tr.tx_id) <> auth.uid() then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  if tr.status <> 'INFO_REQUESTED' then perform _err('TRANSITION_UNKNOWN', format('Transition de tranche %s -> AWAITING_PAYMENT inconnue', tr.status)); end if;
  v_text := _check_message(p_message);
  insert into request_messages(tx_id, tranche_id, author_id, kind, body) values (tr.tx_id, tr.id, auth.uid(), 'INFO_ANSWER', v_text) returning * into m;
  return _set_tranche_status(p_tranche, 'AWAITING_PAYMENT', auth.uid(), 'INFO_ANSWERED', jsonb_build_object('message_id', m.id));
end $$;

-- Le payeur rejette la demande : tranche REJECTED (terminale), jeton révoqué, motif conservé.
create or replace function reject_request(p_tranche uuid, p_reason text) returns tranches
language plpgsql security definer set search_path = public as $$
declare tr tranches; v_text text; m request_messages;
begin
  tr := _request_tranche(p_tranche);
  if not has_role(tr.tx_id, 'PAYER') then perform _err('PAYER_ONLY', 'Réservé au payeur'); end if;
  if tr.status not in ('AWAITING_PAYMENT','INFO_REQUESTED') then
    perform _err('TRANSITION_UNKNOWN', format('Transition de tranche %s -> REJECTED inconnue', tr.status));
  end if;
  v_text := _check_message(p_reason);
  insert into request_messages(tx_id, tranche_id, author_id, kind, body) values (tr.tx_id, tr.id, auth.uid(), 'NOTE', v_text) returning * into m;
  perform _revoke_active_token(p_tranche, 'Demande rejetée par le payeur', auth.uid());
  return _set_tranche_status(p_tranche, 'REJECTED', auth.uid(), 'REQUEST_REJECTED', jsonb_build_object('message_id', m.id, 'reason', v_text));
end $$;

-- Pièces d’une réponse : déposées par l’initiateur pendant que la tranche attend des informations.
drop policy if exists docs_insert_info on documents;
create policy docs_insert_info on documents for insert with check (
  uploaded_by = auth.uid() and tranche_id is not null
  and exists (select 1 from tranches tr join transactions t on t.id = tr.tx_id
              where tr.id = tranche_id and tr.tx_id = documents.tx_id and tr.status = 'INFO_REQUESTED' and t.created_by = auth.uid()));
drop policy if exists dossiers_insert_info on storage.objects;
create policy dossiers_insert_info on storage.objects for insert with check (
  bucket_id = 'dossiers' and exists (
    select 1 from transactions t join tranches tr on tr.tx_id = t.id
    where t.id = _storage_tx(name) and tr.status = 'INFO_REQUESTED' and t.created_by = auth.uid()));

-- ---------- X2.8 Notifications ----------
-- Destinataires : toutes les parties (événements existants, inchangés), les autres parties que l’auteur (décisions
-- et réponses), ou le payeur seul (demande reçue d’un prestataire). Aucun texte : l’application fait le libellé.
create or replace function _notify_from_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_payload jsonb; v_to text; v_outcome text; v_release timestamptz; v_who text := 'ALL';
begin
  v_to := new.payload->>'tranche_to';
  if new.tranche_id is null then
    if new.to_status = 'VALIDATED' then v_type := 'TX_VALIDATED';
    elsif new.to_status = 'REJECTED' then v_type := 'TX_REJECTED';
    elsif new.to_status = 'SUBMITTED' and exists (
        select 1 from transaction_parties p join transactions t on t.id = p.tx_id
        where p.tx_id = new.tx_id and p.role = 'PROVIDER' and p.user_id = t.created_by) then
      v_type := 'PAYMENT_REQUEST_RECEIVED'; v_who := 'PAYER';
    end if;
  elsif new.event = 'DISPUTE_OPENED' then v_type := 'DISPUTE_OPENED';
  elsif new.event = 'DISPUTE_RESOLVED' then
    v_type := 'DISPUTE_RESOLVED';
    v_outcome := case new.payload->>'outcome' when 'RELEASE_TO_PROVIDER' then 'RELEASED' else 'REFUNDED' end;
  elsif new.event in ('INFO_REQUESTED','INFO_ANSWERED','REQUEST_REJECTED') then v_type := new.event; v_who := 'OTHERS';
  elsif v_to = 'AWAITING_PAYMENT' then v_type := 'PAYMENT_READY';
  elsif v_to = 'CONFIRMED' then
    v_type := 'TRANCHE_CONFIRMED';
    select contest_ends_at into v_release from tranches where id = new.tranche_id;
  elsif v_to = 'RELEASED' then v_type := 'TRANCHE_RELEASED';
  end if;
  if v_type is null then return new; end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'type', v_type, 'txId', new.tx_id, 'trancheId', new.tranche_id,
    'reason', case when v_type = 'TX_REJECTED' then coalesce(new.payload->>'reason', '') end,
    'releaseAt', case when v_release is not null then to_char(v_release at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'outcome', v_outcome));
  insert into notifications(user_id, tx_id, event, payload)
  select distinct p.user_id, new.tx_id, v_type, v_payload from transaction_parties p
  where p.tx_id = new.tx_id and p.user_id is not null
    and (v_who = 'ALL' or (v_who = 'OTHERS' and p.user_id is distinct from new.actor_id) or (v_who = 'PAYER' and p.role = 'PAYER'));
  return new;
end $$;

-- ---------- Droits (X2) ----------
revoke all on function _check_message(text), _request_tranche(uuid), _request_messages_immutable(),
  _set_tranche_status(uuid, tranche_status, uuid, text, jsonb), _notify_from_audit() from public, anon, authenticated;
revoke all on function request_info(uuid, text), answer_info(uuid, text), reject_request(uuid, text),
  transition_tranche(uuid, tranche_status, text), simulate_tranche_system(uuid, tranche_status) from public, anon;
grant execute on function request_info(uuid, text), answer_info(uuid, text), reject_request(uuid, text),
  transition_tranche(uuid, tranche_status, text), simulate_tranche_system(uuid, tranche_status) to authenticated;
revoke all on request_messages from anon;
grant select on request_messages to authenticated;
alter publication supabase_realtime add table request_messages;
