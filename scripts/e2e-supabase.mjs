#!/usr/bin/env node
/**
 * Lot A (T7) : test de bout en bout de l’application mobile contre le projet Supabase de développement (pas le simulateur).
 *
 *   pnpm test:e2e:supabase            # construit l’export web (EXPO_PUBLIC_API=supabase), puis parcourt l’application
 *   pnpm test:e2e:supabase --no-build # réutilise l’export précédent
 *
 * Parcours principal : connexion par téléphone et code, création d’un besoin en six étapes (pièce envoyée avec son
 * empreinte), soumission, détail (« Reçue par le payeur »), paiement (« Paiement en cours »), demande « Payée » par le
 * simulateur du partenaire côté serveur (tâche planifiée, mock_mode du projet), reçu. Sans aucun mode démonstration.
 * Puis : écran « Configuration manquante » d’un export sans configuration.
 *
 * - Compte de test réservé aux tests automatisés : +33 6 39 98 00 11 (code fixe), données effacées avant et après
 *   (demo_reset, permis en mock_mode seulement), comme la suite de contrat.
 * - Variables lues dans l’environnement (pnpm test:e2e:supabase les prend dans apps/mobile/.env.local) :
 *   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY (clé publique). Jamais affichées.
 * - Chrome installé, piloté par playwright-core (aucun navigateur téléchargé ; CHROME_PATH pour un autre exécutable).
 * - Ne couvre pas : biométrie, caméra (scan), réencodage des photos, stockage sécurisé, notifications : tests sur téléphone.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps/mobile');
const FIXTURES = path.join(ROOT, 'scripts/fixtures');
const OUT = path.join(os.tmpdir(), 'diaspay-e2e-supabase');
const DIST = path.join(OUT, 'dist');
const DIST_EMPTY = path.join(OUT, 'dist-unconfigured');
const DIST_EMPTY_INTERNAL = path.join(OUT, 'dist-unconfigured-internal');
const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;
const PHONE = '+33639980011';
if (!URL || !KEY) { console.error('SUPABASE_TEST_URL et SUPABASE_TEST_ANON_KEY sont requis (pnpm test:e2e:supabase).'); process.exit(2); }

const { createClient } = createRequire(path.join(ROOT, 'packages/api-client/package.json'))('@supabase/supabase-js');

/** Session du compte de test, côté test (lecture du serveur et nettoyage). */
async function testSession() {
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error: e1 } = await sb.auth.signInWithOtp({ phone: PHONE });
  if (e1) throw new Error(`connexion du compte de test : ${e1.message}`);
  const { data, error: e2 } = await sb.auth.verifyOtp({ phone: PHONE, token: '123456', type: 'sms' });
  if (e2 || !data.session) throw new Error(`code du compte de test : ${e2?.message}`);
  return { sb, uid: data.session.user.id };
}

/** Pièces des dossiers du compte : empreinte SHA-256 enregistrée par le serveur. */
async function documentHashes() {
  const { sb, uid } = await testSession();
  const { data: txs } = await sb.from('transactions').select('id').eq('created_by', uid);
  const { data: docs } = await sb.from('documents').select('content_hash').in('tx_id', (txs ?? []).map((t) => t.id));
  await sb.auth.signOut();
  return (docs ?? []).map((d) => d.content_hash);
}

/** Efface les dossiers du compte de test (fichiers du bucket, puis demo_reset), comme resetDemoData. */
async function resetAccount() {
  const { sb, uid } = await testSession();
  const { data: txs } = await sb.from('transactions').select('id').eq('created_by', uid);
  for (const t of txs ?? []) {
    const { data: docs } = await sb.from('documents').select('storage_path').eq('tx_id', t.id);
    if (docs?.length) await sb.storage.from('dossiers').remove(docs.map((d) => d.storage_path));
  }
  const { error: e3 } = await sb.rpc('demo_reset');
  if (e3) throw new Error(`demo_reset : ${e3.message}`);
  await sb.auth.signOut();
}

function exportWeb(outDir, env) {
  const r = spawnSync('pnpm', ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', outDir], { cwd: APP, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// ——— 1. Exports web : relié au projet de développement, et sans configuration ———
if (!process.argv.includes('--no-build')) {
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('Export web relié au projet Supabase de développement…');
  const base = { ...process.env, EXPO_PUBLIC_DEMO: '', EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE: '' };
  exportWeb(DIST, { ...base, EXPO_PUBLIC_API: 'supabase', EXPO_PUBLIC_SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY });
  console.log('Export web sans configuration…');
  // EXPO_NO_DOTENV : aucun fichier .env lu ; variables vidées.
  const unconfigured = { ...base, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_API: '', EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_ANON_KEY: '' };
  exportWeb(DIST_EMPTY, unconfigured);
  // Build interne déclaré : la garde de boutique le laisse passer ; c’est alors l’écran « Configuration manquante ».
  exportWeb(DIST_EMPTY_INTERNAL, { ...unconfigured, EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE: '1' });
}

// ——— 2. Serveurs statiques (repli sur index.html pour les routes) ———
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
async function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://localhost:${server.address().port}` };
}

// ——— 3. Parcours ———
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const step = (name) => { steps.push(name); console.log('  ✓', name); };

const visible = (loc) => loc.filter({ visible: true }).first();
const byText = (text, exact = true) => visible(page.getByText(text, { exact }));
const byLabel = (label) => visible(page.locator(`[aria-label="${label}"]`));
async function topmost(locator) {
  const n = await locator.count();
  for (let i = n - 1; i >= 0; i--) {
    const el = locator.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.width === 0 || box.y < 0 || box.y > 844) continue;
    const onTop = await el.evaluate((node, [x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (node === hit || node.contains(hit)); },
      [box.x + box.width / 2, box.y + box.height / 2]);
    if (onTop) return el;
  }
  return null;
}
/** Attend qu’un élément correspondant soit au premier plan, puis clique dessus (les écrans précédents restent montés). */
async function click(locator, timeout = 20_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const el = await topmost(locator);
    if (el) { await el.click(); await sleep(500); return; }
    if (Date.now() > end) throw new Error(`introuvable au premier plan : ${locator}`);
    await sleep(300);
  }
}
const tap = (text, exact = true) => click(page.getByText(text, { exact }));
/** Attend un texte au premier plan (temps réel : jusqu’à timeout). */
async function see(text, timeout = 20_000, exact = true) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await topmost(page.getByText(text, { exact }))) return;
    if (Date.now() > end) throw new Error(`texte attendu absent : « ${text} »`);
    await sleep(500);
  }
}
async function fill(label, value) {
  const el = visible(page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`));
  await el.waitFor({ timeout: 20_000 });
  await el.fill(''); await el.pressSequentially(value); await sleep(200);
}

let failed = false;
const main = await serve(DIST);
const empty = await serve(DIST_EMPTY);
const emptyInternal = await serve(DIST_EMPTY_INTERNAL);
try {
  await resetAccount();
  step('compte de test remis à zéro (demo_reset)');

  // Connexion par téléphone et code (Supabase Auth, numéro de test).
  await page.goto(main.base, { waitUntil: 'networkidle' });
  await sleep(1500);
  if (await byText('Passer').isVisible().catch(() => false)) await tap('Passer');
  await fill('Téléphone', '6 39 98 00 11');
  await tap('Recevoir le code');
  await visible(page.locator('input[aria-label="Chiffre 1 sur 6"]')).click();
  await page.keyboard.type('123456'); await sleep(200);
  await tap('Valider');
  await sleep(2500);
  if (page.url().includes('profile-setup')) {
    await fill('Nom complet', 'Test de contrat payer'); await tap('Choisir un pays'); await tap('France'); await tap('Continuer');
  }
  if (page.url().includes('biometrics')) await tap('Continuer');
  await see('Nouveau besoin');
  step('connexion par téléphone et code (Supabase Auth), accueil');

  // Aucune donnée de démonstration en usage normal : compte vide.
  for (const demo of ['École Les Palmiers', 'Studio Bastos', 'Marie N.']) {
    if (await topmost(page.getByText(demo, { exact: false }))) throw new Error(`donnée de démonstration affichée : ${demo}`);
  }
  step('aucune donnée statique de démonstration affichée');

  // Création d’un besoin en six étapes.
  const purpose = `Soins E2E ${Date.now()}`;
  await tap('Nouveau besoin');
  await tap('Santé');
  await tap('Continuer');
  await fill('Montant', '180000');
  await fill('Objectif', purpose);
  await fill('Référence du patient', 'RM-12');
  // Échéance dans 3 jours : une demande n’est soumise que 7 jours avant son échéance (activation_lead_days, activate_due_tranches).
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await visible(page.locator('input[aria-label="Date souhaitée"]')).fill(due); await sleep(300);
  await tap('Continuer');
  await fill('Rechercher un prestataire', 'Clinique'); await sleep(1500);
  await tap('Clinique Sainte-Élise', false);
  await tap('Continuer');
  await tap('Continuer');   // plan : paiement unique (défaut)
  await click(page.locator('[aria-label="Ajouter : Devis ou facture proforma"]'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap('Choisir un document')]);
  await chooser.setFiles(path.join(FIXTURES, 'devis_hopital.pdf'));
  await see('devis_hopital.pdf', 30_000, false);
  await sleep(2500);
  await tap('Continuer');
  step('création d’un besoin : type, détails, prestataire, plan, pièce envoyée (empreinte), récapitulatif');
  await tap('Soumettre le dossier');
  await tap('Voir mes transactions', true);
  step('soumission (submit_operation)');
  const hashes = await documentHashes();
  if (hashes.length !== 1 || !/^[0-9a-f]{64}$/.test(hashes[0] ?? '')) throw new Error(`empreinte de la pièce absente : ${JSON.stringify(hashes)}`);
  step('pièce enregistrée avec son empreinte SHA-256 (serveur)');

  // Liste et détail : place dans l’opération et libellé de suivi.
  await see('À payer par vous', 20_000, false);
  await click(page.locator('[aria-label^="Santé, Clinique Sainte-Élise"]'));
  await see(purpose);
  await see('Reçue par le payeur', 20_000, false);   // mark_received à l’ouverture par le payeur
  step('liste (« À payer par vous ») et détail (« Reçue par le payeur »)');

  // Paiement, puis « Payée » par le simulateur du partenaire côté serveur (aucune démonstration).
  await tap('Payer');
  await tap('Payer avec Face ID');
  await see('Paiement en cours', 20_000, false);
  step('paiement lancé : « Paiement en cours »');
  await see('Payée', 90_000, false);
  step('demande « Payée » par le simulateur du serveur (événement signé, temps réel)');

  await tap('Voir le reçu');
  await see(purpose, 20_000, false);
  step('reçu');

  // Litige après paiement : ouverture, libellé « Contestée », suivi.
  await click(page.locator('[aria-label="Retour"]'));
  await tap('Ouvrir un litige');
  await fill('Décrivez le problème', 'Les soins prévus n’ont pas eu lieu (test de bout en bout).');
  await tap('Ouvrir le litige');
  await see('Contestée', 20_000, false);
  await tap('Voir le litige');
  await see('Litige ouvert', 20_000);
  await see('Prestation non réalisée', 5_000);
  if (await topmost(page.getByText('Payeur (payeur)'))) throw new Error('« Ouvert par » affiche « Payeur (payeur) »');
  step('litige : ouverture, « Contestée », suivi');
  // Retour jusqu’aux onglets (la pile contient le détail, le paiement remplacé par le détail, le litige).
  for (let i = 0; i < 5 && !(await topmost(page.getByText('Alertes', { exact: true }))); i++) await click(page.locator('[aria-label="Retour"]'));

  // Alertes : celles du serveur (paiement, litige), tout marquer comme lu.
  await tap('Alertes');
  await see('Tout marquer comme lu', 20_000);
  await tap('Tout marquer comme lu');
  step('alertes du serveur, tout marquer comme lu');

  // Profil, langue, sécurité.
  await tap('Profil');
  await see('+33 6 39 98 00 11', 20_000, false);
  await tap('Langue');
  await click(page.locator('[aria-label="English"]'));
  await tap('OK');
  await see('Language', 10_000);
  await tap('Language');
  await click(page.locator('[aria-label="Français"]'));
  await tap('OK');
  await see('Langue', 10_000);
  await tap('code de secours', false);
  await see('Sécurité', 10_000);
  await click(page.locator('[aria-label="Retour"]'));
  step('profil, langue (anglais puis français), sécurité');

  // Hors connexion : bandeau et dernières données connues.
  await tap('Transactions');
  await context.setOffline(true);
  await tap('Toutes');
  // Bandeau superposé en haut de l’écran (aucun clic à recevoir) : vérifié par sa visibilité.
  await byText('Hors connexion · dernières données connues').waitFor({ state: 'visible', timeout: 15_000 });
  await see('À payer par vous', 5_000, false);
  await context.setOffline(false);
  await sleep(1500);
  step('hors connexion : bandeau, dernières données affichées');

  // Sans configuration : build de production bloqué par la garde de boutique (inchangée) ; build interne déclaré ou
  // développement : écran « Configuration manquante ». Jamais de repli sur le simulateur.
  await page.goto(empty.base, { waitUntil: 'networkidle' });
  await see('Build non conforme', 20_000);
  step('build de production sans configuration : bloqué par la garde de boutique');
  await page.goto(emptyInternal.base, { waitUntil: 'networkidle' });
  await see('Configuration manquante', 20_000);
  await see('EXPO_PUBLIC_API', 5_000, false);
  if (await topmost(page.getByText('Recevoir le code'))) throw new Error('sans configuration, l’écran de connexion s’affiche');
  step('build interne sans configuration : écran « Configuration manquante »');

  if (pageErrors.length) throw new Error(`erreurs de page : ${pageErrors.join(' | ')}`);
} catch (e) {
  failed = true;
  console.error('Échec :', e.message);
  const shot = path.join(OUT, 'echec.png');
  await page.screenshot({ path: shot }).catch(() => undefined);
  console.error('Capture :', shot, '— URL :', page.url());
} finally {
  await resetAccount().catch((e) => console.error('Nettoyage :', e.message));
  await browser.close();
  main.server.close(); empty.server.close(); emptyInternal.server.close();
}
console.log(`\n${steps.length} étapes réussies${failed ? ' ; ÉCHEC' : ''}.`);
process.exitCode = failed ? 1 : 0;
