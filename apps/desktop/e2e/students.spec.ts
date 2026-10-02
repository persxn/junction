import { expect, test } from '@playwright/test';

import { signIn, stubShell } from './session.js';

/**
 * The students smoke (WP-17 step 8): add a student by hand → import a small
 * CSV → read the preview with its error row → commit → the list holds them —
 * on the web build against the real backend.
 *
 * The web build has no shell, so the file is chosen through the browser
 * stand-in (`shell/files.ts`), which Playwright answers with an in-memory CSV:
 * nothing is read from or written to the disk, and every person is synthetic
 * (D-33).
 */

const CSV = [
  'Roll No.,Name,Programme,Batch,Skills,Hostel',
  'E2E0001,Kavya E2E,B.Tech,2027,"Python:3, SQL",North',
  'E2E0002,Rohan E2E,BCA,2026,,South',
  'E2E0003,Bad Programme E2E,Diploma,2027,,North',
].join('\n');

test('add a student → import a CSV with one bad row → commit', async ({ page }) => {
  await stubShell(page);
  await page.goto('/');
  await signIn(page);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Students' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
  await expect(page.getByRole('button', { name: /How the student list works/ })).toBeVisible();

  // Add one by hand.
  await page.getByRole('link', { name: 'Add a student' }).click();
  await page.getByLabel(/^Roll number/).fill('E2E0100');
  await page.getByLabel(/^Full name/).fill('Manual E2E');
  await page.getByLabel(/shown the privacy notice/).check();
  await page.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Manual E2E' })).toBeVisible();
  await expect(page.getByText('Not in a team yet', { exact: false })).toBeVisible();

  // Import.
  await page.getByRole('link', { name: 'All students' }).click();
  await page.getByRole('link', { name: 'Import a list' }).first().click();
  await expect(page.getByRole('table', { name: 'Accepted columns' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file…' }).click();
  await (
    await chooser
  ).setFiles({ name: 'e2e-students.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

  await expect(page.getByRole('heading', { name: 'What will happen' })).toBeVisible();
  await expect(page.getByLabel('Import “Hostel” as')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Rows with errors (1)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('cell', { name: /Diploma/ })).toContainText('is not a programme');

  await page.getByLabel(/new students have been shown the privacy notice/).check();
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await expect(page.getByText('2 new students added')).toBeVisible();

  await page.getByRole('link', { name: 'See the students' }).click();
  await expect(page.getByText('3 students.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Kavya E2E/ })).toBeVisible();
  await page.getByRole('button', { name: 'My students' }).click();
  await expect(page.getByText('3 students match these filters.')).toBeVisible();
});
