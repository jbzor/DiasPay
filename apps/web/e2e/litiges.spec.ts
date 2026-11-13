import { expect, test } from '@playwright/test';

import { STAFF } from './env';
import { RUN, cleanup, openedDispute, party, staffClient } from './fixtures';
import { row, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });
test.afterAll(cleanup);

test('un validateur n’accède pas aux litiges (interface et base)', async ({ page }) => {
  await signIn(page, STAFF.A.email);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Litiges' })).toHaveCount(0);
  await page.goto('/litiges');
  await expect(page).toHaveURL(/\/acces-refuse\?motif=admin/);
  await expect(page.locator('main').getByRole('alert')).toHaveText('Cette page est réservée aux administrateurs.');
  const sb = await staffClient(STAFF.A.email);
  expect((await sb.from('bo_disputes').select('id')).data).toEqual([]);
});

test('litige après un paiement direct, en faveur du payeur : issues valides seulement, double confirmation, remboursement demandé, demande toujours payée, journal', async ({ page }) => {
  const purpose = `École Les Palmiers ${RUN}`;
  const d = await openedDispute(purpose, { by: 'PAYER', answer: 'Les cours ont commencé le 4 novembre, liste d’appel disponible.' });
  await signIn(page, STAFF.ADMIN.email, '/litiges');
  await expect(page.getByRole('heading', { name: 'Litiges', level: 1 })).toBeVisible();
  const line = row(page, `Scolarité · ${purpose}`);
  await expect(line).toContainText('Prestation non réalisée');
  await expect(line).toContainText('300 000 FCFA');
  await expect(line).toContainText('Payeur');
  // Réponse de la partie adverse : le litige est en médiation, toujours dans le filtre « Ouverts ».
  await expect(line).toContainText('En médiation');
  await line.click();
  const panel = page.locator('aside.panel');
  await expect(panel.getByRole('heading', { name: 'Prestation non réalisée' })).toBeFocused();
  await expect(panel).toContainText('Tranche 1 · 300 000 FCFA');
  await expect(panel).toContainText('L’élève n’a pas reçu les cours prévus.');
  await expect(panel).toContainText('Les cours ont commencé le 4 novembre');
  await expect(panel).toContainText('Prestataire informé');
  await expect(panel).toContainText('à rendre');
  await expect(panel).toContainText('Vous n’êtes pas partie à ce dossier : vous pouvez trancher.');
  // Règlement direct payé : clôture, remboursement total ou partiel ; ni libération ni retour de fonds bloqués.
  await expect(panel.getByRole('button', { name: 'Clore sans suite' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Rembourser en partie' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Libérer au prestataire' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Rendre les fonds au payeur' })).toHaveCount(0);
  // Note obligatoire.
  await panel.getByRole('button', { name: 'Rembourser le payeur' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Rédigez la note de décision (3 caractères minimum).');
  await panel.getByLabel('Note de décision (obligatoire)').fill('Aucune preuve de cours fournie : remboursement.');
  // Remboursement partiel : montant obligatoire.
  await panel.getByRole('button', { name: 'Rembourser en partie' }).click();
  await expect(panel.getByRole('alert')).toContainText('Indiquez un montant positif');
  await expect(page.getByRole('dialog')).toBeHidden();
  await panel.getByRole('button', { name: 'Rembourser le payeur' }).click();
  // Double confirmation de l’intention : case puis mot à saisir.
  const dialog = page.getByRole('dialog', { name: 'Rembourser le payeur ?' });
  const confirm = dialog.getByRole('button', { name: 'Rembourser le payeur' });
  await expect(dialog).toContainText('irréversible');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Je confirme cette décision, irréversible.').check();
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Pour confirmer, saisissez REMBOURSER').fill('rembourser');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status').filter({ hasText: 'Litige tranché : remboursement de' })).toBeVisible();
  await expect(row(page, `Scolarité · ${purpose}`)).toHaveCount(0);
  // Base : la demande reste PAID (K7), remboursement demandé au partenaire, journal ; alerte au payeur.
  const sb = await staffClient(STAFF.ADMIN.email);
  expect((await sb.from('tranches').select('status').eq('id', d.trancheId).single()).data?.status).toBe('PAID');
  expect((await sb.from('refunds').select('status, amount_minor').eq('tranche_id', d.trancheId).single()).data).toMatchObject({ status: 'REQUESTED', amount_minor: 300_000 });
  const audit = (await sb.rpc('bo_audit', { p_tx: d.txId })).data as Array<{ event: string; actor_name: string; payload: { outcome?: string } }>;
  expect(audit.find((r) => r.event === 'DISPUTE_RESOLVED')).toMatchObject({ actor_name: STAFF.ADMIN.name, payload: { outcome: 'REFUND_FULL' } });
  await expect.poll(async () => (await (await party('PAYER')).listNotifications())
    .find((n) => n.event.type === 'DISPUTE_RESOLVED' && n.event.txId === d.txId)?.event).toMatchObject({ outcome: 'REFUNDED' });
  // Litige résolu, visible dans le filtre « Résolus » en lecture seule.
  await page.getByLabel('Afficher').selectOption('RESOLVED');
  await row(page, `Scolarité · ${purpose}`).click();
  await expect(page.locator('aside.panel')).toContainText('Remboursé au payeur');
  await expect(page.locator('aside.panel').getByRole('button', { name: 'Rembourser le payeur' })).toHaveCount(0);
});

test('litige en règlement conditionnel, fonds bloqués, en faveur du prestataire : fonds libérés, demande toujours payée', async ({ page }) => {
  const purpose = `Cours du soir ${RUN}`;
  const d = await openedDispute(purpose, { by: 'PROVIDER', conditional: true });
  await signIn(page, STAFF.ADMIN.email, '/litiges');
  await row(page, `Scolarité · ${purpose}`).click();
  const panel = page.locator('aside.panel');
  await expect(panel).toContainText('Payeur informé');
  await expect(panel.locator('.versions')).toContainText('Pas encore de réponse.');
  await expect(panel.getByRole('button', { name: 'Rendre les fonds au payeur' })).toBeVisible();
  await panel.getByLabel('Note de décision (obligatoire)').fill('Prestation attestée par le relevé de présence.');
  await panel.getByRole('button', { name: 'Libérer au prestataire' }).click();
  const dialog = page.getByRole('dialog', { name: 'Libérer les fonds au prestataire ?' });
  await dialog.getByLabel('Je confirme cette décision, irréversible.').check();
  await dialog.getByLabel('Pour confirmer, saisissez LIBÉRER').fill('LIBERER');
  await dialog.getByRole('button', { name: 'Libérer au prestataire' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'les fonds sont libérés au prestataire' })).toBeVisible();
  const sb = await staffClient(STAFF.ADMIN.email);
  expect((await sb.from('tranches').select('status, funds_state').eq('id', d.trancheId).single()).data).toMatchObject({ status: 'PAID', funds_state: 'RELEASED' });
  expect(((await sb.rpc('bo_audit_verify', { p_tx: d.txId })).data as { valid: boolean }).valid).toBe(true);
});

test('litige avant paiement : demande suspendue, seule la clôture sans suite est proposée, elle lève la suspension', async ({ page }) => {
  const purpose = `Cantine ${RUN}`;
  const d = await openedDispute(purpose, { by: 'PAYER', beforePayment: true });
  const sb = await staffClient(STAFF.ADMIN.email);
  expect((await sb.from('transactions').select('status').eq('id', d.txId).single()).data?.status).toBe('SUSPENDED');
  await signIn(page, STAFF.ADMIN.email, '/litiges');
  await row(page, `Scolarité · ${purpose}`).click();
  const panel = page.locator('aside.panel');
  await expect(panel).toContainText('Litige ouvert avant paiement : la demande est suspendue');
  await expect(panel.getByRole('button', { name: 'Clore sans suite' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Rembourser le payeur' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Libérer au prestataire' })).toHaveCount(0);
  await panel.getByLabel('Note de décision (obligatoire)').fill('Malentendu réglé entre les parties.');
  await panel.getByRole('button', { name: 'Clore sans suite' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clore ce litige sans suite ?' });
  await expect(dialog).toContainText('la suspension levée');
  await dialog.getByLabel('Je confirme cette décision, irréversible.').check();
  await dialog.getByLabel('Pour confirmer, saisissez CLORE').fill('clore');
  await dialog.getByRole('button', { name: 'Clore sans suite' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Litige clos sans suite.' })).toBeVisible();
  expect((await sb.from('transactions').select('status').eq('id', d.txId).single()).data?.status).toBe('ACTIVE');
  expect((await sb.from('tranches').select('status, on_hold').eq('id', d.trancheId).single()).data).toMatchObject({ status: 'SUBMITTED', on_hold: false });
});
