-- =====================================================================
-- Retour arrière de 0011_lotx_x6.sql (types de besoin configurables) : à n’exécuter qu’en cas de besoin, à la main
-- (psql ou éditeur SQL), dans une transaction. Restaure release_rules et required_documents (tables), la colonne
-- transactions.vertical en enum, et les fonctions de 0008 et 0009. Refuse si un dossier utilise un module ajouté depuis
-- (code absent de l’enum vertical). Testé sur le jeu de données du projet de développement (voir docs/decisions.md, X-6).
-- Les fonctions ci-dessous sont copiées à l’identique de 0008_lotx.sql (transition_tx, save_draft) et 0009_lotx_x4.sql
-- (_documents_guard).
-- =====================================================================
do $$
begin
  if exists (select 1 from transactions t where t.vertical not in (select unnest(enum_range(null::vertical))::text)) then
    raise exception 'Retour arrière impossible : des dossiers utilisent un type de besoin absent de l’enum vertical';
  end if;
end $$;

-- Ouverture (open_verticals) alignée sur les modules activés, puis règles reprises dans les anciennes tables.
update app_config set value = coalesce((select string_agg(code, ',' order by display_order) from request_modules where enabled), '')
 where key = 'open_verticals';
update _release_rules_0003 r set release_mode = m.release_mode, contest_hours = m.contest_hours, dual_validation = m.dual_validation
  from request_modules m where m.code = r.vertical;
delete from _required_documents_0005;
insert into _required_documents_0005(vertical, kind, required)
  select m.code, d->>'kind', (d->>'required')::boolean from request_modules m, jsonb_array_elements(m.required_documents) d
  where m.code in (select unnest(enum_range(null::vertical))::text);

create temp table _lotx_x6_down_views as
  select c.relname::text as name, pg_get_viewdef(c.oid, true) as def from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relname in ('bo_dossiers','bo_evidence_queue','bo_disputes');
drop view if exists bo_dossiers, bo_evidence_queue, bo_disputes;
alter table transactions drop constraint if exists transactions_vertical_module_fk;
alter table transactions alter column vertical type vertical using vertical::vertical;
do $$
declare r record;
begin
  for r in select * from _lotx_x6_down_views loop
    execute format('create view %I with (security_invoker = true) as %s', r.name, r.def);
  end loop;
end $$;
drop table _lotx_x6_down_views;
revoke all on bo_dossiers, bo_evidence_queue, bo_disputes from public, anon;
grant select on bo_dossiers, bo_evidence_queue, bo_disputes to authenticated;

drop view if exists release_rules, required_documents;
alter table _release_rules_0003 rename to release_rules;
alter table _required_documents_0005 rename to required_documents;
grant select on release_rules, required_documents to authenticated;

-- Fonctions de 0008 et 0009, à l’identique.
create or replace function transition_tx(p_tx uuid, p_to tx_status, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ok boolean := false; r tx_role; old_status tx_status; total bigint; missing text;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx) or is_validator()) then
    perform _err('TX_NOT_FOUND', 'Transaction introuvable');
  end if;
  old_status := t.status;
  if not exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to) then
    perform _err('TRANSITION_UNKNOWN', format('Transition %s -> %s inconnue', t.status, p_to));
  end if;

  if exists (select 1 from allowed_transitions
             where from_status = t.status and to_status = p_to and validator_only) then
    if not is_validator() then perform _err('VALIDATOR_ONLY', 'Réservé aux validateurs'); end if;
    if is_party(p_tx) then perform _err('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas agir sur un dossier dont il est partie'); end if;
    ok := true;
  else
    foreach r in array array['PAYER','REQUESTER','PROVIDER']::tx_role[] loop
      if has_role(p_tx, r)
         and (r <> 'PROVIDER' or t.status not in ('DRAFT','REJECTED') or t.created_by = auth.uid())
         and exists (select 1 from allowed_transitions where from_status = t.status and to_status = p_to and role = r) then
        ok := true;
      end if;
    end loop;
  end if;
  if not ok then perform _err('TRANSITION_FORBIDDEN', format('Transition %s -> %s non autorisée', t.status, p_to)); end if;

  if old_status = 'DRAFT' and p_to = 'SUBMITTED' then
    if not (t.vertical::text = any(string_to_array((select value from app_config where key = 'open_verticals'), ','))) then
      perform _err('VERTICAL_UNAVAILABLE', 'Ce type de besoin n’est pas encore ouvert');
    end if;
    if t.purpose is null or t.amount_minor is null or t.currency is null then
      perform _err('VALIDATION', 'Dossier incomplet');
    end if;
    if exists (select 1 from transaction_parties where tx_id = p_tx and role = 'PROVIDER' and user_id = t.created_by)
       and not exists (select 1 from transaction_parties where tx_id = p_tx and role = 'PAYER') then
      perform _err('VALIDATION', 'Téléphone du payeur requis');
    end if;
    select sum(amount_minor) into total from tranches where tx_id = p_tx;
    if total is null then perform _err('PLAN_EMPTY', 'Au moins une tranche est requise'); end if;
    if total <> t.amount_minor then
      perform _err('PLAN_SUM_MISMATCH', format('La somme des tranches (%s) doit égaler le montant total (%s)', total, t.amount_minor),
                   json_build_object('sum', total, 'total', t.amount_minor, 'gap', t.amount_minor - total)::text);
    end if;
    if not exists (select 1 from documents where tx_id = p_tx and tranche_id is null and deleted_at is null) then
      perform _err('TX_NO_DOCUMENT', 'Au moins une pièce justificative est requise');
    end if;
    select rd.kind into missing from required_documents rd
     where rd.vertical = t.vertical::text and rd.required
       and not exists (select 1 from documents d where d.tx_id = p_tx and d.kind = rd.kind and d.tranche_id is null and d.deleted_at is null)
     order by rd.kind limit 1;
    if missing is not null then perform _err('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', missing); end if;
  end if;

  perform set_config('app.via_transition','on', true);
  update transactions set status = p_to,
         reject_reason = case when p_to = 'REJECTED' then p_reason when p_to = 'SUBMITTED' then null else reject_reason end
   where id = p_tx returning * into t;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
  values (p_tx, auth.uid(), 'STATUS_CHANGE', old_status, p_to, jsonb_build_object('reason', p_reason));
  return t;
end $$;

create or replace function save_draft(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_id uuid; t transactions; v_role tx_role; v_vertical text; v_amount bigint; v_purpose text;
  v_currency text; v_date date; v_plan text; v_prov jsonb; v_prov_row providers; v_prov_user uuid; v_prov_name text;
  v_prov_phone text; v_payer_phone text; v_payer_user uuid; v_creator text; me profiles; rule release_rules; it jsonb; n int := 0;
begin
  v_uid := _require_user();
  begin v_id := (p_draft->>'id')::uuid; exception when others then perform _err('VALIDATION', 'Identifiant de brouillon invalide'); end;
  if v_id is null then perform _err('VALIDATION', 'Identifiant de brouillon manquant'); end if;
  v_vertical := p_draft->>'vertical';
  if v_vertical is null or not exists (select 1 from release_rules where vertical = v_vertical) then
    perform _err('VALIDATION', 'Type de besoin manquant ou inconnu');
  end if;
  v_creator := nullif(p_draft->>'creatorRole', '');
  if v_creator is not null and v_creator not in ('PAYER','REQUESTER','PROVIDER') then
    perform _err('VALIDATION', 'Rôle du créateur inconnu');
  end if;

  select * into t from transactions where id = v_id for update;
  if found then
    if t.created_by <> v_uid then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
    if t.status not in ('DRAFT','REJECTED') then perform _err('NOT_EDITABLE', 'Seul un brouillon ou un dossier rejeté se modifie'); end if;
  end if;

  select * into me from profiles where id = v_uid;
  v_role := coalesce(v_creator, case when me.primary_role = 'REQUESTER' then 'REQUESTER' else 'PAYER' end)::tx_role;

  v_amount := case when (p_draft->>'amountMinor') ~ '^[0-9]+$' and (p_draft->>'amountMinor')::bigint > 0
                   then (p_draft->>'amountMinor')::bigint end;
  v_currency := case when p_draft->>'currency' in ('EUR','USD','XAF') then p_draft->>'currency' end;
  v_purpose := case when length(trim(coalesce(p_draft->>'purpose', ''))) between 3 and 500 then trim(p_draft->>'purpose') end;
  v_date := case when (p_draft->>'desiredDate') ~ '^\d{4}-\d{2}-\d{2}$' then (p_draft->>'desiredDate')::date end;
  v_plan := case when p_draft->>'planType' in ('SINGLE','PARTIAL','INSTALLMENTS','RECURRING') then p_draft->>'planType' end;
  v_prov := p_draft->'provider';
  v_payer_phone := nullif(trim(coalesce(p_draft->>'counterpartyPhone', '')), '');
  if v_payer_phone is not null and not _valid_phone(v_payer_phone) then perform _err('PHONE_INVALID', 'Numéro du payeur invalide'); end if;

  if v_role = 'PROVIDER' then
    if not coalesce(me.can_initiate_requests, false) then
      perform _err('INITIATION_NOT_ALLOWED', 'Votre compte n’est pas autorisé à initier des demandes de paiement');
    end if;
    if v_payer_phone is not null and (_norm_phone(v_payer_phone) = _norm_phone(me.phone) or _user_by_phone(v_payer_phone) = v_uid) then
      perform _err('SELF_PAYER', 'Vous ne pouvez pas être le payeur de votre propre demande');
    end if;
    v_prov_name := coalesce(nullif(trim(coalesce(v_prov->>'name', '')), ''), nullif(trim(me.full_name), ''));
  else
    if v_prov is not null and nullif(v_prov->>'id', '') is not null then
      begin select * into v_prov_row from providers where id = (v_prov->>'id')::uuid; exception when others then v_prov_row := null; end;
    end if;
    if v_prov is not null and nullif(v_prov->>'invitedPhone', '') is not null and not _valid_phone(v_prov->>'invitedPhone') then
      perform _err('PHONE_INVALID', 'Numéro du prestataire invalide');
    end if;
    v_prov_name := coalesce(v_prov_row.name, nullif(trim(coalesce(v_prov->>'name', '')), ''));
  end if;

  if t.id is null then
    insert into transactions(id, vertical, purpose, amount_minor, currency, status, created_by, due_date,
                             beneficiary_name, provider_id, provider_name, plan_type, draft_data)
    values (v_id, v_vertical::vertical, v_purpose, v_amount, v_currency::currency, 'DRAFT', v_uid, v_date,
            nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''), v_prov_row.id, v_prov_name, v_plan, p_draft - 'documents' - 'id');
  else
    update transactions set vertical = v_vertical::vertical, purpose = v_purpose, amount_minor = v_amount, currency = v_currency::currency,
      due_date = v_date, beneficiary_name = nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''),
      provider_id = v_prov_row.id, provider_name = v_prov_name, plan_type = v_plan, draft_data = p_draft - 'documents' - 'id'
    where id = v_id;
  end if;

  -- Parties : le créateur, le payeur désigné (demandeur ou prestataire créateur), le prestataire choisi.
  delete from transaction_parties where tx_id = v_id;
  insert into transaction_parties(tx_id, user_id, role) values (v_id, v_uid, v_role);
  if v_role in ('REQUESTER','PROVIDER') and v_payer_phone is not null then
    v_payer_user := _user_by_phone(v_payer_phone);
    insert into transaction_parties(tx_id, user_id, role, invited_phone)
    values (v_id, v_payer_user, 'PAYER', case when v_payer_user is null then '+' || _norm_phone(v_payer_phone) end);
  end if;
  if v_role <> 'PROVIDER' then
    v_prov_user := v_prov_row.user_id;
    v_prov_phone := coalesce(v_prov_row.phone, v_prov->>'invitedPhone');
    if v_prov_user is null and v_prov_phone is not null then v_prov_user := _user_by_phone(v_prov_phone); end if;
    if v_prov_user is not null and v_prov_user <> v_uid then
      insert into transaction_parties(tx_id, user_id, role) values (v_id, v_prov_user, 'PROVIDER');
    elsif v_prov_user is null and _valid_phone(v_prov_phone) then
      insert into transaction_parties(tx_id, role, invited_phone) values (v_id, 'PROVIDER', '+' || _norm_phone(v_prov_phone));
    end if;
  end if;

  -- Tranches : seules les lignes complètes (montant positif, libellé) sont matérialisées ; le plan brut reste dans draft_data.
  select * into rule from release_rules where vertical = v_vertical;
  delete from tranches where tx_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_draft->'tranches', '[]'::jsonb)) loop
    if (it->>'amountMinor') ~ '^[0-9]+$' and (it->>'amountMinor')::bigint > 0 and length(trim(coalesce(it->>'label', ''))) > 0 then
      n := n + 1;
      insert into tranches(tx_id, seq, label, amount_minor, due_date, release_mode, contest_hours)
      values (v_id, n, trim(it->>'label'), (it->>'amountMinor')::bigint,
              case when (it->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'dueDate')::date end, rule.release_mode, rule.contest_hours);
    end if;
  end loop;
  if v_plan = 'RECURRING' and p_draft ? 'recurrence' and (p_draft->'recurrence'->>'installments') ~ '^[0-9]+$'
     and (p_draft->'recurrence'->>'installments')::int between 2 and 60 and (p_draft->'recurrence'->>'startDate') ~ '^\d{4}-\d{2}-\d{2}$' then
    insert into recurrence_plans(tx_id, frequency, installments, start_date)
    values (v_id, (p_draft->'recurrence'->>'frequency')::recurrence_freq, (p_draft->'recurrence'->>'installments')::int,
            (p_draft->'recurrence'->>'startDate')::date)
    on conflict (tx_id) do update set frequency = excluded.frequency, installments = excluded.installments, start_date = excluded.start_date;
  else
    delete from recurrence_plans where tx_id = v_id;
  end if;
  return _draft_json(v_id);
end $$;

create or replace function _documents_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mime_type not in ('image/jpeg','image/png','application/pdf') then perform _err('FILE_TYPE', 'Format accepté : JPEG, PNG ou PDF'); end if;
  if new.size_bytes is null or new.size_bytes <= 0 or new.size_bytes > 10*1024*1024 then perform _err('FILE_TOO_LARGE', 'Fichier vide ou de plus de 10 Mo'); end if;
  if new.storage_path not like new.tx_id::text || '/%' then perform _err('VALIDATION', 'Chemin de stockage invalide'); end if;
  if new.tranche_id is null and (select count(*) from documents
      where tx_id = new.tx_id and kind = new.kind and tranche_id is null and deleted_at is null) >= 3 then
    perform _err('TOO_MANY_FILES', 'Au plus 3 fichiers par pièce');
  end if;
  new.content_hash := _norm_hash(new.content_hash);
  if new.content_hash is not null then
    if new.content_hash !~ '^[0-9a-f]{64}$' then perform _err('HASH_INVALID', 'Empreinte invalide (SHA-256 hexadécimal attendu)'); end if;
    new.hash_algo := coalesce(new.hash_algo, 'SHA-256');
    if new.hash_algo <> 'SHA-256' then perform _err('HASH_INVALID', 'Algorithme d’empreinte non pris en charge'); end if;
  elsif new.hash_algo is not null then
    perform _err('HASH_INVALID', 'Algorithme sans empreinte');
  elsif coalesce((select value from app_config where key = 'require_content_hash'), 'false') = 'true' then
    perform _err('HASH_REQUIRED', 'Empreinte de la pièce obligatoire');
  end if;
  return new;
end $$;

drop function if exists needs_platform_review(uuid);
drop function if exists _platform_review(uuid);
drop function if exists _duplicate_refs(uuid);
-- Lot X (X7, 0012) dépend de request_modules : s’il est appliqué, l’annuler d’abord (0012_lotx_x7_down.sql).
drop table if exists request_modules;
drop function if exists _check_module_documents();
revoke all on function transition_tx(uuid, tx_status, text), save_draft(jsonb) from public, anon;
grant execute on function transition_tx(uuid, tx_status, text), save_draft(jsonb) to authenticated;
revoke all on function _documents_guard() from public, anon, authenticated;
