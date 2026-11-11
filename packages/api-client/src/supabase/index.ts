// Seul point d’entrée de supabase-js : les écrans n’importent jamais @supabase/supabase-js.
export { SupabaseApi, fetchUploader, BUCKET, VIEW_URL_TTL_S } from './api';
export type { DiasPayClient, FileUploader, UploadFile, UploadTarget, SupabaseApiOptions } from './api';
export { SupabaseAuth } from './auth';
export type { DevicePrefs } from './auth';
export { createDiasPayClient, assertPublicKey } from './client';
export type { ClientConfig, SessionStorage } from './client';
export { setErrorLogger, toAuthError, toDomainError } from './errors';
export type { ErrorLogger } from './errors';
export * as convert from './convert';
