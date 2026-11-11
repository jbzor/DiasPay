import { expect, test } from '@playwright/test';

import { STAFF } from './env';
import { RUN, cleanup, landWithPendingEvidence, party, staffClient } from './fixtures';
import { row, signIn, staffPage } from './helpers';

test.describe.configure({ mode: 'serial' });
test.afterAll(cleanup);

test('preuve de jalon (seed-evidence.sql) : aperçu journalisé, motif obligatoire, double validation, tranche débloquée', async ({ browser }) => {
  const purpose = `Parcelle Odza ${RUN}`;
  const txId = await landWithPendingEvidence(purpose);
  const a = await staffPage(browser, STAFF.A.email, '/preuves');
  await expect(a.getByRole('heading', { name: 'Preuves de jalons', level: 1 })).toBeVisible();
  const line = row(a, `Terrain · ${purpose}`);
  await expect(line).toContainText('Signature de l’acte notarié');
  await expect(line).toContainText('4 000 000 FCFA');
  await expect(line).toContainText('0 sur 2');
  await line.click();
  const panel = a.locator('aside.panel');
  await expect(panel.getByRole('heading', { name: 'Signature de l’acte notarié' })).toBeFocused();
  await expect(panel).toContainText(`Terrain · ${purpose}`);
  await expect(panel).toContainText('Validations (2 requises)');
  // Aperçu de la preuve dans le volet : fichier réel, consultation journalisée.
  await expect(panel.locator('.preview iframe')).toHaveAttribute('src', /^blob:/);
  await expect(panel).toContainText('acte_notarie.pdf · Preuve de jalon');
  await expect(panel.locator('[data-check="EVIDENCE_PRESENT"]')).toHaveAttribute('data-result', 'OK');
  // Motif obligatoire au rejet.
  await panel.getByRole('button', { name: 'Rejeter' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Indiquez le motif du rejet (3 caractères minimum).');
  // Première approbation : reste en attente.
  await panel.getByRole('button', { name: 'Approuver' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Approuver' }).click();
  await expect(a.getByRole('status').filter({ hasText: 'attend une seconde validation' })).toBeVisible();
  await expect(row(a, `Terrain · ${purpose}`)).toContainText('1 sur 2');

  const b = await staffPage(browser, STAFF.B.email, '/preuves');
  await row(b, `Terrain · ${purpose}`).click();
  await expect(b.locator('aside.panel')).toContainText(STAFF.A.name);
  await b.locator('aside.panel').getByRole('button', { name: 'Approuver' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Approuver' }).click();
  await expect(b.getByRole('status').filter({ hasText: 'Preuve approuvée' })).toBeVisible();
  await expect(row(b, `Terrain · ${purpose}`)).toHaveCount(0);

  // Base : tranche débloquée, consultation de la preuve journalisée (deux validateurs), chaîne intacte ; alerte au prestataire.
  const sb = await staffClient(STAFF.A.email);
  const tranche = await sb.from('tranches').select('status').eq('tx_id', txId).eq('seq', 1).single();
  expect(tranche.data?.status).toBe('RELEASED');
  const audit = (await sb.rpc('bo_audit', { p_tx: txId })).data as Array<{ event: string; actor_name: string }>;
  expect(audit.filter((r) => r.event === 'DOCUMENT_VIEWED').map((r) => r.actor_name).sort()).toEqual([STAFF.A.name, STAFF.B.name].sort());
  expect(audit.some((r) => r.event === 'EVIDENCE_APPROVED')).toBe(true);
  expect(((await sb.rpc('bo_audit_verify', { p_tx: txId })).data as { valid: boolean }).valid).toBe(true);
  await expect.poll(async () => (await (await party('OTHER')).listNotifications()).some((n) => n.event.type === 'TRANCHE_RELEASED' && n.event.txId === txId)).toBe(true);
  await a.context().close();
  await b.context().close();
});

test('preuve : rejet avec motif, la tranche revient au prestataire', async ({ page }) => {
  const purpose = `Parcelle Rejet ${RUN}`;
  const txId = await landWithPendingEvidence(purpose);
  await signIn(page, STAFF.B.email, '/preuves');
  await row(page, `Terrain · ${purpose}`).click();
  const panel = page.locator('aside.panel');
  await panel.getByLabel('Motif (obligatoire en cas de rejet)').fill('Acte non signé par le vendeur');
  await panel.getByRole('button', { name: 'Rejeter' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Rejeter' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preuve rejetée' })).toBeVisible();
  const sb = await staffClient(STAFF.B.email);
  expect((await sb.from('tranches').select('status').eq('tx_id', txId).eq('seq', 1).single()).data?.status).toBe('PAID_LOCKED');
});
