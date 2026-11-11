import { expect, test } from '@playwright/test';

import { STAFF } from './env';
import { RUN, cleanup, submittedDossier } from './fixtures';
import { row, signIn } from './helpers';

test.afterAll(cleanup);

test('clavier : lien d’évitement, flèches dans le tableau, Entrée ouvre, Échap ferme et rend le focus, focus visible', async ({ page }) => {
  const first = `Clavier ${RUN} un`;
  const second = `Clavier ${RUN} deux`;
  await submittedDossier({ amountMinor: 41_000, purpose: first });
  await submittedDossier({ amountMinor: 42_000, purpose: second });
  await signIn(page, STAFF.A.email);
  await expect(row(page, second)).toBeVisible();

  // Premier arrêt de tabulation : le lien d’évitement, qui mène au contenu.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();

  // La recherche filtre le tableau ; Tab mène à la seule ligne tabulable du tableau.
  await page.getByLabel('Rechercher').fill(`Clavier ${RUN}`);
  await expect(page.locator('table.grid tbody tr')).toHaveCount(2);
  await page.getByLabel('Rechercher').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Reçu/ })).toBeFocused(); // tri de la colonne « Reçu »
  await page.keyboard.press('Tab');
  const rows = page.locator('table.grid tbody tr');
  await expect(rows.nth(0)).toBeFocused();
  // Focus visible : anneau de 3 px (variable de la charte).
  expect(await rows.nth(0).evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('3px');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.nth(1)).toBeFocused();
  const label = (await rows.nth(1).locator('td').first().textContent())!;

  // Entrée ouvre le volet, focalisé sur son titre ; Échap le ferme et rend le focus à la ligne.
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-title')).toBeFocused();
  await expect(page.locator('#panel-title')).toHaveText(label);
  await expect(page.getByLabel('J’ai vérifié que le montant correspond aux pièces')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('aside.panel :focus')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-title')).toHaveCount(0);
  await expect(rows.nth(1)).toBeFocused();

  // La fenêtre de confirmation se pilote au clavier : focus sur Annuler, Échap l’annule.
  await page.keyboard.press('Enter');
  await page.getByLabel('J’ai vérifié que le montant correspond aux pièces').check();
  await page.locator('aside.panel').getByRole('button', { name: 'Approuver' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#panel-title')).toHaveText(label);
});
