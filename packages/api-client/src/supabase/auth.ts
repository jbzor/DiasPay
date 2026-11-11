import { normalizePhone } from '@diaspay/domain';
import { AuthError, OTP_LENGTH, OTP_RESEND_MS, OTP_TTL_MS } from '../auth';
import type { AuthApi, PrimaryRole, Profile, Session } from '../auth';
import type { DiasPayClient } from './api';
import { toAuthError, unwrapMaybe } from './errors';

/** Préférences propres à l’appareil (la biométrie ne concerne que ce téléphone). */
export interface DevicePrefs {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

const BIOMETRIC_KEY = 'diaspay.biometric';
const PRIMARY_ROLES: readonly string[] = ['PAYER', 'REQUESTER', 'PROVIDER'];

/**
 * AuthApi sur Supabase Auth : connexion par SMS (code à 6 chiffres, valable 300 s : réglage `sms_otp_exp`).
 * Décision D5 : Supabase ne verrouille pas un numéro après 3 codes erronés ; on s’appuie sur sa limite de débit
 * (OTP_LOCKED sur 429) et on ne peut pas afficher le nombre d’essais restants.
 */
export class SupabaseAuth implements AuthApi {
  /** Expiration locale du dernier code demandé, par numéro : distingue OTP_EXPIRED d’OTP_WRONG (Supabase ne le fait pas). */
  private readonly expiries = new Map<string, number>();

  constructor(private readonly sb: DiasPayClient, private readonly prefs: DevicePrefs, private readonly clock: () => number = Date.now) {}

  async requestOtp(raw: string): Promise<{ expiresAt: string; resendAt: string }> {
    const phone = normalizePhone(raw); // PHONE_INVALID avant tout appel réseau
    const { error } = await this.sb.auth.signInWithOtp({ phone });
    if (error) throw toAuthError(error, { step: 'request' });
    const now = this.clock();
    this.expiries.set(phone, now + OTP_TTL_MS);
    return { expiresAt: new Date(now + OTP_TTL_MS).toISOString(), resendAt: new Date(now + OTP_RESEND_MS).toISOString() };
  }

  async verifyOtp(raw: string, code: string): Promise<Session> {
    const phone = normalizePhone(raw);
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) throw new AuthError('OTP_FORMAT', `Le code comporte ${OTP_LENGTH} chiffres`);
    const { data, error } = await this.sb.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error || !data.session) {
      throw toAuthError(error ?? { code: 'otp_expired' }, { step: 'verify', otpExpiresAt: this.expiries.get(phone), now: this.clock() });
    }
    this.expiries.delete(phone);
    return this.load(data.session.user.id, data.session.user.phone);
  }

  /** Profil serveur + préférences de l’appareil → Session de l’application. */
  private async load(userId: string, rawPhone: string | undefined): Promise<Session> {
    const row = unwrapMaybe(await this.sb.from('profiles').select('full_name, country, primary_role, push_enabled').eq('id', userId).maybeSingle(), 'auth.profile');
    const biometric = (await this.prefs.get(BIOMETRIC_KEY)) === '1';
    const fullName = row?.full_name?.trim() ?? '';
    const role = row?.primary_role && PRIMARY_ROLES.includes(row.primary_role) ? (row.primary_role as PrimaryRole) : undefined;
    return {
      userId,
      phone: rawPhone ? `+${rawPhone.replace(/\D/g, '')}` : '',
      // Profil complet seulement si le nom, le pays et le rôle ont été saisis (sinon : écran de profil).
      profile: fullName && row?.country && role ? { fullName, country: row.country, primaryRole: role } : undefined,
      biometricEnabled: biometric,
      pushEnabled: row?.push_enabled ?? true,
    };
  }

  private async requireUser(): Promise<{ id: string; phone?: string }> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    if (!u) throw new AuthError('NOT_AUTHENTICATED', 'Aucune session');
    return { id: u.id, phone: u.phone };
  }

  async saveProfile(profile: Profile): Promise<Session> {
    const u = await this.requireUser();
    const fullName = profile.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2 || !profile.country.trim()) throw new AuthError('PROFILE_INVALID', 'Profil incomplet');
    unwrapMaybe(await this.sb.from('profiles').update({ full_name: fullName, country: profile.country.trim(), primary_role: profile.primaryRole }).eq('id', u.id), 'auth.saveProfile');
    return this.load(u.id, u.phone);
  }

  async setBiometric(enabled: boolean): Promise<Session> {
    return this.setPreferences({ biometricEnabled: enabled });
  }

  async setPreferences(p: { biometricEnabled?: boolean; pushEnabled?: boolean }): Promise<Session> {
    const u = await this.requireUser();
    if (p.biometricEnabled !== undefined) await this.prefs.set(BIOMETRIC_KEY, p.biometricEnabled ? '1' : null);
    if (p.pushEnabled !== undefined) unwrapMaybe(await this.sb.from('profiles').update({ push_enabled: p.pushEnabled }).eq('id', u.id), 'auth.preferences');
    return this.load(u.id, u.phone);
  }

  /** Session restaurée depuis le stockage chiffré ; hors connexion, null n’est jamais renvoyé à tort (voir l’appelant). */
  async getSession(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    if (!u) return null;
    return this.load(u.id, u.phone);
  }

  async signOut(): Promise<void> {
    // Déconnexion locale même hors connexion ; les abonnements temps réel sont fermés par l’application.
    await this.sb.auth.signOut({ scope: 'local' });
    await this.sb.removeAllChannels();
    await this.prefs.set(BIOMETRIC_KEY, null);
  }
}
