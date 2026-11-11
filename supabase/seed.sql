-- Données de démonstration : comptes de plateforme et prestataires vérifiés (noms fictifs).
-- JAMAIS en production : le script s’arrête si app_config.mock_mode n’est pas 'true'.
-- Idempotent : réexécutable sans doublon.
--
-- Comptes : numéros de test déclarés dans l’authentification (code fixe 123456, aucun SMS envoyé),
-- tranche 06 39 98 réservée à la fiction par l’ARCEP. Les comptes payeur, demandeur et prestataire se créent
-- à la première connexion ; ceux de plateforme (validateurs, administrateur) sont créés ici avec leur rôle.
begin;

do $$
begin
  if coalesce((select value from app_config where key = 'mock_mode'), 'false') <> 'true' then
    raise exception 'seed.sql refusé : app_config.mock_mode n’est pas ''true'' (projet de production ?)';
  end if;
end $$;

-- Comptes de plateforme, créés comme le fait l’authentification par téléphone (utilisateur + identité « phone »).
with demo(id, phone, full_name, role) as (values
  ('d0000000-0000-4000-8000-000000000004'::uuid, '33639980004', 'Validateur A (démo)', 'VALIDATOR'),
  ('d0000000-0000-4000-8000-000000000005'::uuid, '33639980005', 'Validateur B (démo)', 'VALIDATOR'),
  ('d0000000-0000-4000-8000-000000000006'::uuid, '33639980006', 'Administrateur (démo)', 'ADMIN')
), new_users as (
  -- Les colonnes de jetons doivent valoir '' (et non NULL) : sinon l’authentification échoue
  -- (« Database error finding user »), constaté sur le projet réel.
  insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          encrypted_password, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', d.id, 'authenticated', 'authenticated', d.phone, now(),
         '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', ''
  from demo d
  where not exists (select 1 from auth.users u where u.phone = d.phone)
  returning id
)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'phone',
       jsonb_build_object('sub', u.id::text, 'phone', u.phone, 'email_verified', false, 'phone_verified', false), null, now(), now()
from auth.users u join demo d on d.phone = u.phone
where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'phone');

-- Rattrapage des comptes créés par une version antérieure de ce script.
update auth.users set encrypted_password = coalesce(encrypted_password, ''), confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''), email_change_token_new = coalesce(email_change_token_new, ''), email_change = coalesce(email_change, '')
where phone in ('33639980004', '33639980005', '33639980006');

-- Rôles et noms (le déclencheur guard_profile ne bloque que les rôles anon et authenticated).
update profiles p set full_name = d.full_name, platform_role = d.role::platform_role, country = 'CM', locale = 'fr'
from (values
  ('33639980004', 'Validateur A (démo)', 'VALIDATOR'),
  ('33639980005', 'Validateur B (démo)', 'VALIDATOR'),
  ('33639980006', 'Administrateur (démo)', 'ADMIN')
) as d(phone, full_name, role)
where p.phone = d.phone;

-- Prestataires vérifiés (noms fictifs), Yaoundé et Douala. Ceux qui portent le numéro du compte prestataire
-- de démonstration (+33 6 39 98 00 03) lui sont rattachés à son inscription (ou dès maintenant s’il existe).
insert into providers(name, city, verticals, verified, phone)
select v.name, v.city, v.verticals, true, v.phone
from (values
  ('Collège Les Manguiers',            'Yaoundé', '{EDUCATION}'::text[], '+33639980003'),
  ('Lycée Bilingue de l’Étoile',       'Yaoundé', '{EDUCATION}'::text[], null),
  ('Institut Supérieur Akwa',          'Douala',  '{EDUCATION}'::text[], null),
  ('École Primaire La Ruche',          'Douala',  '{EDUCATION}'::text[], null),
  ('Université Privée du Mfoundi',     'Yaoundé', '{EDUCATION}'::text[], null),
  ('Clinique Sainte-Élise',            'Yaoundé', '{HEALTH}'::text[],    '+33639980003'),
  ('Centre Médical Bonapriso',         'Douala',  '{HEALTH}'::text[],    null),
  ('Polyclinique du Wouri',            'Douala',  '{HEALTH}'::text[],    null),
  ('Cabinet Dentaire Essos',           'Yaoundé', '{HEALTH}'::text[],    null),
  ('Pharmacie de la Cité Verte',       'Yaoundé', '{HEALTH}'::text[],    null),
  ('Agence Immobilière Bastos',        'Yaoundé', '{RENT}'::text[],      '+33639980003'),
  ('Résidences Bonanjo',               'Douala',  '{RENT}'::text[],      null),
  ('Gestion Locative Makepe',          'Douala',  '{RENT}'::text[],      null),
  ('Cité Universitaire Ngoa-Ekellé',   'Yaoundé', '{RENT,EDUCATION}'::text[], null),
  ('Coopérative Agricole du Moungo',   'Douala',  '{AGRO}'::text[],      null)
) as v(name, city, verticals, phone)
where not exists (select 1 from providers p where p.name = v.name);
update providers p set user_id = pr.id from profiles pr
where p.user_id is null and p.phone is not null and _norm_phone(pr.phone) = _norm_phone(p.phone);

commit;

select phone, full_name, platform_role from profiles where phone like '3363998000%' order by phone;
select count(*) as prestataires, count(user_id) as rattaches from providers;
