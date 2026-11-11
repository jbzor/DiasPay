'use client';
import { t } from '@/i18n';
import { markSigningOut } from '@/lib/signout';
import { browserClient } from '@/lib/supabase/browser';

/** Déconnexion : session locale fermée, abonnements temps réel coupés, retour à la connexion. */
export function SignOutButton({ className = 'btn-link' }: { className?: string }) {
  async function signOut() {
    markSigningOut();
    const sb = browserClient();
    await sb.removeAllChannels();
    await sb.auth.signOut({ scope: 'local' });
    window.location.assign('/connexion?motif=deconnecte');
  }
  return <button type="button" className={className} onClick={signOut}>{t('nav.signOut')}</button>;
}
