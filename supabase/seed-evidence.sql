-- Dossier terrain avec une preuve de jalon en attente de validation (écran « Preuves de jalons » du bureau de contrôle).
-- DÉVELOPPEMENT SEULEMENT : refusé si app_config.mock_mode n’est pas 'true'. Les preuves réelles arrivent en vague 2.
--
--   scripts/db.sh seed-evidence            # dossier fictif complet ; la pièce n’a pas de fichier dans le bucket
--   scripts/db.sh seed-evidence <tx_id>    # brouillon terrain existant (créé par l’application ou un test), dont la
--                                          # preuve (pièce de type EVIDENCE) est déjà envoyée dans le bucket
--
-- Le dossier est amené à l’état qu’il aurait au bout du parcours : soumis, pris en charge, validé par deux validateurs
-- (case du montant cochée), jeton émis, en cours ; première tranche payée, puis preuve déposée par le prestataire.
-- Le journal d’audit retrace chaque étape (chaîne d’empreintes intacte). Affiche l’identifiant du dossier et de la tranche.
\if :{?tx}
select set_config('seed.tx', :'tx', false);
\else
select set_config('seed.tx', '', false);
\endif
begin;

do $$
declare
  v_tx uuid; v_req uuid; v_payer uuid; v_prov uuid; v_val1 uuid; v_val2 uuid; v_tr uuid; t transactions; v_n int;
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

  -- Parcours du dossier, journalisé comme par les fonctions de l’application.
  update transactions set status = 'SUBMITTED' where id = v_tx;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (v_tx, v_req, 'STATUS_CHANGE', 'DRAFT', 'SUBMITTED', '{"reason":null}');
  update transactions set status = 'IN_REVIEW' where id = v_tx;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (v_tx, v_val1, 'STATUS_CHANGE', 'SUBMITTED', 'IN_REVIEW', '{"reason":null}');
  insert into validations(tx_id, validator_id, approved, amount_checked) values (v_tx, v_val1, true, true), (v_tx, v_val2, true, true);
  insert into audit_log(tx_id, actor_id, event, payload) values
    (v_tx, v_val1, 'VALIDATION_DECISION', '{"approved":true,"amount_checked":true,"reason":null,"got":1,"need":2}'),
    (v_tx, v_val2, 'VALIDATION_DECISION', '{"approved":true,"amount_checked":true,"reason":null,"got":2,"need":2}');
  update transactions set status = 'VALIDATED' where id = v_tx;
  insert into audit_log(tx_id, actor_id, event, from_status, to_status, payload) values (v_tx, v_val2, 'STATUS_CHANGE', 'IN_REVIEW', 'VALIDATED', '{"reason":null}');
  perform _simulate_token_issue(v_tx);   -- jeton, IN_PROGRESS, première tranche activée (jalon)
  perform _set_tranche_status(v_tr, 'PAID_LOCKED', v_payer, 'SYSTEM_SIMULATED', '{}');
  insert into payments(tx_id, tranche_id, provider, status) values (v_tx, v_tr, 'MOCK', 'SUCCEEDED');
  perform _set_tranche_status(v_tr, 'EVIDENCE_SUBMITTED', v_prov, 'TRANCHE_CHANGE', '{"reason":null}');

  select count(*) into v_n from audit_log where tx_id = v_tx;
  raise notice 'Dossier terrain % : tranche % en attente de preuve (% lignes de journal, chaîne valide : %)', v_tx, v_tr, v_n, verify_audit(v_tx);
end $$;

commit;
select set_config('seed.tx', '', false);
