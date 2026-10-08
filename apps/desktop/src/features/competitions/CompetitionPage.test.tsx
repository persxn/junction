import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import {
  installCompetitionsApi,
  makeCompetition,
  makeEvent,
  type CompetitionsApi,
} from '../../testing/competitions-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi, makeStudent } from '../../testing/students-api.js';
import { installTeamsApi, makeTeam } from '../../testing/teams-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const MEERA = makeStudent(9, { fullName: 'Meera Demo' });
const entry = (student: typeof ASHA, roleLabel: string | null) => ({
  studentId: student.id,
  fullName: student.fullName,
  universityId: student.universityId,
  studentStatus: 'ACTIVE' as const,
  roleLabel,
  addedAt: '2026-10-08T06:00:00.000Z',
  removedAt: null,
  removalReason: null,
});
const ROCKET = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }), {
  roster: [entry(ASHA, 'Backend')],
  rosterCount: 1,
  history: [
    {
      id: '0192f0c1-0000-7000-8000-0000000ee001',
      from: null,
      to: 'ASSIGNED',
      changedBy: 'Ada Lovelace',
      changedAt: '2026-10-01T06:00:00.000Z',
      note: null,
    },
    {
      id: '0192f0c1-0000-7000-8000-0000000ee002',
      from: 'ASSIGNED',
      to: 'APPLIED',
      changedBy: 'Grace Hopper',
      changedAt: '2026-10-03T06:00:00.000Z',
      note: 'Form sent',
    },
  ],
  status: 'APPLIED',
});

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi({ students: [ASHA, MEERA] });
  api = installCompetitionsApi({
    competitions: [ROCKET],
    activeElsewhere: { [MEERA.id]: 'Team Comet — Alpha Hack' },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPage() {
  const user = userEvent.setup();
  await renderApp(`/competitions/${ROCKET.id}`);
  await screen.findByRole('heading', { level: 1, name: 'Team Rocket — Alpha Hack' });
  return user;
}

describe('the competition page', () => {
  it('tells its history in words and offers only the allowed moves', async () => {
    const user = await openPage();
    expect(screen.getByText(/Ada Lovelace started it as Assigned/)).toBeInTheDocument();
    expect(screen.getByText(/Grace Hopper moved it from Assigned to Applied/)).toBeInTheDocument();
    expect(screen.getByText(/“Form sent”/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Move Team Rocket to/ }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Move to Participating',
      'Mark not selected',
      'Withdraw',
    ]);
  });

  it('shows the A14 refusal inline when a roster add clashes', async () => {
    const user = await openPage();
    await user.type(screen.getByLabelText('Add to the roster'), 'Meera');
    await user.click(await screen.findByRole('option', { name: /Meera Demo/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already in Team Comet — Alpha Hack for this event',
    );
  });

  it('removes from the roster at once, and Undo brings the student back with the same role', async () => {
    const user = await openPage();
    const roster = screen.getByRole('list', { name: 'Roster' });
    await user.click(within(roster).getByRole('button', { name: 'Remove Asha Demo' }));
    expect(screen.queryByRole('button', { name: 'Remove Asha Demo' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.competitions.get(ROCKET.id)?.roster).toEqual([
        expect.objectContaining({ studentId: ASHA.id, roleLabel: 'Backend' }),
      ]);
    });
  });

  it('a closed competition is read-only and says why', async () => {
    installCompetitionsApi({
      competitions: [
        { ...ROCKET, status: 'COMPLETED', allowed: [], can: { edit: false, manageMentors: false } },
      ],
    });
    await openPage();
    expect(screen.getByText(/is completed and can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move Team Rocket to/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Asha Demo' })).toBeDisabled();
    expect(screen.getByLabelText('Notes')).toBeDisabled();
  });
});

describe('the team and student pages list competitions', () => {
  const ref = {
    id: ROCKET.id,
    eventTitle: 'Alpha Hack',
    status: 'APPLIED' as const,
    kind: 'TEAM' as const,
    teamName: 'Team Rocket',
    onRoster: true,
  };

  it('on the team page, each linking to its competition', async () => {
    const team = makeTeam(1, { name: 'Team Rocket', competitions: [ref] });
    installTeamsApi({ teams: [team] });
    installCompetitionsApi({ competitions: [ROCKET] });
    const user = userEvent.setup();
    await renderApp(`/teams/${team.id}`);
    const list = await screen.findByRole('list', { name: 'Competitions' });
    expect(within(list).getByText('Applied')).toBeInTheDocument();
    await user.click(within(list).getByRole('link', { name: 'Alpha Hack' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Team Rocket — Alpha Hack' }),
    ).toBeInTheDocument();
  });

  it('on the student page, with the team it was with', async () => {
    installStudentsApi({ students: [{ ...ASHA, competitions: [ref] }] });
    await renderApp(`/students/${ASHA.id}`);
    const list = await screen.findByRole('list', { name: 'Competitions' });
    expect(within(list).getByText('Team Rocket')).toBeInTheDocument();
  });
});
