import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULES, buildInstallmentsPlan, emptyDraft } from '@diaspay/domain';
import type { NeedDraft, RequestModule } from '@diaspay/domain';
import { ApiError, MemoryDraftStore, MockApi } from '../src';

const T0 = new Date('2026-11-10T09:00:00');
const DAY = 86_400_000;

function make(opts: { failureRate?: number; random?: () => number; modules?: readonly RequestModule[] } = {}) {
  let now = new Date(T0);
  const store = new MemoryDraftStore();
  const api = new MockApi(() => now, undefined, { drafts: store, uploadFailureRate: opts.failureRate, random: opts.random, modules: opts.modules });
  api.setUser({ id: 'u-marie', role: 'PAYER' });
  return { api, store, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as ApiError).code; }
  return 'OK';
}

const file = (kind: string, name = `${kind}.pdf`, sizeBytes = 120_000) => ({ kind: kind as never, name, sizeBytes, uri: `file:///${name}` });

async function healthDraft(api: MockApi, dueDate = '2026-11-15'): Promise<NeedDraft> {
  const d = await api.saveDraft({
    ...emptyDraft('need-h', T0), vertical: 'HEALTH', amountMinor: 180_000, currency: 'XAF', purpose: 'Opération du genou',
    beneficiaryReference: 'RM-12', desiredDate: dueDate, provider: { id: 'pv-hopital-central', name: 'Hôpital Central' },
    planType: 'SINGLE', tranches: [{ label: 'Soins', amountMinor: 180_000, dueDate }],
  });
  await api.attachDocument(d.id, file('QUOTE'));
  return api.getDraft(d.id);
}

describe('prestataires', () => {
  it('recherche par verticale, insensible à la casse et aux accents', async () => {
    const { api } = make();
    expect((await api.searchProviders('hopital', 'HEALTH')).map((p) => p.name)).toEqual(['Hôpital Central', 'Hôpital Saint-Luc']);
    expect((await api.searchProviders('ESPOIR', 'HEALTH')).map((p) => p.name)).toEqual(['Clinique de l’Espoir']);
    expect((await api.searchProviders('douala', 'EDUCATION')).map((p) => p.name)).toEqual(['Collège La Réussite']);
    expect(await api.searchProviders('hopital', 'RENT')).toEqual([]);
    expect((await api.searchProviders('', 'RENT')).every((p) => p.verified)).toBe(true);
  });
});

describe('brouillons', () => {
  it('appartiennent à l’utilisateur et ne sont jamais des transactions', async () => {
    const { api } = make();
    const before = (await api.listTransactions()).length;
    await api.saveDraft(emptyDraft('need-1', T0));
    expect((await api.listDrafts()).map((d) => d.id)).toEqual(['need-1']);
    expect((await api.listTransactions()).length).toBe(before);
    expect((await api.listTransactions()).some((t) => t.status === 'DRAFT')).toBe(false);
    api.setUser({ id: 'u-autre', role: 'PAYER' });
    expect(await api.listDrafts()).toEqual([]);
    expect(await code(api.getDraft('need-1'))).toBe('TX_NOT_FOUND');
    expect(await code(api.saveDraft({ ...emptyDraft('need-1', T0) }))).toBe('TX_NOT_FOUND');
    api.setUser(null);
    expect(await api.listDrafts()).toEqual([]);
  });
  it('se suppriment', async () => {
    const { api } = make();
    await api.saveDraft(emptyDraft('need-1', T0));
    await api.deleteDraft('need-1');
    expect(await api.listDrafts()).toEqual([]);
  });
});

describe('pièces', () => {
  it('envoi avec progression, contrôles de format et de taille', async () => {
    const { api } = make();
    await api.saveDraft(emptyDraft('need-1', T0));
    const seen: number[] = [];
    const doc = await api.attachDocument('need-1', file('QUOTE'), (p) => seen.push(p));
    expect(doc.status).toBe('UPLOADED');
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(await code(api.attachDocument('need-1', file('QUOTE', 'a.heic')))).toBe('FILE_TYPE');
    expect(await code(api.attachDocument('need-1', file('QUOTE', 'a.pdf', 11 * 1024 * 1024)))).toBe('FILE_TOO_LARGE');
    await api.removeDocument('need-1', doc.id);
    expect((await api.getDraft('need-1')).documents).toEqual([]);
  });
  it('échec simulé puis nouvelle tentative avec le même identifiant', async () => {
    let fail = true;
    const { api } = make({ failureRate: 0.5, random: () => (fail ? 0 : 0.9) });
    await api.saveDraft(emptyDraft('need-1', T0));
    expect(await code(api.attachDocument('need-1', { ...file('LEASE'), id: 'doc-1' }))).toBe('UPLOAD_FAILED');
    fail = false;
    expect((await api.attachDocument('need-1', { ...file('LEASE'), id: 'doc-1' })).id).toBe('doc-1');
    expect((await api.getDraft('need-1')).documents).toHaveLength(1);
  });
});

describe('soumission', () => {
  // Lot X v2 : platform_review NEVER par défaut (K2) ; l’opération est active dès la soumission, la demande due est soumise au payeur.
  it('active un dossier valide dès la soumission (règlement direct, sans revue par défaut)', async () => {
    const { api } = make();
    const d = await healthDraft(api);
    const tx = await api.submitNeed(d.id);
    expect(tx).toMatchObject({ status: 'ACTIVE', settlementMode: 'DIRECT' });
    expect(tx.tranches.map((t) => [t.status, t.releaseMode, t.contestHours, t.fundsState])).toEqual([['SUBMITTED', 'PROVIDER_CONFIRM', 48, 'NONE']]);
    expect(tx.documentCount).toBe(1);   // santé : le devis seul (K13)
    expect(await api.listDrafts()).toEqual([]);
    expect((await api.listTransactions()).some((t) => t.id === tx.id)).toBe(true);
    // Lot X-C (T7) : « TrustToken généré » juste avant la soumission de la demande, comme le serveur (_submit_request).
    expect((await api.timeline(tx.id)).map((e) => e.event)).toEqual(['NEED_SUBMITTED', 'AUTO_ACTIVATED', 'TOKEN_ISSUED', 'REQUEST_SUBMITTED', 'PAYMENT_READY']);
  });
  it('refuse un écart de plan', async () => {
    const { api } = make();
    const d = await healthDraft(api);
    await api.saveDraft({ ...d, tranches: [{ label: 'Soins', amountMinor: 170_000, dueDate: '2026-11-15' }] });
    try { await api.submitNeed(d.id); expect.unreachable(); } catch (e) {
      expect((e as ApiError).code).toBe('PLAN_SUM_MISMATCH');
      expect((e as ApiError).details).toMatchObject({ gap: 10_000 });
    }
  });
  it('refuse une pièce obligatoire manquante, selon la verticale', async () => {
    const { api } = make();
    const d = await healthDraft(api);
    const quote = d.documents.find((x) => x.kind === 'QUOTE')!;
    await api.removeDocument(d.id, quote.id);
    try { await api.submitNeed(d.id); expect.unreachable(); } catch (e) {
      expect((e as ApiError).code).toBe('DOCUMENT_REQUIRED');
      expect((e as ApiError).details).toEqual({ kind: 'QUOTE' });
    }
    const rent = await api.saveDraft({ ...d, id: 'need-r', vertical: 'RENT', documents: [], beneficiaryName: 'Rose M.', beneficiaryReference: undefined });
    await api.attachDocument(rent.id, file('LAST_RECEIPT'));
    expect(await code(api.submitNeed(rent.id))).toBe('DOCUMENT_REQUIRED');
    await api.attachDocument(rent.id, file('LEASE'));
    expect(await code(api.submitNeed(rent.id))).toBe('OK');
  });
  it('refuse un dossier incomplet (VALIDATION) et une verticale de la vague 2', async () => {
    const { api } = make();
    const d = await healthDraft(api);
    await api.saveDraft({ ...d, purpose: 'ab' });
    try { await api.submitNeed(d.id); expect.unreachable(); } catch (e) {
      expect((e as ApiError).code).toBe('VALIDATION');
      expect((e as ApiError).details.issues).toEqual([{ path: 'purpose', code: 'PURPOSE_TOO_SHORT', params: undefined }]);
    }
    await api.saveDraft({ ...d, vertical: 'LAND' });
    // Lot X (X6) : même code que le serveur (transition_tx), au lieu de VALIDATION.
    expect(await code(api.submitNeed(d.id))).toBe('VERTICAL_UNAVAILABLE');
  });
  // Lot X : comme save_draft, un profil « prestataire » sans rôle explicite crée en payeur (le simulateur refusait, le serveur acceptait).
  it('un profil prestataire sans rôle explicite soumet en payeur, comme le serveur', async () => {
    const { api } = make();
    const d = await healthDraft(api);
    api.setUser({ id: 'u-marie', role: 'PROVIDER' });
    expect((await api.submitNeed(d.id)).status).toBe('ACTIVE');
  });
  it('rôle PROVIDER explicite : niveau N2 exigé (ENROLMENT_REQUIRED), jamais soi-même payeur (SELF_PAYER)', async () => {
    const { api } = make();
    api.setUser({ id: 'u-ecole', role: 'PROVIDER', phone: '+237699000777' });
    expect(await code(api.createDraft({ vertical: 'EDUCATION', creatorRole: 'PROVIDER' }))).toBe('ENROLMENT_REQUIRED');
    api.setUser({ id: 'u-ecole', role: 'PROVIDER', phone: '+237699000777', enrolmentLevel: 'N2' });
    const d = await api.createDraft({ vertical: 'EDUCATION', creatorRole: 'PROVIDER' });
    expect(d).toMatchObject({ vertical: 'EDUCATION', creatorRole: 'PROVIDER', ownerId: 'u-ecole' });
    expect(await code(api.saveDraft({ ...d, counterpartyPhone: '+237 6 99 00 07 77' }))).toBe('SELF_PAYER');
  });
});

// Lot X v2 : la revue par le bureau ne concerne plus que les types de besoin réglés en ALWAYS (ou RISK_BASED avec un risque).
const REVIEWED: readonly RequestModule[] = DEFAULT_MODULES.map((m) => ({ ...m, platformReview: 'ALWAYS' as const }));

describe('bureau de contrôle simulé (platform_review ALWAYS)', () => {
  it('la soumission attend la revue ; l’approbation active, la demande due est soumise, payable directement', async () => {
    const { api } = make({ modules: REVIEWED });
    const tx = await api.submitNeed((await healthDraft(api, '2026-11-15')).id);
    expect(tx.status).toBe('PENDING_REVIEW');
    expect(tx.tranches[0]?.status).toBe('DRAFT');
    const done = await api.simulateReview(tx.id, { approved: true });
    expect(done.status).toBe('ACTIVE');
    expect(done.tranches[0]?.status).toBe('SUBMITTED');
    expect((await api.getToken(done.tranches[0]!.id)).reference).toMatch(/^[0-9a-f]{18}$/);   // lot X-C (T7) : jeton en DIRECT aussi
    const types = (await api.listNotifications()).filter((n) => n.event.txId === tx.id).map((n) => n.event.type);
    expect(types.sort()).toEqual(['PAYMENT_READY', 'TX_VALIDATED']);
    expect((await api.payTranche(done.tranches[0]!.id)).tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'NONE' });
  });
  it('approuve sans soumettre une première échéance lointaine (RG-12)', async () => {
    const { api } = make({ modules: REVIEWED });
    const tx = await api.submitNeed((await healthDraft(api, '2026-12-20')).id);
    const done = await api.simulateReview(tx.id, { approved: true });
    expect(done.tranches[0]?.status).toBe('DRAFT');
    expect(await code(api.payTranche(done.tranches[0]!.id))).toBe('NOT_PAYABLE');
  });
  it('rejette avec motif : opération annulée (plus de correction, D4 remplacée) ; l’initiateur recrée une demande', async () => {
    const { api } = make({ modules: REVIEWED });
    const make1 = (id: string) => api.saveDraft({
      ...emptyDraft(id, T0), vertical: 'EDUCATION', amountMinor: 900_000, currency: 'XAF', purpose: 'Scolarité 2026-2027',
      beneficiaryName: 'Aïcha N.', provider: { id: 'pv-palmiers', name: 'École Les Palmiers' }, planType: 'INSTALLMENTS',
      tranches: buildInstallmentsPlan(900_000, ['2026-11-15', '2027-01-15', '2027-04-15'], 'Tranche'),
    });
    const d = await make1('need-s');
    await api.attachDocument(d.id, file('ENROLMENT_CERTIFICATE'));
    const tx = await api.submitNeed(d.id);
    expect(await code(api.simulateReview(tx.id, { approved: false }))).toBe('REASON_REQUIRED');
    const rejected = await api.simulateReview(tx.id, { approved: false, reason: 'Attestation illisible' });
    expect(rejected).toMatchObject({ status: 'CANCELLED', rejectionReason: 'Attestation illisible' });
    expect(rejected.tranches.every((t) => t.status === 'CANCELLED')).toBe(true);
    expect(await code(api.cancelOperation(tx.id))).toBe('TRANSITION_UNKNOWN');   // déjà annulée, aucune correction
    expect((await api.listNotifications()).filter((n) => n.event.txId === tx.id).map((n) => n.event.type)).toEqual(['TX_REJECTED']);
    const d2 = await make1('need-s2');
    await api.attachDocument(d2.id, file('ENROLMENT_CERTIFICATE'));
    expect((await api.submitNeed(d2.id)).status).toBe('PENDING_REVIEW');
  });
  it('n’agit que sur une opération en revue', async () => {
    const { api } = make();
    expect(await code(api.simulateReview('tx-school', { approved: true }))).toBe('NOT_IN_REVIEW');
  });
});
