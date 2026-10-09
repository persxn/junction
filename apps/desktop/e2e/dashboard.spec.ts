import { expect, test, type Page } from '@playwright/test';

import { signIn, stubShell } from './session.js';

/**
 * The Dashboard smoke (WP-22, R107): sign in → Dashboard → click each of the
 * four KPI tiles → the list it opens shows the same total in its header, on
 * the web build against the real, seeded backend.
 */

const KEYS = ['UPCOMING_EVENTS', 'CLOSING_SOON', 'ACTIVE_COMPETITIONS', 'OVERDUE_TASKS'] as const;

/** The number at the start of a header like "about 1,234 events" or "3 due". */
const leadingCount = (text: string): string => /^(about )?[\d,]+/.exec(text.trim())?.[0] ?? '';

async function listHeaderCount(page: Page, key: (typeof KEYS)[number]): Promise<string> {
  if (key === 'ACTIVE_COMPETITIONS') {
    const line = page.getByText(/^[\d,]+ competitions? match these filters\.$/);
    await expect(line).toBeVisible();
    return leadingCount((await line.textContent()) ?? '');
  }
  if (key === 'OVERDUE_TASKS') {
    const line = page.getByText(/^[\d,]+ due$/);
    await expect(line).toBeVisible();
    return leadingCount((await line.textContent()) ?? '');
  }
  const line = page.getByText(/^(about )?[\d,]+ events?$/);
  await expect(line).toBeVisible();
  return leadingCount((await line.textContent()) ?? '');
}

test('Dashboard → each KPI tile → the list shows the same total', async ({ page }) => {
  await stubShell(page);
  await page.goto('/');
  await signIn(page);
  for (const key of KEYS) {
    // Through the rail: a reload would sign us out (the session lives in memory).
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Dashboard' })
      .click();
    const tile = page.getByTestId(`kpi-${key}`);
    await expect(tile).toBeVisible();
    const value = leadingCount((await tile.textContent()) ?? '');
    await tile.click();
    expect(await listHeaderCount(page, key), key).toBe(value);
  }
});
