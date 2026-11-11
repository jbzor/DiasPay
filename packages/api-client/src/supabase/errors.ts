import { DomainError, isErrorCode } from '@diaspay/domain';
import { ApiError } from '../need';
import { AuthError } from '../auth';

/** Journal des erreurs inattendues : jamais affichées brutes, toujours tracées. Remplaçable (Sentry…). */
export type ErrorLogger = (context: string, error: unknown) => void;
let logger: ErrorLogger = (context, error) => {
  // eslint-disable-next-line no-console
  console.warn(`[diaspay] ${context}`, error);
};
export function setErrorLogger(l: ErrorLogger): void { logger = l; }

/** Forme commune des erreurs PostgREST / Storage / Auth. */
interface RawError { code?: string; message?: string; details?: string | null; hint?: string | null; status?: number; name?: string }

function isNetworkError(e: RawError): boolean {
  const m = `${e.name ?? ''} ${e.message ?? ''}`;
  return /Network request failed|Failed to fetch|fetch failed|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(m)
    || e.name === 'AuthRetryableFetchError';
}

/** Détails exploitables par l’écran, tirés de « detail » (format fixé par 0005). */
function detailsFor(code: string, detail: string | null | undefined): Record<string, unknown> {
  if (!detail) return {};
  if (code === 'DOCUMENT_REQUIRED') return { kind: detail };
  if (code === 'PLAN_SUM_MISMATCH') {
    try { return JSON.parse(detail) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

/**
 * Toute erreur du serveur devient une DomainError à code stable, lu dans « hint » (errcode P0001).
 * Une erreur réseau devient OFFLINE ; toute autre erreur sans code reconnu devient UNEXPECTED, journalisée.
 */
export function toDomainError(error: unknown, context = 'supabase'): DomainError {
  if (error instanceof DomainError) return error;
  const e = (error ?? {}) as RawError;
  if (e.hint && isErrorCode(e.hint)) return new ApiError(e.hint, e.message ?? e.hint, detailsFor(e.hint, e.details));
  if (isNetworkError(e)) return new ApiError('OFFLINE', 'Hors connexion');
  // Droit refusé par RLS sur une écriture directe : traité comme introuvable, sans divulguer l’existence de la ligne.
  if (e.code === '42501') { logger(context, error); return new ApiError('NOT_FOUND', 'Accès refusé'); }
  logger(context, error);
  return new ApiError('UNEXPECTED', 'Erreur inattendue');
}

/** Lève l’erreur convertie si la réponse Supabase en porte une ; une réponse vide est inattendue. */
export function unwrap<R extends { data: unknown; error: unknown }>(res: R, context: string): NonNullable<R['data']> {
  if (res.error) throw toDomainError(res.error, context);
  if (res.data === null) { logger(context, 'réponse vide'); throw new ApiError('UNEXPECTED', 'Réponse vide'); }
  return res.data as NonNullable<R['data']>;
}

/** Comme unwrap, mais une absence de ligne (maybeSingle, jsonb null) est une réponse normale. */
export function unwrapMaybe<R extends { data: unknown; error: unknown }>(res: R, context: string): NonNullable<R['data']> | null {
  if (res.error) throw toDomainError(res.error, context);
  return (res.data ?? null) as NonNullable<R['data']> | null;
}

/**
 * Erreurs de Supabase Auth → codes OTP de l’application (décision D5).
 * Supabase ne distingue pas un code erroné d’un code expiré (`otp_expired` dans les deux cas) et ne
 * compte pas les essais : l’application tranche avec l’heure d’expiration locale, sans nombre d’essais restants.
 */
export function toAuthError(error: unknown, ctx: { step: 'request' | 'verify'; otpExpiresAt?: number; now?: number }): DomainError {
  const e = (error ?? {}) as RawError;
  const now = ctx.now ?? Date.now();
  switch (e.code) {
    case 'otp_expired':
    case 'invalid_credentials':
      if (ctx.otpExpiresAt !== undefined && now >= ctx.otpExpiresAt) return new AuthError('OTP_EXPIRED', 'Le code a expiré');
      return new AuthError('OTP_WRONG', 'Code incorrect');
    case 'over_sms_send_rate_limit':
      return new AuthError('OTP_RESEND_TOO_SOON', 'Patientez avant de renvoyer un code');
    case 'over_request_rate_limit':
      return new AuthError('OTP_LOCKED', 'Trop de tentatives');
    case 'validation_failed':
    case 'phone_provider_disabled':
      if (ctx.step === 'request' && /phone/i.test(e.message ?? '')) return new AuthError('PHONE_INVALID', 'Numéro invalide');
      break;
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'bad_jwt':
      return new AuthError('NOT_AUTHENTICATED', 'Session expirée');
    default:
      break;
  }
  if (e.status === 429) return new AuthError('OTP_LOCKED', 'Trop de tentatives');
  if (isNetworkError(e)) return new ApiError('OFFLINE', 'Hors connexion');
  logger(`auth.${ctx.step}`, error);
  return new ApiError('UNEXPECTED', 'Erreur inattendue');
}
