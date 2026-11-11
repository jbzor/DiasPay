import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { STAFF, STAFF_PASSWORD } from './env';
import { staffClient } from './fixtures';
import { signIn } from './helpers';
import { totp } from './totp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Réglage du projet de développement (rôle postgres, scripts/db.sh) ; toujours remis à 'false' après le test. */
function setRequireMfa(on: boolean) {
  execFileSync(join(root, 'scripts', 'db.sh'), ['psql', '-q', '-c', `update app_config set value = '${on}' where key = 'require_staff_mfa'`], { cwd: root, stdio: 'pipe' });
}

test.describe.configure({ mode: 'serial' });

test('connexion : message identique que le compte existe ou non', async ({ page }) => {
  for (const email of [STAFF.A.email, 'personne-inconnue@diaspay.test']) {
    await page.goto('/connexion');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill('mauvais-mot-de-passe-123');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.locator('#login-error')).toHaveText('Adresse e-mail ou mot de passe incorrect.');
  }
});

test('un utilisateur ordinaire n’accède à rien', async ({ page }) => {
  await signIn(page, STAFF.USER.email);
  await expect(page).toHaveURL(/\/acces-refuse$/);
  await expect(page.locator('main').getByRole('alert')).toContainText('Ce compte n’a pas accès au bureau de contrôle');
  for (const path of ['/dossiers', '/preuves', '/litiges', '/journal']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acces-refuse$/);
  }
  const sb = await staffClient(STAFF.USER.email);
  expect((await sb.from('bo_dossiers').select('id')).data).toEqual([]);
  expect((await sb.rpc('bo_find_transactions', { p_query: '' })).error?.hint).toBe('VALIDATOR_ONLY');
});

test('sans session : toute page renvoie à la connexion ; déconnexion', async ({ page }) => {
  await page.goto('/journal');
  await expect(page).toHaveURL(/\/connexion\?suite=%2Fjournal$/);
  await signIn(page, STAFF.A.email, '/journal');
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.getByRole('navigation')).toContainText(STAFF.A.name);
  await expect(page.getByRole('navigation')).toContainText('Validateur');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion\?motif=deconnecte$/);
  await expect(page.getByRole('status').filter({ hasText: 'Vous êtes déconnecté.' })).toBeVisible();
  await page.goto('/dossiers');
  await expect(page).toHaveURL(/\/connexion\?suite=%2Fdossiers$/);
});

test('session expirée (cookies effacés) : retour à la connexion', async ({ page, context }) => {
  await signIn(page, STAFF.A.email);
  await context.clearCookies();
  await page.goto('/preuves');
  await expect(page).toHaveURL(/\/connexion\?suite=%2Fpreuves$/);
});

test('second facteur exigé (require_staff_mfa = true) : aucun accès sans aal2, ni par l’interface ni par l’API ; inscription puis code TOTP', async ({ page }) => {
  setRequireMfa(true);
  try {
    // API : un validateur au premier niveau (mot de passe seul) n’a aucun droit.
    const api = await staffClient(STAFF.PARTY.email);
    expect((await api.from('bo_dossiers').select('id')).data).toEqual([]);
    expect((await api.rpc('bo_find_transactions', { p_query: '' })).error?.hint).toBe('VALIDATOR_ONLY');
    expect((await api.rpc('is_validator')).data).toBe(false);

    // Interface : renvoi vers le second facteur, quelle que soit la page demandée.
    await page.goto('/connexion');
    await page.getByLabel('Adresse e-mail').fill(STAFF.PARTY.email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/connexion\/second-facteur$/);
    for (const path of ['/dossiers', '/journal']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/connexion\/second-facteur$/);
    }
    // Premier accès : inscription (QR code et clé), mauvais code refusé, bon code accepté.
    await expect(page.getByRole('heading', { name: 'Activer le second facteur' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code d’inscription du second facteur' })).toHaveAttribute('src', /^data:image\/svg\+xml/);
    const secret = (await page.locator('.secret').textContent())!.trim();
    await page.getByLabel('Code à 6 chiffres').fill('000000');
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveText('Code incorrect ou expiré. Saisissez le code affiché maintenant.');
    await page.getByLabel('Code à 6 chiffres').fill(totp(secret));
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expect(page).toHaveURL(/\/dossiers$/);
    await expect(page.getByRole('heading', { name: 'Dossiers à valider', level: 1 })).toBeVisible();

    // API au second niveau : un nouveau jeton aal2 (code de la fenêtre suivante) rend les droits.
    const aal2 = await staffClient(STAFF.PARTY.email);
    const { data: factors, error: listError } = await aal2.auth.mfa.listFactors();
    expect(listError).toBeNull();
    const factor = factors!.totp.find((f) => f.status === 'verified')!;
    await new Promise((r) => setTimeout(r, 31_000 - (Date.now() % 30_000)));
    expect((await aal2.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) })).error).toBeNull();
    expect((await aal2.rpc('is_validator')).data).toBe(true);
    expect((await aal2.from('bo_dossiers').select('id')).error).toBeNull();
  } finally {
    setRequireMfa(false);
    // Le compte de test retrouve son état (aucun facteur), même en cas d’échec.
    execFileSync(join(root, 'scripts', 'db.sh'), ['psql', '-q', '-c',
      `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '${STAFF.PARTY.email}')`], { cwd: root, stdio: 'pipe' });
  }
});
