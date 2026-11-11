'use client';
import { useEffect, useState } from 'react';

import { AuthShell } from '@/components/AuthShell';
import { SignOutButton } from '@/components/SignOutButton';
import { t } from '@/i18n';
import { HOME } from '@/lib/access';
import { browserClient } from '@/lib/supabase/browser';

type State =
  | { kind: 'loading' }
  | { kind: 'verify'; factorId: string }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'failed' };

/**
 * Second facteur (TOTP, décision D7). Facteur déjà vérifié : saisie du code. Premier accès : inscription
 * (QR code fourni par Supabase Auth, clé en clair en secours), puis vérification d’un premier code.
 * Une vérification réussie élève la session au niveau aal2 (cookies mis à jour), exigé par la base quand
 * app_config.require_staff_mfa = 'true'.
 */
export default function SecondFacteur() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mfa = browserClient().auth.mfa;
      const { data, error: err } = await mfa.listFactors();
      if (err) { if (!cancelled) setState({ kind: 'failed' }); return; }
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) { if (!cancelled) setState({ kind: 'verify', factorId: verified.id }); return; }
      // Inscription interrompue : on repart d’un facteur neuf.
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status === 'unverified')) await mfa.unenroll({ factorId: f.id });
      const res = await mfa.enroll({ factorType: 'totp', friendlyName: `Bureau de contrôle ${new Date().toISOString().slice(0, 10)}` });
      if (cancelled) return;
      if (res.error) { setState({ kind: 'failed' }); return; }
      setState({ kind: 'enroll', factorId: res.data.id, qr: res.data.totp.qr_code, secret: res.data.totp.secret });
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind !== 'verify' && state.kind !== 'enroll') return;
    if (!/^\d{6}$/.test(code)) { setError(t('mfa.format')); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await browserClient().auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
    if (err) { setBusy(false); setError(t('mfa.wrong')); setCode(''); return; }
    window.location.assign(HOME);
  }

  const form = (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor="code">{t('mfa.code')}</label>
        <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={error ? true : undefined} autoFocus required />
      </div>
      {error ? <p className="banner err" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? t('mfa.verifying') : t('mfa.verify')}</button>
    </form>
  );

  return (
    <AuthShell title={state.kind === 'enroll' ? t('mfa.enrollTitle') : t('mfa.title')}>
      {state.kind === 'loading' ? <p className="muted" role="status">{t('common.loading')}</p> : null}
      {state.kind === 'failed' ? <p className="banner err" role="alert">{t('mfa.enrollError')}</p> : null}
      {state.kind === 'verify' ? <><p className="muted">{t('mfa.help')}</p>{form}</> : null}
      {state.kind === 'enroll' ? (
        <>
          <p className="muted">{t('mfa.enrollHelp')}</p>
          {/* QR fourni par Supabase Auth sous forme d’image SVG (data:) : aucune donnée envoyée à un tiers. */}
          <div className="qr"><img src={state.qr} alt={t('mfa.qrAlt')} /></div>
          <p className="field-help">{t('mfa.secret')}</p>
          <p className="secret">{state.secret}</p>
          {form}
        </>
      ) : null}
      <SignOutButton />
    </AuthShell>
  );
}
