import { expect, test } from '@playwright/test';

import { STAFF } from './env';
import { RUN, cleanup, party, staffClient, submittedDossier } from './fixtures';
import { row, signIn, staffPage, watchCsp } from './helpers';

/** Prestataire vérifié de l’annuaire (seed.sql), pour des dossiers réalistes. */
async function college() {
  const found = await (await party('REQUESTER')).searchProviders('Collège Les Manguiers', 'EDUCATION');
  const p = found[0]!;
  return { id: p.id, name: p.name };
}

test.describe.configure({ mode: 'serial' });
test.afterAll(cleanup);

test('validation simple : prise en charge à l’ouverture, case obligatoire, approbation, alertes au payeur et au demandeur', async ({ page }) => {
  const csp = watchCsp(page);
  const purpose = `Scolarité simple ${RUN}`;
  const tx = await submittedDossier({ amountMinor: 450_000, purpose, provider: await college() });
  await signIn(page, STAFF.A.email);
  await expect(page.getByRole('heading', { name: 'Dossiers à valider', level: 1 })).toBeVisible();
  const line = row(page, purpose);
  await expect(line).toContainText('450 000 FCFA');
  await expect(line).toContainText('0 sur 1');
  await line.click();
  const panel = page.locator('aside.panel');
  await expect(panel.getByRole('heading', { name: `Scolarité · ${purpose}` })).toBeFocused();
  // D8 : ouvrir le dossier l’a pris en charge, au nom du validateur.
  const sb = await staffClient(STAFF.A.email);
  await expect.poll(async () => (await sb.from('transactions').select('status').eq('id', tx.id).single()).data?.status).toBe('IN_REVIEW');
  const claim = await sb.rpc('bo_audit', { p_tx: tx.id });
  expect((claim.data as Array<{ to_status: string; actor_name: string }>).find((r) => r.to_status === 'IN_REVIEW')?.actor_name).toBe(STAFF.A.name);
  // Contrôles automatiques (D6) et case humaine.
  await expect(panel.locator('[data-check="DOCUMENTS"]')).toHaveAttribute('data-result', 'OK');
  await expect(panel.locator('[data-check="PROVIDER_VERIFIED"]')).toHaveAttribute('data-result', 'OK');
  await expect(panel.locator('[data-check="PLAN_SUM"]')).toHaveAttribute('data-result', 'OK');
  const approve = panel.getByRole('button', { name: 'Approuver' });
  await expect(approve).toBeDisabled();
  await panel.getByLabel('J’ai vérifié que le montant correspond aux pièces').check();
  await expect(approve).toBeEnabled();
  await approve.click();
  const dialog = page.getByRole('dialog', { name: 'Approuver ce dossier ?' });
  await expect(dialog).toContainText('450 000 FCFA');
  await dialog.getByRole('button', { name: 'Approuver' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Dossier approuvé' })).toBeVisible();
  await expect(row(page, purpose)).toHaveCount(0);
  // Alertes dans l’application mobile : payeur et demandeur.
  for (const who of ['PAYER', 'REQUESTER'] as const) {
    await expect.poll(async () => (await (await party(who)).listNotifications()).some((n) => n.event.type === 'TX_VALIDATED' && n.event.txId === tx.id)).toBe(true);
  }
  csp();
});

test('approbation impossible sans la case, aussi pour l’API (AMOUNT_NOT_CHECKED)', async () => {
  const tx = await submittedDossier({ amountMinor: 210_000, purpose: `Case API ${RUN}`, provider: await college() });
  const sb = await staffClient(STAFF.B.email);
  await sb.rpc('claim_dossier', { p_tx: tx.id });
  const res = await sb.rpc('decide_tx', { p_tx: tx.id, p_approved: true, p_amount_checked: false });
  expect(res.error?.hint).toBe('AMOUNT_NOT_CHECKED');
  const reject = await sb.rpc('decide_tx', { p_tx: tx.id, p_approved: false, p_amount_checked: false, p_reason: '' });
  expect(reject.error?.hint).toBe('REASON_REQUIRED');
});

test('double validation : reste en validation après la première approbation, le même validateur ne peut pas approuver deux fois, un second validateur valide', async ({ browser }) => {
  const purpose = `Université ${RUN}`;
  await submittedDossier({ amountMinor: 3_500_000, purpose, provider: await college() });
  const a = await staffPage(browser, STAFF.A.email);
  await expect(row(a, purpose)).toContainText('0 sur 2');
  await row(a, purpose).click();
  await a.getByLabel('J’ai vérifié que le montant correspond aux pièces').check();
  await a.locator('aside.panel').getByRole('button', { name: 'Approuver' }).click();
  await expect(a.getByRole('dialog')).toContainText('Une autre validation reste nécessaire');
  await a.getByRole('dialog').getByRole('button', { name: 'Approuver' }).click();
  await expect(a.getByRole('status').filter({ hasText: 'attend une seconde validation' })).toBeVisible();
  await expect(row(a, purpose)).toContainText('1 sur 2');
  await row(a, purpose).click();
  await expect(a.locator('aside.panel')).toContainText('Vous avez déjà donné votre décision sur ce dossier.');
  await expect(a.locator('aside.panel').getByRole('button', { name: 'Approuver' })).toHaveCount(0);

  const b = await staffPage(browser, STAFF.B.email);
  await expect(row(b, purpose)).toContainText('1 sur 2');
  await row(b, purpose).click();
  const panel = b.locator('aside.panel');
  await expect(panel).toContainText(`${STAFF.A.name}`);
  await expect(panel).toContainText(`Vous (${STAFF.B.name})`);
  await expect(panel).toContainText('en attente');
  await panel.getByLabel('J’ai vérifié que le montant correspond aux pièces').check();
  await panel.getByRole('button', { name: 'Approuver' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Approuver' }).click();
  await expect(b.getByRole('status').filter({ hasText: 'Dossier approuvé' })).toBeVisible();
  // Mise à jour en direct chez le premier validateur : le dossier quitte sa file.
  await expect(row(a, purpose)).toHaveCount(0, { timeout: 20_000 });
  await a.context().close();
  await b.context().close();
});

test('rejet : motif obligatoire, puis alerte avec le motif', async ({ page }) => {
  const purpose = `Rejet ${RUN}`;
  const tx = await submittedDossier({ amountMinor: 95_000, purpose, provider: await college() });
  await signIn(page, STAFF.B.email);
  await row(page, purpose).click();
  const panel = page.locator('aside.panel');
  await panel.getByRole('button', { name: 'Rejeter' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Indiquez le motif du rejet (3 caractères minimum).');
  await expect(panel.getByLabel('Motif (obligatoire en cas de rejet)')).toBeFocused();
  await expect(page.getByRole('dialog')).toBeHidden();
  await panel.getByLabel('Motif (obligatoire en cas de rejet)').fill('Attestation d’inscription illisible');
  await panel.getByRole('button', { name: 'Rejeter' }).click();
  await expect(page.getByRole('dialog')).toContainText('Attestation d’inscription illisible');
  await page.getByRole('dialog').getByRole('button', { name: 'Rejeter' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Dossier rejeté' })).toBeVisible();
  await expect.poll(async () => (await (await party('REQUESTER')).listNotifications())
    .find((n) => n.event.type === 'TX_REJECTED' && n.event.txId === tx.id)?.event).toMatchObject({ reason: 'Attestation d’inscription illisible' });
});

test('doublon possible signalé sans bloquer l’approbation', async ({ page }) => {
  const provider = await college();
  await submittedDossier({ amountMinor: 333_000, purpose: `Premier ${RUN}`, provider });
  const purpose = `Doublon ${RUN}`;
  await submittedDossier({ amountMinor: 333_000, purpose, provider });
  await signIn(page, STAFF.A.email);
  await row(page, purpose).click();
  const check = page.locator('aside.panel [data-check="DUPLICATE"]');
  await expect(check).toHaveAttribute('data-result', 'ATTENTION');
  await expect(check).toContainText('Dossiers semblables');
  await page.getByLabel('J’ai vérifié que le montant correspond aux pièces').check();
  await expect(page.locator('aside.panel').getByRole('button', { name: 'Approuver' })).toBeEnabled();
});

test('validateur partie au dossier : lecture seule avec l’explication (RG-03)', async ({ page }) => {
  const purpose = `Partie ${RUN}`;
  await submittedDossier({ amountMinor: 120_000, purpose, payerPhone: STAFF.PARTY.phone, provider: await college() });
  await signIn(page, STAFF.PARTY.email);
  await row(page, purpose).click();
  const panel = page.locator('aside.panel');
  await expect(panel).toContainText('Vous êtes partie à ce dossier : vous ne pouvez pas le valider (RG-03).');
  await expect(panel.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Rejeter' })).toHaveCount(0);
});

test('consultation d’une pièce : visionneur intégré, consultation inscrite au journal', async ({ page }) => {
  const purpose = `Pièce ${RUN}`;
  const tx = await submittedDossier({ amountMinor: 60_000, purpose, provider: await college() });
  await signIn(page, STAFF.A.email);
  await row(page, purpose).click();
  await page.getByRole('button', { name: 'Voir attestation_inscription.pdf' }).click();
  const viewer = page.getByRole('dialog', { name: 'attestation_inscription.pdf' });
  await expect(viewer.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Voir attestation_inscription.pdf' })).toBeFocused();
  const sb = await staffClient(STAFF.B.email);
  const rows = (await sb.rpc('bo_audit', { p_tx: tx.id })).data as Array<{ event: string; actor_name: string; payload: { file_name: string } }>;
  expect(rows.find((r) => r.event === 'DOCUMENT_VIEWED')).toMatchObject({ actor_name: STAFF.A.name, payload: { file_name: 'attestation_inscription.pdf' } });
});
