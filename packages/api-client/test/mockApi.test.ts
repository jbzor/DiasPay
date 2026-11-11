import { describe, expect, it } from 'vitest';
import { DomainError, decodeEqr, encodeEqr } from '@diaspay/domain';
import { MockApi, currentTrancheIndex, seedTransactions, filterTransactions, lockedFunds, nextPayment } from '../src';

const T0 = new Date('2026-11-08T10:00:00Z');
const make = () => { let now = new Date(T0); const api = new MockApi(() => now); return { api, advance: (h: number) => { now = new Date(now.getTime() + h * 3_600_000); } }; };
const school = async (api: MockApi) => api.getTransaction('tx-school');

const REF2 = '7b31d0a9c5e24f8a61'; // Scolarité T1 (tranche 2)
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };

describe('MockApi', () => {
  it('trouve la prochaine tranche à payer', async () => {
    const { api } = make();
    const next = nextPayment(await api.listTransactions());
    expect(next?.tranche.dueDate).toBe('2026-11-15');
    expect(next?.tx.id).toBe('tx-school');
  });
  it('calcule les fonds verrouillés', async () => {
    const { api } = make();
    const f = lockedFunds(await api.listTransactions());
    expect(f).toEqual([{ currency: 'XAF', amountMinor: 300_000 + 4_000_000 }]);
  });
  it('le paiement verrouille les fonds', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.payTranche(tx.tranches[1]!.id);
    expect((await school(api)).tranches[1]!.status).toBe('PAID_LOCKED');
    await expect(api.payTranche(tx.tranches[1]!.id)).rejects.toThrow(DomainError);
  });
  it('déblocage automatique après le délai de contestation', async () => {
    const { api, advance } = make();
    expect(api.runTimers()).toBe(0);
    advance(49);
    expect(api.runTimers()).toBe(1);
    expect((await school(api)).tranches[0]!.status).toBe('RELEASED');
  });
  it('le payeur approuve un déblocage anticipé', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.approveRelease(tx.tranches[0]!.id);
    expect((await school(api)).tranches[0]!.status).toBe('RELEASED');
  });
  it('litige : motif trop court refusé, litige suspend la tranche et bloque le déblocage auto', async () => {
    const { api, advance } = make();
    const tx = await school(api);
    await expect(api.openDispute(tx.tranches[0]!.id, 'court')).rejects.toThrow(/10 caractères/);
    await api.openDispute(tx.tranches[0]!.id, 'La prestation n’a pas été réalisée');
    expect((await school(api)).tranches[0]!.status).toBe('DISPUTED');
    advance(100);
    expect(api.runTimers()).toBe(0);
  });
  it('litige impossible après le délai', async () => {
    const { api, advance } = make();
    const tx = await school(api);
    advance(50);
    await expect(api.openDispute(tx.tranches[0]!.id, 'Motif suffisamment long')).rejects.toThrow(/impossible/);
  });
  it('la transaction se clôt quand toutes les tranches sont terminées', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.approveRelease(tx.tranches[0]!.id);
    expect((await school(api)).status).toBe('IN_PROGRESS');
  });
  it('filtres et index de tranche', async () => {
    const { api } = make();
    const all = await api.listTransactions();
    expect(filterTransactions(all, 'ACTIVE').map((t) => t.id)).toEqual(['tx-school', 'tx-rent', 'tx-land']);
    expect(filterTransactions(all, 'REVIEW').map((t) => t.id)).toEqual(['tx-health', 'tx-land']);
    expect(currentTrancheIndex(all.find((t) => t.id === 'tx-rent')!)).toBe(4);
  });
  it('notifie les abonnés à chaque changement', async () => {
    const { api } = make();
    let calls = 0;
    api.subscribe(() => { calls++; });
    const tx = await school(api);
    await api.approveRelease(tx.tranches[0]!.id);
    expect(calls).toBe(1);
  });
});

describe('MockApi — TrustToken et eQR', () => {
  const payT2 = async (api: MockApi) => { const tx = await school(api); await api.payTranche(tx.tranches[1]!.id); return tx.tranches[1]!; };

  it('un jeton existe pour toute tranche active, pas pour une tranche prévue', async () => {
    const { api } = make();
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
  it('toutes les références du jeu de démonstration sont uniques et en 18 hex', async () => {
    const { api } = make();
    const refs = (await api.listTransactions()).flatMap((t) => t.tranches).filter((r) => r.status !== 'PLANNED').map((r) => r.reference);
    expect(refs.every((r) => /^[0-9a-f]{18}$/.test(r ?? ''))).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
  });
  it('getTranche renvoie la transaction et la tranche', async () => {
    const { api } = make();
    const tx = await school(api);
    const r = await api.getTranche(tx.tranches[1]!.id);
    expect(r.tx.id).toBe('tx-school');
    expect(r.tranche.seq).toBe(2);
  });
  it('resolveReference : informations, casse et tirets ignorés', async () => {
    const { api } = make();
    const info = await api.resolveReference('7B31-D0A9-C5E2-4F8A-61');
    expect(info).toMatchObject({ txId: 'tx-school', label: 'Scolarité T1', amountMinor: 300_000, currency: 'XAF', status: 'AWAITING_PAYMENT', used: false, seq: 2, contestHours: 72 });
  });
  it('resolveReference : UNKNOWN_REFERENCE et NOT_A_PARTY', async () => {
    const { api } = make();
    expect(await code(api.resolveReference('ffffffffffffffffff'))).toBe('UNKNOWN_REFERENCE');
    expect(await code(api.resolveReference('court'))).toBe('UNKNOWN_REFERENCE');
    const seed = seedTransactions(T0);
    seed[0]!.parties = ['PROVIDER'];
    const other = new MockApi(() => T0, seed);
    expect(await code(other.resolveReference(seed[0]!.tranches[1]!.reference!))).toBe('NOT_A_PARTY');
    other.setPersona('PROVIDER');
    expect(await code(other.resolveReference(seed[0]!.tranches[1]!.reference!))).toBe('NO_ERROR');
  });
  it('confirmByReference : réservé au prestataire', async () => {
    const { api } = make();
    await payT2(api);
    expect(await code(api.confirmByReference(REF2))).toBe('PROVIDER_ONLY');
  });
  it('confirmByReference : référence inconnue et non partie', async () => {
    const { api } = make();
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference('ffffffffffffffffff'))).toBe('UNKNOWN_REFERENCE');
    const seed = seedTransactions(T0);
    seed[0]!.parties = ['PAYER'];
    const other = new MockApi(() => T0, seed);
    other.setPersona('PROVIDER');
    expect(await code(other.confirmByReference(seed[0]!.tranches[1]!.reference!))).toBe('NOT_A_PARTY');
  });
  it('confirmByReference : tranche non payée', async () => {
    const { api } = make();
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2))).toBe('NOT_PAID');
  });
  it('confirmByReference : mode de déblocage qui n’est pas la confirmation du prestataire', async () => {
    const seed = seedTransactions(T0);
    const agro = seed.find((t) => t.id === 'tx-agro')!;
    agro.status = 'IN_PROGRESS';
    agro.tranches[0]!.status = 'PAID_LOCKED';
    const other = new MockApi(() => T0, seed);
    other.setPersona('PROVIDER');
    expect(await code(other.confirmByReference(agro.tranches[0]!.reference!))).toBe('WRONG_MODE');
  });
  it('confirmByReference : jeton expiré selon l’heure de l’appareil ou l’horloge', async () => {
    const { api, advance } = make();
    await payT2(api);
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2, '2026-11-15T10:00:01.000Z'))).toBe('DEVICE_TIME_INVALID'); // trop loin dans le futur
    advance(24 * 7 + 1);
    expect(await code(api.confirmByReference(REF2))).toBe('TOKEN_EXPIRED');
  });
  it('confirmByReference : heure de l’appareil à plus de 5 minutes dans le futur', async () => {
    const { api } = make();
    await payT2(api);
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2, '2026-11-08T10:06:00.000Z'))).toBe('DEVICE_TIME_INVALID');
    expect(await code(api.confirmByReference(REF2, 'pas une date'))).toBe('DEVICE_TIME_INVALID');
  });
  it('confirmByReference : succès, délai de contestation et usage unique', async () => {
    const { api } = make();
    await payT2(api);
    api.setPersona('PROVIDER');
    const tx = await api.confirmByReference('7B31-D0A9-C5E2-4F8A-61', '2026-11-08T10:04:00.000Z');
    const t2 = tx.tranches[1]!;
    expect(t2.status).toBe('CONFIRMED');
    expect(t2.contestEndsAt).toBe('2026-11-11T10:00:00.000Z');
    const tok = await api.getToken(t2.id);
    expect(tok.usedAt).toBe('2026-11-08T10:00:00.000Z');
    expect(await code(api.confirmByReference(REF2))).toBe('TOKEN_USED');
    expect((await api.resolveReference(REF2)).used).toBe(true);
  });
  it('un échec ne consomme pas le jeton', async () => {
    const { api } = make();
    api.setPersona('PROVIDER');
    expect(await code(api.confirmByReference(REF2))).toBe('NOT_PAID');
    expect((await api.getToken((await school(api)).tranches[1]!.id)).usedAt).toBeUndefined();
  });
  it('durée de validité configurable', async () => {
    const api = new MockApi(() => T0, undefined, { tokenValidityHours: 2 });
    const tx = await api.getTransaction('tx-school');
    expect((await api.getToken(tx.tranches[1]!.id)).expiresAt).toBe('2026-11-08T12:00:00.000Z');
  });
});

describe('parcours complet du mock (démonstration)', () => {
  it('payer, afficher le jeton, confirmer en prestataire, délai de contestation, usage unique', async () => {
    let now = new Date(T0);
    const api = new MockApi(() => now);
    const tx = await api.getTransaction('tx-school');
    const t2 = tx.tranches[1]!;

    // 1. Payeur : le jeton existe déjà (tranche à payer), la tranche passe à « payée ».
    const before = await api.getToken(t2.id);
    expect(before.usedAt).toBeUndefined();
    await api.payTranche(t2.id);
    expect((await api.getTranche(t2.id)).tranche.status).toBe('PAID_LOCKED');
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
    expect(info).toMatchObject({ status: 'PAID_LOCKED', used: false, amountMinor: 300_000 });
    now = new Date(now.getTime() + 5 * 60_000);
    const confirmed = await api.confirmByReference(decoded.reference, now.toISOString());
    const done = confirmed.tranches[1]!;
    expect(done.status).toBe('CONFIRMED');
    expect(done.contestEndsAt).toBe(new Date(now.getTime() + 72 * 3_600_000).toISOString());

    // 3. Usage unique : un second scan est refusé, y compris avec le même QR.
    expect(await code(api.confirmByReference(decoded.reference))).toBe('TOKEN_USED');
    expect((await api.getToken(t2.id)).usedAt).toBe(now.toISOString());

    // 4. À l’échéance du délai, la tranche est débloquée automatiquement.
    now = new Date(now.getTime() + 73 * 3_600_000);
    expect(api.runTimers()).toBeGreaterThanOrEqual(1);
    expect((await api.getTranche(t2.id)).tranche.status).toBe('RELEASED');
  });
});
