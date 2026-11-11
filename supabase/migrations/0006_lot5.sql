-- =====================================================================
-- DiasPay : migration 0006 (lot 5) — ce que le bureau de contrôle attend du serveur.
-- À appliquer SUR 0001 à 0005. Ne modifie aucune migration précédente.
-- Test : supabase/tests/02_lot5.sql (variante éditeur SQL : 02_lot5_editor.sql).
--
--  1. Second facteur côté base : require_staff_mfa, is_validator() et is_admin() exigent aal2 (D7)
--  2. Files du bureau : vues bo_dossiers, bo_evidence_queue, bo_disputes (invoker, soumises à RLS)
--  3. Contrôles automatiques : dossier_checks, evidence_checks (D6)
--  4. Prise en charge : claim_dossier (D8)
--  5. Confirmation humaine du montant : decide_tx(…, p_amount_checked, …), validations.amount_checked (D6)
--  6. Pièces : dossier_documents, open_document (consultation journalisée), lecture du stockage conditionnée
--  7. Journal : bo_audit, bo_audit_verify, log_audit_export, bo_find_transactions, bo_decisions
--  8. Litiges : réponse de la partie adverse (respond_dispute), détail pour l’administrateur
--  9. Émission simulée du jeton après validation (développement : mock_mode et auto_issue_token)
-- 10. Droits : rien d’exécutable par anon, droits réappliqués explicitement
-- =====================================================================

-- ---------- 1. Second facteur côté base (D7) ----------
-- 'true' en production : un validateur ou un administrateur n’a ses droits qu’avec un jeton de niveau aal2.
insert into app_config(key, value) values ('require_staff_mfa', 'false') on conflict (key) do nothing;

create or replace function _staff_aal_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_config where key = 'require_staff_mfa'), 'false') <> 'true'
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- Mêmes signatures qu’en 0001 et 0003 : toutes les politiques RLS et fonctions qui les appellent en héritent.
create or replace function is_validator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and platform_role in ('VALIDATOR','ADMIN'))
     and _staff_aal_ok();
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and platform_role = 'ADMIN')
     and _staff_aal_ok();
$$;

create or replace function _require_validator() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  return auth.uid();
end $$;

-- Référence courte d’un dossier, affichée et recherchée par le bureau (8 premiers caractères hexadécimaux).
create or replace function _tx_ref(p_tx uuid) returns text
language sql immutable as $$ select upper(left(replace(p_tx::text, '-', ''), 8)) $$;

-- Nom affiché d’une partie, pour le personnel ou une partie au dossier seulement (profiles n’est lisible que par soi).
create or replace function _party_name(p_tx uuid, p_role tx_role) returns text
language sql stable security definer set search_path = public as $$
  select case when is_validator() or is_party(p_tx) then (
    select coalesce(nullif(trim(pr.full_name), ''), case when p.invited_phone is not null then '+' || _norm_phone(p.invited_phone) end)
    from transaction_parties p left join profiles pr on pr.id = p.user_id
    where p.tx_id = p_tx and p.role = p_role limit 1) end
$$;

-- Nom d’un membre du personnel (validateur, administrateur), pour le personnel seulement.
create or replace function _staff_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when is_validator() then (select nullif(trim(full_name), '') from profiles where id = p_user) end
$$;

-- Début du tour de validation courant : dernière soumission (un dossier corrigé recommence à zéro).
create or replace function _round_start(p_tx uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(max(created_at), '-infinity'::timestamptz) from audit_log where tx_id = p_tx and to_status = 'SUBMITTED'
$$;

create or replace function _evidence_round_start(p_tranche uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(max(created_at), '-infinity'::timestamptz) from audit_log
  where tranche_id = p_tranche and payload->>'tranche_to' = 'EVIDENCE_SUBMITTED'
$$;

-- ---------- 5. Confirmation humaine du montant (D6) ----------
alter table validations add column if not exists amount_checked boolean not null default false;
-- Toute approbation d’un dossier (hors preuve de jalon) porte la case cochée. NOT VALID : les validations
-- antérieures au lot 5 restent telles quelles ; toute nouvelle ligne est contrôlée.
alter table validations drop constraint if exists validations_amount_checked;
alter table validations add constraint validations_amount_checked
  check (tranche_id is not null or not approved or amount_checked) not valid;

-- ---------- 9. Émission simulée du jeton après validation (développement) ----------
-- En production, l’émission du jeton relève du TrustEngine (hors périmètre) : le dossier validé reste VALIDATED.
-- En développement (mock_mode = 'true' et auto_issue_token = 'true', posé par seed.sql), le serveur joue
-- aussitôt les étapes système, comme la validation de démonstration : jeton, IN_PROGRESS, première tranche (RG-12).
insert into app_config(key, value) values ('auto_issue_token', 'false') on conflict (key) do nothing;

create or replace function _simulate_token_issue(p_tx uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ttl int; lead int; first tranches;
begin
  perform set_config('app.via_transition', 'on', true);
  select value::int into ttl from app_config where key = 'token_ttl_days';
  insert into trust_tokens(tx_id, signature, expires_at)
  values (p_tx, 'SIMULATED.' || replace(gen_random_uuid()::text,'-',''), now() + make_interval(days => ttl)) on conflict (tx_id) do nothing;
  update transactions set status = 'TOKEN_ISSUED', expires_at = now() + make_interval(days => ttl) where id = p_tx;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (p_tx, null, 'SYSTEM_SIMULATED', 'VALIDATED', 'TOKEN_ISSUED', '{}');
  update transactions set status = 'IN_PROGRESS' where id = p_tx;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (p_tx, null, 'SYSTEM_SIMULATED', 'TOKEN_ISSUED', 'IN_PROGRESS', '{}');
  -- RG-12 : la première tranche est activée si son échéance tombe dans les 7 jours (ou si c’est un jalon).
  select value::int into lead from app_config where key = 'activation_lead_days';
  select * into first from tranches where tx_id = p_tx order by seq limit 1;
  if found and first.status = 'PLANNED' and (first.due_date is null or first.due_date <= current_date + lead) then
    perform _set_tranche_status(first.id, 'AWAITING_PAYMENT', null, 'TRANCHE_ACTIVATED', '{}');
    perform _issue_tranche_token(first.id);
  end if;
end $$;

-- Nouvelle signature : l’ancienne (uuid, boolean, text) est retirée, aucun appel ne peut l’ignorer.
drop function if exists decide_tx(uuid, boolean, text);
create or replace function decide_tx(p_tx uuid, p_approved boolean, p_amount_checked boolean, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; need int; got int; since timestamptz; v_reason text;
begin
  perform _require_user();
  if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
  select * into t from transactions where id = p_tx for update;
  if not found then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas valider un dossier dont il est partie'); end if;
  if t.status <> 'IN_REVIEW' then perform _err('NOT_IN_REVIEW', 'Le dossier n’est pas en validation'); end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if not p_approved and coalesce(length(v_reason), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
  if p_approved and not coalesce(p_amount_checked, false) then
    perform _err('AMOUNT_NOT_CHECKED', 'Cochez « J’ai vérifié que le montant correspond aux pièces » avant d’approuver');
  end if;

  since := _round_start(p_tx);
  if exists (select 1 from validations where tx_id = p_tx and tranche_id is null
             and validator_id = auth.uid() and decided_at >= since) then
    perform _err('ALREADY_DECIDED', 'Vous avez déjà donné votre décision sur ce dossier');
  end if;
  insert into validations(tx_id, validator_id, approved, reason, amount_checked)
  values (p_tx, auth.uid(), p_approved, v_reason, coalesce(p_amount_checked, false));

  need := required_validations(p_tx);
  select count(distinct validator_id) into got from validations
    where tx_id = p_tx and tranche_id is null and approved and decided_at >= since;
  insert into audit_log(tx_id, actor_id, event, payload)
  values (p_tx, auth.uid(), 'VALIDATION_DECISION', jsonb_build_object(
    'approved', p_approved, 'amount_checked', coalesce(p_amount_checked, false), 'reason', v_reason, 'got', got, 'need', need));

  if not p_approved then
    perform transition_tx(p_tx, 'REJECTED', v_reason);
  elsif got >= need then
    perform transition_tx(p_tx, 'VALIDATED', null);
    if _mock_mode() and coalesce((select value from app_config where key = 'auto_issue_token'), 'false') = 'true' then
      perform _simulate_token_issue(p_tx);
    end if;
  end if;
  select * into t from transactions where id = p_tx;
  return t;
end $$;

-- La validation de démonstration (mock_mode seulement, créée par 0005) porte la case cochée par le validateur
-- simulé et réutilise les étapes système communes. Comportement inchangé pour l’application.
do $demo$
begin
  if to_regprocedure('public.demo_review(uuid, boolean, text)') is null then
    raise notice 'demo_review absente (mock_mode <> true) : rien à mettre à jour';
    return;
  end if;
  execute $f$
  create or replace function demo_review(p_tx uuid, p_approved boolean, p_reason text default null)
  returns transactions language plpgsql security definer set search_path = public as $$
  declare t transactions; v_val uuid; need int; i int := 0; v uuid;
  begin
    perform _require_user();
    if not _mock_mode() then perform _err('DEMO_DISABLED', 'Simulation désactivée'); end if;
    select * into t from transactions where id = p_tx for update;
    if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
    if t.status not in ('SUBMITTED','IN_REVIEW') then perform _err('NOT_IN_REVIEW', 'Le dossier n’est pas en validation'); end if;
    select id into v_val from profiles p where platform_role in ('VALIDATOR','ADMIN')
      and not exists (select 1 from transaction_parties x where x.tx_id = p_tx and x.user_id = p.id)
      order by platform_role, created_at limit 1;
    if v_val is null then perform _err('DEMO_NO_VALIDATOR', 'Aucun validateur de démonstration (exécuter seed.sql)'); end if;
    perform set_config('app.via_transition', 'on', true);
    if t.status = 'SUBMITTED' then
      update transactions set status = 'IN_REVIEW' where id = p_tx;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
      values (p_tx, v_val, 'DEMO_REVIEW', 'SUBMITTED', 'IN_REVIEW', '{"demo":true}');
    end if;
    if not p_approved then
      if coalesce(length(trim(p_reason)), 0) < 3 then perform _err('REASON_REQUIRED', 'Motif du rejet obligatoire'); end if;
      insert into validations(tx_id, validator_id, approved, reason) values (p_tx, v_val, false, trim(p_reason));
      update transactions set status = 'REJECTED', reject_reason = trim(p_reason) where id = p_tx;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
      values (p_tx, v_val, 'DEMO_REVIEW', 'IN_REVIEW', 'REJECTED', jsonb_build_object('reason', trim(p_reason), 'demo', true));
      select * into t from transactions where id = p_tx;
      return t;
    end if;
    need := required_validations(p_tx);
    for v in select id from profiles p where platform_role in ('VALIDATOR','ADMIN')
               and not exists (select 1 from transaction_parties x where x.tx_id = p_tx and x.user_id = p.id)
             order by platform_role, created_at limit need loop
      insert into validations(tx_id, validator_id, approved, amount_checked) values (p_tx, v, true, true);
      i := i + 1;
    end loop;
    update transactions set status = 'VALIDATED' where id = p_tx;
    insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
    values (p_tx, v_val, 'DEMO_REVIEW', 'IN_REVIEW', 'VALIDATED', jsonb_build_object('validations', i, 'need', need, 'amount_checked', true, 'demo', true));
    perform _simulate_token_issue(p_tx);
    select * into t from transactions where id = p_tx;
    return t;
  end $$;
  $f$;
  execute 'revoke all on function demo_review(uuid, boolean, text) from public, anon';
  execute 'grant execute on function demo_review(uuid, boolean, text) to authenticated';
end $demo$;

-- ---------- 4. Prise en charge (D8) ----------
create or replace function claim_dossier(p_tx uuid) returns transactions
language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  perform _require_validator();
  select * into t from transactions where id = p_tx for update;
  if not found then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne prend pas en charge un dossier dont il est partie'); end if;
  if t.status = 'SUBMITTED' then
    select * into t from transition_tx(p_tx, 'IN_REVIEW', null);
  end if;
  return t;
end $$;

-- ---------- 2. Files du bureau (vues soumises à RLS, réservées au personnel) ----------
-- security_invoker : chaque ligne passe par les politiques de l’utilisateur ; « is_validator() » ferme la vue
-- à tout autre compte (un payeur ne voit rien, même de ses propres dossiers).
create or replace view bo_dossiers with (security_invoker = true) as
select t.id, _tx_ref(t.id) as reference, t.vertical::text as vertical, t.purpose, t.amount_minor, t.currency::text as currency,
       t.status::text as status, t.created_at, t.updated_at, r.since as submitted_at,
       _party_name(t.id, 'REQUESTER') as requester_name, _party_name(t.id, 'PAYER') as payer_name,
       coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER')) as provider_name, t.beneficiary_name,
       required_validations(t.id) as validations_required,
       (select count(distinct v.validator_id)::int from validations v
         where v.tx_id = t.id and v.tranche_id is null and v.approved and v.decided_at >= r.since) as validations_received,
       exists (select 1 from validations v where v.tx_id = t.id and v.tranche_id is null
               and v.validator_id = auth.uid() and v.decided_at >= r.since) as decided_by_me,
       is_party(t.id) as is_party
from transactions t
cross join lateral (select _round_start(t.id) as since) r
where t.status in ('SUBMITTED','IN_REVIEW') and is_validator();

create or replace view bo_evidence_queue with (security_invoker = true) as
select tr.id as tranche_id, tr.tx_id, _tx_ref(t.id) as reference, tr.seq, tr.label, tr.amount_minor, t.currency::text as currency,
       t.vertical::text as vertical, t.purpose, coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER')) as provider_name,
       r.since as submitted_at, required_validations(tr.tx_id, tr.id) as validations_required,
       (select count(distinct v.validator_id)::int from validations v
         where v.tranche_id = tr.id and v.approved and v.decided_at >= r.since) as validations_received,
       exists (select 1 from validations v where v.tranche_id = tr.id and v.validator_id = auth.uid() and v.decided_at >= r.since) as decided_by_me,
       is_party(tr.tx_id) as is_party
from tranches tr
join transactions t on t.id = tr.tx_id
cross join lateral (select _evidence_round_start(tr.id) as since) r
where tr.status = 'EVIDENCE_SUBMITTED' and is_validator();

-- Litiges : administrateurs seulement (RG-09).
alter table disputes add column if not exists response text;
alter table disputes add column if not exists responded_by uuid references profiles(id);
alter table disputes add column if not exists responded_at timestamptz;

-- Date à laquelle la partie adverse a été informée (alerte DISPUTE_OPENED), lue pour le personnel seulement.
create or replace function _dispute_notified_at(p_dispute uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when is_validator() then (
    select min(n.created_at) from disputes d join notifications n on n.tx_id = d.tx_id and n.event = 'DISPUTE_OPENED'
      and n.created_at >= d.opened_at and n.user_id <> d.opened_by
    where d.id = p_dispute) end
$$;

create or replace view bo_disputes with (security_invoker = true) as
select d.id, d.tx_id, d.tranche_id, _tx_ref(t.id) as reference, tr.seq as tranche_seq, tr.label as tranche_label,
       tr.amount_minor, tr.status::text as tranche_status, t.currency::text as currency, t.vertical::text as vertical, t.purpose,
       coalesce(d.reason_code, 'OTHER') as reason_code, d.reason as description,
       case when exists (select 1 from transaction_parties p where p.tx_id = d.tx_id and p.user_id = d.opened_by and p.role = 'PROVIDER')
            then 'PROVIDER' else 'PAYER' end as opened_by_role,
       d.opened_at, d.status, d.response, d.responded_at, _dispute_notified_at(d.id) as notified_at,
       d.resolution_note, d.resolved_at, _staff_name(d.resolved_by) as resolved_by_name,
       _party_name(t.id, 'PAYER') as payer_name, coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER')) as provider_name,
       is_party(d.tx_id) as is_party
from disputes d
join tranches tr on tr.id = d.tranche_id
join transactions t on t.id = d.tx_id
where is_admin();

-- ---------- 3. Contrôles automatiques (D6) ----------
-- Résultats : OK, ATTENTION (alerte sans blocage), ECHEC. Le détail (jsonb) est mis en forme par l’application.
create or replace function dossier_checks(p_tx uuid)
returns table (code text, result text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare t transactions; v_missing text[]; v_count int; v_has_list boolean; v_prov providers; v_payer text; v_dups text[]; v_sum bigint;
begin
  perform _require_validator();
  select * into t from transactions where id = p_tx;
  if not found or t.status = 'DRAFT' then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;

  -- Pièces obligatoires (vague 1, décision D2) ; autres verticales : au moins une pièce.
  select count(*) into v_count from documents where tx_id = p_tx and tranche_id is null and deleted_at is null;
  v_has_list := exists (select 1 from required_documents where vertical = t.vertical::text and required);
  if v_has_list then
    select coalesce(array_agg(rd.kind order by rd.kind), '{}') into v_missing from required_documents rd
     where rd.vertical = t.vertical::text and rd.required
       and not exists (select 1 from documents d where d.tx_id = p_tx and d.kind = rd.kind and d.tranche_id is null and d.deleted_at is null);
    code := 'DOCUMENTS'; result := case when cardinality(v_missing) = 0 then 'OK' else 'ECHEC' end;
    detail := jsonb_build_object('rule', 'REQUIRED_LIST', 'missing', to_jsonb(v_missing), 'count', v_count);
  else
    code := 'DOCUMENTS'; result := case when v_count > 0 then 'OK' else 'ECHEC' end;
    detail := jsonb_build_object('rule', 'AT_LEAST_ONE', 'missing', case when v_count > 0 then '[]'::jsonb else '["SUPPORTING_DOCUMENT"]'::jsonb end, 'count', v_count);
  end if;
  return next;

  -- Prestataire vérifié (annuaire).
  code := 'PROVIDER_VERIFIED';
  if t.provider_id is null then
    result := 'ATTENTION'; detail := jsonb_build_object('reason', 'OUTSIDE_DIRECTORY', 'name', t.provider_name);
  else
    select * into v_prov from providers where id = t.provider_id;
    result := case when v_prov.verified then 'OK' else 'ATTENTION' end;
    detail := jsonb_build_object('reason', case when v_prov.verified then 'VERIFIED' else 'UNVERIFIED' end, 'name', v_prov.name);
  end if;
  return next;

  -- Doublon possible : même payeur, même prestataire, même montant, dossiers créés à moins de 30 jours d’écart.
  select coalesce(p.user_id::text, _norm_phone(p.invited_phone)) into v_payer from transaction_parties p where p.tx_id = p_tx and p.role = 'PAYER';
  select coalesce(array_agg(_tx_ref(o.id) order by o.created_at), '{}') into v_dups from transactions o
   where o.id <> t.id and o.amount_minor = t.amount_minor and o.currency = t.currency
     and o.status not in ('DRAFT','CANCELLED','REJECTED')
     and o.created_at between t.created_at - interval '30 days' and t.created_at + interval '30 days'
     and v_payer is not null
     and exists (select 1 from transaction_parties p where p.tx_id = o.id and p.role = 'PAYER'
                 and coalesce(p.user_id::text, _norm_phone(p.invited_phone)) = v_payer)
     and ((t.provider_id is not null and o.provider_id = t.provider_id)
          or (t.provider_id is null and coalesce(trim(t.provider_name), '') <> '' and _fold(o.provider_name) = _fold(t.provider_name)));
  code := 'DUPLICATE'; result := case when cardinality(v_dups) = 0 then 'OK' else 'ATTENTION' end;
  detail := jsonb_build_object('references', to_jsonb(v_dups));
  return next;

  -- Somme des tranches égale au total.
  select coalesce(sum(amount_minor), 0) into v_sum from tranches where tx_id = p_tx;
  code := 'PLAN_SUM'; result := case when v_sum = t.amount_minor then 'OK' else 'ECHEC' end;
  detail := jsonb_build_object('sum', v_sum, 'total', t.amount_minor, 'gap', t.amount_minor - v_sum);
  return next;
end $$;

-- Preuve de jalon : pièce probante déposée, prestataire vérifié. La lisibilité de la pièce reste un contrôle humain.
create or replace function evidence_checks(p_tranche uuid)
returns table (code text, result text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare tr tranches; t transactions; v_count int; v_prov providers;
begin
  perform _require_validator();
  select * into tr from tranches where id = p_tranche;
  if not found then perform _err('TRANCHE_NOT_FOUND', 'Tranche introuvable'); end if;
  select * into t from transactions where id = tr.tx_id;
  select count(*) into v_count from documents where tranche_id = p_tranche and deleted_at is null;
  code := 'EVIDENCE_PRESENT'; result := case when v_count > 0 then 'OK' else 'ECHEC' end; detail := jsonb_build_object('count', v_count);
  return next;
  code := 'PROVIDER_VERIFIED';
  if t.provider_id is null then
    result := 'ATTENTION'; detail := jsonb_build_object('reason', 'OUTSIDE_DIRECTORY', 'name', t.provider_name);
  else
    select * into v_prov from providers where id = t.provider_id;
    result := case when v_prov.verified then 'OK' else 'ATTENTION' end;
    detail := jsonb_build_object('reason', case when v_prov.verified then 'VERIFIED' else 'UNVERIFIED' end, 'name', v_prov.name);
  end if;
  return next;
end $$;

-- Décisions du tour courant (dossier, ou preuve d’une tranche) : qui a décidé, quand, avec quelle case.
create or replace function bo_decisions(p_tx uuid, p_tranche uuid default null)
returns table (validator_id uuid, validator_name text, approved boolean, reason text, amount_checked boolean, decided_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare since timestamptz;
begin
  perform _require_validator();
  since := case when p_tranche is null then _round_start(p_tx) else _evidence_round_start(p_tranche) end;
  return query
    select v.validator_id, coalesce(nullif(trim(p.full_name), ''), '—'), v.approved, v.reason, v.amount_checked, v.decided_at, v.validator_id = auth.uid()
    from validations v left join profiles p on p.id = v.validator_id
    where v.tx_id = p_tx and v.tranche_id is not distinct from p_tranche and v.decided_at >= since
    order by v.decided_at;
end $$;

-- ---------- 6. Pièces : consultation journalisée ----------
create or replace function dossier_documents(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_validator();
  if not exists (select 1 from transactions where id = p_tx) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'name', coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')), 'mimeType', d.mime_type,
      'sizeBytes', d.size_bytes, 'trancheId', d.tranche_id,
      'uploadedAt', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by d.tranche_id nulls first, d.kind, d.created_at)
    from documents d where d.tx_id = p_tx and d.deleted_at is null), '[]'::jsonb);
end $$;

-- Ouverture d’une pièce par le personnel : journalisée (qui, quoi, quand), puis lecture autorisée dans le
-- stockage pendant 2 minutes pour ce fichier (politique dossiers_read) : le temps de créer une URL signée courte.
create or replace function open_document(p_doc uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  perform _require_validator();
  select * into d from documents where id = p_doc and deleted_at is null;
  if not found then perform _err('NOT_FOUND', 'Pièce introuvable'); end if;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (d.tx_id, d.tranche_id, auth.uid(), 'DOCUMENT_VIEWED',
          jsonb_build_object('document_id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'path', d.storage_path));
  return jsonb_build_object('path', d.storage_path, 'name', coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')), 'mimeType', d.mime_type);
end $$;

create or replace function _recently_opened(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from audit_log a
    where a.tx_id = _storage_tx(p_path) and a.event = 'DOCUMENT_VIEWED' and a.actor_id = auth.uid()
      and a.payload->>'path' = p_path and a.created_at > now() - interval '2 minutes')
$$;

-- Les parties lisent leurs pièces comme avant ; le personnel seulement après une ouverture journalisée.
drop policy if exists dossiers_read on storage.objects;
create policy dossiers_read on storage.objects for select using (
  bucket_id = 'dossiers' and (
    exists (select 1 from transactions t where t.id = _storage_tx(name) and (t.created_by = auth.uid() or is_party(t.id)))
    or (is_validator() and _recently_opened(name))));

-- ---------- 7. Journal d’audit ----------
create or replace function bo_audit(p_tx uuid)
returns table (id bigint, created_at timestamptz, actor_id uuid, actor_name text, actor_role text, event text,
               from_status text, to_status text, tranche_id uuid, tranche_seq int, payload jsonb, prev_hash text, hash text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform _require_validator();
  if not exists (select 1 from transactions where transactions.id = p_tx) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  return query
    select a.id, a.created_at, a.actor_id,
           case when a.actor_id is null then null else coalesce(nullif(trim(pr.full_name), ''), '—') end,
           case when a.actor_id is null then null
                else coalesce((select p.role::text from transaction_parties p where p.tx_id = a.tx_id and p.user_id = a.actor_id
                               order by case p.role when 'PAYER' then 1 when 'REQUESTER' then 2 else 3 end limit 1),
                              pr.platform_role::text) end,
           a.event, a.from_status::text, a.to_status::text, a.tranche_id, tr.seq, a.payload, a.prev_hash, a.hash
    from audit_log a
    left join profiles pr on pr.id = a.actor_id
    left join tranches tr on tr.id = a.tranche_id
    where a.tx_id = p_tx
    order by a.id;
end $$;

create or replace function bo_audit_verify(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_count int; v_last text;
begin
  perform _require_validator();
  if not exists (select 1 from transactions where id = p_tx) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  select count(*) into v_count from audit_log where tx_id = p_tx;
  select hash into v_last from audit_log where tx_id = p_tx order by id desc limit 1;
  return jsonb_build_object('valid', verify_audit(p_tx), 'count', v_count, 'lastHash', v_last);
end $$;

-- L’export CSV (fabriqué par l’application à partir de bo_audit) est lui-même journalisé.
create or replace function log_audit_export(p_tx uuid, p_rows int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_validator();
  if not exists (select 1 from transactions where id = p_tx) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  insert into audit_log(tx_id, actor_id, event, payload)
  values (p_tx, auth.uid(), 'AUDIT_EXPORTED', jsonb_build_object('format', 'csv', 'rows', coalesce(p_rows, 0)));
end $$;

-- Recherche d’une transaction pour le journal : objectif, nom d’une partie ou du prestataire, référence du dossier
-- (8 caractères) ou d’un eQR (18). Vide : les plus récentes.
create or replace function bo_find_transactions(p_query text)
returns table (id uuid, reference text, vertical text, purpose text, amount_minor bigint, currency text, status text,
               created_at timestamptz, payer_name text, provider_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare q text := _fold(trim(coalesce(p_query, ''))); hex text := lower(regexp_replace(coalesce(p_query, ''), '[^0-9a-fA-F]', '', 'g'));
begin
  perform _require_validator();
  return query
    select t.id, _tx_ref(t.id), t.vertical::text, t.purpose, t.amount_minor, t.currency::text, t.status::text, t.created_at,
           _party_name(t.id, 'PAYER'), coalesce(nullif(t.provider_name, ''), _party_name(t.id, 'PROVIDER'))
    from transactions t
    where t.status <> 'DRAFT'
      and (q = ''
           or _fold(t.purpose) like '%' || q || '%'
           or _fold(t.provider_name) like '%' || q || '%'
           or _fold(t.beneficiary_name) like '%' || q || '%'
           or (length(hex) >= 4 and replace(t.id::text, '-', '') like hex || '%')
           or (length(hex) = 18 and exists (select 1 from tranches tr join tranche_tokens k on k.tranche_id = tr.id where tr.tx_id = t.id and k.reference = hex))
           or exists (select 1 from transaction_parties p join profiles pr on pr.id = p.user_id
                      where p.tx_id = t.id and _fold(pr.full_name) like '%' || q || '%'))
    order by t.created_at desc
    limit 20;
end $$;

-- ---------- 8. Litiges : réponse de la partie adverse ----------
-- Celle des deux parties (payeur, prestataire) qui n’a pas ouvert le litige donne sa version, une seule fois.
create or replace function respond_dispute(p_dispute uuid, p_text text) returns disputes
language plpgsql security definer set search_path = public as $$
declare d disputes;
begin
  perform _require_user();
  select * into d from disputes where id = p_dispute for update;
  if not found or not is_party(d.tx_id) then perform _err('NO_OPEN_DISPUTE', 'Litige introuvable'); end if;
  if d.status <> 'OPEN' then perform _err('NO_OPEN_DISPUTE', 'Litige déjà clos'); end if;
  if d.opened_by = auth.uid() or not (has_role(d.tx_id, 'PAYER') or has_role(d.tx_id, 'PROVIDER')) then
    perform _err('NOT_RESPONDENT', 'Seule la partie adverse répond au litige');
  end if;
  if d.response is not null then perform _err('ALREADY_ANSWERED', 'Une réponse a déjà été donnée'); end if;
  if coalesce(length(trim(p_text)), 0) < 10 then perform _err('REASON_TOO_SHORT', 'Réponse trop courte (10 caractères minimum)'); end if;
  update disputes set response = trim(p_text), responded_by = auth.uid(), responded_at = now() where id = p_dispute returning * into d;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (d.tx_id, d.tranche_id, auth.uid(), 'DISPUTE_ANSWERED', jsonb_build_object('dispute_id', d.id));
  return d;
end $$;

-- ---------- 10. Droits ----------
-- Aucune fonction nouvelle n’est exécutable par anon ; les fonctions internes ne le sont par personne.
revoke all on function _staff_aal_ok(), _require_validator(), _tx_ref(uuid), _party_name(uuid, tx_role), _staff_name(uuid),
  _round_start(uuid), _evidence_round_start(uuid), _simulate_token_issue(uuid), _dispute_notified_at(uuid)
  from public, anon, authenticated;
-- Évaluées dans les vues et politiques avec les droits de l’utilisateur (chacune vérifie elle-même qui l’appelle).
grant execute on function _tx_ref(uuid), _party_name(uuid, tx_role), _staff_name(uuid), _round_start(uuid),
  _evidence_round_start(uuid), _dispute_notified_at(uuid), _recently_opened(text) to authenticated;
revoke all on function _recently_opened(text) from public, anon;
-- is_validator() et is_admin() gardent leurs droits (create or replace les conserve) : les politiques RLS les évaluent.

revoke all on function decide_tx(uuid, boolean, boolean, text), claim_dossier(uuid), dossier_checks(uuid), evidence_checks(uuid),
  bo_decisions(uuid, uuid), dossier_documents(uuid), open_document(uuid), bo_audit(uuid), bo_audit_verify(uuid),
  log_audit_export(uuid, int), bo_find_transactions(text), respond_dispute(uuid, text) from public, anon;
grant execute on function decide_tx(uuid, boolean, boolean, text), claim_dossier(uuid), dossier_checks(uuid), evidence_checks(uuid),
  bo_decisions(uuid, uuid), dossier_documents(uuid), open_document(uuid), bo_audit(uuid), bo_audit_verify(uuid),
  log_audit_export(uuid, int), bo_find_transactions(text), respond_dispute(uuid, text) to authenticated;

revoke all on bo_dossiers, bo_evidence_queue, bo_disputes from public, anon;
grant select on bo_dossiers, bo_evidence_queue, bo_disputes to authenticated;
