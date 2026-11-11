import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import { STAFF_PASSWORD } from './env';

/** Connexion d’un membre du personnel par l’écran de connexion ; renvoie sur la page demandée. */
export async function signIn(page: Page, email: string, path = '/dossiers'): Promise<void> {
  await page.goto(`/connexion?suite=${encodeURIComponent(path)}`);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/connexion'));
}

/** Nouvelle session isolée (cookies propres) : deux validateurs en parallèle. */
export async function staffPage(browser: Browser, email: string, path = '/dossiers'): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, path);
  return page;
}

/** Ligne du tableau dont la première cellule contient ce texte. */
export const row = (page: Page, text: string | RegExp) => page.locator('table.grid tbody tr').filter({ hasText: text });

/** Aucune violation de la CSP pendant la page (journal de la console). */
export function watchCsp(page: Page): () => void {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  return () => expect(violations, 'violations de la CSP').toEqual([]);
}
