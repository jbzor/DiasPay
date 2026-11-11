import Link from 'next/link';

import { AuthShell } from '@/components/AuthShell';
import { SignOutButton } from '@/components/SignOutButton';
import { t } from '@/i18n';

export default async function AccesRefuse({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = (await searchParams).motif === 'admin';
  return (
    <AuthShell title={t('denied.title')}>
      <p role="alert">{admin ? t('denied.adminOnly') : t('denied.notStaff')}</p>
      {admin ? <Link href="/dossiers" className="btn btn-secondary">{t('denied.back')}</Link> : <SignOutButton className="btn btn-secondary" />}
    </AuthShell>
  );
}
