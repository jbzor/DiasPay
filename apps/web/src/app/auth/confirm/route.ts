import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { safeNext } from '@/lib/access';
import { serverClient } from '@/lib/supabase/server';

/**
 * Retour d’un lien reçu par e-mail (réinitialisation du mot de passe) : échange du code PKCE contre une session,
 * puis redirection interne. Un lien invalide ou expiré renvoie vers la demande d’un nouveau lien.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.nextUrl.searchParams.get('suite'));
  if (code) {
    const supabase = await serverClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL('/mot-de-passe-oublie?lien=invalide', request.url));
}
