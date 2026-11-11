'use client';
import { useState } from 'react';

import { AuthShell } from '@/components/AuthShell';
import { t } from '@/i18n';
import { browserClient } from '@/lib/supabase/browser';

const MIN_LENGTH = 12;

/** Choix d’un nouveau mot de passe (session ouverte par le lien reçu). */
export default function NouveauMotDePasse() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < MIN_LENGTH) { setError(t('reset.tooShort')); return; }
    if (pw !== pw2) { setError(t('reset.mismatch')); return; }
    setBusy(true);
    const sb = browserClient();
    const { error: err } = await sb.auth.updateUser({ password: pw });
    if (err) { setBusy(false); setError(t('reset.invalidLink')); return; }
    await sb.auth.signOut();
    window.location.assign('/connexion?motif=mot-de-passe');
  }

  return (
    <AuthShell title={t('reset.title')}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="pw">{t('reset.password')}</label>
          <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="pw-help" required autoFocus />
          <span id="pw-help" className="field-help">{t('reset.tooShort')}</span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pw2">{t('reset.confirm')}</label>
          <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </div>
        {error ? <p className="banner err" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{t('reset.submit')}</button>
      </form>
    </AuthShell>
  );
}
