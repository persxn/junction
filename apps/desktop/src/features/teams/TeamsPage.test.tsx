import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { renderApp } from '../../testing/render.js';
import { makeStudent, OTHER_PROFESSOR } from '../../testing/students-api.js';
import { installTeamsApi, makeTeam, memberOf, type TeamsApi } from '../../testing/teams-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const RAVI = makeStudent(8, { fullName: 'Ravi Demo' });

let api: TeamsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  api = installTeamsApi({
    students: [ASHA, RAVI],
    teams: [
      makeTeam(1, { name: 'Alpha', members: [memberOf(ASHA)], targets: ['Figma'] }),
      makeTeam(2, { name: 'Beta' }),
    ],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Teams list', () => {
  it('shows the columns in words and opens a team with J and Enter', async () => {
    const user = userEvent.setup();
    await renderApp('/teams');
    const table = await screen.findByRole('table');
    const alpha = within(table).getByText('Alpha').closest('tr')!;
    expect(alpha).toHaveTextContent('1 missing');
    expect(alpha).toHaveTextContent('Ada Lovelace');
    expect(alpha).toHaveTextContent('Active');
    expect(within(table).getByText('Beta').closest('tr')).toHaveTextContent('No skills yet');

    await user.keyboard('j');
    expect(within(table).getByText('Beta').closest('tr')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Beta' })).toBeInTheDocument();
  });

  it('asks the server for my teams and for archived teams', async () => {
    const user = userEvent.setup();
    await renderApp('/teams');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'My teams' }));
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText('No team matches these filters')).toBeInTheDocument();
    const query = api.teamCalls.filter((call) => call.path === '/api/v1/teams').at(-1)?.query;
    expect(query).toContain('status=ARCHIVED');
    expect(query).toContain('mentor=me');
  });
});

describe('the create form', () => {
  it('creates a team with three members and a lead', async () => {
    const extra = makeStudent(9, { fullName: 'Meera Demo' });
    api = installTeamsApi({ students: [ASHA, RAVI, extra] });
    const user = userEvent.setup();
    await renderApp('/teams/new');
    await screen.findByRole('heading', { level: 1, name: 'Create a team' });
    await user.type(screen.getByLabelText(/Team name/), 'Quantum Quokkas');
    await user.type(screen.getByLabelText('Skills this team needs'), 'Python, Figma');
    for (const name of ['Asha', 'Ravi', 'Meera']) {
      await user.type(screen.getByLabelText('Add a student'), name);
      await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
    }
    const list = screen.getByRole('list', { name: 'Members to add' });
    await user.click(within(list).getAllByRole('button', { name: 'Lead' })[1]!);
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quantum Quokkas' }),
    ).toBeInTheDocument();
    const team = [...api.teams.values()].find((row) => row.name === 'Quantum Quokkas')!;
    expect(team.members.map((m) => [m.fullName, m.isLead])).toEqual([
      ['Asha Demo', false],
      ['Ravi Demo', true],
      ['Meera Demo', false],
    ]);
    expect(team.targets).toEqual(['Python', 'Figma']);
  });

  it('says what is wrong without asking the server', async () => {
    const user = userEvent.setup();
    await renderApp('/teams/new');
    await screen.findByRole('heading', { level: 1, name: 'Create a team' });
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    expect(screen.getByText('Give the team a name of at least 2 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Team name/)).toHaveFocus();
    expect(api.teamCalls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('lets an administrator who is not a professor choose the primary mentor', async () => {
    const user = userEvent.setup();
    await renderApp('/teams/new', { roles: ['ADMINISTRATOR'] });
    await screen.findByRole('heading', { level: 1, name: 'Create a team' });
    await user.type(screen.getByLabelText(/Team name/), 'Admin Made');
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    expect(
      screen.getByText('Choose the professor who will be the primary mentor.'),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Primary mentor'), 'Grace Hopper');
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    await screen.findByRole('heading', { level: 1, name: 'Admin Made' });
    expect(api.teamCalls.find((call) => call.method === 'POST')?.body?.primaryUserId).toBe(
      OTHER_PROFESSOR,
    );
  });
});
