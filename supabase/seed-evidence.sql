-- Dossier terrain avec une preuve de jalon en attente de validation (écran « Preuves de jalons » du bureau de contrôle).
-- DÉVELOPPEMENT SEULEMENT : refusé si app_config.mock_mode n’est pas 'true'. Les preuves réelles arrivent en vague 2.
--
--   scripts/db.sh seed-evidence            # dossier fictif complet ; la pièce n’a pas de fichier dans le bucket
--   scripts/db.sh seed-evidence <tx_id>    # brouillon terrain existant (créé par l’application ou un test), dont la
--                                          # preuve (pièce de type EVIDENCE) est déjà envoyée dans le bucket
--
-- Modèle du lot X version 2 (docs/specs/modele-cible-v2.md, migration 0014) : l’opération terrain est en règlement
-- CONDITIONAL. Elle est amenée à l’état qu’elle aurait au bout du parcours : soumise (PENDING_REVIEW, double validation),
-- prise en charge (IN_REVIEW), approuvée par deux validateurs (case du montant cochée), ACTIVE ; première demande envoyée
-- au payeur (SUBMITTED), acceptée, payée par une tentative réussie (PAID, fonds bloqués : funds_state HELD, journal financier
-- PAYMENT), puis preuve déposée par le prestataire (evidence_submitted_at, événement EVIDENCE_SUBMITTED) : elle apparaît
-- dans bo_evidence_queue. Le journal d’audit retrace chaque étape (chaîne d’empreintes intacte).
\if :{?tx}
select set_config('seed.tx', :'tx', false);
\else
select set_config('seed.tx', '', false);
\endif
begin;

do $$
declare
  v_tx uuid; v_req uuid; v_payer uuid; v_prov uuid; v_val1 uuid; v_val2 uuid; v_tr uuid; t transactions; v_n int;
  v_amount bigint; v_cur currency; v_attempt uuid; v_contrib uuid;
begin
  if coalesce((select value from app_config where key = 'mock_mode'), 'false') <> 'true' then
    raise exception 'seed-evidence.sql refusé : app_config.mock_mode n’est pas ''true'' (projet de production ?)';
  end if;
  perform set_config('app.via_transition', 'on', true);

  -- Deux validateurs distincts (seed.sql ou seed-staff.sql).
  select id into v_val1 from profiles where platform_role = 'VALIDATOR' order by created_at limit 1;
  select id into v_val2 from profiles where platform_role in ('VALIDATOR','ADMIN') and id <> v_val1 order by platform_role desc, created_at limit 1;
  if v_val1 is null or v_val2 is null then raise exception 'Deux validateurs requis : exécuter seed.sql ou seed-staff.sql'; end if;

  if current_setting('seed.tx') <> '' then
    -- Brouillon existant : ses parties, ses tranches et ses pièces sont conservées.
    v_tx := current_setting('seed.tx')::uuid;
    select * into t from transactions where id = v_tx for update;
    if not found or t.status <> 'DRAFT' or t.vertical <> 'LAND' then raise exception 'Le dossier % doit être un brouillon terrain (LAND)', v_tx; end if;
    if not exists (select 1 from documents where tx_id = v_tx and kind = 'EVIDENCE' and deleted_at is null) then
      raise exception 'Le brouillon % n’a pas de pièce EVIDENCE (envoyée dans le bucket par l’application)', v_tx;
    end if;
    v_req := t.created_by;
    select user_id into v_payer from transaction_parties where tx_id = v_tx and role = 'PAYER';
    select user_id into v_prov from transaction_parties where tx_id = v_tx and role = 'PROVIDER';
  else
    -- Dossier fictif : comptes de démonstration ou de test existants (créés à leur première connexion).
    select id into v_req from profiles where phone in ('33639980002','33639980012') order by phone limit 1;
    select id into v_payer from profiles where phone in ('33639980001','33639980011') order by phone limit 1;
    select id into v_prov from profiles where phone in ('33639980003','33639980013') order by phone limit 1;
    if v_req is null or v_payer is null then
      raise exception 'Comptes demandeur et payeur absents : se connecter une fois avec +33 6 39 98 00 02 et 01 (code 123456)';
    end if;
    v_tx := gen_random_uuid();
    insert into transactions(id, vertical, purpose, amount_minor, currency, status, created_by, beneficiary_name, provider_name, plan_type)
    values (v_tx, 'LAND', 'Parcelle Nkolbisson (démonstration)', 12500000, 'XAF', 'DRAFT', v_req, 'Famille M.', 'Étude notariale Mbarga (démonstration)', 'PARTIAL');
    insert into transaction_parties(tx_id, user_id, role, invited_phone) values
      (v_tx, v_req, 'REQUESTER', null), (v_tx, v_payer, 'PAYER', null),
      (v_tx, v_prov, 'PROVIDER', case when v_prov is null then '+33639980003' end);
    insert into tranches(tx_id, seq, label, amount_minor, due_date, release_mode, contest_hours) values
      (v_tx, 1, 'Signature de l’acte notarié', 4000000, null, 'EVIDENCE_REVIEW', 0),
      (v_tx, 2, 'Remise du titre foncier', 8500000, null, 'EVIDENCE_REVIEW', 0);
    insert into documents(tx_id, kind, storage_path, mime_type, size_bytes, uploaded_by, file_name) values
      (v_tx, 'SUPPORTING_DOCUMENT', v_tx || '/SUPPORTING_DOCUMENT/promesse_de_vente.pdf', 'application/pdf', 182000, v_req, 'promesse_de_vente.pdf'),
      (v_tx, 'EVIDENCE', v_tx || '/EVIDENCE/acte_notarie.pdf', 'application/pdf', 524000, coalesce(v_prov, v_req), 'acte_notarie.pdf');
  end if;

  select id into v_tr from tranches where tx_id = v_tx order by seq limit 1;
  update documents set tranche_id = v_tr where tx_id = v_tx and kind = 'EVIDENCE' and tranche_id is null;

  -- Règlement conditionnel et règle de déblocage par preuve (vague 2), même si le module a changé depuis le brouillon.
  update transactions set settlement_mode = 'CONDITIONAL' where id = v_tx;
  update tranches set release_mode = 'EVIDENCE_REVIEW', contest_hours = 0 where tx_id = v_tx;

  -- Parcours de l’opération (section 3.1), journalisé par les fonctions internes de 0014.
  perform _set_tx_status(v_tx, 'PENDING_REVIEW', v_req, 'STATUS_CHANGE', '{"review":{"mode":"ALWAYS","reasons":["DUAL_VALIDATION"]}}');
  perform _set_tx_status(v_tx, 'IN_REVIEW', v_val1, 'STATUS_CHANGE', '{"reason":null}');
  insert into validations(tx_id, validator_id, approved, amount_checked) values (v_tx, v_val1, true, true), (v_tx, v_val2, true, true);
  insert into audit_log(tx_id, actor_id, event, payload) values
    (v_tx, v_val1, 'VALIDATION_DECISION', '{"approved":true,"amount_checked":true,"reason":null,"got":1,"need":2}'),
    (v_tx, v_val2, 'VALIDATION_DECISION', '{"approved":true,"amount_checked":true,"reason":null,"got":2,"need":2}');
  perform _set_tx_status(v_tx, 'ACTIVE', v_val2, 'STATUS_CHANGE', '{}');

  -- Première demande (section 3.2) : envoyée au payeur, acceptée, payée (tentative réussie), fonds bloqués.
  perform set_config('app.via_transition', 'on', true);
  if (select status from tranches where id = v_tr) = 'DRAFT' then perform _submit_request(v_tr, null); end if;
  select amount_minor, currency into v_amount, v_cur from tranches where id = v_tr;
  -- Lot X v2 (0021) : contribution du montant total, tentative confirmée (statuts du modèle cible).
  insert into contributions(tx_id, tranche_id, payer_id, amount_minor, currency, status, confirmed_at)
  values (v_tx, v_tr, v_payer, v_amount, v_cur, 'CONFIRMED', now()) returning id into v_contrib;
  insert into payment_attempts(tx_id, tranche_id, contribution_id, idempotency_key, provider, method, status, amount_minor, currency,
                               debit_currency, debit_amount_minor, provider_ref, created_by, completed_at)
  values (v_tx, v_tr, v_contrib, 'seed-evidence-' || replace(gen_random_uuid()::text, '-', ''), 'SIMULATED', 'SIMULATED', 'CONFIRMED', v_amount, v_cur,
          v_cur, v_amount, 'seed-' || replace(gen_random_uuid()::text, '-', ''), v_payer, now())
  returning id into v_attempt;
  perform _set_tranche_status(v_tr, 'ACCEPTED', v_payer, 'REQUEST_ACCEPTED', jsonb_build_object('attempt_id', v_attempt));
  insert into payments(tx_id, tranche_id, provider, status) values (v_tx, v_tr, 'SIMULATED', 'SUCCEEDED');
  perform _post_journal('PAYMENT', v_tr, v_cur, jsonb_build_array(
      jsonb_build_object('account','PARTNER_CASH','debit', v_amount), jsonb_build_object('account','DUE_TO_PROVIDER','credit', v_amount)),
      v_attempt, null, null, null, 'Paiement reçu par le partenaire (seed-evidence)');
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload)
  values (v_tx, v_tr, null, 'PAYMENT_SUCCEEDED', jsonb_build_object('attempt_id', v_attempt, 'provider', 'SIMULATED'));
  update tranches set funds_state = 'HELD' where id = v_tr;
  perform _set_tranche_status(v_tr, 'PAID', null, 'REQUEST_PAID', jsonb_build_object('attempt_id', v_attempt, 'funds', 'HELD'));

  -- Preuve déposée par le prestataire (submit_evidence) : file « Preuves de jalons » du bureau.
  update tranches set evidence_submitted_at = now() where id = v_tr;
  insert into audit_log(tx_id, tranche_id, actor_id, event, payload) values (v_tx, v_tr, v_prov, 'EVIDENCE_SUBMITTED', '{}');

  -- Conditions de la vue bo_evidence_queue (0014) : PAID, fonds HELD, preuve déposée.
  if not exists (select 1 from tranches where id = v_tr and status = 'PAID' and funds_state = 'HELD' and evidence_submitted_at is not null) then
    raise exception 'seed-evidence.sql : la demande % n’est pas en attente de preuve', v_tr;
  end if;

  select count(*) into v_n from audit_log where tx_id = v_tx;
  raise notice 'Opération terrain % : demande % payée, fonds bloqués, preuve en attente (% lignes de journal, chaîne valide : %)', v_tx, v_tr, v_n, verify_audit(v_tx);
end $$;

commit;
select set_config('seed.tx', '', false);
