-- Lot X-C (T5) : prise en charge du jeton de présentation (R5, première partie).
-- 0016 liait n’importe quel porteur du jeton comme payeur quand le payeur n’était connu que par son téléphone
-- (transaction_parties.user_id vide) : il suffisait de voir le QR pour prendre la place du payeur invité.
-- Désormais, la prise en charge n’aboutit dans ce cas que si le numéro vérifié de l’utilisateur connecté
-- (profiles.phone, protégé par T4 : il ne change que par le flux d’authentification) est égal, une fois normalisé,
-- à celui de l’invitation. Sinon : même réponse nulle qu’une référence inconnue, échec compté pour la limitation
-- (TOO_MANY_ATTEMPTS), comme aujourd’hui. Quand aucun payeur n’est désigné (cas du commerçant, K4), le comportement
-- est conservé : l’utilisateur connecté devient payeur. Dépend de T4 (0025).
-- Nota : à l’inscription, une invitation par téléphone est rattachée au compte (0005) ; et save_draft rattache
-- directement un numéro déjà inscrit. Le cas « payeur connu par téléphone seulement » ne concerne donc que les numéros
-- sans compte au moment de l’invitation — y compris un utilisateur qui a changé de numéro vérifié depuis (0025).
-- Tests : supabase/tests/07_lotxc.sql (section T5).

-- Prise en charge : usage unique ; lie la demande à l’utilisateur connecté (payeur invité par téléphone : seulement si
-- son numéro vérifié correspond ; payeur encore inconnu : conservé) ; résumé minimal (nom de l’initiateur, montant,
-- devise) ; aucun paiement autorisé. Référence inconnue, demande liée à un autre payeur ou numéro différent de
-- l’invitation : null (même réponse, échec compté pour la limitation). Expiré, révoqué, déjà pris : code stable.
create or replace function claim_presentation_token(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k presentation_tokens; tr tranches; t transactions; v_payer transaction_parties; v_name text;
begin
  perform _require_user();
  perform _reference_guard();
  select * into k from presentation_tokens where token_hash = _token_hash(p_reference) for update;
  if found then
    select * into tr from tranches where id = k.tranche_id;
    select * into t from transactions where id = tr.tx_id;
    select * into v_payer from transaction_parties where tx_id = t.id and role = 'PAYER' order by user_id nulls last limit 1;
  end if;
  if k.id is null
     or (v_payer.user_id is not null and v_payer.user_id <> auth.uid())
     -- Lot X-C (T5) : payeur invité par téléphone : seul le titulaire du numéro vérifié prend la demande en charge.
     or (v_payer.tx_id is not null and v_payer.user_id is null and _norm_phone(v_payer.invited_phone) is distinct from
         _norm_phone((select phone from profiles where id = auth.uid())))
     or coalesce(t.initiator_id, t.created_by) = auth.uid() then
    perform _reference_failed(p_reference, 'claim_presentation_token');
    return null;
  end if;
  if k.revoked_at is not null then perform _err('TOKEN_REVOKED', 'Ce QR a été révoqué'); end if;
  if k.claimed_at is not null then perform _err('TOKEN_USED', 'Ce QR a déjà été utilisé'); end if;
  if k.expires_at <= now() then perform _err('TOKEN_EXPIRED', 'QR expiré'); end if;
  if tr.status <> 'SUBMITTED' or t.status <> 'ACTIVE' then perform _err('NOT_PAYABLE', 'Cette demande n’est plus présentable'); end if;
  update presentation_tokens set claimed_at = now(), claimed_by = auth.uid() where id = k.id;
  if v_payer.tx_id is null then
    insert into transaction_parties(tx_id, user_id, role) values (t.id, auth.uid(), 'PAYER');
  elsif v_payer.user_id is null then
    update transaction_parties set user_id = auth.uid() where id = v_payer.id;
  end if;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (t.id, tr.id, auth.uid(), 'PRESENTATION_CLAIMED', jsonb_build_object('token_id', k.id));
  select coalesce(nullif(trim(full_name), ''), '') into v_name from profiles where id = coalesce(t.initiator_id, t.created_by);
  return jsonb_build_object('trancheId', tr.id, 'txId', t.id, 'initiatorName', coalesce(v_name, ''), 'amountMinor', tr.amount_minor, 'currency', t.currency);
end $$;
