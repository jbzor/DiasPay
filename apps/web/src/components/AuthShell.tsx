import { t } from '@/i18n';
import { Logo } from './Logo';

/** Cadre des écrans de connexion : logo, titre « Bureau de contrôle », contenu. */
export function AuthShell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <Logo size={40} />
          <h1>{t('login.title')}</h1>
        </div>
        {title ? <h2>{title}</h2> : null}
        {children}
      </div>
    </main>
  );
}
