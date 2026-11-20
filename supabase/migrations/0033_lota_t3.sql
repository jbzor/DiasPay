-- Lot A (T3) : simulateur du partenaire de paiement, côté serveur, par le même chemin que les événements réels.
--
-- 1. Point d’entrée des événements signés du partenaire : receive_payment_webhook(corps brut, signature). La signature
--    HMAC-SHA256 (hexadécimal) du corps brut est vérifiée avec la clé du fournisseur (payment_partner_keys), puis
--    l’événement est remis à apply_payment_event avec le résultat de cette vérification : une signature fausse est
--    enregistrée (INVALID_SIGNATURE) et jamais appliquée. Format du corps : {provider, eventId, occurredAt, payload},
--    celui de SimulatedPaymentAdapter (packages/domain/src/payments.ts). service_role seulement (future fonction Edge).
-- 2. Clé du simulateur : générée au hasard par cette migration, seulement si mock_mode = 'true' (dev_only). Elle ne quitte
--    jamais la base : table sans aucun droit pour anon ni authenticated.
-- 3. Simulateur : simulate_payment_attempt (une étape pour une tentative) et payment_simulator_tick (tâche planifiée,
--    toutes les 10 secondes). Il signe ses événements avec la clé et les envoie à receive_payment_webhook : aucun
--    contournement de la vérification, aucun second chemin qui marquerait une demande payée.
--    Identifiants d’événement stables : simsvc-<tentative>-<type>. Un renvoi est donc un doublon (DUPLICATE).
-- 4. Scénarios (réglage dev_only sim_payment_scenario) : SUCCESS (défaut), FAILURE, LATE (« en attente » d’abord,
--    succès après sim_payment_late_seconds), DUPLICATE (succès envoyé deux fois), OUT_OF_ORDER (succès, puis un
--    « en attente » périmé). Délai avant la première réponse : sim_payment_delay_seconds (dev_only).
-- 5. Hors mock_mode : la tâche ne fait rien ; l’appel direct est refusé (SIMULATOR_DISABLED). Aucune fonction du
--    simulateur n’est exécutable par anon ni par authenticated.
-- demo_settle_payment (0021) est inchangé : il reste réservé au mode démonstration explicite.
-- Tests : supabase/tests/08_lota.sql (section T3).

create table if not exists payment_partner_keys (
  provider   text primary key,
  secret     text not null check (length(secret) >= 32),
  dev_only   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table payment_partner_keys enable row level security;   -- aucune politique : invisible par l’API
revoke all on payment_partner_keys from public, anon, authenticated;

insert into payment_partner_keys(provider, secret, dev_only)
select 'SIMULATED', encode(extensions.gen_random_bytes(32), 'hex'), true
 where (select value from app_config where key = 'mock_mode') = 'true'
on conflict (provider) do nothing;

-- Réglages dev_only du simulateur (projet de développement seulement). Voir docs/open-parameters.md.
insert into app_config(key, value)
select k, v from (values ('sim_payment_scenario', 'SUCCESS'), ('sim_payment_delay_seconds', '5'), ('sim_payment_late_seconds', '60')) s(k, v)
 where (select value from app_config where key = 'mock_mode') = 'true'
on conflict (key) do nothing;

-- ---------- Point d’entrée des événements signés ----------
create or replace function receive_payment_webhook(p_raw_body text, p_signature text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_body jsonb; v_provider text; v_secret text; v_valid boolean;
begin
  begin v_body := p_raw_body::jsonb;
  exception when others then perform _err('VALIDATION', 'Corps de l’événement illisible (JSON attendu)'); end;
  if jsonb_typeof(v_body) is distinct from 'object' then perform _err('VALIDATION', 'Corps de l’événement illisible (objet attendu)'); end if;
  v_provider := trim(coalesce(v_body->>'provider', ''));
  select secret into v_secret from payment_partner_keys where provider = v_provider;
  v_valid := v_secret is not null and p_signature is not null
         and lower(trim(p_signature)) = encode(extensions.hmac(p_raw_body, v_secret, 'sha256'), 'hex');
  return apply_payment_event(v_provider, v_body->>'eventId', v_valid, v_body->'payload');
end $$;
revoke all on function receive_payment_webhook(text, text) from public, anon, authenticated;
grant execute on function receive_payment_webhook(text, text) to service_role;

-- ---------- Simulateur ----------
create or replace function _sim_setting(p_key text, p_default text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_config where key = p_key), p_default)
$$;

-- Signe le corps brut avec la clé du simulateur, comme le partenaire signe les siens.
create or replace function _sim_sign(p_raw_body text) returns text
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select secret into v_secret from payment_partner_keys where provider = 'SIMULATED';
  if v_secret is null then perform _err('SIMULATOR_DISABLED', 'Simulateur sans clé (projet hors mock_mode)'); end if;
  return encode(extensions.hmac(p_raw_body, v_secret, 'sha256'), 'hex');
end $$;

-- Un événement du partenaire simulé pour une tentative, signé et remis au point d’entrée.
create or replace function _sim_send(p_attempt uuid, p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; v_raw text;
begin
  select * into a from payment_attempts where id = p_attempt;
  v_raw := jsonb_build_object(
    'provider', a.provider, 'eventId', 'simsvc-' || a.id::text || '-' || p_type,
    'occurredAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', jsonb_strip_nulls(jsonb_build_object('type', p_type, 'idempotencyKey', a.idempotency_key, 'providerRef', a.provider_ref,
      'amountMinor', a.amount_minor, 'currency', a.currency,
      'errorCode', case when p_type = 'PAYMENT_FAILED' then 'SIMULATED_DECLINE' end)))::text;
  return receive_payment_webhook(v_raw, _sim_sign(v_raw));
end $$;

-- Une étape du scénario actif pour une tentative en cours. Renvoie l’étape jouée et les réponses du point d’entrée.
create or replace function simulate_payment_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a payment_attempts; v_scenario text; v_late int; v_pending timestamptz; v_step text; v_results jsonb := '[]';
begin
  if not _mock_mode() then perform _err('SIMULATOR_DISABLED', 'Simulateur du partenaire désactivé (mock_mode)'); end if;
  select * into a from payment_attempts where id = p_attempt for update;
  if not found or a.provider <> 'SIMULATED' then perform _err('PAYMENT_NOT_FOUND', 'Tentative simulée introuvable'); end if;
  v_scenario := upper(_sim_setting('sim_payment_scenario', 'SUCCESS'));
  if v_scenario not in ('SUCCESS','FAILURE','LATE','DUPLICATE','OUT_OF_ORDER') then
    perform _err('VALIDATION', 'Scénario du simulateur inconnu : ' || v_scenario);
  end if;
  if a.status not in ('INITIATED','PENDING') then
    return jsonb_build_object('attemptId', a.id, 'scenario', v_scenario, 'step', 'DONE', 'results', v_results);
  end if;
  if v_scenario = 'SUCCESS' then
    v_step := 'SUCCEEDED'; v_results := jsonb_build_array(_sim_send(a.id, 'PAYMENT_SUCCEEDED'));
  elsif v_scenario = 'FAILURE' then
    v_step := 'FAILED'; v_results := jsonb_build_array(_sim_send(a.id, 'PAYMENT_FAILED'));
  elsif v_scenario = 'DUPLICATE' then
    v_step := 'SUCCEEDED_TWICE';
    v_results := jsonb_build_array(_sim_send(a.id, 'PAYMENT_SUCCEEDED'), _sim_send(a.id, 'PAYMENT_SUCCEEDED'));
  elsif v_scenario = 'OUT_OF_ORDER' then
    v_step := 'SUCCEEDED_THEN_PENDING';
    v_results := jsonb_build_array(_sim_send(a.id, 'PAYMENT_SUCCEEDED'), _sim_send(a.id, 'PAYMENT_PENDING'));
  else   -- LATE : « en attente » d’abord, succès quand le délai est écoulé depuis cet événement
    v_late := greatest(_sim_setting('sim_payment_late_seconds', '60')::int, 0);
    select received_at into v_pending from webhook_events where provider = a.provider and event_id = 'simsvc-' || a.id::text || '-PAYMENT_PENDING';
    if v_pending is null then
      v_step := 'PENDING'; v_results := jsonb_build_array(_sim_send(a.id, 'PAYMENT_PENDING'));
    elsif v_pending <= now() - make_interval(secs => v_late) then
      v_step := 'SUCCEEDED'; v_results := jsonb_build_array(_sim_send(a.id, 'PAYMENT_SUCCEEDED'));
    else
      v_step := 'WAITING';
    end if;
  end if;
  return jsonb_build_object('attemptId', a.id, 'scenario', v_scenario, 'step', v_step, 'results', v_results);
end $$;

-- Tâche planifiée : traite les tentatives simulées en cours dont le délai est écoulé. Hors mock_mode : ne fait rien.
create or replace function payment_simulator_tick() returns int
language plpgsql security definer set search_path = public as $$
declare v_delay int; v_id uuid; n int := 0;
begin
  if not _mock_mode() or not exists (select 1 from payment_partner_keys where provider = 'SIMULATED') then return 0; end if;
  v_delay := greatest(_sim_setting('sim_payment_delay_seconds', '5')::int, 0);
  for v_id in select id from payment_attempts
               where provider = 'SIMULATED' and status in ('INITIATED','PENDING') and created_at <= now() - make_interval(secs => v_delay)
               order by created_at limit 50
  loop
    begin
      perform simulate_payment_attempt(v_id);
      n := n + 1;
    exception when others then
      raise warning 'payment_simulator_tick : tentative % : %', v_id, sqlerrm;
    end;
  end loop;
  return n;
end $$;

revoke all on function _sim_setting(text, text), _sim_sign(text), _sim_send(uuid, text), simulate_payment_attempt(uuid), payment_simulator_tick()
  from public, anon, authenticated;

-- Planification : projet en mock_mode seulement (aucune tâche en production ; la tâche vérifie aussi mock_mode).
do $$
begin
  if (select value from app_config where key = 'mock_mode') = 'true'
     and not exists (select 1 from cron.job where jobname = 'diaspay-payment-simulator') then
    perform cron.schedule('diaspay-payment-simulator', '10 seconds', 'select public.payment_simulator_tick()');
  end if;
end $$;
