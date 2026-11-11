import { expect, test } from '@playwright/test';

import { STAFF } from './env';
import { signIn, watchCsp } from './helpers';

test('en-têtes de sécurité sur les pages et les fichiers statiques', async ({ request }) => {
  const page = await request.get('/connexion');
  const h = page.headers();
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-content-type-options']).toBe('nosniff');
  const csp = h['content-security-policy']!;
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // Nonce différent à chaque requête.
  const again = (await request.get('/connexion')).headers()['content-security-policy'];
  expect(again).not.toBe(csp);
  // Pages du personnel : jamais en cache partagé.
  expect(h['cache-control']).toContain('no-store');
  const icon = await request.get('/icon.svg');
  expect(icon.headers()['x-frame-options']).toBe('DENY');
});

test('aucune violation de la CSP sur les écrans du personnel', async ({ page }) => {
  const check = watchCsp(page);
  await signIn(page, STAFF.ADMIN.email);
  for (const path of ['/dossiers', '/preuves', '/litiges', '/journal']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  check();
});

test('le bureau de contrôle ne s’affiche pas dans un cadre tiers', async ({ page }) => {
  await page.setContent('<iframe id="f" src="http://localhost:3100/connexion"></iframe>');
  await page.waitForTimeout(1500);
  const frame = page.frame({ url: /connexion/ });
  const blocked = !frame || (await frame.locator('h1').count().catch(() => 0)) === 0;
  expect(blocked).toBe(true);
});
