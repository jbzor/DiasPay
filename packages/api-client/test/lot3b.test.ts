import { describe, expect, it } from 'vitest';
import { emptyDraft } from '@diaspay/domain';
import type { NeedDraft } from '@diaspay/domain';
import { MemoryDraftStore, MemoryStateStore, MockApi, MockAuth, STATE_VERSION } from '../src';
import type { ApiError, Transaction } from '../src';

const T0 = new Date('2026-11-10T09:00:00');
const HOUR = 3_600_000;

function make(opts: { state?: MemoryStateStore; seedNotifications?: boolean } = {}) {
  let now = new Date(T0);
  const drafts = new MemoryDraftStore();
  const api = new MockApi(() => now, undefined, { drafts, state: opts.state, stateSaveDelayMs: 10_000, seedNotifications: opts.seedNotifications });
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

/** Créer, valider, payer, confirmer par scan, débloquer. */
async function fullFlow(api: MockApi) {
  const tx = await submitHealth(api);
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

describe('alertes', () => {
  it('chaque étape du parcours produit son alerte et sa ligne de journal', async () => {
    const { api } = make({ seedNotifications: false });
    const { tx, trId } = await fullFlow(api);
    expect(await types(api, tx.id)).toEqual(['TX_VALIDATED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED']);
    const events = (await api.timeline(tx.id)).map((e) => e.event);
    for (const t of ['TX_VALIDATED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED']) expect(events).toContain(t);
    const confirmed = (await api.listNotifications()).find((n) => n.event.type === 'TRANCHE_CONFIRMED')!;
    expect(confirmed.event).toMatchObject({ trancheId: trId, releaseAt: expect.any(String) });
    // L’alerte stocke l’événement, jamais un texte.
    expect(Object.keys(confirmed)).toEqual(['id', 'event', 'at']);
  });
  it('rejet, litige ouvert et litige résolu', async () => {
    const { api } = make({ seedNotifications: false });
    const rej = await submitHealth(api);
    await api.simulateReview(rej.id, { approved: false, reason: 'Devis illisible' });
    expect((await api.listNotifications())[0]?.event).toEqual({ type: 'TX_REJECTED', txId: rej.id, reason: 'Devis illisible' });
    const tx = await submitHealth(api);
    await api.simulateReview(tx.id, { approved: true });
    const trId = tx.tranches[0]!.id;
    await api.payTranche(trId);
    await api.openDispute(trId, 'NOT_DELIVERED', 'Les soins n’ont pas eu lieu.');
    await api.simulateDisputeResolution(trId, { outcome: 'REFUNDED', note: 'Prestation non justifiée' });
    expect(await types(api, tx.id)).toEqual(['TX_VALIDATED', 'PAYMENT_READY', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED']);
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
  async function disputed() {
    const ctx = make({ seedNotifications: false });
    const tx = await submitHealth(ctx.api);
    await ctx.api.simulateReview(tx.id, { approved: true });
    const trId = tx.tranches[0]!.id;
    await ctx.api.payTranche(trId);
    return { ...ctx, tx, trId };
  }
  it('openDispute crée le litige avec le motif et la description', async () => {
    const { api, trId, tx } = await disputed();
    expect(await api.getDispute(trId)).toBeNull();
    await api.openDispute(trId, 'INCOMPLETE', 'Une partie des soins manque.');
    expect(await api.getDispute(trId)).toMatchObject({
      txId: tx.id, trancheId: trId, reason: 'INCOMPLETE', description: 'Une partie des soins manque.', openedBy: 'PAYER', status: 'OPEN',
    });
    expect(await code(api.getDispute('tr-inconnue'))).toBe('NOT_FOUND');
  });
  it('libération : tranche débloquée, reçu disponible', async () => {
    const { api, trId } = await disputed();
    await api.openDispute(trId, 'OTHER', 'Désaccord sur la date.');
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'RELEASED', note: '' }))).toBe('REASON_REQUIRED');
    const tx = await api.simulateDisputeResolution(trId, { outcome: 'RELEASED', note: 'Prestation justifiée' });
    expect(tx.tranches[0]?.status).toBe('RELEASED');
    expect(tx.status).toBe('CLOSED');
    expect(await api.getDispute(trId)).toMatchObject({ status: 'RELEASED_TO_PROVIDER', resolutionNote: 'Prestation justifiée', resolvedAt: expect.any(String) });
    expect((await api.getReceipt(trId)).chainValid).toBe(true);
    expect(await code(api.simulateDisputeResolution(trId, { outcome: 'RELEASED', note: 'encore' }))).toBe('NO_OPEN_DISPUTE');
  });
  it('remboursement : tranche annulée, pas de reçu', async () => {
    const { api, trId } = await disputed();
    await api.openDispute(trId, 'NOT_DELIVERED', 'Les soins n’ont pas eu lieu.');
    const tx = await api.simulateDisputeResolution(trId, { outcome: 'REFUNDED', note: 'Non justifiée' });
    expect(tx.tranches[0]?.status).toBe('CANCELLED');
    expect((await api.getDispute(trId))?.status).toBe('REFUNDED_TO_PAYER');
    expect(await code(api.getReceipt(trId))).toBe('NOT_RELEASED');
  });
});

describe('reçu et journal chaîné', () => {
  it('reçu d’une tranche débloquée, journal vérifié', async () => {
    const { api } = make({ seedNotifications: false });
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
  it('une modification volontaire du journal est détectée', async () => {
    const { api } = make({ seedNotifications: false });
    const { tx, trId } = await fullFlow(api);
    api.tamperAuditForTest(tx.id, 2, { detail: 'falsifié' });
    expect((await api.getReceipt(trId)).chainValid).toBe(false);
  });
  it('refuse une tranche non débloquée', async () => {
    const { api } = make();
    const school = await api.getTransaction('tx-school');
    expect(await code(api.getReceipt(school.tranches[1]!.id))).toBe('NOT_RELEASED');
  });
});

describe('abandon et suppression (D4)', () => {
  it('abandonne un dossier rejeté ; il reste visible avec son journal', async () => {
    const { api } = make();
    const tx = await submitHealth(api);
    expect(await code(api.abandonRejected(tx.id))).toBe('NOT_REJECTED');
    await api.simulateReview(tx.id, { approved: false, reason: 'Incomplet' });
    const done = await api.abandonRejected(tx.id);
    expect(done.status).toBe('CANCELLED');
    expect((await api.listTransactions()).some((t) => t.id === tx.id)).toBe(true);
    expect((await api.timeline(tx.id)).map((e) => e.event)).toContain('TX_ABANDONED');
    expect(await code(api.abandonRejected(tx.id))).toBe('NOT_REJECTED');
    expect(await code(api.reopenForCorrection(tx.id))).toBe('NOT_REJECTED');
  });
  it('un brouillon jamais soumis se supprime ; une correction (dossier audité) non', async () => {
    const { api } = make();
    await api.saveDraft(emptyDraft('need-x', T0));
    await api.deleteDraft('need-x');
    expect(await api.listDrafts()).toEqual([]);
    const tx = await submitHealth(api);
    await api.simulateReview(tx.id, { approved: false, reason: 'Incomplet' });
    const fix = await api.reopenForCorrection(tx.id);
    expect(await code(api.deleteDraft(fix.id))).toBe('AUDITED_FILE');
    expect((await api.listDrafts()).map((d) => d.id)).toEqual([fix.id]);
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
    const first = make({ state, seedNotifications: false });
    const { tx, trId } = await fullFlow(first.api);
    await first.api.flushState();
    expect(state.saves).toBe(1);

    const second = new MockApi(() => new Date(T0.getTime() + HOUR), undefined, { state, drafts: first.drafts });
    expect(await second.hydrate()).toBe(true);
    expect((await second.getTransaction(tx.id)).tranches[0]?.status).toBe('RELEASED');
    expect(await types(second, tx.id)).toEqual(['TX_VALIDATED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED']);
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
  it('créer, valider, payer, confirmer, débloquer : alertes attendues, reçu valide, falsification détectée', async () => {
    const { api } = make({ seedNotifications: false });
    const { tx, trId } = await fullFlow(api);
    expect(await types(api, tx.id)).toEqual(['TX_VALIDATED', 'PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED']);
    expect((await api.getTransaction(tx.id)).status).toBe('CLOSED');
    const ok = await api.getReceipt(trId);
    expect(ok.chainValid).toBe(true);
    expect(ok.entryCount).toBeGreaterThanOrEqual(8);
    api.tamperAuditForTest(tx.id, 1, { actor: 'quelqu’un d’autre' });
    expect((await api.getReceipt(trId)).chainValid).toBe(false);
  });
});
