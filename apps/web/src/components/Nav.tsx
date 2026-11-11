'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t } from '@/i18n';
import type { Key } from '@/i18n';
import { Logo } from './Logo';
import { SignOutButton } from './SignOutButton';
import { useStaff } from './StaffContext';

const ITEMS: Array<{ href: string; key: Key; adminOnly?: boolean }> = [
  { href: '/dossiers', key: 'nav.dossiers' },
  { href: '/preuves', key: 'nav.preuves' },
  { href: '/litiges', key: 'nav.litiges', adminOnly: true },
  { href: '/journal', key: 'nav.journal' },
];

/** Navigation latérale (200 px) : sections, puis nom et rôle du membre du personnel et déconnexion. */
export function Nav() {
  const path = usePathname();
  const staff = useStaff();
  return (
    <nav className="shell-nav" aria-label={t('nav.label')}>
      <div className="brand"><Logo size={30} /><span className="brand-name">{t('app.title')}</span></div>
      <ul className="nav-list">
        {ITEMS.filter((i) => !i.adminOnly || staff.role === 'ADMIN').map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="nav-link" aria-current={path === i.href || path.startsWith(`${i.href}/`) ? 'page' : undefined}>{t(i.key)}</Link>
          </li>
        ))}
      </ul>
      <div className="nav-user">
        <span className="nav-user-name" title={staff.name}>{staff.name}</span>
        <span className="nav-user-role">{t(staff.role === 'ADMIN' ? 'role.ADMIN' : 'role.VALIDATOR')}</span>
        <SignOutButton />
      </div>
    </nav>
  );
}
