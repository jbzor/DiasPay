/**
 * Suite de contrat unique de TransactionApi : exécutée contre le simulateur (toujours) et contre SupabaseApi
 * (si SUPABASE_TEST_URL et SUPABASE_TEST_ANON_KEY sont définis). Toute différence de comportement entre les deux
 * implémentations fait échouer l’une des deux ; les écarts assumés sont nommés dans Harness (partyIsolation, refundSettlement) et documentés
 * dans docs/supabase-setup.md.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULES, emptyDraft, isErrorCode } from '@diaspay/domain';
import type { DisputeOutcome, DraftDocumentInput, NeedDraft, Vertical } from '@diaspay/domain';
import { newUuid } from '../../src';
import type { Transaction, TransactionApi } from '../../src';

export type ContractApi = TransactionApi & {
  simulateReview(txId: string, d: { approved: boolean; reason?: string }): Promise<Transaction>;
  simulateDisputeResolution(trancheId: string, d: { outcome: DisputeOutcome; note: string }): Promise<Transaction>;
};
export type Who = 'PAYER' | 'REQUESTER' | 'OTHER';

export interface Harness {
  name: string;
  /** API agissant pour cet utilisateur (connexion faite par le harnais). */
  as(who: Who): Promise<ContractApi>;
  /** Recherche qui doit trouver au moins un prestataire vérifié, saisie sans accents ni majuscules. */
  provider: { query: string; vertical: Vertical; expectName: RegExp };
  /** Fichier à envoyer (URI lisible par l’implémentation). */
  file(kind: string): DraftDocumentInput;
  /**
   * Écart assumé : exécution d’un remboursement décidé par un litige. Le serveur crée un remboursement PENDING et attend
   * l’événement du partenaire (la demande reste PAID, refundedMinor 0) ; le simulateur, dont le partenaire simulé répond
   * aussitôt, l’applique tout de suite (REFUNDED, refundedMinor = montant). Seul ce point diffère ; le reste est commun.
   */
  refundSettlement: 'IMMEDIATE' | 'AWAITING_PARTNER_EVENT';
  /** Isolation des transactions par partie (RLS). Le simulateur n’a qu’un profil de démonstration à la fois : écart assumé. */
  partyIsolation: boolean;
  /** Numéros des comptes (E.164). Lot X : le payeur désigné par un demandeur ou un prestataire, refus de se désigner soi-même. */
  phones: Record<Who, string>;
  /** Identifiant du compte (préfixe des chemins de pièces d’identité, X4 v2). */
  userId(who: Who): Promise<string>;
  timeout: number;
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as { code?: string }).code ?? 'SANS_CODE'; }
  return 'OK';
}

/** Date AAAA-MM-JJ dans n jours (une demande à moins de 7 jours est soumise à l’activation, RG-12). */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const tx = (t: Transaction) => t.id;

function healthDraft(id: string, over: Partial<NeedDraft> = {}): NeedDraft {
  const due = inDays(3);
  return {
    ...emptyDraft(id, new Date()), vertical: 'HEALTH', amountMinor: 180_000, currency: 'XAF', purpose: 'Soins (test de contrat)',
    beneficiaryName: 'Rose M.', desiredDate: due, provider: { name: 'Cabinet (test de contrat)', invitedPhone: '+237699000001' },
    planType: 'SINGLE', tranches: [{ label: 'Soins', amountMinor: 180_000, dueDate: due }], step: 'recap', ...over,
  };
}

export function contractSuite(h: Harness): void {
  /** Dossier santé complet (devis et pièce du bénéficiaire), soumis : actif dès la soumission (platform_review NEVER). */
  async function submitHealth(api: ContractApi, over: Partial<NeedDraft> = {}): Promise<Transaction> {
    const id = newUuid();
    await api.saveDraft(healthDraft(id, over));
    await api.attachDocument(id, h.file('QUOTE'));
    await api.attachDocument(id, h.file('BENEFICIARY_ID'));
    return api.submitNeed(id);
  }
  const t = h.timeout;

  describe(`contrat TransactionApi : ${h.name}`, () => {
    it('recherche de prestataires sans accents ni casse, filtrée par verticale', async () => {
      const api = await h.as('PAYER');
      const found = await api.searchProviders(h.provider.query, h.provider.vertical);
      expect(found.some((p) => h.provider.expectName.test(p.name))).toBe(true);
      expect(found.every((p) => p.verticals.includes(h.provider.vertical))).toBe(true);
      expect(await api.searchProviders(h.provider.query, 'LAND')).toEqual([]);
    }, t);

    it('brouillon partiel : enregistré, relu à l’identique, supprimé', async () => {
      const api = await h.as('PAYER');
      const id = newUuid();
      const saved = await api.saveDraft({ ...emptyDraft(id, new Date()), vertical: 'EDUCATION', step: 'details', purpose: 'Sc' });
      expect(saved).toMatchObject({ id, vertical: 'EDUCATION', step: 'details', purpose: 'Sc' });
      expect((await api.getDraft(id)).purpose).toBe('Sc');
      expect((await api.listDrafts()).some((d) => d.id === id)).toBe(true);
      await api.deleteDraft(id);
      expect(await code(api.getDraft(id))).toBe('TX_NOT_FOUND');
    }, t);

    it('isolation : le brouillon d’un utilisateur est introuvable pour un autre', async () => {
      const mine = await h.as('PAYER');
      const id = newUuid();
      await mine.saveDraft({ ...emptyDraft(id, new Date()), vertical: 'RENT' });
      const other = await h.as('OTHER');
      expect(await code(other.getDraft(id))).toBe('TX_NOT_FOUND');
      expect((await other.listDrafts()).some((d) => d.id === id)).toBe(false);
      expect(await code(other.saveDraft({ ...emptyDraft(id, new Date()), vertical: 'RENT' }))).toBe('TX_NOT_FOUND');
      await (await h.as('PAYER')).deleteDraft(id);
    }, t);

    it('soumission : pièce obligatoire manquante, puis dossier complet activé directement (règlement direct)', async () => {
      const api = await h.as('PAYER');
      const id = newUuid();
      await api.saveDraft(healthDraft(id));
      await api.attachDocument(id, h.file('QUOTE'));
      const missing = await api.submitNeed(id).catch((e: { code: string; details?: { kind?: string } }) => e);
      expect(missing).toMatchObject({ code: 'DOCUMENT_REQUIRED', details: { kind: 'BENEFICIARY_ID' } });
      const doc = await api.attachDocument(id, h.file('BENEFICIARY_ID'));
      expect(doc).toMatchObject({ kind: 'BENEFICIARY_ID', status: 'UPLOADED' });
      const draft = await api.getDraft(id);
      expect(draft.documents.map((d) => d.kind).sort()).toEqual(['BENEFICIARY_ID', 'QUOTE']);
      const tx = await api.submitNeed(id);
      // Lot X v2 : module platform_review NEVER (défaut) : l’opération est active dès la soumission, la demande due est soumise.
      expect(tx.status).toBe('ACTIVE');
      expect(tx).toMatchObject({ vertical: 'HEALTH', settlementMode: 'DIRECT', amount: { amountMinor: 180_000, currency: 'XAF' }, purpose: 'Soins (test de contrat)' });
      expect(tx.tranches).toHaveLength(1);
      expect(tx.tranches[0]).toMatchObject({ status: 'SUBMITTED', fundsState: 'NONE', onHold: false, refundedMinor: 0 });
      expect(tx.tranches[0]!.paidAt).toBeUndefined();
      expect((await api.listTransactions()).some((x) => x.id === tx.id)).toBe(true);
      // Le dossier soumis n’est plus un brouillon.
      expect((await api.listDrafts()).some((d) => d.id === id)).toBe(false);
      // Aucune revue : la revue simulée est refusée, pas d’alerte TX_VALIDATED ; le payeur initiateur reçoit PAYMENT_READY.
      expect(await code(api.simulateReview(tx.id, { approved: true }))).toBe('NOT_IN_REVIEW');
      const alerts = await api.listNotifications();
      expect(alerts.some((n) => n.event.type === 'TX_VALIDATED' && n.event.txId === tx.id)).toBe(false);
      expect(alerts.some((n) => n.event.type === 'PAYMENT_READY' && n.event.txId === tx.id && n.event.trancheId === tx.tranches[0]!.id)).toBe(true);
      expect(alerts.some((n) => n.event.type === 'PAYMENT_REQUEST_RECEIVED' && n.event.txId === tx.id)).toBe(false);

      // Règlement direct : ni jeton ni eQR ; pas de reçu avant paiement ; un tiers n’y a pas accès.
      const tr = tx.tranches[0]!;
      expect(await code(api.getToken(tr.id))).toBe('NO_TOKEN');
      expect(await code(api.getReceipt(tr.id))).toBe('NOT_RELEASED');
      if (h.partyIsolation) {
        const other = await h.as('OTHER');
        expect((await other.listTransactions()).some((x) => x.id === tx.id)).toBe(false);
        expect(await code(other.getReceipt(tr.id))).toBe('TRANCHE_NOT_FOUND');
      }
    }, t * 2);

    it('plan incohérent : PLAN_SUM_MISMATCH avec l’écart', async () => {
      const api = await h.as('PAYER');
      const id = newUuid();
      await api.saveDraft(healthDraft(id, { tranches: [{ label: 'Soins', amountMinor: 100_000, dueDate: inDays(3) }] }));
      await api.attachDocument(id, h.file('QUOTE'));
      await api.attachDocument(id, h.file('BENEFICIARY_ID'));
      const e = await api.submitNeed(id).catch((x: { code: string; details?: Record<string, unknown> }) => x);
      expect(e).toMatchObject({ code: 'PLAN_SUM_MISMATCH', details: { gap: 80_000 } });
      await api.deleteDraft(id);
    }, t);

    it('annulation par l’initiateur (remplace le rejet de démonstration D4) : CANCELLED sans paiement, CLOSED après un paiement', async () => {
      // Sans paiement : opération et demandes annulées ; plus rien n’est payable.
      const api = await h.as('PAYER');
      const tx = await submitHealth(api);
      expect(await code(api.simulateReview(tx.id, { approved: false, reason: 'Devis illisible' }))).toBe('NOT_IN_REVIEW');
      if (h.partyIsolation) expect(await code((await h.as('OTHER')).cancelOperation(tx.id, 'Intrus'))).toBe('TX_NOT_FOUND');
      const cancelled = await (await h.as('PAYER')).cancelOperation(tx.id, 'Plus nécessaire');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.tranches.map((r) => r.status)).toEqual(['CANCELLED']);
      expect(await code(api.payTranche(cancelled.tranches[0]!.id, newUuid()))).toBe('TX_NOT_ACTIVE');
      expect(await code(api.cancelOperation(tx.id))).toBe('TRANSITION_UNKNOWN');

      // Avec une demande payée : la demande programmée est annulée, la payée reste payée, l’opération est close.
      const two = await submitHealth(api, {
        planType: 'PARTIAL', tranches: [
          { label: 'Acompte', amountMinor: 80_000, dueDate: inDays(3) },
          { label: 'Solde', amountMinor: 100_000, dueDate: inDays(60) },
        ],
      });
      expect(two.tranches.map((r) => r.status)).toEqual(['SUBMITTED', 'DRAFT']);
      expect((await api.payTranche(two.tranches[0]!.id, newUuid())).tranches[0]!.status).toBe('PAID');
      const closed = await api.cancelOperation(two.id, 'Solde réglé autrement');
      expect(closed.status).toBe('CLOSED');
      expect(closed.tranches.map((r) => r.status)).toEqual(['PAID', 'CANCELLED']);
    }, t * 3);

    it('alertes : marquées lues par le destinataire', async () => {
      const api = await h.as('PAYER');
      const before = await api.listNotifications();
      if (before.length === 0) return;
      await api.markAllNotificationsRead();
      expect((await api.listNotifications()).every((n) => n.readAt)).toBe(true);
    }, t);

    // ——— Lot X ———

    it('X1 : règlement direct, aucun jeton de demande (lecture, réémission, révocation)', async () => {
      const api = await h.as('PAYER');
      const tx = await submitHealth(api);
      const tr = tx.tranches[0]!;
      expect(tx.settlementMode).toBe('DIRECT');
      expect(await api.eqrImageEnabled()).toBe(false);   // lot X v2 (0015) : image du QR hors du parcours par défaut
      expect(await code(api.getToken(tr.id))).toBe('NO_TOKEN');
      // Le payeur est ici l’initiateur : réémission et révocation n’ont pas de jeton sur lequel agir.
      expect(await code(api.reissueToken(tr.id, 'Nouveau QR'))).toBe('NO_TOKEN');
      expect(await code(api.revokeToken(tr.id, 'Lien compromis'))).toBe('NO_TOKEN');
      expect(await code(api.getToken(tr.id))).toBe('NO_TOKEN');
      if (h.partyIsolation) {
        const other = await h.as('OTHER');
        expect(await code(other.reissueToken(tr.id, 'Intrus'))).toBe('TRANCHE_NOT_FOUND');
        expect(await code(other.revokeToken(tr.id, 'Intrus'))).toBe('TRANCHE_NOT_FOUND');
      }
    }, t * 2);

    it('X2 : le payeur ouvre, demande des informations, l’initiateur répond, le payeur rejette ; clôture', async () => {
      const requester = await h.as('REQUESTER');
      const done = await submitHealth(requester, { counterpartyPhone: h.phones.PAYER });
      expect(done.status).toBe('ACTIVE');
      const tr = done.tranches[0]!;
      expect(tr.status).toBe('SUBMITTED');
      expect(await code(requester.markReceived(tr.id))).toBe('PAYER_ONLY');
      expect(await code(requester.requestInfo(tr.id, 'Question'))).toBe('PAYER_ONLY');

      const payer = await h.as('PAYER');
      await payer.markReceived(tr.id);
      await payer.markReceived(tr.id);   // idempotent
      expect(await code(payer.requestInfo(tr.id, ' '))).toBe('REASON_REQUIRED');
      const asked = await payer.requestInfo(tr.id, 'Pouvez-vous joindre le devis signé ?');
      expect(asked.tranches[0]!.status).toBe('INFO_REQUESTED');
      expect(await code(payer.answerInfo(tr.id, 'Réponse'))).toBe('INITIATOR_ONLY');
      expect(await code(payer.payTranche(tr.id, newUuid()))).toBe('NOT_PAYABLE');   // en attente d’informations

      const back = await (await h.as('REQUESTER')).answerInfo(tr.id, 'Devis signé joint.');
      expect(back.tranches[0]!.status).toBe('SUBMITTED');
      expect((await (await h.as('REQUESTER')).listNotifications()).some((n) => n.event.type === 'INFO_REQUESTED' && n.event.txId === tx(done))).toBe(true);

      const p2 = await h.as('PAYER');
      const msgs = await p2.listMessages(tr.id);
      expect(msgs.map((m) => m.kind)).toEqual(['INFO_REQUEST', 'INFO_ANSWER']);
      expect(msgs.map((m) => m.mine)).toEqual([true, false]);
      expect((await p2.listNotifications()).some((n) => n.event.type === 'INFO_ANSWERED' && n.event.txId === tx(done))).toBe(true);
      expect(await code(p2.rejectRequest(tr.id, ''))).toBe('REASON_REQUIRED');
      const closed = await p2.rejectRequest(tr.id, 'Je ne reconnais pas cette demande.');
      expect(closed.tranches[0]!.status).toBe('REJECTED');
      expect(closed.status).toBe('CLOSED');
      expect(await code(p2.requestInfo(tr.id, 'Encore ?'))).toBe('TX_NOT_ACTIVE');
      expect(await code(p2.payTranche(tr.id, newUuid()))).toBe('TX_NOT_ACTIVE');
      expect(await code(p2.getToken(tr.id))).toBe('NO_TOKEN');   // règlement direct : jamais de jeton
      expect((await p2.listMessages(tr.id)).map((m) => m.kind)).toEqual(['INFO_REQUEST', 'INFO_ANSWER', 'NOTE']);
      expect((await (await h.as('REQUESTER')).listNotifications()).some((n) => n.event.type === 'REQUEST_REJECTED' && n.event.txId === tx(done))).toBe(true);
    }, t * 3);

    it('X3 : demande initiée par un prestataire enrôlé N2, refusée sans le niveau requis', async () => {
      const other = await h.as('OTHER');
      expect(await code(other.createDraft({ vertical: 'EDUCATION', creatorRole: 'PROVIDER' }))).toBe('ENROLMENT_REQUIRED');
      const prov = await h.as('REQUESTER');   // compte de test enrôlé N2 (seed : enrolment_level)
      const draft = await prov.createDraft({ vertical: 'EDUCATION', creatorRole: 'PROVIDER' });
      expect(draft.creatorRole).toBe('PROVIDER');
      const due = inDays(3);
      const full: NeedDraft = {
        ...draft, amountMinor: 120_000, currency: 'XAF', purpose: 'Frais d’inscription (test de contrat)', beneficiaryName: 'Élève',
        counterpartyPhone: h.phones.REQUESTER, planType: 'SINGLE', tranches: [{ label: 'Inscription', amountMinor: 120_000, dueDate: due }], step: 'recap',
      };
      expect(await code(prov.saveDraft(full))).toBe('SELF_PAYER');
      await prov.saveDraft({ ...full, counterpartyPhone: h.phones.PAYER });
      await prov.attachDocument(draft.id, h.file('ENROLMENT_CERTIFICATE'));
      const sent = await prov.submitNeed(draft.id);
      expect(sent.status).toBe('ACTIVE');
      expect(sent).toMatchObject({ vertical: 'EDUCATION', settlementMode: 'DIRECT' });
      expect(sent.tranches[0]!.status).toBe('SUBMITTED');
      const payer = await h.as('PAYER');
      expect((await payer.listNotifications()).some((n) => n.event.type === 'PAYMENT_REQUEST_RECEIVED' && n.event.txId === sent.id)).toBe(true);
      expect((await payer.listTransactions()).some((x) => x.id === sent.id)).toBe(true);
    }, t * 2);

    it('X4 : empreinte enregistrée, réutilisation signalée par un nombre, consultation journalisée', async () => {
      const api = await h.as('PAYER');
      const a = newUuid();
      await api.saveDraft(healthDraft(a));
      const quote = await api.attachDocument(a, h.file('QUOTE'));
      expect(quote.contentHash).toMatch(/^[0-9a-f]{64}$/);
      await api.attachDocument(a, h.file('BENEFICIARY_ID'));
      const txA = await api.submitNeed(a);
      // Second dossier avec le même devis (même fichier, donc même empreinte).
      const b = newUuid();
      await api.saveDraft(healthDraft(b, { amountMinor: 190_000, tranches: [{ label: 'Soins', amountMinor: 190_000, dueDate: inDays(3) }] }));
      const again = await api.attachDocument(b, h.file('QUOTE'));
      expect(again.contentHash).toBe(quote.contentHash);
      await api.attachDocument(b, h.file('BENEFICIARY_ID'));
      const txB = await api.submitNeed(b);
      const reuse = await api.documentReuse(quote.contentHash!, txB.id);
      expect(reuse.reused).toBe(true);
      expect(reuse.count).toBeGreaterThanOrEqual(1);
      expect(Object.keys(reuse).sort()).toEqual(['count', 'reused']);   // un nombre, jamais les données des autres dossiers
      expect(await code(api.documentReuse('xyz'))).toBe('HASH_INVALID');
      if (h.partyIsolation) expect(await code((await h.as('OTHER')).documentReuse(quote.contentHash!))).toBe('NOT_FOUND');
      // Consultation : journalisée avant que l’adresse du fichier ne soit délivrée.
      const p2 = await h.as('PAYER');
      const access = await p2.getDocumentAccess(quote.id);
      expect(access).toMatchObject({ id: quote.id, mimeType: 'application/pdf', contentHash: quote.contentHash });
      expect(access.url).not.toBe('');
      expect((await p2.timeline(txA.id)).some((e) => e.event === 'DOCUMENT_VIEWED')).toBe(true);
      if (h.partyIsolation) expect(await code((await h.as('OTHER')).getDocumentAccess(quote.id))).toBe('NOT_FOUND');
    }, t * 2);

    it('X5 : paiement idempotent, appliqué par le même chemin que les événements du partenaire', async () => {
      const api = await h.as('PAYER');
      // Deux demandes dues : l’opération reste active après le premier paiement (le refus porte sur la demande, pas sur l’opération).
      const done = await submitHealth(api, {
        planType: 'PARTIAL', tranches: [
          { label: 'Consultation', amountMinor: 80_000, dueDate: inDays(3) },
          { label: 'Examens', amountMinor: 100_000, dueDate: inDays(5) },
        ],
      });
      expect(done.tranches.map((r) => r.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
      const tr = done.tranches[0]!;
      const key = newUuid();
      const paid = await api.payTranche(tr.id, key);
      expect(paid.tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'NONE' });
      expect(paid.tranches[1]!.status).toBe('SUBMITTED');
      expect(paid.status).toBe('ACTIVE');
      const again = await api.payTranche(tr.id, key);   // même clé : même résultat, rien de plus
      expect(again.tranches[0]!.status).toBe('PAID');
      expect(again.tranches[0]!.paidAt).toBe(paid.tranches[0]!.paidAt);
      expect(await code(api.payTranche(tr.id, newUuid()))).toBe('NOT_PAYABLE');
      expect(await code(api.payTranche(tr.id, 'court'))).toBe('VALIDATION');
      const events = (await api.timeline(done.id)).map((e) => e.event);
      expect(events.filter((e) => e === 'PAYMENT_STARTED')).toHaveLength(1);
      expect(events).toContain('REQUEST_PAID');
      if (h.partyIsolation) expect(await code((await h.as('OTHER')).payTranche(done.tranches[1]!.id, newUuid()))).toBe('TRANCHE_NOT_FOUND');
    }, t * 2);

    it('X6 : types de besoin lus dans les modules (valeurs du code par défaut), vague 2 refusée', async () => {
      const api = await h.as('PAYER');
      const mods = await api.listModules();
      const known = DEFAULT_MODULES.map((m) => m.code);
      expect(mods.filter((m) => known.includes(m.code))).toEqual(DEFAULT_MODULES);
      expect(mods.map((m) => m.displayOrder)).toEqual([...mods.map((m) => m.displayOrder)].sort((a, b) => a - b));
      const id = newUuid();
      const due = inDays(3);
      await api.saveDraft({ ...healthDraft(id), vertical: 'AGRO', tranches: [{ label: 'Achat', amountMinor: 180_000, dueDate: due }] });
      await api.attachDocument(id, h.file('SUPPORTING_DOCUMENT'));
      expect(await code(api.submitNeed(id))).toBe('VERTICAL_UNAVAILABLE');
      await api.deleteDraft(id);
    }, t);

    it('références et tranches inconnues : codes stables de la table', async () => {
      const api = await h.as('PAYER');
      const e1 = await code(api.resolveReference('ffffffffffffffffff'));
      expect(e1).toBe('UNKNOWN_REFERENCE');
      const e2 = await code(api.getReceipt(newUuid()));
      expect(['TRANCHE_NOT_FOUND']).toContain(e2);
      for (const c of [e1, e2]) expect(isErrorCode(c)).toBe(true);
    }, t);

    // ——— Lot X version 2 : parcours par défaut (règlement direct) et litiges ———

    it('parcours direct : demande reçue, informations, plan accepté, paiement, reçu', async () => {
      const requester = await h.as('REQUESTER');
      const tx0 = await submitHealth(requester, { counterpartyPhone: h.phones.PAYER });
      expect(tx0).toMatchObject({ status: 'ACTIVE', settlementMode: 'DIRECT' });
      const tr = tx0.tranches[0]!;
      expect(await code(requester.acceptPlan(tx0.id))).toBe('PAYER_ONLY');
      expect(await code(requester.payTranche(tr.id, newUuid()))).toBe('PAYER_ONLY');

      const payer = await h.as('PAYER');
      expect((await payer.listNotifications()).some((n) => n.event.type === 'PAYMENT_REQUEST_RECEIVED' && n.event.txId === tx0.id)).toBe(true);
      expect((await payer.listTransactions()).some((x) => x.id === tx0.id)).toBe(true);
      await payer.markReceived(tr.id);
      expect((await payer.requestInfo(tr.id, 'Quel est le nom du médecin ?')).tranches[0]!.status).toBe('INFO_REQUESTED');
      expect((await (await h.as('REQUESTER')).answerInfo(tr.id, 'Docteur Ngono, service de cardiologie.')).tranches[0]!.status).toBe('SUBMITTED');

      // Acceptation du plan : une fois (idempotente), sans rien payer.
      const p2 = await h.as('PAYER');
      const accepted = await p2.acceptPlan(tx0.id);
      expect(accepted.acceptedAt).toBeTruthy();
      expect(accepted.status).toBe('ACTIVE');
      expect(accepted.tranches[0]!.status).toBe('SUBMITTED');
      const twice = await p2.acceptPlan(tx0.id);
      expect(twice.acceptedAt).toBe(accepted.acceptedAt);
      expect((await (await h.as('REQUESTER')).listNotifications()).some((n) => n.event.type === 'PLAN_ACCEPTED' && n.event.txId === tx0.id)).toBe(true);

      // Paiement : SUBMITTED → ACCEPTED → PAID (événement du partenaire simulé) ; versé directement, opération close.
      const p3 = await h.as('PAYER');
      const paid = await p3.payTranche(tr.id, newUuid());
      expect(paid.tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'NONE', onHold: false, refundedMinor: 0 });
      expect(paid.tranches[0]!.paidAt).toBeTruthy();
      expect(paid.status).toBe('CLOSED');
      expect((await p3.listNotifications()).some((n) => n.event.type === 'REQUEST_PAID' && n.event.txId === tx0.id && n.event.trancheId === tr.id)).toBe(true);
      const receipt = await p3.getReceipt(tr.id);
      expect(receipt).toMatchObject({ trancheId: tr.id, txId: tx0.id, amountMinor: 180_000, currency: 'XAF', purpose: 'Soins (test de contrat)', chainValid: true });
      expect(receipt.entryCount).toBeGreaterThan(0);
      const events = (await p3.timeline(tx0.id)).map((e) => e.event);
      expect(events).toContain('PAYMENT_STARTED');
      expect(events).toContain('REQUEST_PAID');
      expect(events).toContain('PLAN_ACCEPTED');
      expect(events.indexOf('PAYMENT_STARTED')).toBeLessThan(events.indexOf('REQUEST_PAID'));
      expect(await code(p3.getToken(tr.id))).toBe('NO_TOKEN');
      // Le demandeur, partie au dossier, voit aussi le reçu.
      expect((await (await h.as('REQUESTER')).getReceipt(tr.id)).trancheId).toBe(tr.id);
      if (h.partyIsolation) expect(await code((await h.as('OTHER')).getReceipt(tr.id))).toBe('TRANCHE_NOT_FOUND');
    }, t * 4);

    it('litige avant paiement : demande suspendue, opération SUSPENDED, paiement et questions refusés ; levée sans suite', async () => {
      const requester = await h.as('REQUESTER');
      const tx0 = await submitHealth(requester, { counterpartyPhone: h.phones.PAYER });
      const tr = tx0.tranches[0]!;
      const payer = await h.as('PAYER');
      expect(await code(payer.openDispute(tr.id, 'OTHER', 'court'))).toBe('REASON_TOO_SHORT');
      const held = await payer.openDispute(tr.id, 'WRONG_AMOUNT', 'Le montant ne correspond pas au devis reçu.');
      expect(held.status).toBe('SUSPENDED');
      expect(held.tranches[0]).toMatchObject({ status: 'SUBMITTED', onHold: true });
      const d = await payer.getDispute(tr.id);
      expect(d).toMatchObject({ trancheId: tr.id, txId: tx0.id, status: 'OPEN', beforePayment: true, reason: 'WRONG_AMOUNT', openedBy: 'PAYER' });
      expect(await code(payer.payTranche(tr.id, newUuid()))).toBe('REQUEST_ON_HOLD');
      expect(await code(payer.requestInfo(tr.id, 'Pouvez-vous préciser ?'))).toBe('REQUEST_ON_HOLD');
      expect(await code(payer.openDispute(tr.id, 'OTHER', 'Un second litige sur la même demande.'))).toBe('DISPUTE_NOT_ALLOWED');
      expect((await (await h.as('REQUESTER')).listNotifications()).some((n) => n.event.type === 'DISPUTE_OPENED' && n.event.txId === tx0.id)).toBe(true);

      // Décision sans suite (administrateur simulé) : suspension levée, la demande redevient payable.
      const p2 = await h.as('PAYER');
      const resumed = await p2.simulateDisputeResolution(tr.id, { outcome: 'NO_ACTION', note: 'Montant confirmé par le devis.' });
      expect(resumed.status).toBe('ACTIVE');
      expect(resumed.tranches[0]).toMatchObject({ status: 'SUBMITTED', onHold: false });
      expect(await p2.getDispute(tr.id)).toMatchObject({ status: 'RESOLVED', outcome: 'NO_ACTION', beforePayment: true });
      expect((await p2.payTranche(tr.id, newUuid())).tranches[0]!.status).toBe('PAID');
    }, t * 3);

    it('litige après paiement : la demande reste PAID ; remboursement complet décidé', async () => {
      const api = await h.as('PAYER');
      const tx0 = await submitHealth(api);
      const tr = tx0.tranches[0]!;
      const paid = await api.payTranche(tr.id, newUuid());
      expect(paid.status).toBe('CLOSED');
      const after = await api.openDispute(tr.id, 'NOT_DELIVERED', 'Les soins n’ont pas été dispensés.');
      expect(after.status).toBe('CLOSED');
      expect(after.tranches[0]).toMatchObject({ status: 'PAID', onHold: false });
      expect(await api.getDispute(tr.id)).toMatchObject({ status: 'OPEN', beforePayment: false, reason: 'NOT_DELIVERED' });
      expect((await api.listNotifications()).some((n) => n.event.type === 'DISPUTE_OPENED' && n.event.txId === tx0.id)).toBe(true);

      const resolved = await api.simulateDisputeResolution(tr.id, { outcome: 'REFUND_FULL', note: 'Prestation non réalisée.' });
      expect(await api.getDispute(tr.id)).toMatchObject({ status: 'RESOLVED', outcome: 'REFUND_FULL', refundAmountMinor: 180_000 });
      expect((await api.listNotifications()).some((n) => n.event.type === 'DISPUTE_RESOLVED' && n.event.txId === tx0.id && n.event.outcome === 'REFUNDED')).toBe(true);
      // Écart nommé (refundSettlement) : le serveur attend l’événement du partenaire, le simulateur l’applique aussitôt.
      if (h.refundSettlement === 'IMMEDIATE') {
        expect(resolved.tranches[0]).toMatchObject({ status: 'REFUNDED', refundedMinor: 180_000 });
      } else {
        expect(resolved.tranches[0]).toMatchObject({ status: 'PAID', refundedMinor: 0 });
      }
      expect(await code(api.simulateDisputeResolution(tr.id, { outcome: 'NO_ACTION', note: 'Encore' }))).toBe('NO_OPEN_DISPUTE');
    }, t * 3);
  });

  describe('lot X version 2 (X4) : enrôlement', () => {
    it('N1 par la vérification simulée, puis niveau atteint ; pièces hors de son dossier refusées', async () => {
      const me = await h.as('PAYER');
      const uid = await h.userId('PAYER');
      const docs = (owner: string) => [
        { kind: 'ID_DOCUMENT', path: `${owner}/contrat-id-${newUuid()}.jpg`, mimeType: 'image/jpeg', sizeBytes: 2_000 },
        { kind: 'SELFIE', path: `${owner}/contrat-selfie-${newUuid()}.jpg`, mimeType: 'image/jpeg', sizeBytes: 2_000 },
      ];
      // Le compte de test du serveur garde son niveau d’un passage à l’autre : N0 la première fois seulement.
      if ((await me.getEnrolment()).level === 'N0') {
        expect(await code(me.submitEnrolment({ level: 'N1', documents: docs('un-autre-compte') }))).toBe('VALIDATION');
        expect(await code(me.submitEnrolment({ level: 'N1', documents: docs(uid).slice(0, 1) }))).toBe('DOCUMENT_REQUIRED');
        const c = await me.submitEnrolment({ level: 'N1', documents: docs(uid) });
        expect(c).toMatchObject({ requestedLevel: 'N1', status: 'APPROVED', route: 'KYC', kycResult: 'APPROVED' });
      }
      const after = await me.getEnrolment();
      expect(after.level).toBe('N1');
      expect(await code(me.submitEnrolment({ level: 'N1', documents: docs(uid) }))).toBe('ALREADY_ENROLLED');
      expect(await code(me.submitEnrolment({ level: 'N2', documents: [{ kind: 'BUSINESS_REGISTRATION', path: 'un-autre-compte/rc.pdf' }] }))).toBe('VALIDATION');
      expect(await code(me.submitEnrolment({ level: 'N2', documents: [{ kind: 'BUSINESS_REGISTRATION', path: `${uid}/rc.pdf` }] }))).toBe('DOCUMENT_REQUIRED');
    }, h.timeout);
  });

  describe('lot X version 2 (X5) : devis, accepter et payer', () => {
    it('devis EUR simulé et figé, refus d’un devis inconnu, paiement avec le devis, rejeu de la même clé', async () => {
      const requester = await h.as('REQUESTER');
      const tx0 = await submitHealth(requester, { counterpartyPhone: h.phones.PAYER });
      const tr = tx0.tranches[0]!;
      expect(await code(requester.getQuote(tr.id))).toBe('PAYER_ONLY');
      const payer = await h.as('PAYER');
      const same = await payer.getQuote(tr.id);
      expect(same).toMatchObject({ source: 'IDENTITY', rate: '1', requestCurrency: 'XAF', debitCurrency: 'XAF', debitAmountMinor: 180_000, totalDebitMinor: 180_000 });
      const eur = await payer.getQuote(tr.id, 'EUR');
      // 180 000 XAF / 655,957 = 274,41 € (arrondi au supérieur) ; aucun frais sans barème.
      expect(eur).toMatchObject({ source: 'SIMULATED', simulated: true, debitCurrency: 'EUR', debitAmountMinor: 27_441, totalDebitMinor: 27_441,
        fees: { serviceMinor: 0, fxMinor: 0, methodMinor: 0 } });
      expect(Date.parse(eur.expiresAt)).toBeGreaterThan(Date.parse(eur.quotedAt));
      expect(await code(payer.getQuote(tr.id, 'USD'))).toBe('QUOTE_UNAVAILABLE');
      expect(await code(payer.acceptAndPay(tr.id, newUuid(), newUuid()))).toBe('QUOTE_INVALID');
      const key = newUuid();
      const paid = await payer.acceptAndPay(tr.id, eur.id, key);
      expect(paid.tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'NONE' });
      expect((await payer.acceptAndPay(tr.id, eur.id, key)).tranches[0]!.status).toBe('PAID');   // même clé : même résultat
      expect(await code(payer.getQuote(tr.id))).toBe('TX_NOT_ACTIVE');                            // opération close après paiement
    }, h.timeout);
  });
}
