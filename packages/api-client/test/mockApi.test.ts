import { describe, expect, it } from 'vitest';
import { DomainError } from '@diaspay/domain';
import { MockApi, currentTrancheIndex, filterTransactions, lockedFunds, nextPayment } from '../src';

const T0 = new Date('2026-11-08T10:00:00Z');
const make = () => { let now = new Date(T0); const api = new MockApi(() => now); return { api, advance: (h: number) => { now = new Date(now.getTime() + h * 3_600_000); } }; };
const school = async (api: MockApi) => api.getTransaction('tx-school');

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
  it('seul le prestataire confirme par scan, puis le délai court', async () => {
    const { api } = make();
    const tx = await school(api);
    await api.payTranche(tx.tranches[1]!.id);
    await expect(api.confirmByReference('7B31-D0A9-C5E2')).rejects.toThrow(/prestataire/);
    api.setPersona('PROVIDER');
    await api.confirmByReference('7B31-D0A9-C5E2');
    const t2 = (await school(api)).tranches[1]!;
    expect(t2.status).toBe('CONFIRMED');
    expect(new Date(t2.contestEndsAt!).toISOString()).toBe('2026-11-11T10:00:00.000Z');
    await expect(api.confirmByReference('7B31-D0A9-C5E2')).rejects.toThrow(/déjà traitée/);
  });
  it('référence inconnue', async () => {
    const { api } = make();
    api.setPersona('PROVIDER');
    await expect(api.confirmByReference('XXXX')).rejects.toThrow(/inconnue/);
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
