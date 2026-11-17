-- Lot X-C (T9) : réglages dangereux pour une production. LECTURE SEULE (transaction en lecture seule, annulée).
-- Usage : scripts/db.sh psql -f scripts/prod-readiness.sql   (ou coller dans l’éditeur SQL de Supabase)
-- Chaque ligne renvoyée est un point à corriger, ou à accepter par écrit (docs/release-checklist.md, point 44).
-- Aucune ligne : rien de dangereux parmi ces contrôles (ils ne remplacent pas la liste de contrôle complète).
begin transaction read only;

select 'mock_mode' as controle, coalesce((select value from app_config where key = 'mock_mode'), '(absent)') as valeur,
       'doit valoir false en production (fonctions demo_* et simulations actives sinon)' as attendu
 where coalesce((select value from app_config where key = 'mock_mode'), 'true') = 'true'
union all
select 'require_staff_mfa', coalesce((select value from app_config where key = 'require_staff_mfa'), '(absent)'),
       'doit valoir true en production (second facteur du personnel, D7)'
 where coalesce((select value from app_config where key = 'require_staff_mfa'), '') <> 'true'
union all
select 'enrolment_limits', 'table vide',
       'plafonds par niveau à saisir (point ouvert 1) : sans ligne, tout paiement est refusé (LIMITS_NOT_CONFIGURED)'
 where not exists (select 1 from enrolment_limits)
union all
select 'enrolment_limits', count(*)::text || ' ligne(s) dev_only',
       'aucune ligne de développement (sans plafond) en production'
  from enrolment_limits where dev_only having count(*) > 0
union all
select 'fee_schedule', '(absent)',
       'barème des frais décidé (point ouvert 9), ou « aucun frais » accepté par écrit'
 where not exists (select 1 from app_config where key = 'fee_schedule')
union all
select 'fonction exécutable par anon', p.oid::regprocedure::text,
       'aucune fonction du schéma public exécutable par anon (lot X-C, T8)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1, 2;

rollback;
