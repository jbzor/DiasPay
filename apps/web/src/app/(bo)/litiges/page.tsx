import { t } from '@/i18n';
import { requireStaff } from '@/lib/staff';

/** Réservé aux administrateurs (vérifié ici en plus du proxy ; la base refuse aussi : is_admin()). */
export default async function Page() {
  await requireStaff('/litiges');
  return <main className="main"><h1>{t('nav.litiges')}</h1></main>;
}
