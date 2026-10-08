import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { renderApp } from '../../testing/render.js';
import { makeStudent } from '../../testing/students-api.js';
import { installTeamsApi, makeTeam, memberOf, primaryOf } from '../../testing/teams-api.js';

/**
 * WP-18's screens with axe (R89's `pnpm test:a11y`): the list, a team with
 * every section filled, its member menu, role and hand-over dialogs, the form,
 * and the Student page's Teams section — each with its guide open.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ASHA = makeStudent(7, {
  fullName: 'Asha Demo',
  tags: [
    {
      tagId: '0192f0c1-0000-7000-8000-000000008001',
      name: 'Python',
      relation: 'SKILL',
      proficiency: 2,
    },
  ],
});
const RAVI = makeStudent(8, { fullName: 'Ravi Demo', status: 'INACTIVE' });
const ALPHA = makeTeam(1, {
  name: 'Alpha',
  description: 'Hackathon team for the spring season.',
  members: [memberOf(ASHA, { roleLabel: 'Backend', isLead: true }), memberOf(RAVI)],
  pastMembers: [memberOf(RAVI, { leftAt: '2026-10-01T10:00:00.000Z' })],
  mentors: [
    primaryOf(),
    { ...primaryOf('0192f0c1-0000-7000-8000-00000000a002'), role: 'CO_MENTOR' },
  ],
  targets: ['Python', 'Figma'],
});

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installTeamsApi({ students: [ASHA, RAVI], teams: [ALPHA, makeTeam(2, { status: 'ARCHIVED' })] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the list', async () => {
    await renderApp('/teams');
    await screen.findByText('Alpha');
    await expect(document.body).toBeAccessible();
  });

  it('a team, its member menu and its dialogs', async () => {
    const user = userEvent.setup();
    await renderApp(`/teams/${ALPHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    await expect(document.body).toBeAccessible();
    const list = screen.getByRole('list', { name: 'Current members' });
    await user.click(within(list).getByRole('button', { name: 'Actions for Asha Demo' }));
    await expect(document.body).toBeAccessible();
    await user.click(screen.getByRole('menuitem', { name: 'Edit role…' }));
    await expect(document.body).toBeAccessible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Hand over…' }));
    await expect(document.body).toBeAccessible();
  });

  it('the add-member typeahead, open', async () => {
    const user = userEvent.setup();
    installTeamsApi({
      students: [ASHA, RAVI, makeStudent(9, { fullName: 'Meera Demo' })],
      teams: [ALPHA],
    });
    await renderApp(`/teams/${ALPHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    await user.type(screen.getByLabelText('Add a member'), 'Meera');
    await screen.findByRole('listbox');
    await expect(document.body).toBeAccessible();
  });

  it('the create form, as an administrator', async () => {
    await renderApp('/teams/new', { roles: ['ADMINISTRATOR'] });
    await screen.findByRole('heading', { level: 1, name: 'Create a team' });
    await expect(document.body).toBeAccessible();
  });

  it('the Student page with its teams', async () => {
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('list', { name: 'Current teams' });
    await expect(document.body).toBeAccessible();
  });
});
