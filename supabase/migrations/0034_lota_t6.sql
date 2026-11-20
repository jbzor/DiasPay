-- Lot A (T6) : libellés de suivi du Dr (livrable 6, « Les 13 libellés »).
--
-- La correspondance validée calcule chaque libellé à partir des statuts et des événements du journal. Il manquait une
-- donnée lisible par la liste des opérations : « En cours de vérification » = demande soumise ET au moins une pièce
-- consultée par le payeur. Les consultations sont journalisées (DOCUMENT_VIEWED, get_document_access) mais le journal
-- n’est pas lu par la liste ; on retient donc la date de la première consultation d’une pièce de l’opération par son
-- payeur, posée par un déclencheur sur le journal (aucune fonction appelable, aucun droit nouveau).
-- « Reçue par le payeur » existe déjà (tranches.first_viewed_at, mark_received, 0008) : rien à ajouter.
-- « Notification envoyée » n’est pas calculable : aucun canal externe (lot 6). La demande reste « soumise ».
-- Tests : supabase/tests/08_lota.sql (section T6).

alter table transactions add column if not exists payer_documents_viewed_at timestamptz;

create or replace function _note_payer_document_view() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tx_id is not null and new.actor_id is not null
     and exists (select 1 from transaction_parties p where p.tx_id = new.tx_id and p.user_id = new.actor_id and p.role = 'PAYER') then
    update transactions set payer_documents_viewed_at = new.created_at
     where id = new.tx_id and payer_documents_viewed_at is null;
  end if;
  return new;
end $$;
revoke all on function _note_payer_document_view() from public, anon, authenticated;

drop trigger if exists audit_log_payer_document_view on audit_log;
create trigger audit_log_payer_document_view after insert on audit_log
  for each row when (new.event = 'DOCUMENT_VIEWED') execute function _note_payer_document_view();
