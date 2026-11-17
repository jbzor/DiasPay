-- Lot X-C (complément de T4) : le nom du profil est figé à partir du niveau N1.
-- À partir de N1, le nom a été rapproché de la pièce d’identité (KYC) : le titulaire ne le change plus par écriture directe
-- (auth.saveProfile, PostgREST) — PROFILE_PROTECTED, comme le téléphone (0025), le niveau, le statut KYC et le rôle de
-- plateforme. En N0, saveProfile pose encore le nom (inscription, avant tout enrôlement). Les fonctions serveur
-- (SECURITY DEFINER : enrôlement, KYC) ne passent pas par anon/authenticated et restent libres de le corriger.
-- Réécrire la même valeur reste permis (is distinct from) : saveProfile renvoie le nom inchangé quand on ne modifie que
-- le pays ou le rôle principal.
-- Tests : supabase/tests/07_lotxc.sql (section T4b).

create or replace function guard_profile() returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated')
     and (new.platform_role is distinct from old.platform_role
          or new.kyc_status is distinct from old.kyc_status
          or new.enrolment_level is distinct from old.enrolment_level
          or new.phone is distinct from old.phone
          or (new.full_name is distinct from old.full_name and old.enrolment_level >= 'N1')) then
    raise exception using errcode = 'P0001',
      message = 'Le rôle de plateforme, le statut KYC, le niveau d’enrôlement, le téléphone et (à partir de N1) le nom ne sont pas modifiables',
      hint = 'PROFILE_PROTECTED';
  end if;
  return new;
end $$;
revoke execute on function guard_profile() from public, anon, authenticated;
