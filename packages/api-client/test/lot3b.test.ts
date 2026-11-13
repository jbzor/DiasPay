import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULES, buildInstallmentsPlan, emptyDraft } from '@diaspay/domain';
import type { NeedDraft, RequestModule } from '@diaspay/domain';
import { MemoryDraftStore, MemoryStateStore, MockApi, MockAuth, STATE_VERSION } from '../src';
import type { ApiError, Transaction } from '../src';

const T0 = new Date('2026-11-10T09:00:00');
const HOUR = 3_600_000;

/** Modules du simulateur : valeurs du code, Santé réglée autrement (revue du bureau, libération conditionnelle). */
const healthModule = (over: Partial<RequestModule>): RequestModule[] =>
  DEFAULT_MODULES.map((m) => (m.code === 'HEALTH' ? { ...m, ...over } : m));
/** Santé en libération conditionnelle, avec revue du bureau : le parcours complet (valider, payer, confirmer, libérer). */
const CONDITIONAL_REVIEWED = healthModule({ settlementMode: 'CONDITIONAL', platformReview: 'ALWAYS' });
/** Santé en libération conditionnelle, sans revue. */
const CONDITIONAL = healthModule({ settlementMode: 'CONDITIONAL' });
/** Santé en règlement direct, avec revue du bureau (pour le rejet). */
const REVIEWED = healthModule({ platformReview: 'ALWAYS' });

function make(opts: { state?: MemoryStateStore; seedNotifications?: boolean; modules?: readonly RequestModule[] } = {}) {
  let now = new Date(T0);
  const drafts = new MemoryDraftStore();
  const api = new MockApi(() => now, undefined, {
    drafts, state: opts.state, stateSaveDelayMs: 10_000, seedNotifications: opts.seedNotifications, modules: opts.modules,
  });
  api.setUser({ id: 'u-marie', role: 'PAYER', name: 'Marie N.' });
  return { api, drafts, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as ApiError).code; }
  return 'OK';
}
const file = (kind: string, name = `${kind}.pdf`) => ({ kind: kind as never, name, sizeBytes: 50_000, uri: `file:///${name}` });
const types = async (api: MockApi, txId: string) =>
  (await api.listNotifications()).filter((n) => n.event.txId === txId).map((n) => n.event.type).reverse();

async function submitHealth(api: MockApi, dueDate = '2026-11-12'): Promise<Transaction> {
  const d: NeedDraft = await api.saveDraft({
    ...emptyDraft(`need-${Math.random()}`, T0), vertical: 'HEALTH', amountMinor: 180_000, currency: 'XAF', purpose: 'Opération de la hanche',
    beneficiaryName: 'Rose M.', provider: { id: 'pv-hopital-central', name: 'Hôpital Central' }, planType: 'SINGLE',
    tranches: [{ label: 'Soins', amountMinor: 180_000, dueDate }],
  });
  await api.attachDocument(d.id, file('QUOTE'));
  await api.attachDocument(d.id, file('BENEFICIARY_ID'));
  return api.submitNeed(d.id);
}
/** Scolarité en trois échéances (règlement direct, activée à la soumission). */
async function submitSchool(api: MockApi): Promise<Transaction> {
  const d = await api.saveDraft({
    ...emptyDraft(`need-${Math.random()}`, T0), vertical: 'EDUCATION', amountMinor: 900_000, currency: 'XAF', purpose: 'Scolarité 2026-2027',
    beneficiaryName: 'Aïcha N.', provider: { id: 'pv-palmiers', name: 'École Les Palmiers' }, planType: 'INSTALLMENTS',
    tranches: buildInstallmentsPlan(900_000, ['2026-11-15', '2027-01-15', '2027-04-15'], 'Tranche'),
  });
  await api.attachDocument(d.id, file('ENROLMENT_CERTIFICATE'));
  return api.submitNeed(d.id);
}

/** Lot X v2, libération conditionnelle (module CONDITIONAL_REVIEWED) : créer, valider, payer, confirmer par scan, libérer. */
async function fullFlow(api: MockApi) {
  const tx = await submitHealth(api);
  expect(tx.status).toBe('PENDING_REVIEW');
  await api.simulateReview(tx.id, { approved: true });
  const trId = tx.tranches[0]!.id;
  await api.payTranche(trId);
  const ref = (await api.getToken(trId)).reference;
  api.setPersona('PROVIDER');
  await api.confirmByReference(ref);
  api.setPersona('PAYER');
  await api.approveRelease(trId);
  return { tx, trId };
}
/** Lot X v2, règlement direct (défaut) : créer (activée à la soumission), payer ; ni jeton, ni confirmation, ni délai. */
async function directFlow(api: MockApi) {
  const tx = await submitHealth(api);
  expect(tx.status).toBe('ACTIVE');
  const trId = tx.tranches[0]!.id;
  await api.payTranche(trId);
  return { tx, trId };
}
const FULL_FLOW_ALERTS = ['TX_VALIDATED', 'PAYMENT_READY', 'REQUEST_PAID', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED'];

describe('alertes', () => {
  it('chaque étape du parcours produit son alerte et sa ligne de journal', async () => {
    const { api } = make({ seedNotifications: false, modules: CONDITIONAL_REVIEWED });
    const { tx, trId } = await fullFlow(api);
    expect(await types(api, tx.id)).toEqual(FULL_FLOW_ALERTS);
    const events = (await api.timeline(tx.id)).map((e) => e.event);
    for (const t of FULL_FLOW_ALERTS) expect(events).toContain(t);
    const confirmed = (await api.listNotifications()).find((n) => n.event.type === 'TRANCHE_CONFIRMED')!;
    expect(confirmed.event).toMatchObject({ trancheId: trId, releaseAt: expect.any(String) });
    // L’alerte stocke l’événement, jamais un texte.
    expect(Object.keys(confirmed)).toEqual(['id', 'event', 'at']);
  });
  it('règlement direct : demande soumise à l’activation, payée, aucune confirmation ni libération', async () => {
    const { api } = make({ seedNotifications: false });
    const { tx, trId } = await directFlow(api);
    expect(await types(api, tx.id)).toEqual(['PAYMENT_READY', 'REQUEST_PAID']);
    expect((await api.listNotifications())[0]?.event).toEqual({ type: 'REQUEST_PAID', txId: tx.id, trancheId: trId });
    const events = (await api.timeline(tx.id)).map((e) => e.event);
    for (const t of ['NEED_SUBMITTED', 'AUTO_ACTIVATED', 'REQUEST_SUBMITTED', 'PAYMENT_READY', 'REQUEST_PAID', 'TX_CLOSED']) expect(events).toContain(t);
    expect(events).not.toContain('TX_VALIDATED');
    expect((await api.getTransaction(tx.id)).status).toBe('CLOSED');
  });
  it('rejet, litige ouvert et litige résolu', async () => {
    const { api } = make({ seedNotifications: false, modules: REVIEWED });
    const rej = await submitHealth(api);
    await api.simulateReview(rej.id, { approved: false, reason: 'Devis illisible' });
    expect((await api.listNotifications())[0]?.event).toEqual({ type: 'TX_REJECTED', txId: rej.id, reason: 'Devis illisible' });
    const tx = await submitHealth(api);
    await api.simulateReview(tx.id, { approved: true });
    const trId = tx.tranches[0]!.id;
    await api.payTranche(trId);
    await api.openDispute(trId, 'NOT_DELIVERED', 'Les soins n’ont pas eu lieu.');
    await api.simulateDisputeResolution(trId, { outcome: 'REFUND_FULL', note: 'Prestation non justifiée' });
    expect(await types(api, tx.id)).toEqual(['TX_VALIDATED', 'PAYMENT_READY', 'REQUEST_PAID', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED']);
    expect((await api.listNotifications())[0]?.event).toMatchObject({ type: 'DISPUTE_RESOLVED', outcome: 'REFUNDED' });
  });
  it('marquer une alerte lue, puis toutes', async () => {
    const { api } = make();
    const list = await api.listNotifications();
    expect(list.length).toBeGreaterThanOrEqual(3); // alertes de démonstration
    expect(list.map((n) => n.at)).toEqual([...list.map((n) => n.at)].sort().reverse());
    await api.markNotificationRead(list[0]!.id);
    expect((await api.listNotifications()).filter((n) => !n.readAt)).toHaveLength(list.length - 1);
    await api.markAllNotificationsRead();
    expect((await api.listNotifications()).every((n) => n.readAt)).toBe(true);
    expect(await code(api.markNotificationRead('nt-inconnue'))).toBe('NOT_FOUND');
  });
});

describe('litiges', () => {
  /** Demande payée : règlement direct par défaut, ou libération conditionnelle (fonds bloqués). */
  async function disputed(modules?: readonly RequestModule[]) {
    const ctx = make({ seedNotifications: false, modules });
    const tx = await submitHealth(ctx.api);
    const trId = tx.tranches[0]!.id;
    await ctx.api.payTranche(trId);
    return { ...ctx, tx, trId };
  }
  it('openDispute crée le litige avec le motif et la description ; après paiement, le statut ne change pas', async () => {
    const { api, trId, tx } = await disputed();
    expect(await api.getDispute(trId)).toBeNull();
    await api.openDispute(trId, 'INCOMPLETE', 'Une partie des soins manque.');
    expect(await api.getDispute(trId)).toMatchObject({
      txId: tx.id, trancheId: trId, reason: 'INCOMPLETE', description: 'Une partie des soins manque.', openedBy: 'PAYER', status: 'OPEN',
      beforePayment: false,
    });
    expect((await api.getTransaction(tx.id)).tranches[0]).toMatchObject({ status: 'PAID', onHold: false });
    expect(await code(api.openDispute(trId, 'OTHER', 'Un second litige en même temps.'))).toBe('DISPUTE_NOT_ALLOWED');
    expect(await code(api.getDispute('tr-inconnue'))).toBe('TRANCHE_NOT_FOUND');
  });
  it('avant paiement : demande suspendue, opération SUSPENDED ; NO_ACTION la reprend', async () => {
    const { api } = make({ seedNotifications: false });
    const tx = await submitHealth(api);
    const trId = tx.tranches[0]!.id;
    await api.openDispute(trId, 'OTHER', 'Le devis ne correspond pas.');
    expect(await api.getDispute(trId)).toMatchObject({ beforePayment: true, status: 'OPEN' });
    expect((await api.getTransaction(tx.id))).toMatchObject({ status: 'SUSPENDED', tranches: [{ status: 'SUBMITTED', onHold: true }] });
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'REFUND_FULL', note: 'Rien n’a été payé' }))).toBe('INVALID_OUTCOME');
    const after = await api.simulateDisputeResolution(trId, { outcome: 'NO_ACTION', note: 'Devis corrigé' });
    expect(after).toMatchObject({ status: 'ACTIVE', tranches: [{ status: 'SUBMITTED', onHold: false }] });
    expect(await api.getDispute(trId)).toMatchObject({ status: 'RESOLVED', outcome: 'NO_ACTION' });
    expect((await api.listNotifications())[0]?.event).toMatchObject({ type: 'DISPUTE_RESOLVED', outcome: 'NO_ACTION' });
    expect((await api.payTranche(trId)).tranches[0]?.status).toBe('PAID');
  });
  it('libération (CONDITIONAL) : fonds libérés, reçu disponible', async () => {
    const { api, trId } = await disputed(CONDITIONAL);
    await api.openDispute(trId, 'OTHER', 'Désaccord sur la date.');
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'FUNDS_RELEASED', note: '' }))).toBe('REASON_REQUIRED');
    const tx = await api.simulateDisputeResolution(trId, { outcome: 'FUNDS_RELEASED', note: 'Prestation justifiée' });
    expect(tx.tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'RELEASED' });
    expect(tx.status).toBe('CLOSED');
    expect(await api.getDispute(trId)).toMatchObject({
      status: 'RESOLVED', outcome: 'FUNDS_RELEASED', resolutionNote: 'Prestation justifiée', resolvedAt: expect.any(String),
    });
    expect((await api.listNotifications())[0]?.event).toMatchObject({ type: 'DISPUTE_RESOLVED', outcome: 'RELEASED' });
    expect((await api.getReceipt(trId)).chainValid).toBe(true);
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'FUNDS_RELEASED', note: 'encore' }))).toBe('NO_OPEN_DISPUTE');
  });
  it('libération ou retour des fonds impossibles en règlement direct', async () => {
    const { api, trId } = await disputed();
    await api.openDispute(trId, 'OTHER', 'Désaccord sur la date.');
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'FUNDS_RELEASED', note: 'Prestation justifiée' }))).toBe('INVALID_OUTCOME');
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'FUNDS_RETURNED', note: 'Prestation non justifiée' }))).toBe('INVALID_OUTCOME');
  });
  it('remboursement total : demande remboursée par le moteur de paiement, le reçu du paiement reste', async () => {
    const { api, trId, tx: created } = await disputed();
    expect((await api.getTransaction(created.id)).status).toBe('CLOSED');   // seule demande, payée : opération close
    await api.openDispute(trId, 'NOT_DELIVERED', 'Les soins n’ont pas eu lieu.');
    const tx = await api.simulateDisputeResolution(trId, { outcome: 'REFUND_FULL', note: 'Non justifiée' });
    expect(tx.tranches[0]).toMatchObject({ status: 'REFUNDED', refundedMinor: 180_000 });
    expect(await api.getDispute(trId)).toMatchObject({ status: 'RESOLVED', outcome: 'REFUND_FULL', refundAmountMinor: 180_000 });
    expect((await api.timeline(tx.id)).map((e) => e.event)).toContain('REQUEST_REFUNDED');
    // Miroir de get_receipt : le reçu existe pour une demande payée puis remboursée.
    expect((await api.getReceipt(trId)).amountMinor).toBe(180_000);
  });
  it('remboursement partiel : montant obligatoire, jamais au-delà du payé', async () => {
    const { api, trId } = await disputed();
    await api.openDispute(trId, 'INCOMPLETE', 'Une partie des soins manque.');
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'REFUND_PARTIAL', note: 'Partiel' }))).toBe('AMOUNT_INVALID');
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'REFUND_PARTIAL', note: 'Partiel', amountMinor: 180_001 }))).toBe('REFUND_EXCEEDS_PAID');
    const tx = await api.simulateDisputeResolution(trId, { outcome: 'REFUND_PARTIAL', note: 'Partiel', amountMinor: 50_000 });
    expect(tx.tranches[0]).toMatchObject({ status: 'REFUNDED', refundedMinor: 50_000 });
    expect(await api.getDispute(trId)).toMatchObject({ outcome: 'REFUND_PARTIAL', refundAmountMinor: 50_000 });
  });
  it('retour des fonds (CONDITIONAL) : fonds rendus au payeur, demande remboursée, pas de reçu', async () => {
    const { api, trId } = await disputed(CONDITIONAL);
    await api.openDispute(trId, 'NOT_DELIVERED', 'Les soins n’ont pas eu lieu.');
    const tx = await api.simulateDisputeResolution(trId, { outcome: 'FUNDS_RETURNED', note: 'Non justifiée' });
    expect(tx.tranches[0]).toMatchObject({ status: 'REFUNDED', fundsState: 'RETURNED', refundedMinor: 180_000 });
    expect(await api.getDispute(trId)).toMatchObject({ status: 'RESOLVED', outcome: 'FUNDS_RETURNED', refundAmountMinor: 180_000 });
    expect(await code(api.getReceipt(trId))).toBe('NOT_RELEASED');
  });
});

describe('reçu et journal chaîné', () => {
  it('reçu d’une tranche libérée (CONDITIONAL), journal vérifié', async () => {
    const { api } = make({ seedNotifications: false, modules: CONDITIONAL_REVIEWED });
    const { tx, trId } = await fullFlow(api);
    const r = await api.getReceipt(trId);
    expect(r).toMatchObject({
      trancheId: trId, txId: tx.id, amountMinor: 180_000, currency: 'XAF', payerName: 'Marie N.', providerName: 'Hôpital Central',
      purpose: 'Opération de la hanche', chainValid: true,
    });
    expect(r.reference).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{2}$/);
    expect(r.lastHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.entryCount).toBe((await api.timeline(tx.id)).length);
  });
  it('reçu d’un paiement direct : dès le paiement, sans référence de QR', async () => {
    const { api } = make({ seedNotifications: false });
    const { tx, trId } = await directFlow(api);
    const paid = (await api.getTransaction(tx.id)).tranches[0]!;
    const r = await api.getReceipt(trId);
    expect(r).toMatchObject({ trancheId: trId, amountMinor: 180_000, payerName: 'Marie N.', releasedAt: paid.paidAt, chainValid: true, reference: '' });
    expect(paid.reference).toBeUndefined();
    expect(r.entryCount).toBe((await api.timeline(tx.id)).length);
  });
  it('une modification volontaire du journal est détectée', async () => {
    const { api } = make({ seedNotifications: false, modules: CONDITIONAL_REVIEWED });
    const { tx, trId } = await fullFlow(api);
    api.tamperAuditForTest(tx.id, 2, { detail: 'falsifié' });
    expect((await api.getReceipt(trId)).chainValid).toBe(false);
  });
  it('refuse une demande non payée, ou payée dont les fonds sont encore bloqués', async () => {
    const { api } = make();
    const school = await api.getTransaction('tx-school');
    expect(await code(api.getReceipt(school.tranches[1]!.id))).toBe('NOT_RELEASED');
    const land = await api.getTransaction('tx-land');
    expect(land.tranches[1]).toMatchObject({ status: 'PAID', fundsState: 'HELD' });
    expect(await code(api.getReceipt(land.tranches[1]!.id))).toBe('NOT_RELEASED');
  });
});

describe('annulation et suppression (D4, lot X v2)', () => {
  it('l’initiateur annule une opération active ; elle reste visible avec son journal', async () => {
    const { api } = make();
    const tx = await submitHealth(api);
    api.setUser({ id: 'u-autre', role: 'PAYER' });
    expect(await code(api.cancelOperation(tx.id))).toBe('TX_NOT_FOUND');
    api.setUser({ id: 'u-marie', role: 'PAYER', name: 'Marie N.' });
    const done = await api.cancelOperation(tx.id, 'Soins pris en charge par l’assurance');
    expect(done.status).toBe('CANCELLED');
    expect(done.tranches.map((t) => t.status)).toEqual(['CANCELLED']);
    expect((await api.listTransactions()).some((t) => t.id === tx.id)).toBe(true);
    const cancelled = (await api.timeline(tx.id)).find((e) => e.event === 'TX_CANCELLED');
    expect(cancelled?.detail).toBe('Soins pris en charge par l’assurance');
    expect(await code(api.cancelOperation(tx.id))).not.toBe('OK');   // déjà annulée
    expect(await code(api.payTranche(tx.tranches[0]!.id))).toBe('TX_NOT_ACTIVE');
  });
  it('une opération dont une demande est payée se clôt (CLOSED) au lieu d’être annulée', async () => {
    const { api } = make();
    const tx = await submitSchool(api);
    expect(tx.tranches.map((t) => t.status)).toEqual(['SUBMITTED', 'DRAFT', 'DRAFT']);
    await api.payTranche(tx.tranches[0]!.id);
    const done = await api.cancelOperation(tx.id);
    expect(done.status).toBe('CLOSED');
    expect(done.tranches.map((t) => t.status)).toEqual(['PAID', 'CANCELLED', 'CANCELLED']);
  });
  it('un dossier rejeté par le bureau est annulé, sans correction ni nouvelle annulation', async () => {
    const { api } = make({ modules: REVIEWED });
    const tx = await submitHealth(api);
    await api.simulateReview(tx.id, { approved: false, reason: 'Incomplet' });
    expect((await api.getTransaction(tx.id))).toMatchObject({ status: 'CANCELLED', rejectionReason: 'Incomplet' });
    expect(await code(api.cancelOperation(tx.id))).not.toBe('OK');
    expect(await api.listDrafts()).toEqual([]);   // aucun brouillon de correction
    expect((await api.listTransactions()).some((t) => t.id === tx.id)).toBe(true);
  });
  it('un brouillon jamais soumis se supprime ; un dossier soumis ou une ancienne correction (dossier audité) non', async () => {
    const { api } = make();
    await api.saveDraft(emptyDraft('need-x', T0));
    await api.deleteDraft('need-x');
    expect(await api.listDrafts()).toEqual([]);
    const tx = await submitHealth(api);
    expect(await code(api.deleteDraft(tx.id))).toBe('TX_NOT_FOUND');
    // Brouillon de correction d’un instantané antérieur (correctionOf) : il appartient à un dossier audité.
    const legacy = await api.saveDraft({ ...emptyDraft('need-fix', T0), correctionOf: tx.id });
    expect(await code(api.deleteDraft(legacy.id))).toBe('AUDITED_FILE');
    expect((await api.listDrafts()).map((d) => d.id)).toEqual([legacy.id]);
  });
});

describe('pièces multiples (D2)', () => {
  it('jusqu’à 3 fichiers par type, retrait d’un fichier précis', async () => {
    const { api } = make();
    await api.saveDraft(emptyDraft('need-1', T0));
    const a = await api.attachDocument('need-1', file('BENEFICIARY_ID', 'recto.jpg'));
    await api.attachDocument('need-1', file('BENEFICIARY_ID', 'verso.jpg'));
    await api.attachDocument('need-1', file('BENEFICIARY_ID', 'page3.pdf'));
    expect(await code(api.attachDocument('need-1', file('BENEFICIARY_ID', 'page4.pdf')))).toBe('TOO_MANY_FILES');
    expect(await code(api.attachDocument('need-1', file('QUOTE')))).toBe('OK');
    await api.removeDocument('need-1', a.id);
    expect((await api.getDraft('need-1')).documents.filter((d) => d.kind === 'BENEFICIARY_ID').map((d) => d.name)).toEqual(['verso.jpg', 'page3.pdf']);
    expect(await code(api.attachDocument('need-1', file('BENEFICIARY_ID', 'page4.pdf')))).toBe('OK');
  });
});

describe('persistance de l’état du simulateur', () => {
  it('restaure transactions, alertes, journal et litiges', async () => {
    const state = new MemoryStateStore();
    const first = make({ state, seedNotifications: false, modules: CONDITIONAL_REVIEWED });
    const { tx, trId } = await fullFlow(first.api);
    await first.api.flushState();
    expect(state.saves).toBe(1);

    const second = new MockApi(() => new Date(T0.getTime() + HOUR), undefined, { state, drafts: first.drafts });
    expect(await second.hydrate()).toBe(true);
    expect((await second.getTransaction(tx.id)).tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'RELEASED' });
    expect(await types(second, tx.id)).toEqual(FULL_FLOW_ALERTS);
    expect(second.paymentLedger().state()).toEqual(first.api.paymentLedger().state());
    expect((await second.getReceipt(trId)).chainValid).toBe(true);
    expect((await second.timeline(tx.id)).length).toBe((await first.api.timeline(tx.id)).length);
  });
  it('ignore un instantané périmé ou illisible et repart du jeu de démonstration', async () => {
    const state = new MemoryStateStore();
    state.value = { version: STATE_VERSION + 99, txs: [] };
    const api = new MockApi(() => T0, undefined, { state });
    expect(await api.hydrate()).toBe(false);
    expect((await api.listTransactions()).map((t) => t.id)).toContain('tx-school');
    expect(state.value).toBeNull(); // instantané périmé effacé
    state.value = 'pas un objet';
    expect(await new MockApi(() => T0, undefined, { state }).hydrate()).toBe(false);
    expect(await new MockApi(() => T0).hydrate()).toBe(false); // sans stockage
  });
  it('enregistre avec un anti-rebond', async () => {
    const state = new MemoryStateStore();
    const api = new MockApi(() => T0, undefined, { state, stateSaveDelayMs: 20 });
    api.setPersona('PROVIDER');
    api.setPersona('PAYER');
    expect(state.saves).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(state.saves).toBe(1);
  });
  it('réinitialise les données de démonstration', async () => {
    const state = new MemoryStateStore();
    const { api, drafts } = make({ state });
    const tx = await submitHealth(api);
    await api.saveDraft(emptyDraft('need-y', T0));
    await api.flushState();
    await api.resetDemoData();
    expect((await api.listTransactions()).some((t) => t.id === tx.id)).toBe(false);
    expect(await drafts.list()).toEqual([]);
    expect(state.value).toBeNull();
    expect((await api.listNotifications()).length).toBeGreaterThan(0);
  });
});

describe('préférences de l’utilisateur', () => {
  it('biométrie et notifications push', async () => {
    const auth = new MockAuth({ clock: () => T0 });
    expect(await code(auth.setPreferences({ pushEnabled: false }))).toBe('NOT_AUTHENTICATED');
    await auth.requestOtp('+33612345678');
    const s = await auth.verifyOtp('+33612345678', '123456');
    expect(s.pushEnabled).toBe(true);
    expect(await auth.setPreferences({ pushEnabled: false })).toMatchObject({ pushEnabled: false, biometricEnabled: false });
    expect(await auth.setPreferences({ biometricEnabled: true })).toMatchObject({ pushEnabled: false, biometricEnabled: true });
  });
});

describe('parcours complet du simulateur', () => {
  it('créer, valider, payer, confirmer, débloquer (CONDITIONAL) : alertes attendues, reçu valide, falsification détectée', async () => {
    const { api } = make({ seedNotifications: false, modules: CONDITIONAL_REVIEWED });
    const { tx, trId } = await fullFlow(api);
    expect(await types(api, tx.id)).toEqual(FULL_FLOW_ALERTS);
    expect((await api.getTransaction(tx.id)).status).toBe('CLOSED');
    const ok = await api.getReceipt(trId);
    expect(ok.chainValid).toBe(true);
    expect(ok.entryCount).toBeGreaterThanOrEqual(8);
    api.tamperAuditForTest(tx.id, 1, { actor: 'quelqu’un d’autre' });
    expect((await api.getReceipt(trId)).chainValid).toBe(false);
  });
});
