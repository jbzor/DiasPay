import { describe, expect, it } from 'vitest';
import { DomainError, decodeEqr, encodeEqr } from '@diaspay/domain';
import { MockApi, currentTrancheIndex, seedTransactions, filterTransactions, lockedFunds, nextPayment } from '../src';
import type { Transaction } from '../src';

const T0 = new Date('2026-11-08T10:00:00Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();

const REF2 = '7b31d0a9c5e24f8a61'; // Scolarité T1 (tranche 2), dans la variante conditionnelle
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };

/**
 * Lot X v2 : le jeu de démonstration règle la scolarité en direct (aucun jeton, aucun délai). Le QR, la confirmation par scan
 * du prestataire et le délai de contestation n’existent qu’en libération conditionnelle ; ce jeu reprend la scolarité avec un
 * module EDUCATION réglé en CONDITIONAL (seul mode PROVIDER_CONFIRM du jeu) : T1 payée, fonds bloqués, confirmée la veille
 * (fin du délai dans 48 h) ; T2 soumise au payeur, avec sa référence ; T3 en brouillon.
 */
function conditionalSeed(): Transaction[] {
  const seed = seedTransactions(T0);
  const s = seed.find((t) => t.id === 'tx-school')!;
  s.settlementMode = 'CONDITIONAL';
  Object.assign(s.tranches[0]!, { fundsState: 'HELD', confirmedAt: iso(-24 * HOUR), contestEndsAt: iso(48 * HOUR) });
  s.tranches[1]!.reference = REF2;
  return seed;
}
const make = (seed?: Transaction[]) => {
  let now = new Date(T0);
  const api = new MockApi(() => now, seed);
  return { api, advance: (h: number) => { now = new Date(now.getTime() + h * HOUR); } };
};
const makeConditional = () => make(conditionalSeed());
const school = async (api: MockApi) => api.getTransaction('tx-school');

describe('MockApi', () => {
  it('trouve la prochaine tranche à payer', async () => {
    const { api } = make();
    const next = nextPayment(await api.listTransactions());
    expect(next?.tranche.dueDate).toBe('2026-11-15');
    expect(next?.tx.id).toBe('tx-school');
  });
  it('calcule les fonds verrouillés (CONDITIONAL seulement)', async () => {
    const { api } = make();
    // Terrain : la tranche 2 est payée, fonds bloqués ; la tranche 1 est libérée ; les paiements directs ne bloquent rien.
    expect(lockedFunds(await api.listTransactions())).toEqual([{ currency: 'XAF', amountMinor: 4_000_000 }]);
    const tx = await school(api);
    await api.payTranche(tx.tranches[1]!.id);
    expect(lockedFunds(await api.listTransactions())).toEqual([{ currency: 'XAF', amountMinor: 4_000_000 }]);
  });
  it('le paiement règle la demande : DIRECT, versée sans blocage ; un second paiement est refusé', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.payTranche(tx.tranches[1]!.id);
    const t2 = (await school(api)).tranches[1]!;
    expect(t2).toMatchObject({ status: 'PAID', fundsState: 'NONE', paidAt: T0.toISOString() });
    expect((await api.listNotifications())[0]?.event).toEqual({ type: 'REQUEST_PAID', txId: 'tx-school', trancheId: t2.id });
    await expect(api.payTranche(tx.tranches[1]!.id)).rejects.toThrow(DomainError);
  });
  it('le paiement verrouille les fonds en CONDITIONAL', async () => {
    const { api } = makeConditional();
    const tx = await school(api);
    await api.payTranche(tx.tranches[1]!.id);
    expect((await school(api)).tranches[1]).toMatchObject({ status: 'PAID', fundsState: 'HELD' });
    expect(lockedFunds(await api.listTransactions())).toEqual([{ currency: 'XAF', amountMinor: 300_000 + 300_000 + 4_000_000 }]);
    await expect(api.payTranche(tx.tranches[1]!.id)).rejects.toThrow(DomainError);
  });
  it('déblocage automatique après le délai de contestation (CONDITIONAL)', async () => {
    const { api, advance } = makeConditional();
    expect(api.runTimers()).toBe(0);
    advance(49);
    expect(api.runTimers()).toBe(1);
    expect((await school(api)).tranches[0]).toMatchObject({ status: 'PAID', fundsState: 'RELEASED' });
    expect((await api.listNotifications())[0]?.event.type).toBe('TRANCHE_RELEASED');
    // Le règlement direct n’a aucun délai : rien à libérer.
    const direct = make();
    direct.advance(24 * 365);
    expect(direct.api.runTimers()).toBe(0);
  });
  it('le payeur approuve un déblocage anticipé (CONDITIONAL) ; en DIRECT : WRONG_MODE', async () => {
    const { api } = makeConditional();
    const tx = await school(api);
    await api.approveRelease(tx.tranches[0]!.id);
    expect((await school(api)).tranches[0]!.fundsState).toBe('RELEASED');
    const direct = make().api;
    expect(await code(direct.approveRelease((await school(direct)).tranches[0]!.id))).toBe('WRONG_MODE');
    expect(await code(direct.confirmService((await school(direct)).tranches[0]!.id))).toBe('WRONG_MODE');
  });
  it('litige après paiement : motif trop court refusé, statut inchangé, déblocage auto bloqué', async () => {
    const { api, advance } = makeConditional();
    const tx = await school(api);
    await expect(api.openDispute(tx.tranches[0]!.id, 'court')).rejects.toThrow(/10 caractères/);
    await api.openDispute(tx.tranches[0]!.id, 'La prestation n’a pas été réalisée');
    const t1 = (await school(api)).tranches[0]!;
    expect(t1).toMatchObject({ status: 'PAID', fundsState: 'HELD', onHold: false });
    expect(await api.getDispute(t1.id)).toMatchObject({ status: 'OPEN', beforePayment: false });
    expect((await school(api)).status).toBe('ACTIVE');
    advance(100);
    expect(api.runTimers()).toBe(0);
  });
  it('opération suspendue : aucune libération automatique, même délai écoulé (lot X-C, T6)', async () => {
    const { api, advance } = makeConditional();
    const tx = await school(api);
    // Litige avant paiement sur la tranche 2 : l’opération est suspendue ; la tranche 1 (payée, confirmée) reste bloquée.
    await api.openDispute(tx.tranches[1]!.id, 'Montant différent du devis convenu');
    expect((await school(api)).status).toBe('SUSPENDED');
    advance(49);
    expect(api.runTimers()).toBe(0);
    expect((await school(api)).tranches[0]!.fundsState).toBe('HELD');
    // Litige levé sans suite : l’opération redevient active, la libération automatique reprend.
    await api.simulateDisputeResolution(tx.tranches[1]!.id, { outcome: 'NO_ACTION', note: 'Levée sans suite (test)' });
    expect((await school(api)).status).toBe('ACTIVE');
    expect(api.runTimers()).toBe(1);
    expect((await school(api)).tranches[0]!.fundsState).toBe('RELEASED');
  });
  it('demande échue : plus payable, même avant le passage d’expiration (lot X-C, T6)', async () => {
    const { api, advance } = make();
    const tx = await school(api);
    (await school(api)).tranches[1]!.expiresAt = iso(1 * HOUR);   // posée comme _submit_request (durée du module)
    advance(2);
    expect(await code(api.getQuote(tx.tranches[1]!.id))).toBe('REQUEST_EXPIRED');
    expect(await code(api.payTranche(tx.tranches[1]!.id))).toBe('REQUEST_EXPIRED');
    expect((await school(api)).tranches[1]!.status).toBe('SUBMITTED');   // le passage d’expiration n’a pas encore eu lieu
  });
  it('litige avant paiement : demande suspendue, opération SUSPENDED, paiement refusé', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.openDispute(tx.tranches[1]!.id, 'Montant différent du devis');
    const after = await school(api);
    expect(after.status).toBe('SUSPENDED');
    expect(after.tranches[1]).toMatchObject({ status: 'SUBMITTED', onHold: true });
    expect(await api.getDispute(tx.tranches[1]!.id)).toMatchObject({ beforePayment: true });
    expect(await code(api.payTranche(tx.tranches[1]!.id))).toBe('REQUEST_ON_HOLD');   // annoncé avant l’état de l’opération (0018)
  });
  it('litige impossible sur une demande non soumise', async () => {
    const { api } = make();
    const tx = await school(api);
    await expect(api.openDispute(tx.tranches[2]!.id, 'Motif suffisamment long')).rejects.toThrow(/impossible/);
  });
  it('la transaction se clôt quand toutes les demandes sont terminées', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.payTranche(tx.tranches[1]!.id);
    expect((await school(api)).status).toBe('ACTIVE'); // T3 reste en brouillon
    const health = await api.getTransaction('tx-health');
    await api.payTranche(health.tranches[0]!.id);
    expect((await api.getTransaction('tx-health')).status).toBe('CLOSED');
    expect((await api.timeline('tx-health')).map((e) => e.event)).toContain('TX_CLOSED');
  });
  it('filtres et index de tranche', async () => {
    const { api } = make();
    const all = await api.listTransactions();
    expect(filterTransactions(all, 'ACTIVE').map((t) => t.id)).toEqual(['tx-school', 'tx-health', 'tx-rent', 'tx-land']);
    expect(filterTransactions(all, 'REVIEW').map((t) => t.id)).toEqual([]);
    expect(filterTransactions(all, 'CLOSED').map((t) => t.id)).toEqual([]);
    expect(currentTrancheIndex(all.find((t) => t.id === 'tx-rent')!)).toBe(4);
    expect(currentTrancheIndex(all.find((t) => t.id === 'tx-land')!)).toBe(2); // fonds bloqués : demande non finale
    // Une demande d’informations met le dossier « en vérification ».
    api.setUser({ id: 'u-marie', role: 'PAYER' });
    await api.requestInfo((await api.getTransaction('tx-health')).tranches[0]!.id, 'Merci de préciser la date de l’opération');
    expect(filterTransactions(await api.listTransactions(), 'REVIEW').map((t) => t.id)).toEqual(['tx-health']);
  });
  it('notifie les abonnés à chaque changement', async () => {
    const { api } = makeConditional();
    let calls = 0;
    api.subscribe(() => { calls++; });
    const tx = await school(api);
    await api.approveRelease(tx.tranches[0]!.id);
    expect(calls).toBe(1);
  });
});

describe('MockApi — TrustToken et eQR (CONDITIONAL seulement)', () => {
  const payT2 = async (api: MockApi) => { const tx = await school(api); await api.payTranche(tx.tranches[1]!.id); return tx.tranches[1]!; };

  it('un jeton existe pour toute demande soumise en CONDITIONAL, pas pour un brouillon', async () => {
    const { api } = makeConditional();
    const tx = await school(api);
    const tok = await api.getToken(tx.tranches[1]!.id);
    expect(tok.reference).toBe(REF2);
    expect(tok.reference).toMatch(/^[0-9a-f]{18}$/);
    expect(tok.kid).toBe('SIMULATED');
    expect(tok.signature).toMatch(/^SIMULATED\.[0-9a-f]+$/);
    expect(tok.simulated).toBe(true);
    expect(tok.expiresAt).toBe('2026-11-15T10:00:00.000Z');
    expect(await code(api.getToken(tx.tranches[2]!.id))).toBe('NO_TOKEN');
    expect(await code(api.getToken('inconnu'))).toBe('TRANCHE_NOT_FOUND');
  });
  it('règlement direct : aucun jeton ni référence (NO_TOKEN), le scan ne trouve rien', async () => {
    const { api } = make();
    const tx = await school(api);
    expect(await code(api.getToken(tx.tranches[1]!.id))).toBe('NO_TOKEN');
    expect(await code(api.getToken(tx.tranches[0]!.id))).toBe('NO_TOKEN');
    expect(tx.tranches.every((t) => t.reference === undefined)).toBe(true);
    // Miroir de _party_token (0015) : en DIRECT, le prestataire ne résout aucune référence.
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2))).toBe('UNKNOWN_REFERENCE');
  });
  it('toutes les références du jeu de démonstration sont uniques et en 18 hex', async () => {
    const { api } = make();
    const txs = await api.listTransactions();
    const refs = txs.filter((t) => t.settlementMode === 'CONDITIONAL').flatMap((t) => t.tranches).filter((r) => r.status !== 'DRAFT').map((r) => r.reference);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => /^[0-9a-f]{18}$/.test(r ?? ''))).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
    expect(txs.filter((t) => t.settlementMode === 'DIRECT').flatMap((t) => t.tranches).every((r) => r.reference === undefined)).toBe(true);
  });
  it('getTranche renvoie la transaction et la tranche', async () => {
    const { api } = make();
    const tx = await school(api);
    const r = await api.getTranche(tx.tranches[1]!.id);
    expect(r.tx.id).toBe('tx-school');
    expect(r.tranche.seq).toBe(2);
  });
  it('resolveReference : informations, casse et tirets ignorés', async () => {
    const { api } = makeConditional();
    const info = await api.resolveReference('7B31-D0A9-C5E2-4F8A-61');
    expect(info).toMatchObject({ txId: 'tx-school', label: 'Scolarité T1', amountMinor: 300_000, currency: 'XAF', status: 'SUBMITTED', used: false, seq: 2, contestHours: 72 });
  });
  it('resolveReference : UNKNOWN_REFERENCE, y compris pour un dossier étranger (lot X : même réponse)', async () => {
    const { api } = makeConditional();
    expect(await code(api.resolveReference('ffffffffffffffffff'))).toBe('UNKNOWN_REFERENCE');
    expect(await code(api.resolveReference('court'))).toBe('UNKNOWN_REFERENCE');
    const seed = conditionalSeed();
    seed[0]!.parties = ['PROVIDER'];
    const other = new MockApi(() => T0, seed);
    expect(await code(other.resolveReference(seed[0]!.tranches[1]!.reference!))).toBe('UNKNOWN_REFERENCE');
    other.setPersona('PROVIDER');
    expect(await code(other.resolveReference(seed[0]!.tranches[1]!.reference!))).toBe('NO_ERROR');
  });
  it('confirmByReference : réservé au prestataire', async () => {
    const { api } = makeConditional();
    await payT2(api);
    expect(await code(api.confirmByReference(REF2))).toBe('PROVIDER_ONLY');
  });
  it('confirmByReference : référence inconnue et dossier étranger, même code (lot X)', async () => {
    const { api } = makeConditional();
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference('ffffffffffffffffff'))).toBe('UNKNOWN_REFERENCE');
    const seed = conditionalSeed();
    seed[0]!.parties = ['PAYER'];
    const other = new MockApi(() => T0, seed);
    other.setPersona('PROVIDER');
    expect(await code(other.confirmByReference(seed[0]!.tranches[1]!.reference!))).toBe('UNKNOWN_REFERENCE');
  });
  it('confirmByReference : tranche non payée', async () => {
    const { api } = makeConditional();
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2))).toBe('NOT_PAID');
  });
  it('confirmByReference : mode de déblocage qui n’est pas la confirmation du prestataire', async () => {
    const seed = seedTransactions(T0);
    const agro = seed.find((t) => t.id === 'tx-agro')!;   // PAYER_CONFIRM
    agro.status = 'ACTIVE';
    Object.assign(agro.tranches[0]!, { status: 'PAID', fundsState: 'HELD', paidAt: T0.toISOString() });
    const land = seed.find((t) => t.id === 'tx-land')!;   // EVIDENCE_REVIEW
    const other = new MockApi(() => T0, seed);
    other.setPersona('PROVIDER');
    expect(await code(other.confirmByReference(agro.tranches[0]!.reference!))).toBe('WRONG_MODE');
    expect(await code(other.confirmByReference(land.tranches[1]!.reference!))).toBe('WRONG_MODE');
    // Le payeur confirme lui-même en PAYER_CONFIRM ; le délai de contestation démarre.
    other.setPersona('PAYER');
    const tx = await other.confirmService(agro.tranches[0]!.id);
    expect(tx.tranches[0]).toMatchObject({ confirmedAt: T0.toISOString(), contestEndsAt: iso(72 * HOUR) });
    expect(await code(other.confirmService(agro.tranches[0]!.id))).toBe('ALREADY_CONFIRMED');
  });
  it('confirmByReference : jeton expiré selon l’heure de l’appareil ou l’horloge', async () => {
    const { api, advance } = makeConditional();
    await payT2(api);
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2, '2026-11-15T10:00:01.000Z'))).toBe('DEVICE_TIME_INVALID'); // trop loin dans le futur
    advance(24 * 7 + 1);
    expect(await code(api.confirmByReference(REF2))).toBe('TOKEN_EXPIRED');
  });
  it('confirmByReference : heure de l’appareil à plus de 5 minutes dans le futur', async () => {
    const { api } = makeConditional();
    await payT2(api);
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2, '2026-11-08T10:06:00.000Z'))).toBe('DEVICE_TIME_INVALID');
    expect(await code(api.confirmByReference(REF2, 'pas une date'))).toBe('DEVICE_TIME_INVALID');
  });
  it('confirmByReference : succès, délai de contestation et usage unique', async () => {
    const { api } = makeConditional();
    await payT2(api);
    api.setPersona('PROVIDER');
    const tx = await api.confirmByReference('7B31-D0A9-C5E2-4F8A-61', '2026-11-08T10:04:00.000Z');
    const t2 = tx.tranches[1]!;
    expect(t2).toMatchObject({ status: 'PAID', fundsState: 'HELD', confirmedAt: T0.toISOString() });
    expect(t2.contestEndsAt).toBe('2026-11-11T10:00:00.000Z');
    expect(await code(api.getToken(t2.id))).toBe('NO_TOKEN');   // lot X : le jeton ne se lit que par le payeur
    api.setPersona('PAYER');
    const tok = await api.getToken(t2.id);
    expect(tok.usedAt).toBe('2026-11-08T10:00:00.000Z');
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2))).toBe('TOKEN_USED');
    expect((await api.resolveReference(REF2)).used).toBe(true);
  });
  it('un échec ne consomme pas le jeton', async () => {
    const { api } = makeConditional();
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2))).toBe('NOT_PAID');
    api.setPersona('PAYER');
    expect((await api.getToken((await school(api)).tranches[1]!.id)).usedAt).toBeUndefined();
  });
  it('durée de validité configurable', async () => {
    const api = new MockApi(() => T0, conditionalSeed(), { tokenValidityHours: 2 });
    const tx = await api.getTransaction('tx-school');
    expect((await api.getToken(tx.tranches[1]!.id)).expiresAt).toBe('2026-11-08T12:00:00.000Z');
  });
});

describe('parcours complet du mock (démonstration)', () => {
  it('CONDITIONAL : payer, afficher le jeton, confirmer en prestataire, délai de contestation, usage unique, libération', async () => {
    let now = new Date(T0);
    const api = new MockApi(() => now, conditionalSeed());
    const tx = await api.getTransaction('tx-school');
    const t2 = tx.tranches[1]!;

    // 1. Payeur : le jeton existe déjà (demande soumise), la demande passe à « payée », fonds bloqués.
    const before = await api.getToken(t2.id);
    expect(before.usedAt).toBeUndefined();
    await api.payTranche(t2.id);
    expect((await api.getTranche(t2.id)).tranche).toMatchObject({ status: 'PAID', fundsState: 'HELD' });
    const token = await api.getToken(t2.id);
    expect(token.reference).toBe(before.reference);

    // Le contenu du QR ne porte que référence, kid et signature.
    const qr = encodeEqr({ reference: token.reference, kid: token.kid, signature: token.signature });
    expect(qr).toBe(`DPQ1:${token.reference}:${token.kid}:${token.signature}`);
    expect(qr).not.toMatch(/300000|Scolarité|Aïcha|Palmiers/);

    // 2. Prestataire : résolution puis confirmation, 5 minutes plus tard.
    api.setPersona('PROVIDER');
    const decoded = decodeEqr(qr);
    const info = await api.resolveReference(decoded.reference);
    expect(info).toMatchObject({ status: 'PAID', used: false, amountMinor: 300_000 });
    now = new Date(now.getTime() + 5 * 60_000);
    const confirmed = await api.confirmByReference(decoded.reference, now.toISOString());
    const done = confirmed.tranches[1]!;
    expect(done.confirmedAt).toBe(now.toISOString());
    expect(done.contestEndsAt).toBe(new Date(now.getTime() + 72 * HOUR).toISOString());

    // 3. Usage unique : un second scan est refusé, y compris avec le même QR.
    expect(await code(api.confirmByReference(decoded.reference))).toBe('TOKEN_USED');
    api.setPersona('PAYER');   // lot X : le jeton ne se lit que par le payeur
    expect((await api.getToken(t2.id)).usedAt).toBe(now.toISOString());
    expect(await code(api.getReceipt(t2.id))).toBe('NOT_RELEASED');   // fonds encore bloqués

    // 4. À l’échéance du délai, les fonds sont libérés automatiquement ; le reçu devient disponible.
    now = new Date(now.getTime() + 73 * HOUR);
    expect(api.runTimers()).toBeGreaterThanOrEqual(1);
    expect((await api.getTranche(t2.id)).tranche).toMatchObject({ status: 'PAID', fundsState: 'RELEASED' });
    expect((await api.getReceipt(t2.id)).chainValid).toBe(true);
  });
});
