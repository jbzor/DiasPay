import { defineConfig, devices } from '@playwright/test';

/**
 * Tests de bout en bout du bureau de contrôle, contre le projet Supabase de développement
 * (mock_mode = 'true', require_staff_mfa = 'false', seed.sql et seed-staff.sql exécutés).
 * Lit apps/web/.env.local (URL et clé publique) et .env.local à la racine (E2E_STAFF_PASSWORD).
 * Application servie en production (next build puis next start) : CSP et en-têtes réels.
 *
 *   pnpm --filter @diaspay/web build && pnpm --filter @diaspay/web e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Africa/Douala',
    viewport: { width: 1366, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1366, height: 900 } } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/connexion`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
