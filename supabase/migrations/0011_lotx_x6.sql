-- =====================================================================
-- DiasPay : migration 0011 (lot X, passe 2, X6) — types de besoin configurables : un noyau commun, des modules en données.
-- À appliquer SUR 0001 à 0010. Ne modifie aucune migration précédente. Réversible : supabase/rollbacks/0011_lotx_x6_down.sql.
-- Test : supabase/tests/04_lotx_p2.sql (partie X6).
--
--  1. request_modules : libellés, activation, vague, règle de déblocage, double validation, platform_review, plusieurs payeurs,
--     pièces requises (JSON), ordre. Amorcée avec les valeurs actuelles (vérifiées avant la conversion), platform_review = ALWAYS.
--  2. transactions.vertical : texte, clé étrangère vers request_modules(code) (même nom de colonne) ; release_rules et
--     required_documents deviennent des vues sur request_modules (les anciennes tables sont renommées, pas supprimées).
--  3. platform_review : needs_platform_review(tx) ; ALWAYS (file du bureau, comme aujourd’hui), NEVER (validation automatique,
--     AUTO_VALIDATED), RISK_BASED (automatique sauf montant au seuil, première demande, doublon). Double validation toujours
--     appliquée : un dossier qui exige deux validateurs passe toujours par le bureau.
--  4. Ouverture d’un type : request_modules.enabled (remplace app_config.open_verticals, conservé mais plus lu).
-- =====================================================================

-- ---------- X6.1 Table des modules ----------
create table if not exists request_modules (
  code               text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label_fr           text not null check (length(trim(label_fr)) >= 2),
  label_en           text not null check (length(trim(label_en)) >= 2),
  description_fr     text,
  description_en     text,
  enabled            boolean not null default false,
  wave               int not null default 1 check (wave between 1 and 9),
  release_mode       release_mode not null,
  contest_hours      int not null default 0 check (contest_hours between 0 and 720),
  dual_validation    boolean not null default false,
  platform_review    text not null default 'ALWAYS' check (platform_review in ('ALWAYS','RISK_BASED','NEVER')),
  multiple_payers    boolean not null default false,
  -- [{ "kind": "QUOTE", "required": true, "maxFiles": 3, "labels": { "fr": "…", "en": "…" } }]
  required_documents jsonb not null default '[]' check (jsonb_typeof(required_documents) = 'array'),
  display_order      int not null default 100,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Pièces d’un module : type en majuscules, obligatoire ou non, 1 à 10 fichiers, libellés français et anglais.
create or replace function _check_module_documents() returns trigger language plpgsql as $$
declare v_doc jsonb;
begin
  for v_doc in select * from jsonb_array_elements(new.required_documents) loop
    if jsonb_typeof(v_doc) <> 'object' or coalesce(v_doc->>'kind', '') !~ '^[A-Z][A-Z0-9_]{1,39}$' or jsonb_typeof(v_doc->'required') is distinct from 'boolean'
       or coalesce((v_doc->>'maxFiles')::int, 0) not between 1 and 10
       or coalesce(length(trim(v_doc->'labels'->>'fr')), 0) < 2 or coalesce(length(trim(v_doc->'labels'->>'en')), 0) < 2 then
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
drop trigger if exists request_modules_check on request_modules;
create trigger request_modules_check before insert or update on request_modules for each row execute function _check_module_documents();

-- Amorçage : valeurs actuelles (release_rules, required_documents, open_verticals). Miroir de DEFAULT_MODULES (@diaspay/domain),
-- comparé par test ; vérifié ci-dessous contre les tables avant leur remplacement.
-- seed:begin
insert into request_modules(code, label_fr, label_en, description_fr, description_en, enabled, wave, release_mode, contest_hours,
                            dual_validation, platform_review, multiple_payers, required_documents, display_order)
select x.code, x.label_fr, x.label_en, x.description_fr, x.description_en, x.enabled, x.wave, x.release_mode::release_mode, x.contest_hours,
       x.dual_validation, x.platform_review, x.multiple_payers, x.required_documents, x.display_order
from jsonb_to_recordset($seed$[
 {"code":"EDUCATION","label_fr":"Scolarité","label_en":"Education","description_fr":"Frais de scolarité, échelonnés si besoin","description_en":"School fees, in instalments if needed",
  "enabled":true,"wave":1,"release_mode":"PROVIDER_CONFIRM","contest_hours":72,"dual_validation":false,"platform_review":"ALWAYS","multiple_payers":false,"display_order":1,
  "required_documents":[{"kind":"ENROLMENT_CERTIFICATE","required":true,"maxFiles":3,"labels":{"fr":"Attestation d’inscription","en":"Enrolment certificate"}},
                        {"kind":"SCHOOL_SCHEDULE","required":false,"maxFiles":3,"labels":{"fr":"Échéancier de l’école","en":"School payment schedule"}}]},
 {"code":"HEALTH","label_fr":"Santé","label_en":"Health","description_fr":"Soins, hospitalisation, médicaments","description_en":"Care, hospital stay, medicines",
  "enabled":true,"wave":1,"release_mode":"PROVIDER_CONFIRM","contest_hours":48,"dual_validation":false,"platform_review":"ALWAYS","multiple_payers":false,"display_order":2,
  "required_documents":[{"kind":"QUOTE","required":true,"maxFiles":3,"labels":{"fr":"Devis ou facture proforma","en":"Quote or pro forma invoice"}},
                        {"kind":"BENEFICIARY_ID","required":true,"maxFiles":3,"labels":{"fr":"Pièce d’identité du bénéficiaire","en":"Beneficiary’s ID"}},
                        {"kind":"MEDICAL_CERTIFICATE","required":false,"maxFiles":3,"labels":{"fr":"Certificat médical","en":"Medical certificate"}}]},
 {"code":"RENT","label_fr":"Loyer","label_en":"Rent","description_fr":"Paiement récurrent au bailleur","description_en":"Recurring payment to the landlord",
  "enabled":true,"wave":1,"release_mode":"PROVIDER_CONFIRM","contest_hours":72,"dual_validation":false,"platform_review":"ALWAYS","multiple_payers":false,"display_order":3,
  "required_documents":[{"kind":"LEASE","required":true,"maxFiles":3,"labels":{"fr":"Bail","en":"Lease"}},
                        {"kind":"LAST_RECEIPT","required":false,"maxFiles":3,"labels":{"fr":"Dernière quittance","en":"Latest rent receipt"}}]},
 {"code":"AGRO","label_fr":"Agro","label_en":"Agri","description_fr":"Achat à un fournisseur, livraison confirmée","description_en":"Purchase from a supplier, confirmed delivery",
  "enabled":false,"wave":2,"release_mode":"PAYER_CONFIRM","contest_hours":72,"dual_validation":false,"platform_review":"ALWAYS","multiple_payers":false,"display_order":4,
  "required_documents":[{"kind":"SUPPORTING_DOCUMENT","required":true,"maxFiles":3,"labels":{"fr":"Pièce justificative","en":"Supporting document"}}]},
 {"code":"REAL_ESTATE","label_fr":"Immobilier","label_en":"Real estate","description_fr":"Paiement par jalons, avec preuves","description_en":"Milestone payments, with evidence",
  "enabled":false,"wave":2,"release_mode":"EVIDENCE_REVIEW","contest_hours":0,"dual_validation":true,"platform_review":"ALWAYS","multiple_payers":false,"display_order":5,
  "required_documents":[{"kind":"SUPPORTING_DOCUMENT","required":true,"maxFiles":3,"labels":{"fr":"Pièce justificative","en":"Supporting document"}}]},
 {"code":"LAND","label_fr":"Terrain","label_en":"Land","description_fr":"Paiement par jalons, avec preuves","description_en":"Milestone payments, with evidence",
  "enabled":false,"wave":2,"release_mode":"EVIDENCE_REVIEW","contest_hours":0,"dual_validation":true,"platform_review":"ALWAYS","multiple_payers":false,"display_order":6,
  "required_documents":[{"kind":"SUPPORTING_DOCUMENT","required":true,"maxFiles":3,"labels":{"fr":"Pièce justificative","en":"Supporting document"}}]}
]$seed$::jsonb) as x(code text, label_fr text, label_en text, description_fr text, description_en text, enabled boolean, wave int, release_mode text,
                     contest_hours int, dual_validation boolean, platform_review text, multiple_payers boolean, required_documents jsonb, display_order int)
on conflict (code) do nothing;
-- seed:end

-- L’amorçage reprend exactement les valeurs en place : sinon la migration s’arrête (aucune règle ne change en silence).
do $$
declare v_open text[] := string_to_array(coalesce((select value from app_config where key = 'open_verticals'), ''), ',');
begin
  if to_regclass('public.release_rules') is null or (select relkind from pg_class where oid = 'public.release_rules'::regclass) <> 'r' then
    return;   -- déjà convertie (migration rejouée) : rien à comparer
  end if;
  if exists (select 1 from release_rules r full join request_modules m on m.code = r.vertical
             where r.vertical is null or m.code is null or r.release_mode <> m.release_mode or r.contest_hours <> m.contest_hours
                or r.dual_validation <> m.dual_validation) then
    raise exception 'request_modules : amorçage différent de release_rules';
  end if;
  if exists ((select vertical, kind, required from required_documents)
             except (select m.code, d->>'kind', (d->>'required')::boolean from request_modules m, jsonb_array_elements(m.required_documents) d))
     or exists ((select m.code, d->>'kind', (d->>'required')::boolean from request_modules m, jsonb_array_elements(m.required_documents) d)
             except (select vertical, kind, required from required_documents)) then
    raise exception 'request_modules : amorçage différent de required_documents';
  end if;
  if exists (select 1 from request_modules where enabled <> (code = any(v_open))) then
    raise exception 'request_modules : amorçage différent de open_verticals';
  end if;
end $$;

-- ---------- X6.2 Vues de compatibilité ----------
-- Les anciennes tables sont renommées (réversibilité) ; les fonctions existantes lisent les vues du même nom.
do $$
begin
  if (select relkind from pg_class where oid = 'public.release_rules'::regclass) = 'r' then
    alter table release_rules rename to _release_rules_0003;
  end if;
  if (select relkind from pg_class where oid = 'public.required_documents'::regclass) = 'r' then
    alter table required_documents rename to _required_documents_0005;
  end if;
end $$;
revoke all on _release_rules_0003, _required_documents_0005 from anon, authenticated;

create or replace view release_rules with (security_invoker = true) as
  select code as vertical, release_mode, contest_hours, dual_validation from request_modules;
create or replace view required_documents with (security_invoker = true) as
  select m.code as vertical, d->>'kind' as kind, (d->>'required')::boolean as required
  from request_modules m cross join lateral jsonb_array_elements(m.required_documents) d;

-- transactions.vertical : texte référencé par request_modules (même nom de colonne). Les trois vues du bureau qui lisent la
-- colonne sont recréées à l’identique (définition relue dans le catalogue).
create temp table _lotx_x6_views as
  select c.relname::text as name, pg_get_viewdef(c.oid, true) as def from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relname in ('bo_dossiers','bo_evidence_queue','bo_disputes');
drop view if exists bo_dossiers, bo_evidence_queue, bo_disputes;
alter table transactions alter column vertical type text using vertical::text;
alter table transactions drop constraint if exists transactions_vertical_module_fk;
alter table transactions add constraint transactions_vertical_module_fk foreign key (vertical) references request_modules(code);
do $$
declare r record;
begin
  for r in select * from _lotx_x6_views loop
    execute format('create view %I with (security_invoker = true) as %s', r.name, r.def);
  end loop;
end $$;
drop table _lotx_x6_views;
revoke all on bo_dossiers, bo_evidence_queue, bo_disputes from public, anon;
grant select on bo_dossiers, bo_evidence_queue, bo_disputes to authenticated;

-- ---------- X6.3 Revue par le bureau de contrôle ----------
-- Dossier semblable (même règle que le contrôle DUPLICATE de dossier_checks) : références des autres dossiers.
create or replace function _duplicate_refs(p_tx uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare t transactions; v_payer text; v_dups text[];
begin
  select * into t from transactions where id = p_tx;
  select coalesce(p.user_id::text, _norm_phone(p.invited_phone)) into v_payer from transaction_parties p where p.tx_id = p_tx and p.role = 'PAYER' limit 1;
  select coalesce(array_agg(_tx_ref(o.id) order by o.created_at), '{}') into v_dups from transactions o
   where o.id <> t.id and o.amount_minor = t.amount_minor and o.currency = t.currency
     and o.status not in ('DRAFT','CANCELLED','REJECTED')
     and o.created_at between t.created_at - interval '30 days' and t.created_at + interval '30 days'
     and v_payer is not null
     and exists (select 1 from transaction_parties p where p.tx_id = o.id and p.role = 'PAYER'
                 and coalesce(p.user_id::text, _norm_phone(p.invited_phone)) = v_payer)
     and ((t.provider_id is not null and o.provider_id = t.provider_id)
          or (t.provider_id is null and coalesce(trim(t.provider_name), '') <> '' and _fold(o.provider_name) = _fold(t.provider_name)));
  return v_dups;
end $$;

-- Décision : { review, mode, reasons[] }. Raisons : ALWAYS, DUAL_VALIDATION (deux validateurs exigés : module ou seuil de
-- montant), FIRST_REQUEST (première demande validée de ce créateur), DUPLICATE (dossier semblable). Miroir de platformReviewDecision.
create or replace function _platform_review(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t transactions; m request_modules; v_reasons text[] := '{}';
begin
  select * into t from transactions where id = p_tx;
  select * into m from request_modules where code = t.vertical;
  if m.platform_review = 'ALWAYS' or m.code is null then v_reasons := array_append(v_reasons, 'ALWAYS'); end if;
  if required_validations(p_tx) >= 2 then v_reasons := array_append(v_reasons, 'DUAL_VALIDATION'); end if;
  if m.platform_review = 'RISK_BASED' then
    if not exists (select 1 from transactions o where o.created_by = t.created_by and o.id <> t.id
                   and o.status in ('VALIDATED','TOKEN_ISSUED','IN_PROGRESS','CLOSED','DISPUTED')) then
      v_reasons := array_append(v_reasons, 'FIRST_REQUEST');
    end if;
    if cardinality(_duplicate_refs(p_tx)) > 0 then v_reasons := array_append(v_reasons, 'DUPLICATE'); end if;
  end if;
  return jsonb_build_object('review', cardinality(v_reasons) > 0, 'mode', coalesce(m.platform_review, 'ALWAYS'), 'reasons', to_jsonb(v_reasons));
end $$;

-- Publique (parties, personnel) : le dossier passe-t-il par le bureau de contrôle ?
create or replace function needs_platform_review(p_tx uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_user();
  if not exists (select 1 from transactions where id = p_tx and (created_by = auth.uid() or is_party(id) or is_validator())) then
    perform _err('TX_NOT_FOUND', 'Transaction introuvable');
  end if;
  return (_platform_review(p_tx)->>'review')::boolean;
end $$;

-- Transitions (0008, complétées) : ouverture lue dans request_modules ; à la soumission, validation automatique quand le
-- module ne demande pas de revue (NEVER, ou RISK_BASED sans risque) : SUBMITTED → VALIDATED, journal AUTO_VALIDATED.
create or replace function transition_tx(p_tx uuid, p_to tx_status, p_reason text default null)
returns transactions language plpgsql security definer set search_path = public as $$
declare t transactions; ok boolean := false; r tx_role; old_status tx_status; total bigint; missing text; v_review jsonb;
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
    if not exists (select 1 from request_modules where code = t.vertical and enabled) then
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
     where rd.vertical = t.vertical and rd.required
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

  if old_status = 'DRAFT' and p_to = 'SUBMITTED' then
    v_review := _platform_review(p_tx);
    if not (v_review->>'review')::boolean then
      update transactions set status = 'VALIDATED' where id = p_tx;
      insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload)
      values (p_tx, null, 'AUTO_VALIDATED', 'SUBMITTED', 'VALIDATED', jsonb_build_object('mode', v_review->>'mode'));
      if _mock_mode() and coalesce((select value from app_config where key = 'auto_issue_token'), 'false') = 'true' then
        perform _simulate_token_issue(p_tx);
      end if;
      select * into t from transactions where id = p_tx;
    end if;
  end if;
  return t;
end $$;

-- Brouillon (0008) : le type de besoin est un code de module (texte), plus une valeur d’enum.
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
  if v_vertical is null or not exists (select 1 from request_modules where code = v_vertical) then
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
    values (v_id, v_vertical, v_purpose, v_amount, v_currency::currency, 'DRAFT', v_uid, v_date,
            nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''), v_prov_row.id, v_prov_name, v_plan, p_draft - 'documents' - 'id');
  else
    update transactions set vertical = v_vertical, purpose = v_purpose, amount_minor = v_amount, currency = v_currency::currency,
      due_date = v_date, beneficiary_name = nullif(trim(coalesce(p_draft->>'beneficiaryName', '')), ''),
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

-- Pièces (0009, complété) : nombre maximal de fichiers par type lu dans le module (3 par défaut, décision D2).
create or replace function _documents_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  if new.mime_type not in ('image/jpeg','image/png','application/pdf') then perform _err('FILE_TYPE', 'Format accepté : JPEG, PNG ou PDF'); end if;
  if new.size_bytes is null or new.size_bytes <= 0 or new.size_bytes > 10*1024*1024 then perform _err('FILE_TOO_LARGE', 'Fichier vide ou de plus de 10 Mo'); end if;
  if new.storage_path not like new.tx_id::text || '/%' then perform _err('VALIDATION', 'Chemin de stockage invalide'); end if;
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

-- ---------- RLS et droits (X6) ----------
alter table request_modules enable row level security;
drop policy if exists request_modules_read on request_modules;
create policy request_modules_read on request_modules for select to authenticated using (true);
-- Un type de besoin s’ajoute ou se règle par une ligne de données, par un administrateur (aucun code à modifier).
drop policy if exists request_modules_admin_write on request_modules;
create policy request_modules_admin_write on request_modules for all to authenticated using (is_admin()) with check (is_admin());
revoke all on request_modules from anon;
grant select, insert, update on request_modules to authenticated;
revoke delete on request_modules from authenticated;
revoke all on release_rules, required_documents from anon;
grant select on release_rules, required_documents to authenticated;

revoke all on function _check_module_documents(), _duplicate_refs(uuid), _platform_review(uuid) from public, anon, authenticated;
revoke all on function needs_platform_review(uuid), transition_tx(uuid, tx_status, text), save_draft(jsonb) from public, anon;
grant execute on function needs_platform_review(uuid), transition_tx(uuid, tx_status, text), save_draft(jsonb) to authenticated;
-- _documents_guard est un déclencheur : aucun droit d’exécution direct (comme en 0009).
revoke all on function _documents_guard() from public, anon, authenticated;
