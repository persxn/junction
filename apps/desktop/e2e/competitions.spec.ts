import { expect, test, type Page } from '@playwright/test';

import { signIn, stubShell } from './session.js';

/**
 * The competitions smoke (WP-19, WP-20a): Discover → A → team → the Hackathon
 * template → review dates → confirm → the competition's page, where ticking a
 * task moves progress, a link and a path are attached (WP-20b) → board (Assigned) → "Move to…" Applied → the Team page
 * lists it — on the web
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

test('Discover → A → team → Hackathon template → dates → confirm → tick → board → Applied', async ({
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
  await expect(dialog.getByText('Step 1 of 4')).toBeVisible();
  await dialog.getByRole('radio', { name: /E2E Pipeliners/ }).check();
  await dialog.getByRole('button', { name: 'Next' }).click();
  // WP-20a: the Hackathon template, whatever the event's type.
  await dialog.getByRole('radio', { name: /^Hackathon/ }).check();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Registration closes')).toBeVisible();
  await expect(dialog.getByText(/Stage dates — Hackathon/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText(/Taking part: Lena Pipeline, Omar Pipeline/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await page.getByRole('button', { name: 'Open competition' }).click();

  // The copied workflow: tick a task and the progress moves off 0%.
  const progress = page.getByRole('progressbar', { name: 'Workflow progress' });
  await expect(progress).toHaveAttribute('aria-valuetext', '0%');
  await page
    .getByRole('list', { name: 'Tasks of Team & registration' })
    .getByRole('checkbox')
    .first()
    .check();
  await expect(progress).not.toHaveAttribute('aria-valuetext', '0%');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // WP-20b: a link and a path, against the real backend; outside the shell a path is Copy only.
  const addResource = async (text: string): Promise<void> => {
    await page.getByRole('button', { name: 'Add a resource to this competition' }).click();
    const add = page.getByRole('dialog', { name: 'Add a resource to this competition' });
    await add.getByLabel('Link or path').fill(text);
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(add).toBeHidden();
  };
  await addResource('https://github.com/e2e/pipeline.git');
  const links = page.getByRole('list', { name: 'Resources of this competition' });
  await expect(links.getByText('e2e/pipeline')).toBeVisible();
  await expect(links.getByRole('button', { name: 'Open e2e/pipeline' })).toBeVisible();
  await addResource('C:\\Team\\deck.pdf');
  await expect(links.getByText(/Opening files needs the CompIntel desktop app/)).toBeVisible();
  await expect(links.getByRole('button', { name: 'Open deck.pdf' })).toHaveCount(0);

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
