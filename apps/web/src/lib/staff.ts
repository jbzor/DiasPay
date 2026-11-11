import 'server-only';
import { redirect } from 'next/navigation';

import { decideAccess } from './access';
import type { Aal, PlatformRole } from './access';
import { serverClient } from './supabase/server';

export interface Staff { id: string; name: string; email: string; role: 'VALIDATOR' | 'ADMIN' }

/**
 * Membre du personnel connecté, vérifié côté serveur (seconde barrière après le proxy, qui ne voit pas les
 * préchargements). Redirige selon les mêmes règles d’accès que le proxy.
 */
export async function requireStaff(path: string): Promise<Staff> {
  const supabase = await serverClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect(`/connexion?suite=${encodeURIComponent(path)}`);
  const [profile, config, aal] = await Promise.all([
    supabase.from('profiles').select('full_name, platform_role').eq('id', claims.sub).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', 'require_staff_mfa').maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const role = (profile.data?.platform_role ?? 'USER') as PlatformRole;
  const decision = decideAccess({
    path,
    requireMfa: config.data?.value === 'true',
    user: { role, aal: (claims.aal === 'aal2' ? 'aal2' : 'aal1') as Aal, nextAal: (aal.data?.nextLevel === 'aal2' ? 'aal2' : 'aal1') as Aal },
  });
  if (decision.kind === 'redirect') redirect(decision.to);
  return { id: claims.sub, name: profile.data?.full_name?.trim() || String(claims.email ?? ''), email: String(claims.email ?? ''), role: role as Staff['role'] };
}
