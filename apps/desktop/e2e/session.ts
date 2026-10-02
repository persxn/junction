import { expect, type Page } from '@playwright/test';

import { readEnvironment } from './environment.js';

/**
 * The shell stub and the sign-in every E2E spec starts with (shared since
 * WP-17's students spec).
 *
 * The web build has no Tauri shell, so the page gets the shell's answers from a
 * stub of `window.__TAURI_INTERNALS__` pointing at the real backend.
 */

export async function stubShell(page: Page): Promise<void> {
  const env = readEnvironment();
  await page.addInitScript(
    ({ baseUrl, port, clientSecret, dataDir }) => {
      let nextCallback = 1;
      const answers: Record<string, unknown> = {
        backend_status: {
          phase: 'READY',
          generation: 1,
          port,
          recentCrashes: 0,
          lastError: null,
          dataDir,
          logsDir: `${dataDir}\\logs`,
          appVersion: '0.1.0',
        },
        backend_connection: { baseUrl, clientSecret, generation: 1 },
        shell_settings: { closeToTray: true, autostart: false },
      };
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: {
          invoke: (command: string) =>
            Promise.resolve(
              command.startsWith('plugin:event|listen')
                ? nextCallback++
                : (answers[command] ?? null),
            ),
          transformCallback: () => nextCallback++,
          unregisterCallback: () => undefined,
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        },
      });
    },
    { baseUrl: env.baseUrl, port: env.port, clientSecret: env.clientSecret, dataDir: env.dataDir },
  );
}

/**
 * Signing in, and then R74's one-time "Connect your sources" step if this
 * installation has not been through it yet (pre-M2a item 5).
 *
 * The step is the first thing an administrator meets after the wizard, so the
 * smoke meets it too. Going through it here is the real-browser evidence that it
 * appears once and then stands between nobody and the app: the second spec signs
 * in to the same backend and never sees it again.
 */
export async function signIn(page: Page): Promise<void> {
  const env = readEnvironment();
  await page.getByLabel('Email').fill(env.email);
  await page.getByLabel('Password').fill(env.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const connect = page.getByRole('heading', { name: 'Connect your sources' });
  const rail = page.getByRole('navigation', { name: 'Main' });
  await expect(connect.or(rail).first()).toBeVisible();
  if (await connect.isVisible()) {
    await page.getByRole('button', { name: 'Skip for now' }).click();
  }
  await expect(rail).toBeVisible();
}
