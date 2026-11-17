-- Lot X-C (T4) : profils et numéro de téléphone (R3 de l’état des lieux du 16 novembre, confirmé).
--  1. phone rejoint les colonnes protégées de guard_profile (PROFILE_PROTECTED) : un utilisateur pouvait inscrire le
--     numéro d’un autre dans son propre profil et se faire désigner comme contrepartie à sa place (_user_by_phone).
--     Convention de 0004 : colonnes sensibles protégées par le déclencheur plutôt que par la politique — les écritures
--     clientes légitimes ne touchent que full_name, country, primary_role et push_enabled (api-client, auth.ts).
--  2. Le numéro ne change que par le flux d’authentification : auth.users porte le numéro vérifié (OTP), copié dans
--     profiles à l’inscription seulement (handle_new_user, 0001). Si le numéro vérifié change (auth.updateUser),
--     il est désormais recopié (on_auth_user_phone_changed) ; ce chemin ne passe pas par anon/authenticated,
--     guard_profile le laisse donc passer.
--  3. Unicité du numéro normalisé : _user_by_phone compare les numéros normalisés (_norm_phone), mais l’unicité ne
--     portait que sur la valeur brute (profiles_phone_key) — deux graphies d’un même numéro pouvaient désigner deux
--     profils. Aucun doublon normalisé relevé sur le projet de développement (T1, 16 novembre 2026).
-- Tests : supabase/tests/07_lotxc.sql (section T4).

create or replace function guard_profile() returns trigger language plpgsql as $$
begin
  if current_user in ('anon','authenticated')
     and (new.platform_role is distinct from old.platform_role
          or new.kyc_status is distinct from old.kyc_status
          or new.enrolment_level is distinct from old.enrolment_level
          or new.phone is distinct from old.phone) then
    raise exception using errcode = 'P0001', message = 'Le rôle de plateforme, le statut KYC, le niveau d’enrôlement et le téléphone ne sont pas modifiables',
                          hint = 'PROFILE_PROTECTED';
  end if;
  return new;
end $$;

-- Numéro vérifié recopié depuis auth.users (seul flux légitime de changement de numéro).
create or replace function handle_user_phone_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set phone = new.phone where id = new.id and phone is distinct from new.phone;
  return new;
end $$;
revoke all on function handle_user_phone_change() from public, anon, authenticated;
drop trigger if exists on_auth_user_phone_changed on auth.users;
create trigger on_auth_user_phone_changed after update of phone on auth.users
  for each row execute function handle_user_phone_change();

-- Unicité du numéro normalisé (la contrainte brute profiles_phone_key est conservée : elle ne contredit rien).
create unique index if not exists profiles_phone_norm_key on profiles ((_norm_phone(phone))) where _norm_phone(phone) is not null;
