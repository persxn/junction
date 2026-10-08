import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { renderApp } from '../../testing/render.js';
import { makeStudent } from '../../testing/students-api.js';
import { installTeamsApi, makeTeam, memberOf, type TeamsApi } from '../../testing/teams-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const python = (n: number) => ({
  tagId: `0192f0c1-0000-7000-8000-00000000800${String(n)}`,
  name: 'Python',
  relation: 'SKILL' as const,
  proficiency: 1 as const,
});
const ASHA = makeStudent(7, { fullName: 'Asha Demo', tags: [python(1)] });
const RAVI = makeStudent(8, { fullName: 'Ravi Demo', tags: [python(2)] });

function threeTeams() {
  return [
    makeTeam(1, {
      name: 'Alpha',
      members: [memberOf(ASHA, { roleLabel: 'Backend', isLead: true }), memberOf(RAVI)],
      targets: ['Python', 'Figma'],
    }),
    makeTeam(2, { name: 'Beta', members: [memberOf(ASHA, { roleLabel: 'Presenter' })] }),
    makeTeam(3, { name: 'Gamma', members: [memberOf(ASHA, { roleLabel: 'Designer' })] }),
  ];
}

let api: TeamsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  api = installTeamsApi({ students: [ASHA, RAVI], teams: threeTeams() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const teamId = (name: string): string =>
  [...api.teams.values()].find((team) => team.name === name)!.id;

async function openTeam(name: string) {
  const user = userEvent.setup();
  await renderApp(`/teams/${teamId(name)}`);
  await screen.findByRole('heading', { level: 1, name });
  return user;
}

const members = (): HTMLElement => screen.getByRole('list', { name: 'Current members' });

describe('student in three teams', () => {
  it('the Student page lists three teams, each linking to its page', async () => {
    const user = userEvent.setup();
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
    const list = screen.getByRole('list', { name: 'Current teams' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(within(list).getByText('Lead')).toBeInTheDocument();
    await user.click(within(list).getByRole('link', { name: 'Beta' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Beta' })).toBeInTheDocument();
  });

  it('removing him from one team via the Team page leaves two', async () => {
    const user = await openTeam('Gamma');
    await user.click(within(members()).getByRole('button', { name: 'Actions for Asha Demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    await screen.findByText('Asha Demo left Gamma');
    expect(api.students.get(ASHA.id)?.teams.filter((team) => team.leftAt === null)).toHaveLength(2);
    // The closed row is kept (R95).
    expect(api.teams.get(teamId('Gamma'))?.pastMembers).toHaveLength(1);
  });
});

describe('the member menu', () => {
  it('remove + Undo restores the same role and lead', async () => {
    const user = await openTeam('Alpha');
    await user.click(within(members()).getByRole('button', { name: 'Actions for Asha Demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    // Optimistic: gone before the server answers.
    expect(within(members()).queryByText('Asha Demo')).toBeNull();
    await screen.findByText('Asha Demo left Alpha');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      const back = api.teams.get(teamId('Alpha'))?.members.find((m) => m.studentId === ASHA.id);
      expect(back).toMatchObject({ roleLabel: 'Backend', isLead: true });
    });
    expect(await within(members()).findByText('Asha Demo')).toBeInTheDocument();
  });

  it('works by keyboard: open, move, choose, and Esc gives focus back', async () => {
    const user = await openTeam('Alpha');
    const trigger = within(members()).getByRole('button', { name: 'Actions for Ravi Demo' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Edit role…' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Make lead' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      const team = api.teams.get(teamId('Alpha'))!;
      expect(team.members.find((m) => m.studentId === RAVI.id)?.isLead).toBe(true);
      expect(team.members.find((m) => m.studentId === ASHA.id)?.isLead).toBe(false);
    });
  });

  it('edits a role in its dialog', async () => {
    const user = await openTeam('Alpha');
    await user.click(within(members()).getByRole('button', { name: 'Actions for Ravi Demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit role…' }));
    const dialog = screen.getByRole('dialog', { name: 'Ravi Demo’s role' });
    await user.type(within(dialog).getByLabelText('Role in this team'), 'Frontend');
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await waitFor(() => {
      expect(
        api.teams.get(teamId('Alpha'))?.members.find((m) => m.studentId === RAVI.id)?.roleLabel,
      ).toBe('Frontend');
    });
  });
});

describe('conflicts and permissions', () => {
  it('a 409 puts the page back and shows the reload message', async () => {
    api = installTeamsApi({ students: [ASHA, RAVI], teams: threeTeams(), conflictOnce: true });
    const user = await openTeam('Alpha');
    await user.click(within(members()).getByRole('button', { name: 'Actions for Ravi Demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    expect(
      await screen.findByText('Someone else changed this team — reload to see their changes.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(within(members()).getByText('Ravi Demo')).toBeInTheDocument();
  });

  it('a co-mentor sees mentor controls disabled with the reason in words', async () => {
    const [alpha, ...rest] = threeTeams();
    api = installTeamsApi({
      students: [ASHA, RAVI],
      teams: [
        {
          ...alpha!,
          can: { edit: true, archive: false, manageMentors: false, transferPrimary: false },
        },
        ...rest,
      ],
    });
    await openTeam('Alpha');
    expect(screen.getByRole('button', { name: 'Hand over…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByLabelText('Add a co-mentor')).toBeDisabled();
    expect(
      screen.getByText('Only the primary mentor or an administrator can add or remove mentors.'),
    ).toBeInTheDocument();
    expect(within(members()).getByRole('button', { name: 'Actions for Asha Demo' })).toBeEnabled();
  });

  it('an archived team is read-only and says so', async () => {
    const [alpha, ...rest] = threeTeams();
    api = installTeamsApi({
      students: [ASHA, RAVI],
      teams: [{ ...alpha!, status: 'ARCHIVED' }, ...rest],
    });
    await openTeam('Alpha');
    expect(screen.getByText(/This team is archived: everything is kept/)).toBeInTheDocument();
    expect(screen.getByLabelText('Add a member')).toBeDisabled();
    expect(within(members()).queryByRole('button', { name: /Actions for/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeEnabled();
  });
});

describe('members, coverage and mentors', () => {
  it('adds a member through the typeahead, which says how many teams they are in', async () => {
    const extra = makeStudent(9, { fullName: 'Meera Demo' });
    api = installTeamsApi({ students: [ASHA, RAVI, extra], teams: threeTeams() });
    const user = await openTeam('Beta');
    await user.type(screen.getByLabelText('Add a member'), 'Demo');
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Also in 1 team')]),
    );
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(api.teams.get(teamId('Beta'))?.members).toHaveLength(2);
    });
  });

  it('shows coverage in words with a legend, and saves targets', async () => {
    const user = await openTeam('Alpha');
    const chips = screen.getByRole('list', { name: 'Skill coverage' });
    expect(within(chips).getByText(/Covered/)).toBeInTheDocument();
    expect(within(chips).getByText(/Missing/)).toBeInTheDocument();
    expect(screen.getByText('1 covered · 1 missing')).toBeInTheDocument();
    const field = screen.getByLabelText('Skills this team needs');
    await user.clear(field);
    await user.type(field, 'Python, SQL');
    await user.click(screen.getByRole('button', { name: 'Save skills' }));
    await waitFor(() => {
      expect(api.teams.get(teamId('Alpha'))?.targets).toEqual(['Python', 'SQL']);
    });
  });

  it('hands the team over, stepping away', async () => {
    const user = await openTeam('Alpha');
    await user.click(screen.getByRole('button', { name: 'Hand over…' }));
    const dialog = screen.getByRole('dialog', { name: 'Hand Alpha over' });
    await user.selectOptions(within(dialog).getByLabelText('New primary mentor'), 'Grace Hopper');
    await user.click(within(dialog).getByLabelText(/Step away/));
    await user.click(within(dialog).getByRole('button', { name: 'Hand over' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const mentors = api.teams.get(teamId('Alpha'))!.mentors;
    expect(mentors.map((m) => [m.displayName, m.role])).toEqual([['Grace Hopper', 'PRIMARY']]);
  });
});
