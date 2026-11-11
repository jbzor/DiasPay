'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { AuthShell } from '@/components/AuthShell';
import { t } from '@/i18n';
import { browserClient } from '@/lib/supabase/browser';

/** Demande de lien de réinitialisation. Même réponse que l’adresse corresponde à un compte ou non. */
export default function MotDePasseOublie() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  useEffect(() => { setInvalidLink(new URLSearchParams(window.location.search).get('lien') === 'invalide'); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    await browserClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm?suite=/nouveau-mot-de-passe`,
    }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  return (
    <AuthShell title={t('forgot.title')}>
      {invalidLink && !sent ? <p className="banner err" role="alert">{t('reset.invalidLink')}</p> : null}
      {sent ? <p className="banner ok" role="status">{t('forgot.sent')}</p> : (
        <form onSubmit={submit}>
          <p className="muted">{t('forgot.help')}</p>
          <div className="field">
            <label className="field-label" htmlFor="email">{t('login.email')}</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{t('forgot.submit')}</button>
        </form>
      )}
      <Link href="/connexion" className="btn-link">{t('forgot.back')}</Link>
    </AuthShell>
  );
}
