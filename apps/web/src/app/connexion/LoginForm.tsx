'use client';
import { useState } from 'react';
import Link from 'next/link';

import { t } from '@/i18n';
import { safeNext } from '@/lib/access';
import { browserClient } from '@/lib/supabase/browser';

/**
 * Connexion du personnel : adresse e-mail et mot de passe (décision D7). Le message d’échec est le même que le
 * compte existe ou non. Le proxy décide ensuite : second facteur, accès refusé ou bureau de contrôle.
 */
export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError(t('login.missing')); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await browserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setBusy(false);
      setError(err.status === 429 || err.code === 'over_request_rate_limit' ? t('login.rateLimited')
        : err.status && err.status >= 500 || err.name === 'AuthRetryableFetchError' ? t('login.unavailable')
        : t('login.invalid'));
      return;
    }
    // Navigation complète : le proxy relit la session et applique les règles d’accès.
    window.location.assign(safeNext(next));
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby={error ? 'login-error' : undefined}>
      <div className="field">
        <label className="field-label" htmlFor="email">{t('login.email')}</label>
        <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined} required autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="password">{t('login.password')}</label>
        <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined} required />
      </div>
      {error ? <p id="login-error" className="banner err" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? t('login.submitting') : t('login.submit')}</button>
      <Link href="/mot-de-passe-oublie" className="btn-link">{t('login.forgot')}</Link>
    </form>
  );
}
