import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { STAFF } from './env';
import { RUN, cleanup, party, staffClient, submittedDossier } from './fixtures';
import { signIn } from './helpers';

test.describe.configure({ mode: 'serial' });
test.afterAll(cleanup);

/** Dossier parcouru (lot X v2) : soumis pour revue, pris en charge, approuvé (opération ACTIVE, demande envoyée), demande payée. */
async function completedPath(purpose: string): Promise<string> {
  const tx = await submittedDossier({ amountMinor: 250_000, purpose });
  const sb = await staffClient(STAFF.A.email);
  await sb.rpc('claim_dossier', { p_tx: tx.id });
  const d = await sb.rpc('decide_tx', { p_tx: tx.id, p_approved: true, p_amount_checked: true });
  if (d.error) throw d.error;
  const payer = await party('PAYER');
  await payer.payTranche((await payer.getTransaction(tx.id)).tranches[0]!.id);
  return tx.id;
}

test('journal : recherche au clavier, chaîne vérifiée, empreinte copiée en entier', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const purpose = `Scolarité Journal ${RUN}`;
  const txId = await completedPath(purpose);
  await signIn(page, STAFF.B.email, '/journal');
  await expect(page.getByRole('heading', { name: 'Journal d’audit', level: 1 })).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Transaction' });
  await search.fill(`scolarite journal ${RUN.toLowerCase()}`); // sans accents ni majuscules
  const option = page.getByRole('option', { name: new RegExp(`Scolarité Journal ${RUN}`) });
  await expect(option).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  const banner = page.locator('[data-chain]');
  await expect(banner).toHaveAttribute('data-chain', 'valid');
  const rows = page.locator('table.grid tbody tr');
  const n = await rows.count();
  expect(n).toBeGreaterThanOrEqual(8);
  await expect(banner).toHaveText(`Chaîne vérifiée : aucune modification détectée sur les ${n} entrées de cette transaction.`);
  await expect(rows.first()).toContainText('Dossier soumis');
  await expect(rows.first()).toContainText('Jean Demandeur (e2e) (demandeur)');
  await expect(page.locator('tr[data-event="STATUS_CHANGE"]').filter({ hasText: 'Dossier pris en charge' })).toContainText(`${STAFF.A.name} (validateur)`);
  await expect(page.locator('tr[data-event="VALIDATION_DECISION"]')).toContainText('Approbation d’un validateur (montant vérifié)');
  await expect(page.locator('tr[data-event="STATUS_CHANGE"]').filter({ hasText: 'Dossier validé (opération active)' })).toContainText(`${STAFF.A.name} (validateur)`);
  const sent = page.locator('tr[data-event="REQUEST_SUBMITTED"]');
  await expect(sent).toContainText('Demande de paiement envoyée au payeur');
  await expect(sent).toContainText('Système');
  await expect(sent).toContainText('Tranche 1');
  await expect(page.locator('tr[data-event="REQUEST_PAID"]')).toContainText('Demande payée');
  // Empreinte abrégée « 3f9a…c71b », copie complète au clic.
  const sb = await staffClient(STAFF.B.email);
  const first = ((await sb.rpc('bo_audit', { p_tx: txId })).data as Array<{ hash: string }>)[0]!.hash;
  const hashBtn = rows.first().getByRole('button');
  await expect(hashBtn).toHaveText(`${first.slice(0, 4)}…${first.slice(-4)}`);
  await hashBtn.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
});

test('export CSV : colonnes complètes, empreintes entières, UTF-8 avec BOM, export journalisé', async ({ page }) => {
  const purpose = `Export Journal ${RUN}`;
  const txId = await completedPath(purpose);
  await signIn(page, STAFF.A.email, '/journal');
  const search = page.getByRole('combobox', { name: 'Transaction' });
  await search.fill(purpose);
  await page.getByRole('option', { name: new RegExp(purpose) }).click();
  await expect(page.locator('[data-chain]')).toHaveAttribute('data-chain', 'valid');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exporter' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^journal-[0-9A-F]{8}-\d{12}\.csv$/);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split('\r\n');
  expect(lines[0]).toBe('Horodatage (UTC);Acteur;Rôle;Événement;Code;Statut avant;Statut après;Tranche;Données;Empreinte précédente;Empreinte');
  expect(lines.length).toBeGreaterThan(8);
  for (const l of lines.slice(1)) expect(l).toMatch(/;[0-9a-f]{64}$/);
  expect(csv).toContain('Dossier soumis');
  expect(lines.at(-1)).toContain('AUDIT_EXPORTED');
  // L’export apparaît au journal, à l’écran et en base, et la chaîne reste valide.
  await expect(page.locator('tr[data-event="AUDIT_EXPORTED"]')).toContainText('Journal exporté (CSV)');
  await expect(page.getByRole('status').filter({ hasText: 'Export CSV téléchargé' })).toBeVisible();
  const sb = await staffClient(STAFF.B.email);
  const audit = (await sb.rpc('bo_audit', { p_tx: txId })).data as Array<{ event: string; actor_name: string }>;
  expect(audit.find((r) => r.event === 'AUDIT_EXPORTED')?.actor_name).toBe(STAFF.A.name);
  expect(((await sb.rpc('bo_audit_verify', { p_tx: txId })).data as { valid: boolean }).valid).toBe(true);
});

test('chaîne rompue : alerte rouge (réponse de bo_audit_verify simulée ; détection en base testée par 02_lot5.sql)', async ({ page }) => {
  const purpose = `Chaîne rompue ${RUN}`;
  await completedPath(purpose);
  await page.route('**/rest/v1/rpc/bo_audit_verify', async (route) => {
    const res = await route.fetch();
    const body = await res.json() as { count: number };
    await route.fulfill({ response: res, json: { ...body, valid: false } });
  });
  await signIn(page, STAFF.A.email, '/journal');
  await page.getByRole('combobox', { name: 'Transaction' }).fill(purpose);
  await page.getByRole('option', { name: new RegExp(purpose) }).click();
  const banner = page.locator('[data-chain]');
  await expect(banner).toHaveAttribute('data-chain', 'broken');
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(banner).toContainText('Chaîne rompue');
});
