import { expect, test, type Page } from '@playwright/test';

import { signIn, stubShell } from './session.js';

/**
 * The teams smoke (WP-18): create a team → add three members → make a lead →
 * the coverage chips read in words — on the web build against the real
 * backend. The three students are added by hand first, so the spec stands on
 * its own; every person is synthetic (D-33).
 */

const STUDENTS = [
  { roll: 'E2ET001', name: 'Tara Teams', skill: 'Python' },
  { roll: 'E2ET002', name: 'Ishan Teams', skill: 'Python' },
  { roll: 'E2ET003', name: 'Neha Teams', skill: 'Figma' },
];

async function addStudent(page: Page, student: (typeof STUDENTS)[number]): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Students' })
    .click();
  await page.getByRole('link', { name: 'Add a student' }).click();
  await page.getByLabel(/^Roll number/).fill(student.roll);
  await page.getByLabel(/^Full name/).fill(student.name);
  await page.getByLabel(/shown the privacy notice/).check();
  await page.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('heading', { level: 1, name: student.name })).toBeVisible();
  await page.getByLabel('Add a skill').fill(student.skill);
  await page
    .getByRole('heading', { name: 'Skills', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Add' })
    .click();
  await expect(page.getByText(`Added ${student.skill}`)).toBeVisible();
}

test('create a team → add three members → make a lead → coverage in words', async ({ page }) => {
  await stubShell(page);
  await page.goto('/');
  await signIn(page);
  for (const student of STUDENTS) await addStudent(page, student);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Teams' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
  await expect(page.getByRole('button', { name: /How the team list works/ })).toBeVisible();
  await page.getByRole('link', { name: 'Create a team' }).click();
  await page.getByLabel(/^Team name/).fill('E2E Falcons');
  await page.getByLabel('Skills this team needs').fill('Python, Figma, SQL');
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Falcons' })).toBeVisible();

  const members = page.getByRole('list', { name: 'Current members' });
  for (const student of STUDENTS) {
    await page.getByLabel('Add a member').fill(student.name);
    await page.getByRole('option', { name: new RegExp(student.name) }).click();
    await expect(members.getByRole('link', { name: student.name })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Members (3)' })).toBeVisible();

  await members.getByRole('button', { name: 'Actions for Ishan Teams' }).click();
  await page.getByRole('menuitem', { name: 'Make lead' }).click();
  await expect(members.getByRole('listitem').filter({ hasText: 'Ishan Teams' })).toContainText(
    'Lead',
  );

  const chips = page.getByRole('list', { name: 'Skill coverage' });
  await expect(chips.getByRole('listitem').filter({ hasText: 'Python' })).toContainText('Covered');
  await expect(chips.getByRole('listitem').filter({ hasText: 'Figma' })).toContainText('Thin');
  await expect(chips.getByRole('listitem').filter({ hasText: 'SQL' })).toContainText('Missing');
  await expect(page.getByText('1 covered · 1 thin · 1 missing')).toBeVisible();

  await page.getByRole('link', { name: 'All teams' }).click();
  await expect(page.getByRole('row', { name: /E2E Falcons/ })).toContainText(
    '1 covered · 1 thin · 1 missing',
  );
});
