import { Nav } from '@/components/Nav';
import { StaffProvider } from '@/components/StaffContext';
import { t } from '@/i18n';
import { requireStaff } from '@/lib/staff';

/** Espace du personnel : vérification serveur (en plus du proxy), navigation et zone principale. */
export default async function BoLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff('/dossiers');
  return (
    <StaffProvider staff={{ id: staff.id, name: staff.name, role: staff.role }}>
      <a href="#contenu" className="skip-link">{t('nav.skip')}</a>
      <div className="shell">
        <Nav />
        <div id="contenu">{children}</div>
      </div>
    </StaffProvider>
  );
}
