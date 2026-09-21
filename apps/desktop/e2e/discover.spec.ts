import { expect, test, type Page } from '@playwright/test';

import { readEnvironment } from './environment.js';

/**
 * The Discover smoke (WP-16a step 10): sign in → Discover → two filters →
 * J/K/Enter → Save → Undo, on the web build against a real, seeded backend.
 *
 * The web build has no Tauri shell, so the page gets the shell's answers from a
 * stub of `window.__TAURI_INTERNALS__` — exactly the IPC surface the shell
 * provides (`backend_status`, `backend_connection`, events), pointing at the
 * real backend. Everything past that boundary is real: HTTP, auth, search,
 * ranking, facets, Save and Undo.
 */

async function stubShell(page: Page): Promise<void> {
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

test('sign in → Discover → two filters → J/K/Enter → Save → Undo', async ({ page }) => {
  const env = readEnvironment();
  await stubShell(page);
  await page.goto('/');

  // Sign in with the account the real setup wizard created.
  await page.getByLabel('Email').fill(env.email);
  await page.getByLabel('Password').fill(env.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Discover, from the rail.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Discover' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible();
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();
  // Real ranking reasons and real distances from the seeded campus.
  await expect(cards.first()).toContainText(/km \(straight line\)|Online|Distance unknown/);

  // Two filters.
  await page.getByRole('button', { name: 'Mode filter' }).click();
  await page.getByRole('checkbox', { name: /^In person/ }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Distance filter' }).click();
  await page.getByRole('radio', { name: /Within 500 km/ }).check();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Distance filter: Within 500 km (in person)' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mode filter: In person' })).toBeVisible();
  await expect(page.locator('#discover-count')).toContainText(/\d+ events?/);
  await expect(cards.first()).toContainText('km (straight line)');

  // For the manual check: what a professor sees, written outside the repository.
  const shot = process.env.E2E_SCREENSHOT;
  if (shot !== undefined && shot !== '') await page.screenshot({ path: shot });

  // J/K/Enter.
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await expect(cards.nth(1)).toBeFocused();
  const title = (await cards.nth(1).getByRole('heading', { level: 3 }).textContent()) ?? '';
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(cards.nth(1)).toBeFocused();

  // Save (S), then Undo.
  await page.keyboard.press('s');
  await expect(page.getByText(`Saved “${title}”`)).toBeVisible();
  await expect(cards.nth(1).getByRole('button', { name: 'Saved' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cards.nth(1).getByRole('button', { name: 'Save' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
