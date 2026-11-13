-- =====================================================================
-- DiasPay : migration 0022 (lot X version 2, X6) — types de besoin configurables, données minimales (K13).
-- À appliquer SUR 0001 à 0021. Test : supabase/tests/06_lotx2_p2.sql (partie X6).
-- Complète 0011 (request_modules, vertical en texte avec clé étrangère, release_rules et required_documents en vues) :
--
--  1. request_modules : beneficiary_mode (NAME, REFERENCE_ONLY, NONE), retention_days (nul tant que non décidé, point
--     ouvert 6), et pour chaque pièce requise une sensibilité (STANDARD ou SENSITIVE).
--  2. Santé (K13, décision D2 corrigée) : une seule pièce, « Devis ou facture proforma » (obligatoire, SENSITIVE) ;
--     plus de pièce d’identité du bénéficiaire ni de certificat médical ; beneficiary_mode = REFERENCE_ONLY.
--  3. transactions.beneficiary_reference : référence minimale (code ou initiales, sans espace, 16 caractères au plus) ;
--     save_draft refuse un nom pour un module REFERENCE_ONLY ou NONE, submit_operation exige la référence.
--     Données de développement : noms des bénéficiaires des modules REFERENCE_ONLY effacés.
--  4. Pièces : seul un type prévu par le module est accepté au dossier (DOCUMENT_KIND_NOT_ALLOWED).
--  5. Journaux : la consultation d’une pièce SENSITIVE est journalisée sans nom de fichier ni chemin (empreinte du chemin).
-- =====================================================================

-- ---------- X6.1 Colonnes du module ----------
alter table request_modules add column if not exists beneficiary_mode text not null default 'NAME';
alter table request_modules add column if not exists retention_days int;
do $$ begin
  alter table request_modules add constraint request_modules_beneficiary_mode_check check (beneficiary_mode in ('NAME','REFERENCE_ONLY','NONE'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table request_modules add constraint request_modules_retention_days_check check (retention_days between 1 and 36500);
exception when duplicate_object then null; end $$;
comment on column request_modules.retention_days is 'Durée de conservation en jours (point ouvert 6) : nulle tant que non décidée, aucune purge automatique.';

create or replace function _check_module_documents() returns trigger language plpgsql as $$
declare v_doc jsonb;
begin
  for v_doc in select * from jsonb_array_elements(new.required_documents) loop
    if jsonb_typeof(v_doc) <> 'object' or coalesce(v_doc->>'kind', '') !~ '^[A-Z][A-Z0-9_]{1,39}$' or jsonb_typeof(v_doc->'required') is distinct from 'boolean'
       or coalesce((v_doc->>'maxFiles')::int, 0) not between 1 and 10
       or coalesce(length(trim(v_doc->'labels'->>'fr')), 0) < 2 or coalesce(length(trim(v_doc->'labels'->>'en')), 0) < 2
       or coalesce(v_doc->>'sensitivity', 'STANDARD') not in ('STANDARD','SENSITIVE') then
      raise exception using errcode = 'P0001', message = format('Pièce de module invalide : %s', v_doc), hint = 'VALIDATION';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.required_documents)) <>
     (select count(distinct x->>'kind') from jsonb_array_elements(new.required_documents) x) then
    raise exception using errcode = 'P0001', message = 'Type de pièce en double dans le module', hint = 'VALIDATION';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Sensibilité explicite sur chaque pièce (STANDARD par défaut).
update request_modules m set required_documents = coalesce((
  select jsonb_agg(d || jsonb_build_object('sensitivity', coalesce(d->>'sensitivity', 'STANDARD')) order by ord)
    from jsonb_array_elements(m.required_documents) with ordinality x(d, ord)), '[]'::jsonb);

-- ---------- X6.2 Santé : données minimales (K13) ----------
update request_modules set beneficiary_mode = 'REFERENCE_ONLY',
  required_documents = '[{"kind": "QUOTE", "labels": {"en": "Quote or pro forma invoice", "fr": "Devis ou facture proforma"}, "maxFiles": 3, "required": true, "sensitivity": "SENSITIVE"}]'::jsonb
 where code = 'HEALTH';

-- ---------- X6.3 Référence du bénéficiaire ----------
alter table transactions add column if not exists beneficiary_reference text;
do $$ begin
  alter table transactions add constraint transactions_beneficiary_reference_check check (beneficiary_reference ~ '^[A-Z0-9][A-Z0-9./-]{0,15}$');
exception when duplicate_object then null; end $$;
-- Données de développement (aucune donnée de production) : aucun nom de bénéficiaire pour un module REFERENCE_ONLY.
update transactions t set beneficiary_name = null, draft_data = case when draft_data is null then null else draft_data - 'beneficiaryName' end
 where exists (select 1 from request_modules m where m.code = t.vertical and m.beneficiary_mode <> 'NAME')
   and (beneficiary_name is not null or draft_data ? 'beneficiaryName');

-- ---------- X6.5 Journaux : rien de sensible ----------
create or replace function _doc_sensitive(p_doc documents) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from transactions t join request_modules m on m.code = t.vertical, jsonb_array_elements(m.required_documents) x
                  where t.id = p_doc.tx_id and x->>'kind' = p_doc.kind::text and x->>'sensitivity' = 'SENSITIVE')
$$;
create or replace function _doc_view_payload(p_doc documents) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when _doc_sensitive(p_doc)
    then jsonb_build_object('document_id', p_doc.id, 'kind', p_doc.kind, 'sensitive', true,
                            'path_sha256', encode(extensions.digest(p_doc.storage_path, 'sha256'), 'hex'))
    else jsonb_build_object('document_id', p_doc.id, 'kind', p_doc.kind, 'file_name', p_doc.file_name, 'path', p_doc.storage_path) end
$$;

-- ---------- Fonctions mises à jour ----------
create or replace function _documents_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare v_max int;
begin
  if new.mime_type not in ('image/jpeg','image/png','application/pdf') then perform _err('FILE_TYPE', 'Format accepté : JPEG, PNG ou PDF'); end if;
  if new.size_bytes is null or new.size_bytes <= 0 or new.size_bytes > 10*1024*1024 then perform _err('FILE_TOO_LARGE', 'Fichier vide ou de plus de 10 Mo'); end if;
  if new.storage_path not like new.tx_id::text || '/%' then perform _err('VALIDATION', 'Chemin de stockage invalide'); end if;
  -- X6 (K13) : une pièce du dossier est d’un type prévu par le module (le module « Santé » n’en prévoit plus qu’un).
  if tg_op = 'INSERT' and new.tranche_id is null and exists (
       select 1 from transactions t join request_modules m on m.code = t.vertical
        where t.id = new.tx_id and jsonb_array_length(m.required_documents) > 0
          and not exists (select 1 from jsonb_array_elements(m.required_documents) x where x->>'kind' = new.kind::text)) then
    perform _err('DOCUMENT_KIND_NOT_ALLOWED', 'Type de pièce non prévu pour ce type de besoin', new.kind::text);
  end if;
  select coalesce((select (d->>'maxFiles')::int from transactions t join request_modules m on m.code = t.vertical,
                          jsonb_array_elements(m.required_documents) d where t.id = new.tx_id and d->>'kind' = new.kind), 3) into v_max;
  if new.tranche_id is null and (select count(*) from documents
      where tx_id = new.tx_id and kind = new.kind and tranche_id is null and deleted_at is null) >= v_max then
    perform _err('TOO_MANY_FILES', format('Au plus %s fichiers par pièce', v_max));
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

create or replace function _recently_opened(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  select exists (select 1 from audit_log a
    where a.tx_id = _storage_tx(p_path) and a.event = 'DOCUMENT_VIEWED' and a.actor_id = auth.uid()
      and (a.payload->>'path' = p_path or a.payload->>'path_sha256' = encode(extensions.digest(p_path, 'sha256'), 'hex'))
      and a.created_at > now() - interval '2 minutes')
$$;

create or replace function get_document_access(p_document uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare d documents; t transactions; v_role text;
begin
  perform _require_user();
  select * into d from documents where id = p_document and deleted_at is null;
  if not found then perform _err('NOT_FOUND', 'Pièce introuvable'); end if;
  select * into t from transactions where id = d.tx_id;
  if not (t.created_by = auth.uid() or is_party(t.id) or is_validator()) then perform _err('NOT_FOUND', 'Pièce introuvable'); end if;
  if not (t.status = 'DRAFT' and t.created_by = auth.uid() and not has_audit(t.id)) then
    v_role := coalesce((select p.role::text from transaction_parties p where p.tx_id = t.id and p.user_id = auth.uid()
                        order by case p.role when 'PAYER' then 1 when 'REQUESTER' then 2 else 3 end limit 1),
                       case when is_validator() then 'STAFF' else 'CREATOR' end);
    insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
    values (d.tx_id, d.tranche_id, auth.uid(), 'DOCUMENT_VIEWED',
            _doc_view_payload(d) || jsonb_build_object('role', v_role, 'via', 'get_document_access'));
  end if;
  return jsonb_build_object('id', d.id, 'path', d.storage_path, 'name', coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')),
                            'mimeType', d.mime_type, 'contentHash', d.content_hash);
end $$;

create or replace function open_document(p_doc uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare d documents;
begin
  perform _require_validator();
  select * into d from documents where id = p_doc and deleted_at is null;
  if not found then perform _err('NOT_FOUND', 'Pièce introuvable'); end if;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (d.tx_id, d.tranche_id, auth.uid(), 'DOCUMENT_VIEWED',
          _doc_view_payload(d));
  return jsonb_build_object('path', d.storage_path, 'name', coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')), 'mimeType', d.mime_type);
end $$;

create or replace function save_draft(p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_uid uuid; v_id uuid; t transactions; v_role tx_role; v_vertical text; v_amount bigint; v_purpose text;
  v_currency text; v_date date; v_plan text; v_prov jsonb; v_prov_row providers; v_prov_user uuid; v_prov_name text;
  v_prov_phone text; v_payer_phone text; v_payer_user uuid; v_creator text; me profiles; rule release_rules; it jsonb; n int := 0;
  v_bmode text; v_bname text; v_bref text;
begin
  v_uid := _require_user();
  begin v_id := (p_draft->>'id')::uuid; exception when others then perform _err('VALIDATION', 'Identifiant de brouillon invalide'); end;
  if v_id is null then perform _err('VALIDATION', 'Identifiant de brouillon manquant'); end if;
  v_vertical := p_draft->>'vertical';
  if v_vertical is null or not exists (select 1 from request_modules where code = v_vertical) then
    perform _err('VALIDATION', 'Type de besoin manquant ou inconnu');
  end if;
  -- X6 (K13) : bénéficiaire selon le module ; référence minimale (code ou initiales), jamais un nom pour REFERENCE_ONLY.
  select beneficiary_mode into v_bmode from request_modules where code = v_vertical;
  v_bname := nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), '');
  v_bref := nullif(upper(trim(coalesce(p_draft->>'beneficiaryReference', ''))), '');
  if v_bmode <> 'NAME' then
    if v_bname is not null then perform _err('BENEFICIARY_NAME_NOT_ALLOWED', 'Ce type de besoin n’enregistre pas le nom du bénéficiaire'); end if;
    if v_bmode = 'NONE' then v_bref := null;
    elsif v_bref is not null and v_bref !~ '^[A-Z0-9][A-Z0-9./-]{0,15}$' then
      perform _err('BENEFICIARY_REFERENCE_INVALID', 'Référence : code ou initiales, sans espace (16 caractères au plus)');
    end if;
  else
    v_bref := null;
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
  if v_role = 'REQUESTER' then perform _require_enrolment(me, 'REQUESTER'); end if;

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
    perform _require_enrolment(me, 'PROVIDER');
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
                             beneficiary_name, beneficiary_reference, provider_id, provider_name, plan_type, draft_data)
    values (v_id, v_vertical, v_purpose, v_amount, v_currency::currency, 'DRAFT', v_uid, v_date,
            v_bname, v_bref, v_prov_row.id, v_prov_name, v_plan, p_draft - 'documents' - 'id');
  else
    update transactions set vertical = v_vertical, purpose = v_purpose, amount_minor = v_amount, currency = v_currency::currency,
      due_date = v_date, beneficiary_name = v_bname, beneficiary_reference = v_bref,
      provider_id = v_prov_row.id, provider_name = v_prov_name, plan_type = v_plan, draft_data = p_draft - 'documents' - 'id'
    where id = v_id;
  end if;

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

create or replace function submit_operation(p_tx uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare t transactions; total bigint; missing text; v_review jsonb;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if t.status <> 'DRAFT' then perform _err('TRANSITION_UNKNOWN', format('Transition %s -> soumission inconnue', t.status)); end if;
  if not _is_initiator(p_tx) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  perform _check_initiator_level(p_tx);
  if not exists (select 1 from request_modules where code = t.vertical and enabled) then
    perform _err('VERTICAL_UNAVAILABLE', 'Ce type de besoin n’est pas encore ouvert');
  end if;
  if t.purpose is null or t.amount_minor is null or t.currency is null then perform _err('VALIDATION', 'Dossier incomplet'); end if;
  if (select beneficiary_mode from request_modules where code = t.vertical) = 'REFERENCE_ONLY' and t.beneficiary_reference is null then
    perform _err('BENEFICIARY_REFERENCE_REQUIRED', 'Référence du bénéficiaire requise (code ou initiales)');
  end if;
  if not exists (select 1 from transaction_parties where tx_id = p_tx and role = 'PAYER') then
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
   where rd.vertical = t.vertical and rd.required
     and not exists (select 1 from documents d where d.tx_id = p_tx and d.kind = rd.kind and d.tranche_id is null and d.deleted_at is null)
   order by rd.kind limit 1;
  if missing is not null then perform _err('DOCUMENT_REQUIRED', 'Pièce obligatoire manquante', missing); end if;

  update transactions set reject_reason = null where id = p_tx;
  v_review := _platform_review(p_tx);
  if (v_review->>'review')::boolean then
    return _set_tx_status(p_tx, 'PENDING_REVIEW', auth.uid(), 'STATUS_CHANGE', jsonb_build_object('review', v_review));
  end if;
  return _activate_operation(p_tx, auth.uid(), 'AUTO_ACTIVATED', jsonb_build_object('mode', v_review->>'mode'));
end $$;

-- ---------- Droits (X6) ----------
revoke all on function _doc_sensitive(documents), _doc_view_payload(documents), _check_module_documents() from public, anon, authenticated;
revoke all on function save_draft(jsonb), submit_operation(uuid), get_document_access(uuid), open_document(uuid) from public, anon;
grant execute on function save_draft(jsonb), submit_operation(uuid), get_document_access(uuid), open_document(uuid) to authenticated;
