import { AuthShell } from '@/components/AuthShell';
import { t } from '@/i18n';
import { LoginForm } from './LoginForm';

export default async function ConnexionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const notice = sp.motif === 'expiree' ? t('login.expired') : sp.motif === 'deconnecte' ? t('login.signedOut') : sp.motif === 'mot-de-passe' ? t('login.passwordChanged') : null;
  return (
    <AuthShell>
      <p className="muted">{t('login.subtitle')}</p>
      {notice ? <p className="banner info" role="status">{notice}</p> : null}
      <LoginForm next={sp.suite ?? null} />
    </AuthShell>
  );
}
