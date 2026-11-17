-- Lot X-C (T3) : brouillons d’opération (R2 de l’état des lieux du 16 novembre, étendu).
--  1. Plus aucune écriture directe des clients sur transactions : la politique tx_update_draft (0001, resserrée en 0003)
--     laissait le créateur d’un brouillon modifier n’importe quelle colonne par PostgREST (constat confirmé :
--     beneficiary_name, settlement_mode, initiator_id ; status restait protégé par guard_status). Elle est supprimée :
--     toute modification d’un brouillon passe par save_draft (les applications ne font que des SELECT sur la table).
--  2. submit_operation durcie contre un brouillon falsifié avant cette migration (ou par toute autre voie) :
--     le mode de règlement est recalculé depuis request_modules (jamais une donnée du client) ; un initiator_id
--     différent du créateur est refusé (INITIATOR_MISMATCH) — aucun flux ne les distingue aujourd’hui (0014 : valeur
--     par défaut) ; un nom de bénéficiaire est refusé quand le module ne le prévoit pas (BENEFICIARY_NAME_NOT_ALLOWED,
--     même règle que save_draft, K13).
-- Tests : supabase/tests/07_lotxc.sql (section T3).

drop policy if exists tx_update_draft on transactions;

create or replace function submit_operation(p_tx uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare t transactions; total bigint; missing text; v_review jsonb; v_mode settlement_mode;
begin
  perform _require_user();
  select * into t from transactions where id = p_tx for update;
  if not found or not (t.created_by = auth.uid() or is_party(p_tx)) then perform _err('TX_NOT_FOUND', 'Transaction introuvable'); end if;
  if t.status <> 'DRAFT' then perform _err('TRANSITION_UNKNOWN', format('Transition %s -> soumission inconnue', t.status)); end if;
  if not _is_initiator(p_tx) then perform _err('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande'); end if;
  -- Lot X-C (T3) : l’initiateur d’un brouillon est toujours son créateur (0014) ; toute autre valeur est une falsification.
  if t.initiator_id is distinct from t.created_by then
    perform _err('INITIATOR_MISMATCH', 'Initiateur incohérent avec le créateur du dossier');
  end if;
  perform _check_initiator_level(p_tx);
  if not exists (select 1 from request_modules where code = t.vertical and enabled) then
    perform _err('VERTICAL_UNAVAILABLE', 'Ce type de besoin n’est pas encore ouvert');
  end if;
  if t.purpose is null or t.amount_minor is null or t.currency is null then perform _err('VALIDATION', 'Dossier incomplet'); end if;
  -- Lot X-C (T3) : même règle qu’à l’enregistrement (K13) — le nom du bénéficiaire n’existe que si le module le prévoit.
  if (select beneficiary_mode from request_modules where code = t.vertical) <> 'NAME' and t.beneficiary_name is not null then
    perform _err('BENEFICIARY_NAME_NOT_ALLOWED', 'Ce type de besoin n’enregistre pas le nom du bénéficiaire');
  end if;
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

  -- Lot X-C (T3) : le mode de règlement est celui du module au moment de la soumission (recalculé, jamais fourni).
  v_mode := coalesce((select settlement_mode from request_modules where code = t.vertical), 'DIRECT');
  update transactions set reject_reason = null, settlement_mode = v_mode where id = p_tx;
  v_review := _platform_review(p_tx);
  if (v_review->>'review')::boolean then
    return _set_tx_status(p_tx, 'PENDING_REVIEW', auth.uid(), 'STATUS_CHANGE', jsonb_build_object('review', v_review));
  end if;
  return _activate_operation(p_tx, auth.uid(), 'AUTO_ACTIVATED', jsonb_build_object('mode', v_review->>'mode'));
end $$;
