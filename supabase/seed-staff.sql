-- Comptes du personnel de TEST (bureau de contrôle) : adresse e-mail et mot de passe, rôle de plateforme.
-- JAMAIS en production : le script s’arrête si app_config.mock_mode n’est pas 'true'. Idempotent.
-- Mot de passe : variable psql « staff_password », lue dans .env.local (E2E_STAFF_PASSWORD) par
--   scripts/db.sh seed-staff
-- En production, les comptes du personnel sont nominatifs, créés dans le tableau de bord Supabase
-- (Authentication > Users > Add user), puis reçoivent leur rôle par SQL : voir docs/backoffice.md.
select set_config('seed.staff_password', :'staff_password', false);
begin;

do $$
begin
  if coalesce((select value from app_config where key = 'mock_mode'), 'false') <> 'true' then
    raise exception 'seed-staff.sql refusé : app_config.mock_mode n’est pas ''true'' (projet de production ?)';
  end if;
  if length(current_setting('seed.staff_password')) < 12 then
    raise exception 'E2E_STAFF_PASSWORD : 12 caractères minimum';
  end if;
end $$;

create temporary table staff_seed(id uuid, email text, phone text, full_name text, role text) on commit drop;
insert into staff_seed values
 ('d5000000-0000-4000-8000-000000000001', 'validateur.a@diaspay.test',      null,          'Validateur A (test)',          'VALIDATOR'),
 ('d5000000-0000-4000-8000-000000000002', 'validateur.b@diaspay.test',      null,          'Validateur B (test)',          'VALIDATOR'),
 ('d5000000-0000-4000-8000-000000000003', 'administrateur@diaspay.test',    null,          'Administratrice (test)',       'ADMIN'),
 -- Validateur qui est aussi payeur dans un dossier de test (invité par ce numéro, réservé aux tests automatisés).
 ('d5000000-0000-4000-8000-000000000004', 'validateur.partie@diaspay.test', '33639980014', 'Validateur partie (test)',     'VALIDATOR'),
 -- Utilisateur ordinaire avec un mot de passe : la connexion au bureau de contrôle doit lui être refusée.
 ('d5000000-0000-4000-8000-000000000005', 'utilisateur@diaspay.test',       null,          'Utilisateur ordinaire (test)', 'USER');

-- Création comme le fait Supabase Auth pour un compte e-mail confirmé (colonnes de jetons à '' et non NULL).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated', s.email,
       extensions.crypt(current_setting('seed.staff_password'), extensions.gen_salt('bf')), now(), s.phone, case when s.phone is not null then now() end,
       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', s.full_name), now(), now(), '', '', '', ''
from staff_seed s
where not exists (select 1 from auth.users u where u.id = s.id or u.email = s.email);

-- Réexécution : nouveau mot de passe éventuel, e-mail confirmé.
update auth.users u set encrypted_password = extensions.crypt(current_setting('seed.staff_password'), extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(u.email_confirmed_at, now()), updated_at = now()
from staff_seed s where u.id = s.id;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), s.id, s.id::text, 'email', jsonb_build_object('sub', s.id::text, 'email', s.email, 'email_verified', true, 'phone_verified', false),
       null, now(), now()
from staff_seed s
where not exists (select 1 from auth.identities i where i.user_id = s.id and i.provider = 'email');

-- Rôle de plateforme (le déclencheur guard_profile ne bloque que les rôles anon et authenticated).
update profiles p set full_name = s.full_name, platform_role = s.role::platform_role, country = 'CM', locale = 'fr'
from staff_seed s where p.id = s.id;

commit;
select set_config('seed.staff_password', '', false);
select email, full_name, platform_role from auth.users u join profiles p on p.id = u.id where u.email like '%@diaspay.test' order by email;
