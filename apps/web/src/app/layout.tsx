import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';

import { t } from '@/i18n';
import { tokensCss } from '@/lib/tokens';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: t('app.titleShort'),
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce posé par le proxy (CSP stricte) : seule la feuille des variables de la charte est en ligne.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="fr" className={inter.variable}>
      <head>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokensCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
