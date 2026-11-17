-- =====================================================================
-- DiasPay : migration 0015 (lot X version 2, X1) — compléments de sécurité du TrustLink et du QR.
-- La partie X1 du premier lot X (0008 : partage retiré, révocation, limitation, journalisation) est conservée telle quelle.
-- À appliquer SUR 0001 à 0014. Test : supabase/tests/05_lotx2_p1.sql (partie X1).
--
--  1. Image du QR retirée du parcours par défaut : eqr_image_enabled vaut désormais 'false' (en DIRECT, le prestataire ne
--     confirme plus par scan). Le code reste pour CONDITIONAL, derrière ce réglage.
--  2. Substitution de destinataire : seuls le payeur et l’initiateur résolvent une référence ; le prestataire aussi, mais
--     seulement en CONDITIONAL (confirmation par scan). Même réponse pour « inconnue » et « pas partie ».
-- =====================================================================

update app_config set value = 'false' where key = 'eqr_image_enabled';
insert into app_config(key, value) values ('eqr_image_enabled', 'false') on conflict (key) do nothing;

create or replace function _party_token(p_ref text) returns tranche_tokens
language sql stable security definer set search_path = public as $$
  select k.* from tranche_tokens k join tranches tr on tr.id = k.tranche_id join transactions t on t.id = tr.tx_id
  where k.reference = lower(regexp_replace(coalesce(p_ref, ''), '[^0-9a-fA-F]', '', 'g'))
    and (has_role(t.id, 'PAYER') or coalesce(t.initiator_id, t.created_by) = auth.uid()
         or (t.settlement_mode = 'CONDITIONAL' and has_role(t.id, 'PROVIDER')))
$$;
revoke all on function _party_token(text) from public, anon, authenticated;
