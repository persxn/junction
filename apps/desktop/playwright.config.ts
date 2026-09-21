import { defineConfig } from '@playwright/test';

/**
 * `pnpm e2e` — the Discover smoke (§17: "Playwright smoke per screen", WP-16a).
 *
 * - The **installed Microsoft Edge** (`channel: 'msedge'`); no browser is ever
 *   downloaded (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the script). If Edge
 *   cannot be launched, the run fails — it never silently skips.
 * - Against the **web build** (`vite preview`) on `http://localhost:5173`, the one
 *   browser origin the backend's CORS allowlist admits (ruling A3), and a
 *   **real backend** on a throwaway data directory seeded by `pnpm seed:demo`
 *   (`e2e/global-setup.ts`).
 * - Outside `pnpm verify` (§4.15's two-minute budget; the R19 reasoning).
 */
// Belt and braces: nothing in this run may fetch a browser build.
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    headless: true,
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite preview --host localhost --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
