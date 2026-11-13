-- =====================================================================
-- DiasPay : migration 0023 (lot X version 2, correctif de 0022) — preuve de jalon acceptée quel que soit le module.
-- À appliquer SUR 0001 à 0022. Test : supabase/tests/06_lotx2_p2.sql (partie X6).
-- 0022 limite les pièces d’un dossier aux types prévus par le module (DOCUMENT_KIND_NOT_ALLOWED). La preuve de jalon
-- (EVIDENCE, CONDITIONAL) n’est pas une pièce requise du module mais une preuve rattachée à une demande : elle reste
-- acceptée. Défaut trouvé par le test de bout en bout du bureau (preuves.spec.ts) ; 0022 étant appliquée, elle n’est
-- pas retouchée.
-- =====================================================================

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
        where t.id = new.tx_id and jsonb_array_length(m.required_documents) > 0 and new.kind::text <> 'EVIDENCE'
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

