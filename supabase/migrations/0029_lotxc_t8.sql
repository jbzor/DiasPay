-- Lot X-C (T8) : droits de anon et lecture des réglages (R7 et D.6 de l’état des lieux du 16 novembre).
--  1. app_config : lecture réservée à authenticated (la politique config_read de 0001 s’appliquait à tous les rôles,
--     using (true)). Vérifié : aucune lecture avant connexion — bureau (proxy.ts, staff.ts) seulement avec une session,
--     application mobile seulement derrière l’authentification (mock_mode, eqr_image_enabled).
--  2. Aucune fonction du schéma public n’est exécutable par anon (ni par PUBLIC, dont anon hérite). Relevé T1 (16 novembre) :
--     14 fonctions — has_role, is_party, status_ok, required_validations, is_validator, is_admin, verify_audit ; les 6
--     fonctions de déclencheur audit_chain, audit_immutable, guard_profile, guard_status, guard_tranche_status,
--     handle_new_user ; et rls_auto_enable, qui ne vient d’aucune migration (fonction d’event trigger créée par l’option
--     du tableau de bord Supabase qui active la RLS automatiquement). Le retrait se fait par un parcours du catalogue :
--     une fonction absente (rls_auto_enable sur un projet neuf) est simplement ignorée, et la migration passe partout.
--     authenticated garde les fonctions qu’il exécutait (politiques RLS : has_role, is_party, is_validator…) : le droit
--     lui est accordé explicitement s’il ne le tenait que de PUBLIC. Les fonctions de déclencheur (trigger, event_trigger)
--     ne s’appellent jamais directement : retirées aussi à authenticated. PostgreSQL ne vérifie pas EXECUTE quand un
--     déclencheur se déclenche (seulement à sa création) : connexion par téléphone et création du profil inchangées.
--  3. Fonctions futures : le rôle des migrations est postgres (current_user des migrations, propriétaire des fonctions).
--     Ses privilèges par défaut dans public donnaient EXECUTE à anon (réglage de Supabase, par schéma) et PostgreSQL le
--     donne à PUBLIC (réglage global, qui ne se retire pas schéma par schéma) : les deux sont retirés. authenticated et
--     service_role gardent leurs privilèges par défaut explicites. Les fonctions créées par supabase_admin (tableau de
--     bord) ne sont pas couvertes : le contrôle générique de 00_smoke les signalerait.
-- Tests : 00_smoke.sql (contrôle générique) et 07_lotxc.sql (section T8).

drop policy if exists config_read on app_config;
create policy config_read on app_config for select to authenticated using (true);
revoke all on app_config from anon;

do $$
declare r record; v_auth boolean; v_trigger boolean;
begin
  for r in select p.oid, p.oid::regprocedure as sig, t.typname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
            where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'EXECUTE') loop
    v_trigger := r.typname in ('trigger', 'event_trigger');
    v_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', r.sig);
    if v_trigger then
      execute format('revoke execute on function %s from authenticated', r.sig);
    elsif v_auth then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    raise notice 'EXECUTE retiré à anon : %', r.sig;
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
