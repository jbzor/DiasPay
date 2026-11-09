import { DomainError } from '@diaspay/domain';

export type PrimaryRole = 'PAYER' | 'REQUESTER' | 'PROVIDER';

export interface Profile {
  fullName: string;
  country: string;
  primaryRole: PrimaryRole;
}

export interface Session {
  userId: string;
  phone: string;
  profile?: Profile;
  biometricEnabled: boolean;
}

/** Contrat d’authentification. MockAuth l’implémente ; Supabase Auth le remplacera (lot 4). */
export interface AuthApi {
  requestOtp(phone: string): Promise<{ expiresAt: string; resendAt: string }>;
  verifyOtp(phone: string, code: string): Promise<Session>;
  saveProfile(profile: Profile): Promise<Session>;
  setBiometric(enabled: boolean): Promise<Session>;
  getSession(): Promise<Session | null>;
  signOut(): Promise<void>;
}

/** Code OTP accepté par la simulation. Passer `code: null` à MockAuth pour le désactiver (code aléatoire). */
export const MOCK_OTP_CODE = '123456';
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_RESEND_MS = 60_000;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_LOCK_MS = 15 * 60_000;

export type AuthErrorCode =
  | 'PHONE_INVALID' | 'OTP_FORMAT' | 'OTP_NOT_REQUESTED' | 'OTP_WRONG' | 'OTP_EXPIRED' | 'OTP_LOCKED'
  | 'OTP_RESEND_TOO_SOON' | 'NOT_AUTHENTICATED' | 'PROFILE_INVALID';

/** Erreur d’authentification : une DomainError avec un code stable et des détails exploitables par l’écran. */
export class AuthError extends DomainError {
  constructor(
    code: AuthErrorCode,
    message: string,
    public readonly details: { remaining?: number; lockedUntil?: string; resendAt?: string } = {},
  ) {
    super(code, message);
  }
}

/**
 * Normalise un numéro au format international E.164 (+ suivi de 8 à 15 chiffres).
 * Accepte espaces, points, tirets, parenthèses et le préfixe 00. Un numéro sans indicatif est refusé.
 */
export function normalizePhone(raw: string): string {
  const compact = raw.trim().replace(/[\s.\-()]/g, '');
  const intl = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(intl)) throw new AuthError('PHONE_INVALID', 'Numéro de téléphone invalide');
  return intl;
}

/** Assemble indicatif et numéro local (le 0 de tête du numéro national est retiré : +33 06… → +336…). */
export function composePhone(dialCode: string, local: string): string {
  const dial = dialCode.trim().replace(/^00/, '+');
  const national = local.replace(/[\s.\-()]/g, '').replace(/^0+/, '');
  return normalizePhone(`${dial.startsWith('+') ? dial : `+${dial}`}${national}`);
}

export function isValidPhone(dialCode: string, local: string): boolean {
  try {
    composePhone(dialCode, local);
    return local.replace(/\D/g, '').length >= 6;
  } catch {
    return false;
  }
}

interface OtpState {
  code?: string;
  expiresAt?: number;
  resendAt?: number;
  failures: number;
  lockedUntil?: number;
}

export interface MockAuthOptions {
  clock?: () => Date;
  /** Code accepté. `null` : code aléatoire non communiqué (lisible par `peekCode` en test). */
  code?: string | null;
  /** Session à restaurer (lue depuis le stockage de l’appareil). */
  session?: Session | null;
}

export class MockAuth implements AuthApi {
  private readonly clock: () => Date;
  private readonly fixedCode: string | null;
  private session: Session | null;
  private readonly otps = new Map<string, OtpState>();
  /** Annuaire simulé : un utilisateur qui se reconnecte retrouve son profil. */
  private readonly users = new Map<string, Omit<Session, 'phone' | 'userId'>>();

  constructor(opts: MockAuthOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.fixedCode = opts.code === undefined ? MOCK_OTP_CODE : opts.code;
    this.session = opts.session ?? null;
    if (this.session) this.remember(this.session);
  }

  private now(): number { return this.clock().getTime(); }
  private iso(ms: number): string { return new Date(ms).toISOString(); }
  private remember(s: Session): void { this.users.set(s.phone, { profile: s.profile, biometricEnabled: s.biometricEnabled }); }

  private stateFor(phone: string): OtpState {
    let st = this.otps.get(phone);
    if (!st) { st = { failures: 0 }; this.otps.set(phone, st); }
    if (st.lockedUntil !== undefined && this.now() >= st.lockedUntil) {
      st.lockedUntil = undefined;
      st.failures = 0;
    }
    return st;
  }

  private assertNotLocked(st: OtpState): void {
    if (st.lockedUntil !== undefined) {
      throw new AuthError('OTP_LOCKED', 'Trop de codes erronés', { lockedUntil: this.iso(st.lockedUntil) });
    }
  }

  async requestOtp(raw: string) {
    const phone = normalizePhone(raw);
    const st = this.stateFor(phone);
    this.assertNotLocked(st);
    const now = this.now();
    if (st.resendAt !== undefined && now < st.resendAt) {
      throw new AuthError('OTP_RESEND_TOO_SOON', 'Patientez avant de renvoyer un code', { resendAt: this.iso(st.resendAt) });
    }
    st.code = this.fixedCode ?? String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    st.expiresAt = now + OTP_TTL_MS;
    st.resendAt = now + OTP_RESEND_MS;
    return { expiresAt: this.iso(st.expiresAt), resendAt: this.iso(st.resendAt) };
  }

  async verifyOtp(raw: string, code: string) {
    const phone = normalizePhone(raw);
    const st = this.stateFor(phone);
    this.assertNotLocked(st);
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) throw new AuthError('OTP_FORMAT', `Le code comporte ${OTP_LENGTH} chiffres`);
    if (st.code === undefined || st.expiresAt === undefined) throw new AuthError('OTP_NOT_REQUESTED', 'Aucun code envoyé à ce numéro');
    if (this.now() >= st.expiresAt) {
      st.code = undefined;
      throw new AuthError('OTP_EXPIRED', 'Le code a expiré');
    }
    if (code !== st.code) {
      st.failures += 1;
      if (st.failures >= OTP_MAX_ATTEMPTS) {
        st.lockedUntil = this.now() + OTP_LOCK_MS;
        st.code = undefined;
        st.expiresAt = undefined;
        st.resendAt = undefined;
        throw new AuthError('OTP_LOCKED', 'Trop de codes erronés', { lockedUntil: this.iso(st.lockedUntil) });
      }
      throw new AuthError('OTP_WRONG', 'Code incorrect', { remaining: OTP_MAX_ATTEMPTS - st.failures });
    }
    this.otps.delete(phone);
    const known = this.users.get(phone);
    this.session = {
      userId: `u-${phone.slice(1)}`,
      phone,
      profile: known?.profile,
      biometricEnabled: known?.biometricEnabled ?? false,
    };
    this.remember(this.session);
    return { ...this.session };
  }

  private requireSession(): Session {
    if (!this.session) throw new AuthError('NOT_AUTHENTICATED', 'Aucune session');
    return this.session;
  }

  async saveProfile(profile: Profile) {
    const s = this.requireSession();
    const fullName = profile.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2 || !profile.country.trim()) throw new AuthError('PROFILE_INVALID', 'Profil incomplet');
    this.session = { ...s, profile: { ...profile, fullName } };
    this.remember(this.session);
    return { ...this.session };
  }

  async setBiometric(enabled: boolean) {
    const s = this.requireSession();
    this.session = { ...s, biometricEnabled: enabled };
    this.remember(this.session);
    return { ...this.session };
  }

  async getSession() {
    return this.session ? { ...this.session } : null;
  }

  async signOut() {
    this.session = null;
  }

  /** Test uniquement : code en attente pour un numéro. */
  peekCode(raw: string): string | undefined {
    return this.otps.get(normalizePhone(raw))?.code;
  }
}
