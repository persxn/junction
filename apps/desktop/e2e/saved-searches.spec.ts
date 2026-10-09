import { expect, test } from '@playwright/test';

import { readEnvironment } from './environment.js';
import { signIn, stubShell } from './session.js';

/**
 * WP-24's smoke on the web build against the real, seeded backend: set an
 * interest → Recommended puts it first and says why → save a search → an
 * event arrives (a manual entry: `seed:demo` switches every source off, so
 * nothing is scraped and nothing is contacted) → exactly one bell item →
 * open it → the search's chips are back.
 */

const SEARCH = 'Zebracorn watch';
const TITLE = 'Zebracorn Robotics Hackathon';

/** Adds an event as a professor would through "Add an event", over the API. */
async function addEvent(): Promise<void> {
  const env = readEnvironment();
  const headers = { 'X-CompIntel-Client': env.clientSecret, 'Content-Type': 'application/json' };
  const login = await fetch(`${env.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: env.email, password: env.password, clientLabel: 'e2e' }),
  });
  expect(login.status).toBe(200);
  const { token } = (await login.json()) as { token: string };
  const created = await fetch(`${env.baseUrl}/api/v1/events`, {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: TITLE,
      eventType: 'HACKATHON',
      mode: 'ONLINE',
      registrationDeadlineAt: { at: '2026-12-20' },
    }),
  });
  expect(created.status, await created.clone().text()).toBe(200);
}

test('interest → Recommended explains it → save a search → new event → one bell item → chips back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await stubShell(page);
  await page.goto('/');
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Discover' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible();

  // 1. Interests: Recommended reorders, and the first card says why.
  await page.getByRole('button', { name: 'Pick your interests' }).click();
  const dialog = page.getByRole('dialog', { name: 'My interests' });
  await dialog.getByRole('checkbox', { name: 'Robotics' }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/Pick your interests to sharpen these/)).toHaveCount(0);
  await expect(page.getByRole('article').first().getByTestId('card-reasons')).toContainText(
    'Robotics matches your interests',
  );

  // 2. Save a search: online events about "zebracorn" (none exist yet).
  await page.getByRole('button', { name: 'Mode filter' }).click();
  await page.getByRole('checkbox', { name: /^Online/ }).check();
  await page.keyboard.press('Escape');
  await page
    .getByRole('searchbox', { name: 'Search events' })
    .or(page.getByRole('textbox', { name: 'Search events' }))
    .fill('zebracorn');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mode filter: Online' })).toBeVisible();
  await page.getByRole('button', { name: 'Save this search' }).click();
  const save = page.getByRole('dialog', { name: 'Save this search' });
  await expect(save.getByRole('checkbox', { name: /Tell me about new matches/ })).toBeChecked();
  await save.getByRole('textbox', { name: 'Name' }).fill(SEARCH);
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(save).toHaveCount(0);

  // Leave Discover, so coming back proves the notification restored the chips.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Dashboard' })
    .click();

  // 3. An event arrives; the evaluator runs after the ingest and tells me once.
  await addEvent();
  const bell = page.getByRole('button', { name: /^1 unread notification/ });
  await expect(bell).toBeVisible({ timeout: 75_000 });
  await bell.click();
  const item = page.getByText(`1 new event matches “${SEARCH}”`).first();
  await expect(item).toBeVisible();
  await item.click();

  // 4. Discover with the search applied: the chip is back, and so is the event.
  await expect(page.getByRole('button', { name: 'Mode filter: Online' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: TITLE })).toBeVisible();
});
