/**
 * Suite de contrat unique de TransactionApi : exécutée contre le simulateur (toujours) et contre SupabaseApi
 * (si SUPABASE_TEST_URL et SUPABASE_TEST_ANON_KEY sont définis). Toute différence de comportement entre les deux
 * implémentations fait échouer l’une des deux ; les écarts assumés sont nommés ici (PARITY_GAPS) et documentés
 * dans docs/supabase-setup.md.
 */
import { describe, expect, it } from 'vitest';
import { emptyDraft, isErrorCode } from '@diaspay/domain';
import type { DraftDocumentInput, NeedDraft, Vertical } from '@diaspay/domain';
import { newUuid } from '../../src';
import type { DisputeOutcome } from '@diaspay/domain';
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
  /** Statuts acceptés juste après la soumission (le serveur reste en SUBMITTED, le simulateur passe en IN_REVIEW). */
  submittedStatuses: readonly string[];
  /** Isolation des transactions par partie (RLS). Le simulateur n’a qu’un profil de démonstration à la fois : écart assumé. */
  partyIsolation: boolean;
  /** Numéros des comptes (E.164). Lot X : le payeur désigné par un demandeur ou un prestataire, refus de se désigner soi-même. */
  phones: Record<Who, string>;
  timeout: number;
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as { code?: string }).code ?? 'SANS_CODE'; }
  return 'OK';
}

/** Date AAAA-MM-JJ dans n jours (une tranche à moins de 7 jours est activée à la validation, RG-12). */
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

    it('soumission : pièce obligatoire manquante, puis dossier complet', async () => {
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
      expect(h.submittedStatuses).toContain(tx.status);
      expect(tx).toMatchObject({ vertical: 'HEALTH', amount: { amountMinor: 180_000, currency: 'XAF' }, purpose: 'Soins (test de contrat)' });
      expect(tx.tranches).toHaveLength(1);
      expect((await api.listTransactions()).some((x) => x.id === tx.id)).toBe(true);
      // Le dossier soumis n’est plus un brouillon.
      expect((await api.listDrafts()).some((d) => d.id === id)).toBe(false);

      // Validation de démonstration : en cours, première tranche à payer (échéance à 3 jours), alerte TX_VALIDATED.
      const done = await api.simulateReview(tx.id, { approved: true });
      expect(done.status).toBe('IN_PROGRESS');
      expect(done.tranches[0]?.status).toBe('AWAITING_PAYMENT');
      const alerts = await api.listNotifications();
      expect(alerts.some((n) => n.event.type === 'TX_VALIDATED' && n.event.txId === tx.id)).toBe(true);
      expect(alerts.some((n) => n.event.type === 'PAYMENT_READY' && n.event.txId === tx.id)).toBe(true);

      // Jeton de la tranche active, référence résolue ; un tiers n’y a pas accès.
      const tr = done.tranches[0]!;
      const token = await api.getToken(tr.id);
      expect(token.reference).toMatch(/^[0-9a-f]{18}$/);
      expect(await code(api.getReceipt(tr.id))).toBe('NOT_RELEASED');
      if (h.partyIsolation) {
        const other = await h.as('OTHER');
        // Lot X (X1.6) : même réponse qu’une référence inconnue, l’existence de la référence n’est pas révélée.
        expect(await code(other.resolveReference(token.reference))).toBe('UNKNOWN_REFERENCE');
        expect((await other.listTransactions()).some((x) => x.id === tx.id)).toBe(false);
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

    it('rejet de démonstration, correction et abandon (D4)', async () => {
      const api = await h.as('PAYER');
      const id = newUuid();
      await api.saveDraft(healthDraft(id));
      await api.attachDocument(id, h.file('QUOTE'));
      await api.attachDocument(id, h.file('BENEFICIARY_ID'));
      const tx = await api.submitNeed(id);
      expect(await code(api.simulateReview(tx.id, { approved: false, reason: '' }))).toBe('REASON_REQUIRED');
      const rejected = await api.simulateReview(tx.id, { approved: false, reason: 'Devis illisible' });
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'Devis illisible' });
      const alerts = await api.listNotifications();
      expect(alerts.some((n) => n.event.type === 'TX_REJECTED' && n.event.txId === tx.id && n.event.reason === 'Devis illisible')).toBe(true);
      const correction = await api.reopenForCorrection(tx.id);
      expect(correction).toMatchObject({ correctionOf: tx.id, rejectionReason: 'Devis illisible' });
      expect(await code(api.deleteDraft(correction.id))).toBe('AUDITED_FILE');
    }, t * 2);

    it('alertes : marquées lues par le destinataire', async () => {
      const api = await h.as('PAYER');
      const before = await api.listNotifications();
      if (before.length === 0) return;
      await api.markAllNotificationsRead();
      expect((await api.listNotifications()).every((n) => n.readAt)).toBe(true);
    }, t);

    // ——— Lot X ———

    it('X1 : jeton révoqué refusé partout, réémis avec une nouvelle référence', async () => {
      const api = await h.as('PAYER');
      const id = newUuid();
      await api.saveDraft(healthDraft(id));
      await api.attachDocument(id, h.file('QUOTE'));
      await api.attachDocument(id, h.file('BENEFICIARY_ID'));
      const done = await api.simulateReview((await api.submitNeed(id)).id, { approved: true });
      const tr = done.tranches[0]!;
      expect(await api.eqrImageEnabled()).toBe(true);
      const before = (await api.getToken(tr.id)).reference;
      expect(await code(api.revokeToken(tr.id, ''))).toBe('REASON_REQUIRED');
      await api.revokeToken(tr.id, 'Lien compromis');
      expect(await code(api.resolveReference(before))).toBe('TOKEN_REVOKED');
      expect(await code(api.getToken(tr.id))).toBe('NO_TOKEN');
      expect(await code(api.revokeToken(tr.id, 'Encore'))).toBe('NO_TOKEN');
      await api.reissueToken(tr.id, 'Nouveau QR');
      const after = (await api.getToken(tr.id)).reference;
      expect(after).toMatch(/^[0-9a-f]{18}$/);
      expect(after).not.toBe(before);
      expect((await api.resolveReference(after)).trancheId).toBe(tr.id);
      if (h.partyIsolation) {
        const other = await h.as('OTHER');
        expect(await code(other.resolveReference(after))).toBe('UNKNOWN_REFERENCE');   // même réponse qu’une référence inconnue
        expect(await code(other.revokeToken(tr.id, 'Intrus'))).toBe('TRANCHE_NOT_FOUND');
      }
    }, t * 2);

    it('X2 : le payeur ouvre, demande des informations, l’initiateur répond, le payeur rejette ; clôture', async () => {
      const requester = await h.as('REQUESTER');
      const id = newUuid();
      await requester.saveDraft(healthDraft(id, { counterpartyPhone: h.phones.PAYER }));
      await requester.attachDocument(id, h.file('QUOTE'));
      await requester.attachDocument(id, h.file('BENEFICIARY_ID'));
      const done = await requester.simulateReview((await requester.submitNeed(id)).id, { approved: true });
      const tr = done.tranches[0]!;
      expect(tr.status).toBe('AWAITING_PAYMENT');
      expect(await code(requester.markReceived(tr.id))).toBe('PAYER_ONLY');
      expect(await code(requester.requestInfo(tr.id, 'Question'))).toBe('PAYER_ONLY');

      const payer = await h.as('PAYER');
      await payer.markReceived(tr.id);
      await payer.markReceived(tr.id);   // idempotent
      expect(await code(payer.requestInfo(tr.id, ' '))).toBe('REASON_REQUIRED');
      const asked = await payer.requestInfo(tr.id, 'Pouvez-vous joindre le devis signé ?');
      expect(asked.tranches[0]!.status).toBe('INFO_REQUESTED');
      expect(await code(payer.answerInfo(tr.id, 'Réponse'))).toBe('INITIATOR_ONLY');

      const back = await (await h.as('REQUESTER')).answerInfo(tr.id, 'Devis signé joint.');
      expect(back.tranches[0]!.status).toBe('AWAITING_PAYMENT');
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
      expect(await code(p2.getToken(tr.id))).toBe('NO_TOKEN');   // jeton révoqué au rejet
      expect((await p2.listMessages(tr.id)).map((m) => m.kind)).toEqual(['INFO_REQUEST', 'INFO_ANSWER', 'NOTE']);
      expect((await (await h.as('REQUESTER')).listNotifications()).some((n) => n.event.type === 'REQUEST_REJECTED' && n.event.txId === tx(done))).toBe(true);
    }, t * 3);

    it('X3 : demande initiée par un prestataire autorisé, refusée sans autorisation', async () => {
      const other = await h.as('OTHER');
      expect(await code(other.createDraft({ vertical: 'EDUCATION', creatorRole: 'PROVIDER' }))).toBe('INITIATION_NOT_ALLOWED');
      const prov = await h.as('REQUESTER');   // compte de test autorisé à initier (seed : can_initiate_requests)
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
      expect(h.submittedStatuses).toContain(sent.status);
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
      const id = newUuid();
      await api.saveDraft(healthDraft(id));
      await api.attachDocument(id, h.file('QUOTE'));
      await api.attachDocument(id, h.file('BENEFICIARY_ID'));
      const done = await api.simulateReview((await api.submitNeed(id)).id, { approved: true });
      const tr = done.tranches[0]!;
      const key = newUuid();
      expect((await api.payTranche(tr.id, key)).tranches[0]!.status).toBe('PAID_LOCKED');
      expect((await api.payTranche(tr.id, key)).tranches[0]!.status).toBe('PAID_LOCKED');   // même clé : même résultat, rien de plus
      expect(await code(api.payTranche(tr.id, newUuid()))).toBe('NOT_PAYABLE');
      expect(await code(api.payTranche(tr.id, 'court'))).toBe('VALIDATION');
      const events = (await api.timeline(done.id)).map((e) => e.event);
      expect(events.filter((e) => e === 'PAYMENT_STARTED')).toHaveLength(1);
      if (h.partyIsolation) expect(await code((await h.as('OTHER')).payTranche(tr.id, newUuid()))).toBe('TRANCHE_NOT_FOUND');
    }, t * 2);

    it('références et tranches inconnues : codes stables de la table', async () => {
      const api = await h.as('PAYER');
      const e1 = await code(api.resolveReference('ffffffffffffffffff'));
      expect(e1).toBe('UNKNOWN_REFERENCE');
      const e2 = await code(api.getReceipt(newUuid()));
      expect(['TRANCHE_NOT_FOUND']).toContain(e2);
      for (const c of [e1, e2]) expect(isErrorCode(c)).toBe(true);
    }, t);
  });
}
