-- =====================================================================
-- DiasPay : migration v0.3 (à appliquer SUR v0.1 + v0.2)
-- Corrige les défauts trouvés en exécutant réellement les migrations et
-- applique les décisions D4 (abandon d'un dossier) et la politique de
-- litige. Voir aussi 00_smoke.sql.
-- =====================================================================

-- 1. Un créateur doit pouvoir lire son brouillon avant d'y avoir ajouté des
--    parties (sinon la politique d'insertion des parties échoue).
drop policy if exists tx_read on transactions;
create policy tx_read on transactions for select
  using (created_by = auth.uid() or is_party(id) or is_validator());

-- 2. Sans pgcrypto : sur Supabase, pgcrypto vit dans le schéma "extensions", que
--    les fonctions SECURITY DEFINER (search_path = public) ne voient pas.
--    On utilise sha256() et gen_random_uuid(), natifs depuis PostgreSQL 13.
--    Le calcul des empreintes est identique : les lignes existantes restent vérifiables.
create or replace function audit_chain() returns trigger
language plpgsql as $$
declare last_hash text;
begin
  perform pg_advisory_xact_lock(hashtext(new.tx_id::text));
  select hash into last_hash from audit_log
    where tx_id = new.tx_id order by id desc limit 1;
  new.prev_hash := last_hash;
  new.created_at := now();
  new.hash := encode(sha256(convert_to(
    coalesce(last_hash,'') || new.tx_id::text || coalesce(new.actor_id::text,'') ||
    new.event || coalesce(new.from_status::text,'') || coalesce(new.to_status::text,'') ||
    new.payload::text || new.created_at::text || coalesce(new.tranche_id::text,''),
    'UTF8')), 'hex');
  return new;
end $$;

create or replace function verify_audit(p_tx uuid) returns boolean
language plpgsql stable as $$
declare r record; prev text := null; expected text;
begin
  for r in select * from audit_log where tx_id = p_tx order by id loop
    expected := encode(sha256(convert_to(
      coalesce(prev,'') || r.tx_id::text || coalesce(r.actor_id::text,'') ||
      r.event || coalesce(r.from_status::text,'') || coalesce(r.to_status::text,'') ||
      r.payload::text || r.created_at::text || coalesce(r.tranche_id::text,''),
      'UTF8')), 'hex');
    if r.hash <> expected or r.prev_hash is distinct from prev then return false; end if;
    prev := r.hash;
  end loop;
  return true;
end $$;

create or replace function _issue_tranche_token(p_tranche uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ttl int;
begin
  select value::int into ttl from app_config where key = 'token_ttl_days';
  insert into tranche_tokens(tranche_id, kid, signature, expires_at)
  values (p_tranche, 'SIMULATED', 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''),
          now() + make_interval(days => ttl))
  on conflict (tranche_id) do nothing;
end $$;

create or replace function simulate_system_transition(p_tx uuid, p_to tx_status)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ttl int; old_status tx_status;
begin
  if (select value from app_config where key = 'mock_mode') <> 'true' then
    raise exception 'Simulation désactivée';
  end if;
  if not is_party(p_tx) and not is_validator() then raise exception 'Accès refusé'; end if;
  select * into t from transactions where id = p_tx for update;
  if not exists (select 1 from allowed_transitions
      where from_status = t.status and to_status = p_to and role = 'SYSTEM') then
    raise exception 'Transition système % -> % invalide', t.status, p_to;
  end if;

  perform set_config('app.via_transition','on', true);
  if p_to = 'TOKEN_ISSUED' then
    select value::int into ttl from app_config where key = 'token_ttl_days';
    insert into trust_tokens(tx_id, signature, expires_at)
    values (p_tx, 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''),
            now() + make_interval(days => ttl))
    on conflict (tx_id) do nothing;
    update transactions set expires_at = now() + make_interval(days => ttl) where id = p_tx;
  end if;
  old_status := t.status;
  update transactions set status = p_to where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'SYSTEM_SIMULATED', old_status, p_to, '{}');
  return t;
end $$;

alter table trust_tokens   alter column reference set default substr(replace(gen_random_uuid()::text,'-',''),1,18);
alter table tranche_tokens alter column reference set default substr(replace(gen_random_uuid()::text,'-',''),1,18);

-- 3. Décision D4 : un dossier rejeté peut être abandonné (trace conservée).
insert into allowed_transitions(from_status,to_status,role,validator_only) values
 ('REJECTED','CANCELLED','REQUESTER',false),
 ('REJECTED','CANCELLED','PAYER',false)
on conflict do nothing;

-- 4. Décision D4 : seul un brouillon jamais audité peut être supprimé, par son créateur.
create or replace function has_audit(p_tx uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from audit_log where tx_id = p_tx);
$$;
revoke all on function has_audit from public, anon;
grant execute on function has_audit to authenticated;
drop policy if exists tx_delete_draft on transactions;
create policy tx_delete_draft on transactions for delete
  using (created_by = auth.uid() and status = 'DRAFT' and not has_audit(id));

-- 5. Profils : un validateur ou un administrateur doit pouvoir modifier son profil.
--    On protège les colonnes sensibles par un déclencheur plutôt que par la politique.
alter table profiles add column if not exists primary_role text
  check (primary_role in ('PAYER','REQUESTER','PROVIDER'));
alter table profiles add column if not exists push_enabled boolean not null default true;

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function guard_profile() returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated')
     and (new.platform_role is distinct from old.platform_role
          or new.kyc_status is distinct from old.kyc_status) then
    raise exception 'Le rôle de plateforme et le statut KYC ne sont pas modifiables';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_trg on profiles;
create trigger guard_profile_trg before update on profiles
  for each row execute function guard_profile();

-- 6. Litiges : le motif saisi (>= 10 caractères) reste dans reason ; le code de motif
--    choisi dans l'interface est stocké à part.
alter table disputes add column if not exists reason_code text
  check (reason_code in ('NOT_DELIVERED','INCOMPLETE','WRONG_AMOUNT','OTHER'));

drop function if exists open_dispute(uuid, text);
create or replace function open_dispute(p_tranche uuid, p_reason text, p_reason_code text default null)
returns disputes language plpgsql security definer set search_path = public as $$
declare tr tranches; d disputes; is_payer boolean; is_provider boolean;
begin
  select * into tr from tranches where id = p_tranche for update;
  if not found then raise exception 'Tranche introuvable'; end if;
  is_payer := has_role(tr.tx_id,'PAYER');
  is_provider := has_role(tr.tx_id,'PROVIDER');
  if not (is_payer or is_provider) then raise exception 'Accès refusé'; end if;

  if tr.status in ('PAID_LOCKED','EVIDENCE_SUBMITTED') then
    null;
  elsif tr.status = 'CONFIRMED' and is_payer and tr.contest_ends_at is not null
        and now() <= tr.contest_ends_at then
    null;
  else
    raise exception 'Litige impossible dans l''état % (ou délai de contestation écoulé)', tr.status;
  end if;

  insert into disputes(tx_id, tranche_id, opened_by, reason, reason_code)
  values (tr.tx_id, p_tranche, auth.uid(), p_reason, p_reason_code) returning * into d;
  perform _set_tranche_status(p_tranche, 'DISPUTED', auth.uid(), 'DISPUTE_OPENED',
           jsonb_build_object('dispute_id', d.id));
  return d;
end $$;
revoke all on function open_dispute(uuid, text, text) from public, anon;
grant execute on function open_dispute(uuid, text, text) to authenticated;
