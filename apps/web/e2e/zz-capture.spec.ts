import { test } from '@playwright/test';
import { STAFF } from './env';
import { RUN, cleanup, submittedDossier } from './fixtures';
import { row, signIn } from './helpers';

// Capture des écrans pour la comparaison avec la maquette (E2E_CAPTURE=1).
test.skip(!process.env.E2E_CAPTURE, 'captures seulement avec E2E_CAPTURE=1');
test.afterAll(cleanup);

test('capture : dossiers à valider', async ({ page }) => {
  await submittedDossier({ amountMinor: 450_000, purpose: `Collège Les Manguiers ${RUN}`, provider: { name: 'Collège Les Manguiers' } });
  await submittedDossier({ vertical: 'HEALTH', amountMinor: 3_500_000, purpose: `Hôpital Central ${RUN}`, provider: { name: 'Clinique Sainte-Élise' } });
  await signIn(page, STAFF.A.email);
  await row(page, `Hôpital Central ${RUN}`).click();
  await page.getByRole('heading', { name: new RegExp(`Hôpital Central ${RUN}`) }).waitFor();
  await page.getByLabel('J’ai vérifié que le montant correspond aux pièces').check();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${process.env.E2E_CAPTURE}/bo-dossiers.png`, fullPage: false });
  await page.locator('aside.panel').evaluate((el) => el.scrollTo(0, 400));
  await page.screenshot({ path: `${process.env.E2E_CAPTURE}/bo-dossiers-bas.png`, fullPage: false });
});

test('capture : preuves de jalons', async ({ page }) => {
  const { landWithPendingEvidence } = await import('./fixtures');
  await landWithPendingEvidence(`Parcelle Nkolbisson ${RUN}`);
  await signIn(page, STAFF.A.email, '/preuves');
  await row(page, `Parcelle Nkolbisson ${RUN}`).click();
  await page.locator('aside.panel .preview iframe').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${process.env.E2E_CAPTURE}/bo-preuves.png` });
});
