/**
 * Web : SecureStore n’existe pas. La session est gardée dans localStorage (comportement par défaut de
 * supabase-js dans un navigateur) ; la version web sert à la démonstration et aux captures, pas à la production.
 */
const mem = new Map<string, string>();
const ls = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export const sessionStorage = {
  async getItem(key: string) { return ls()?.getItem(key) ?? mem.get(key) ?? null; },
  async setItem(key: string, value: string) { mem.set(key, value); try { ls()?.setItem(key, value); } catch { /* mémoire seule */ } },
  async removeItem(key: string) { mem.delete(key); try { ls()?.removeItem(key); } catch { /* mémoire seule */ } },
};
