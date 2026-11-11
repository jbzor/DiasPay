import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Session } from '@diaspay/api-client';
import type { Locale } from '../i18n/messages';

// Clés SecureStore : caractères alphanumériques, « . », « - » et « _ » uniquement.
const KEYS = {
  session: 'diaspay.session',
  onboardingSeen: 'diaspay.onboardingSeen',
  locale: 'diaspay.locale',
} as const;

/** Repli en mémoire : web (SecureStore n’y existe pas) ou appareil sans trousseau disponible. */
const memory = new Map<string, string>();

let secure: Promise<boolean> | null = null;
function canUseSecure(): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(false);
  secure ??= SecureStore.isAvailableAsync().catch(() => false);
  return secure;
}

async function read(key: string): Promise<string | null> {
  if (await canUseSecure()) {
    try { return await SecureStore.getItemAsync(key); } catch { /* repli mémoire */ }
  }
  return memory.get(key) ?? null;
}

async function write(key: string, value: string | null): Promise<void> {
  if (value === null) memory.delete(key); else memory.set(key, value);
  if (!(await canUseSecure())) return;
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // La valeur reste en mémoire pour la session en cours.
  }
}

function isSession(v: unknown): v is Session {
  const s = v as Session | null;
  return !!s && typeof s.userId === 'string' && typeof s.phone === 'string' && typeof s.biometricEnabled === 'boolean';
}

export async function loadSession(): Promise<Session | null> {
  const raw = await read(KEYS.session);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
export const saveSession = (s: Session | null) => write(KEYS.session, s ? JSON.stringify(s) : null);

export const loadOnboardingSeen = async () => (await read(KEYS.onboardingSeen)) === '1';
export const saveOnboardingSeen = () => write(KEYS.onboardingSeen, '1');

export async function loadLocale(): Promise<Locale | null> {
  const v = await read(KEYS.locale);
  return v === 'fr' || v === 'en' ? v : null;
}
export const saveLocale = (l: Locale) => write(KEYS.locale, l);

/** Préférences de l’appareil (biométrie…) : même stockage que la session locale. */
export const devicePrefs = {
  get: (key: string) => read(key),
  set: (key: string, value: string | null) => write(key, value),
};
