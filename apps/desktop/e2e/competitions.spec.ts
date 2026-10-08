import { expect, test, type Page } from '@playwright/test';

import { signIn, stubShell } from './session.js';

/**
 * The competitions smoke (WP-19): Discover → A → team → review → confirm →
 * board (Assigned) → "Move to…" Applied → the Team page lists it — on the web
 * build against the real backend. The team and its two students are made by
 * hand first, so the spec stands on its own; everyone is synthetic (D-33).
 */

async function addStudent(page: Page, roll: string, name: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Students' })
    .click();
  await page.getByRole('link', { name: 'Add a student' }).click();
  await page.getByLabel(/^Roll number/).fill(roll);
  await page.getByLabel(/^Full name/).fill(name);
  await page.getByLabel(/shown the privacy notice/).check();
  await page.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('Discover → A → team → review → confirm → board → Move to Applied → Team page', async ({
  page,
}) => {
  await stubShell(page);
  await page.goto('/');
  await signIn(page);
  await addStudent(page, 'E2EC001', 'Lena Pipeline');
  await addStudent(page, 'E2EC002', 'Omar Pipeline');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Teams' }).click();
  await page.getByRole('link', { name: 'Create a team' }).click();
  await page.getByLabel(/^Team name/).fill('E2E Pipeliners');
  for (const name of ['Lena Pipeline', 'Omar Pipeline']) {
    await page.getByLabel('Add a student').fill(name);
    await page.getByRole('option', { name: new RegExp(name) }).click();
  }
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Pipeliners' })).toBeVisible();

  // Discover: the selected card, then A.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Discover' })
    .click();
  const first = page.getByRole('article').first();
  const title = (await first.getByRole('heading', { level: 3 }).textContent()) ?? '';
  await first.focus();
  await page.keyboard.press('a');
  const dialog = page.getByRole('dialog', { name: `Assign “${title}”` });
  await expect(dialog.getByText('Step 1 of 3')).toBeVisible();
  await dialog.getByRole('radio', { name: /E2E Pipeliners/ }).check();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Registration closes')).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText(/Taking part: Lena Pipeline, Omar Pipeline/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open competition' })).toBeVisible();

  // The board: Assigned, then Move to… Applied.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Competitions' })
    .click();
  const assigned = page.getByRole('region', { name: /^Assigned/ });
  const card = assigned.getByRole('article', {
    name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Move E2E Pipeliners to…' }).click();
  await page.getByRole('menuitem', { name: 'Move to Applied' }).click();
  await expect(
    page.getByRole('region', { name: /^Applied/ }).getByText(title, { exact: true }),
  ).toBeVisible();

  // The Team page lists it, as Applied.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Teams' }).click();
  await page.getByRole('row', { name: /E2E Pipeliners/ }).click();
  const competitions = page.getByRole('list', { name: 'Competitions' });
  await expect(competitions.getByRole('link', { name: title })).toBeVisible();
  await expect(competitions).toContainText('Applied');
});
