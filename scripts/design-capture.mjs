#!/usr/bin/env node
/**
 * Captures de conformité au design : un écran de l’application pour chaque image de docs/maquette/.
 *
 *   pnpm capture            # construit l’export web de démonstration, puis capture
 *   pnpm capture --no-build # réutilise apps/mobile/dist
 *
 * - Export web interne sur le simulateur (EXPO_PUBLIC_API=mock, EXPO_PUBLIC_DEMO=1, EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1), servi localement.
 * - Chrome installé sur la machine, piloté par playwright-core (aucun navigateur téléchargé) ;
 *   CHROME_PATH permet d’indiquer un autre exécutable.
 * - 390 × 844 points, facteur 2 (780 × 1688 pixels, comme la maquette).
 * - Sortie : docs/captures/<même nom que l’image de la maquette>.png
 * Le back-office (24, 31, 32, 33) n’est pas dans l’application mobile : il n’est pas capturé.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps/mobile');
const DIST = path.join(APP, 'dist');
const OUT = path.join(ROOT, 'docs/captures');
const FIXTURES = path.join(ROOT, 'scripts/fixtures');

// ——— 1. Export web de démonstration ———
if (!process.argv.includes('--no-build')) {
  console.log('Export web de démonstration…');
  const r = spawnSync('pnpm', ['exec', 'expo', 'export', '--platform', 'web'], {
    cwd: APP, stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_API: 'mock', EXPO_PUBLIC_DEMO: '1', EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE: '1' },   // simulateur : explicite (lot A)
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// ——— 2. Serveur statique (repli sur index.html pour les routes) ———
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

// ——— 3. Navigateur ———
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('Erreur de page :', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = [];

/** Élément visible portant exactement ce texte (ou ce libellé d’accessibilité). */
const byText = (text, exact = true) => page.getByText(text, { exact }).filter({ visible: true }).first();
const byLabel = (label) => page.locator(`[aria-label="${label}"]`).filter({ visible: true }).first();
/** Élément réellement au premier plan parmi ceux qui correspondent (les écrans précédents restent montés dessous). */
async function clickTopmost(locator, wait = 800) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    const box = await el.boundingBox();
    if (!box || box.width === 0 || box.y < 0 || box.y > 844) continue;
    const onTop = await el.evaluate((node, [x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (node === hit || node.contains(hit)); },
      [box.x + box.width / 2, box.y + box.height / 2]);
    if (onTop) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(wait); return; }
  }
  throw new Error(`aucun élément au premier plan pour ${locator}`);
}
/** Ligne de liste par le début de son libellé d’accessibilité (« Scolarité, École Les Palmiers, … »). */
const openRow = (prefix, wait = 800) => clickTopmost(page.locator(`[aria-label^="${prefix}"]`), wait);
async function tap(text, opts = {}) { await (opts.label ? byLabel(text) : byText(text, opts.exact ?? true)).click(); await sleep(opts.wait ?? 450); }
async function fill(label, value) {
  const el = page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`).filter({ visible: true }).first();
  await el.fill(''); await el.pressSequentially(value); await sleep(200);
}
async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  done.push(name);
  console.log('  ✓', name);
}
async function upload(source, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap(source)]);
  await chooser.setFiles(path.join(FIXTURES, file));
  await sleep(2600);
}
async function signIn({ firstTime }) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(1700);
  if (await byText('Passer').isVisible().catch(() => false)) await tap('Passer');
  await fill('Téléphone', '6 12 34 56 78');
  await tap('Recevoir le code');
  await page.locator('input[aria-label="Chiffre 1 sur 6"]').click();
  await page.keyboard.type('123456'); await sleep(200);
  await tap('Valider', { wait: 800 });
  if (firstTime || page.url().includes('profile-setup')) {
    await fill('Nom complet', 'Marie N.'); await tap('Choisir un pays'); await tap('France'); await tap('Continuer', { wait: 700 });
    await tap('Continuer', { wait: 900 });
  }
}

try {
  // A1, A2 — lancement et présentation
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(250); await shot('01_Splash');
  await sleep(1600); await shot('02_Onboarding1');
  await tap('Suivant', { wait: 700 }); await shot('03_Onboarding2');
  await tap('Suivant', { wait: 700 }); await shot('04_Onboarding3');
  // A3 — connexion et code
  await tap('Commencer', { wait: 700 });
  await fill('Téléphone', '6 12 34 56 78'); await shot('05_Login');
  await tap('Recevoir le code', { wait: 700 });
  await page.locator('input[aria-label="Chiffre 1 sur 6"]').click();
  await page.keyboard.type('48271'); await sleep(300); await shot('06_Otp');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await page.locator('input[aria-label="Chiffre 1 sur 6"]').click();
  await page.keyboard.type('123456'); await sleep(200);
  await tap('Valider', { wait: 900 });
  // A4, A5 — profil et biométrie
  await fill('Nom complet', 'Marie N.'); await tap('Choisir un pays'); await tap('France'); await shot('07_Profile');
  await tap('Continuer', { wait: 800 }); await shot('08_Biometrie');
  await tap('Continuer', { wait: 1000 });

  // B1, C1, C2 — accueil, liste, détail
  await shot('15_Main');
  await tap('Transactions', { wait: 700 }); await shot('16_List');
  await openRow('Scolarité, École Les Palmiers'); await shot('17_Detail');
  // H2, H3 — jeton et paiement de la tranche 2
  await tap('Afficher le QR', { wait: 900 }); await shot('18_Token');
  await tap('Retour', { label: true, wait: 600 });
  await tap('Payer', { wait: 800 }); await shot('19_Paiement');
  await tap('Retour', { label: true, wait: 600 });
  // H9 — ouvrir un litige sur la tranche 1 (confirmée), puis H10 en cours
  await tap('Ouvrir un litige', { wait: 800 });
  await fill('Décrivez le problème', 'Les cours prévus n’ont pas eu lieu.'); await shot('22_Dispute');
  await tap('Ouvrir le litige', { wait: 900 });
  await tap('Voir le litige', { wait: 900 }); await shot('29_LitigeSuivi');
  // H10 résolu (décision simulée : remboursement)
  await tap('Simuler : rembourser le payeur', { wait: 500 });
  await fill('Note de décision', 'Le prestataire n’a pas pu justifier la prestation dans le délai. Le montant est remboursé au payeur.');
  await tap('Décider', { wait: 900 }); await shot('30_LitigeResolu');
  await tap('Retour', { label: true, wait: 600 });
  await tap('Retour', { label: true, wait: 600 });

  // H7 — reçu d’une tranche débloquée (loyer, tranche 3)
  await openRow('Loyer, Studio Bastos');
  await byText('Voir le reçu').click(); await sleep(1000); await shot('23_Receipt');
  await tap('Retour', { label: true, wait: 600 });
  await tap('Retour', { label: true, wait: 600 });
  // H8 — dépôt de preuve : hors périmètre (vague 2) ; écran le plus proche : jalon « Preuve soumise » du terrain
  await openRow('Terrain, Étude notariale Mbarga'); await shot('21_Evidence');
  await tap('Retour', { label: true, wait: 600 });

  // G1 à G6 — création d’un besoin
  await tap('Accueil', { wait: 600 });
  await tap('Nouveau besoin', { wait: 700 }); await tap('Santé'); await shot('09_Type');
  await tap('Continuer', { wait: 700 });
  await fill('Montant', '180000'); await fill('Bénéficiaire', 'Rose M.');
  await page.locator('input[aria-label="Date souhaitée"]').fill('2026-11-15'); await sleep(300);
  await shot('10_Details');
  await fill('Objectif', 'Opération du genou');
  await tap('Continuer', { wait: 900 });
  await fill('Rechercher un prestataire', 'Hôpital'); await sleep(900);
  await tap('Hôpital Central'); await shot('11_Provider');
  await tap('Continuer', { wait: 800 });
  await tap('Échelonné', { wait: 600 }); await shot('12_Plan');
  await tap('Continuer', { wait: 700 });
  await byLabel('Ajouter : Devis ou facture proforma').click(); await sleep(500);
  await upload('Choisir un document', 'devis_hopital.pdf'); await shot('13_Create');
  await byLabel('Ajouter : Pièce d’identité du bénéficiaire').click(); await sleep(500);
  await upload('Choisir un document', 'piece_identite.png');
  await tap('Continuer', { wait: 800 }); await shot('14_Recap');
  await tap('Soumettre le dossier', { wait: 3200 });

  // F1, F2 — profil et sécurité ; E1 — alertes
  await tap('Profil', { wait: 700 }); await shot('27_Profil');
  await tap('code de secours', { exact: false, wait: 800 }); await shot('28_Securite');
  await tap('Retour', { label: true, wait: 600 });
  await tap('Alertes', { wait: 800 }); await shot('25_Notifs');

  // H5 — scan prestataire (profil de démonstration prestataire)
  await tap('Profil', { wait: 600 });
  await byText('Prestataire').click(); await sleep(400);
  await tap('Scanner', { wait: 900 }); await shot('20_Scan');

  // E1 état vide : alertes effacées dans l’instantané de la simulation, puis rechargement
  await page.evaluate(() => {
    const key = 'diaspay.simulator.v1';
    const snap = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (snap) { snap.notifications = []; localStorage.setItem(key, JSON.stringify(snap)); }
  });
  await signIn({ firstTime: false });
  await tap('Alertes', { wait: 900 }); await shot('26_NotifsVide');
} catch (e) {
  console.error('Échec de la capture :', e.message);
  await page.screenshot({ path: path.join(OUT, '_erreur.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

const expected = fs.readdirSync(path.join(ROOT, 'docs/maquette')).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''));
const backOffice = ['24_Backoffice', '31_BoPreuves', '32_BoLitiges', '33_BoJournal'];
const missing = expected.filter((n) => !done.includes(n) && !backOffice.includes(n));
console.log(`\n${done.length} captures dans docs/captures/ ; hors périmètre mobile : ${backOffice.join(', ')}.`);
if (missing.length) { console.error('Manquantes :', missing.join(', ')); process.exitCode = 1; }
