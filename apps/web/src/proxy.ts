import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@diaspay/api-client';

import { decideAccess } from '@/lib/access';
import type { Aal, PlatformRole } from '@/lib/access';
import { publicEnv } from '@/lib/env';
import { buildCsp, newNonce } from '@/lib/security';

/**
 * Proxy (Next.js 16, ex-« middleware ») : à chaque navigation,
 *  1. pose une CSP stricte avec un nonce propre à la requête ;
 *  2. rafraîchit la session Supabase (cookies) ;
 *  3. applique les règles d’accès (lib/access.ts) : connexion, rôle VALIDATOR ou ADMIN, second facteur, pages
 *     réservées aux administrateurs.
 * La base applique de son côté les mêmes refus (RLS, is_validator(), is_admin()).
 */
export async function proxy(request: NextRequest) {
  const { url, anonKey } = publicEnv();
  const nonce = newNonce();
  const csp = buildCsp(nonce, url, process.env.NODE_ENV === 'development');

  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);
  const pending: Array<{ name: string; value: string; options: Parameters<NextResponse['cookies']['set']>[2] }> = [];
  const cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const c of list) { request.cookies.set(c.name, c.value); pending.push(c); }
        reqHeaders.set('cookie', request.cookies.toString());
        Object.assign(cacheHeaders, headers);
      },
    },
  });

  // getClaims vérifie le jeton (signature ou serveur d’authentification) : jamais getSession côté serveur.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  let user: Parameters<typeof decideAccess>[0]['user'] = null;
  let requireMfa = false;
  if (claims?.sub) {
    const [profile, config, aal] = await Promise.all([
      supabase.from('profiles').select('platform_role').eq('id', claims.sub).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'require_staff_mfa').maybeSingle(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    requireMfa = config.data?.value === 'true';
    user = {
      role: (profile.data?.platform_role ?? 'USER') as PlatformRole,
      aal: (claims.aal === 'aal2' ? 'aal2' : 'aal1') as Aal,
      nextAal: (aal.data?.nextLevel === 'aal2' ? 'aal2' : 'aal1') as Aal,
    };
  }

  const decision = decideAccess({ path: request.nextUrl.pathname, user, requireMfa });
  const response = decision.kind === 'redirect'
    ? NextResponse.redirect(new URL(decision.to, request.url))
    : NextResponse.next({ request: { headers: reqHeaders } });
  for (const c of pending) response.cookies.set(c.name, c.value, c.options);
  for (const [k, v] of Object.entries(cacheHeaders)) response.headers.set(k, v);
  response.headers.set('Content-Security-Policy', csp);
  // Pages du personnel : jamais en cache partagé.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
