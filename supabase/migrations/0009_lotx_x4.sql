-- =====================================================================
-- DiasPay : migration 0009 (lot X, passe 2, X4) — TrustVault : empreintes des pièces et consultations journalisées.
-- À appliquer SUR 0001 à 0008. Ne modifie aucune migration précédente : fonctions redéfinies, tables étendues.
-- Test : supabase/tests/04_lotx_p2.sql (variante éditeur SQL : 04_lotx_p2_editor.sql).
--
--  1. documents.content_hash (SHA-256 hexadécimal, 64 caractères) et hash_algo, calculés par l’application avant
--     l’envoi, enregistrés avec la pièce, immuables. Réglage require_content_hash (défaut 'false' : l’empreinte
--     reste facultative pour les anciennes versions de l’application ; à passer à 'true' avant la mise en production).
--  2. Réutilisation d’un justificatif (TrustProof) : document_reuse (un nombre pour une partie, les références pour
--     le personnel) et contrôle DOCUMENT_REUSED (ATTENTION) dans dossier_checks.
--  3. Consultations : get_document_access journalise DOCUMENT_VIEWED pour toute partie (et le personnel) avant
--     d’autoriser la lecture du fichier ; le stockage n’est plus lisible sans consultation journalisée, sauf le
--     brouillon jamais audité de son créateur.
--  4. Pièces d’un dossier soumis immuables (ni modification ni suppression).
-- =====================================================================

-- ---------- X4.1 Empreintes ----------
alter table documents add column if not exists content_hash text;
alter table documents add column if not exists hash_algo text;
alter table documents drop constraint if exists documents_content_hash_format;
alter table documents add constraint documents_content_hash_format check (
  (content_hash is null and hash_algo is null)
  or (content_hash ~ '^[0-9a-f]{64}$' and hash_algo = 'SHA-256'));
create index if not exists documents_content_hash on documents(content_hash) where content_hash is not null;

insert into app_config(key, value) values ('require_content_hash', 'false') on conflict (key) do nothing;

-- Empreinte reçue de l’application : hexadécimal minuscule de 64 caractères (miroir de normalizeContentHash).
create or replace function _norm_hash(p text) returns text
language sql immutable as $$ select nullif(lower(trim(coalesce(p, ''))), '') $$;

-- Contrôles à l’insertion (0005, complétés) : format de l’empreinte, empreinte exigée si le réglage l’impose.
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

-- ---------- X4.4 Immuabilité ----------
-- Une pièce ne change ni ne disparaît que tant que le dossier est modifiable (brouillon, dossier rejeté en correction)
-- ou, pour une pièce de réponse, tant que la tranche attend des informations. L’empreinte ne change jamais.
-- Exceptions : suppression du dossier lui-même (cascade : le dossier n’existe déjà plus) et réinitialisation de démonstration.
create or replace function _documents_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status tx_status; v_tr tranche_status;
begin
  if tg_op = 'UPDATE' and (new.content_hash is distinct from old.content_hash or new.hash_algo is distinct from old.hash_algo) then
    perform _err('HASH_IMMUTABLE', 'L’empreinte d’une pièce ne se modifie pas');
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('app.demo_reset', true), 'off') = 'on' and _mock_mode() then return old; end if;
  select status into v_status from transactions where id = old.tx_id;
  if not found then return case when tg_op = 'DELETE' then old else new end; end if;
  if v_status in ('DRAFT','REJECTED') then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.tranche_id is not null then
    select status into v_tr from tranches where id = old.tranche_id;
    if v_tr = 'INFO_REQUESTED' then return case when tg_op = 'DELETE' then old else new end; end if;
  end if;
  perform _err('DOCUMENT_LOCKED', 'Pièce d’un dossier soumis : ni modification ni suppression');
  return null;
end $$;
drop trigger if exists documents_immutable_trg on documents;
create trigger documents_immutable_trg before update or delete on documents
  for each row execute function _documents_immutable();

-- Ajout d’une pièce (0005) avec son empreinte. Remplace la signature à 6 paramètres (même appel sans empreinte).
drop function if exists add_document(uuid, text, text, text, text, int);
create or replace function add_document(p_tx uuid, p_kind text, p_path text, p_name text, p_mime text, p_size int,
                                        p_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t transactions; d documents;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if not (t.created_by = auth.uid() or has_role(p_tx,'REQUESTER') or has_role(p_tx,'PAYER')) then
    perform _err('TRANSITION_FORBIDDEN', 'Réservé au payeur ou au demandeur');
  end if;
  if t.status not in ('DRAFT','REJECTED') then perform _err('NOT_EDITABLE', 'Dossier non modifiable'); end if;
  insert into documents(tx_id, kind, storage_path, mime_type, size_bytes, uploaded_by, file_name, content_hash)
  values (p_tx, p_kind, p_path, p_mime, p_size, auth.uid(), p_name, _norm_hash(p_hash)) returning * into d;
  return jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.file_name, 'mimeType', d.mime_type, 'sizeBytes', d.size_bytes,
                            'status', 'UPLOADED', 'storagePath', d.storage_path, 'contentHash', d.content_hash,
                            'uploadedAt', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- ---------- X4.2 Réutilisation d’un justificatif (TrustProof) ----------
-- Autres dossiers (hors p_tx, brouillons exclus) contenant une pièce de même empreinte.
create or replace function _hash_reuse(p_hash text, p_tx uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct d.tx_id), '{}') from documents d join transactions o on o.id = d.tx_id
  where d.content_hash = _norm_hash(p_hash) and d.deleted_at is null
    and d.tx_id is distinct from p_tx and o.status <> 'DRAFT'
$$;

-- Une partie n’interroge que l’empreinte d’une pièce qu’elle peut voir ; elle reçoit un nombre, jamais de donnée
-- des autres dossiers. Le personnel reçoit aussi leurs références courtes.
create or replace function document_reuse(p_hash text, p_tx uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_hash text := _norm_hash(p_hash); v_others uuid[]; v_staff boolean;
begin
  perform _require_user();
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then perform _err('HASH_INVALID', 'Empreinte invalide (SHA-256 hexadécimal attendu)'); end if;
  v_staff := is_validator();
  if not v_staff and not exists (
      select 1 from documents d join transactions t on t.id = d.tx_id
      where d.content_hash = v_hash and d.deleted_at is null and (p_tx is null or d.tx_id = p_tx)
        and (t.created_by = auth.uid() or is_party(t.id))) then
    perform _err('NOT_FOUND', 'Pièce introuvable');
  end if;
  v_others := _hash_reuse(v_hash, p_tx);
  return jsonb_build_object('hash', v_hash, 'reused', cardinality(v_others) > 0, 'count', cardinality(v_others))
      || case when v_staff then jsonb_build_object('references',
           (select coalesce(jsonb_agg(_tx_ref(x) order by x), '[]'::jsonb) from unnest(v_others) x)) else '{}'::jsonb end;
end $$;

-- Contrôles automatiques (0006) : DOCUMENT_REUSED ajouté (ATTENTION, sans blocage). Le reste est inchangé.
create or replace function dossier_checks(p_tx uuid)
returns table (code text, result text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare t transactions; v_missing text[]; v_count int; v_has_list boolean; v_prov providers; v_payer text; v_dups text[]; v_sum bigint;
        v_reused jsonb;
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

  -- Lot X (X4) : justificatif déjà présent dans un autre dossier (même empreinte SHA-256). Alerte, sans blocage.
  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'references', x.refs) order by x.kind), '[]'::jsonb) into v_reused
  from (select d.kind, (select jsonb_agg(_tx_ref(o) order by o) from unnest(_hash_reuse(d.content_hash, p_tx)) o) as refs
        from documents d where d.tx_id = p_tx and d.deleted_at is null and d.content_hash is not null) x
  where x.refs is not null;
  code := 'DOCUMENT_REUSED'; result := case when jsonb_array_length(v_reused) = 0 then 'OK' else 'ATTENTION' end;
  detail := jsonb_build_object('documents', v_reused);
  return next;
end $$;

-- ---------- X4.3 Consultations journalisées ----------
-- Toute partie (et le personnel) : DOCUMENT_VIEWED (qui, rôle, quelle pièce ; quand : horodatage de la ligne), puis lecture
-- du fichier autorisée 2 minutes (politique dossiers_read) : le temps de créer une URL signée courte. Le brouillon jamais
-- audité de son créateur n’est pas journalisé (lui seul y a accès ; un journal le rendrait insupprimable, décision D4).
create or replace function get_document_access(p_document uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
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
            jsonb_build_object('document_id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'path', d.storage_path,
                               'role', v_role, 'via', 'get_document_access'));
  end if;
  return jsonb_build_object('id', d.id, 'path', d.storage_path, 'name', coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', '')),
                            'mimeType', d.mime_type, 'contentHash', d.content_hash);
end $$;

-- Lecture d’un fichier du bucket : après une consultation journalisée (partie ou personnel), ou brouillon jamais audité
-- de son créateur (envoi, retrait et suppression du brouillon, décision D4). Avant : toute partie, sans journal.
drop policy if exists dossiers_read on storage.objects;
create policy dossiers_read on storage.objects for select using (
  bucket_id = 'dossiers' and (
    exists (select 1 from transactions t where t.id = _storage_tx(name) and t.created_by = auth.uid()
            and t.status = 'DRAFT' and not has_audit(t.id))
    or (_recently_opened(name) and (is_validator() or exists (
          select 1 from transactions t where t.id = _storage_tx(name) and (t.created_by = auth.uid() or is_party(t.id)))))));

-- ---------- Droits (X4) : rien d’exécutable par anon, fonctions internes réservées ----------
revoke all on function _norm_hash(text), _documents_guard(), _documents_immutable(), _hash_reuse(text, uuid)
  from public, anon, authenticated;
revoke all on function add_document(uuid, text, text, text, text, int, text), document_reuse(text, uuid), get_document_access(uuid),
  dossier_checks(uuid) from public, anon;
grant execute on function add_document(uuid, text, text, text, text, int, text), document_reuse(text, uuid), get_document_access(uuid),
  dossier_checks(uuid) to authenticated;
