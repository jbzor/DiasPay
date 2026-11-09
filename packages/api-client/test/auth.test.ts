import { describe, expect, it } from 'vitest';
import { DomainError } from '@diaspay/domain';
import { AuthError, MOCK_OTP_CODE, MockAuth, composePhone, isValidPhone, normalizePhone } from '../src';

const T0 = new Date('2026-11-09T10:00:00Z');
const PHONE = '+33 6 12 34 56 78';
const E164 = '+33612345678';

function make(opts: { code?: string | null } = {}) {
  let now = new Date(T0);
  const auth = new MockAuth({ clock: () => now, ...opts });
  return { auth, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, now: () => now };
}
const MIN = 60_000;

async function codeOf(p: Promise<unknown>): Promise<AuthError> {
  try { await p; } catch (e) { return e as AuthError; }
  throw new Error('aucune erreur levée');
}

describe('normalisation du numéro', () => {
  it('accepte espaces, points, tirets et le préfixe 00', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe(E164);
    expect(normalizePhone('0033.6.12.34.56.78')).toBe(E164);
    expect(normalizePhone('+237 6-99-00-11-22')).toBe('+237699001122');
  });
  it('assemble indicatif et numéro national en retirant le 0 de tête', () => {
    expect(composePhone('+33', '06 12 34 56 78')).toBe(E164);
    expect(composePhone('237', '699001122')).toBe('+237699001122');
    expect(isValidPhone('+33', '0612345678')).toBe(true);
    expect(isValidPhone('+33', '12')).toBe(false);
  });
  it('refuse un numéro invalide (PHONE_INVALID)', async () => {
    const { auth } = make();
    for (const bad of ['0612345678', '+33', '+0612345678', 'abc', '+33 6 12 34 56 78 90 12 34']) {
      const e = await codeOf(auth.requestOtp(bad));
      expect(e).toBeInstanceOf(DomainError);
      expect(e.code).toBe('PHONE_INVALID');
    }
  });
});

describe('MockAuth', () => {
  it('connecte avec le bon code', async () => {
    const { auth } = make();
    const r = await auth.requestOtp(PHONE);
    expect(r.expiresAt).toBe(new Date(T0.getTime() + 5 * MIN).toISOString());
    expect(r.resendAt).toBe(new Date(T0.getTime() + MIN).toISOString());
    const s = await auth.verifyOtp(PHONE, MOCK_OTP_CODE);
    expect(s).toMatchObject({ phone: E164, biometricEnabled: false });
    expect(s.profile).toBeUndefined();
    expect(await auth.getSession()).toEqual(s);
  });

  it('indique les essais restants sur un mauvais code', async () => {
    const { auth } = make();
    await auth.requestOtp(PHONE);
    const e1 = await codeOf(auth.verifyOtp(PHONE, '000000'));
    expect(e1.code).toBe('OTP_WRONG');
    expect(e1.details.remaining).toBe(2);
    const e2 = await codeOf(auth.verifyOtp(PHONE, '000001'));
    expect(e2.details.remaining).toBe(1);
  });

  it('verrouille 15 minutes après trois échecs, puis déverrouille', async () => {
    const { auth, advance } = make();
    await auth.requestOtp(PHONE);
    await codeOf(auth.verifyOtp(PHONE, '000000'));
    await codeOf(auth.verifyOtp(PHONE, '000000'));
    const lock = await codeOf(auth.verifyOtp(PHONE, '000000'));
    expect(lock.code).toBe('OTP_LOCKED');
    expect(lock.details.lockedUntil).toBe(new Date(T0.getTime() + 15 * MIN).toISOString());
    // Même le bon code et une nouvelle demande sont refusés pendant le verrouillage.
    expect((await codeOf(auth.verifyOtp(PHONE, MOCK_OTP_CODE))).code).toBe('OTP_LOCKED');
    expect((await codeOf(auth.requestOtp(PHONE))).code).toBe('OTP_LOCKED');
    advance(15 * MIN - 1);
    expect((await codeOf(auth.requestOtp(PHONE))).code).toBe('OTP_LOCKED');
    advance(1);
    await auth.requestOtp(PHONE);
    const e = await codeOf(auth.verifyOtp(PHONE, '000000'));
    expect(e.details.remaining).toBe(2); // compteur remis à zéro
    expect((await auth.verifyOtp(PHONE, MOCK_OTP_CODE)).phone).toBe(E164);
  });

  it('un renvoi ne remet pas le compteur d’échecs à zéro', async () => {
    const { auth, advance } = make();
    await auth.requestOtp(PHONE);
    await codeOf(auth.verifyOtp(PHONE, '000000'));
    await codeOf(auth.verifyOtp(PHONE, '000000'));
    advance(MIN);
    await auth.requestOtp(PHONE);
    expect((await codeOf(auth.verifyOtp(PHONE, '000000'))).code).toBe('OTP_LOCKED');
  });

  it('signale un code expiré après 5 minutes', async () => {
    const { auth, advance } = make();
    await auth.requestOtp(PHONE);
    advance(5 * MIN);
    expect((await codeOf(auth.verifyOtp(PHONE, MOCK_OTP_CODE))).code).toBe('OTP_EXPIRED');
  });

  it('refuse un renvoi avant 60 secondes', async () => {
    const { auth, advance } = make();
    await auth.requestOtp(PHONE);
    advance(59_999);
    const e = await codeOf(auth.requestOtp(PHONE));
    expect(e.code).toBe('OTP_RESEND_TOO_SOON');
    expect(e.details.resendAt).toBe(new Date(T0.getTime() + MIN).toISOString());
    advance(1);
    await expect(auth.requestOtp(PHONE)).resolves.toBeTruthy();
  });

  it('refuse un code mal formé et un code jamais demandé', async () => {
    const { auth } = make();
    expect((await codeOf(auth.verifyOtp(PHONE, MOCK_OTP_CODE))).code).toBe('OTP_NOT_REQUESTED');
    await auth.requestOtp(PHONE);
    expect((await codeOf(auth.verifyOtp(PHONE, '12a456'))).code).toBe('OTP_FORMAT');
  });

  it('accepte uniquement le code généré quand le code de simulation est désactivé', async () => {
    const { auth } = make({ code: null });
    await auth.requestOtp(PHONE);
    const code = auth.peekCode(PHONE)!;
    expect(code).toMatch(/^\d{6}$/);
    if (code !== MOCK_OTP_CODE) expect((await codeOf(auth.verifyOtp(PHONE, MOCK_OTP_CODE))).code).toBe('OTP_WRONG');
    expect((await auth.verifyOtp(PHONE, code)).phone).toBe(E164);
  });

  it('enregistre le profil et le retrouve à la reconnexion', async () => {
    const { auth } = make();
    expect((await codeOf(auth.saveProfile({ fullName: 'Marie', country: 'FR', primaryRole: 'PAYER' }))).code).toBe('NOT_AUTHENTICATED');
    await auth.requestOtp(PHONE);
    await auth.verifyOtp(PHONE, MOCK_OTP_CODE);
    expect((await codeOf(auth.saveProfile({ fullName: ' ', country: 'FR', primaryRole: 'PAYER' }))).code).toBe('PROFILE_INVALID');
    const s = await auth.saveProfile({ fullName: '  Marie   Ngo ', country: 'FR', primaryRole: 'PAYER' });
    expect(s.profile).toEqual({ fullName: 'Marie Ngo', country: 'FR', primaryRole: 'PAYER' });
    await auth.signOut();
    await auth.requestOtp(PHONE);
    expect((await auth.verifyOtp(PHONE, MOCK_OTP_CODE)).profile?.fullName).toBe('Marie Ngo');
  });

  it('active et désactive la biométrie', async () => {
    const { auth } = make();
    expect((await codeOf(auth.setBiometric(true))).code).toBe('NOT_AUTHENTICATED');
    await auth.requestOtp(PHONE);
    await auth.verifyOtp(PHONE, MOCK_OTP_CODE);
    expect((await auth.setBiometric(true)).biometricEnabled).toBe(true);
    expect((await auth.setBiometric(false)).biometricEnabled).toBe(false);
  });

  it('déconnecte', async () => {
    const { auth } = make();
    await auth.requestOtp(PHONE);
    await auth.verifyOtp(PHONE, MOCK_OTP_CODE);
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });

  it('renvoie null sans session, et restaure une session fournie', async () => {
    expect(await make().auth.getSession()).toBeNull();
    const restored = new MockAuth({ session: { userId: 'u-1', phone: E164, biometricEnabled: true } });
    expect((await restored.getSession())?.biometricEnabled).toBe(true);
  });
});
