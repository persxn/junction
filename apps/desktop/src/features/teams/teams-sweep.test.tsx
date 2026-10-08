import {
  COVERAGE_STATES,
  MENTOR_ROLES,
  STUDENT_STATUSES,
  TEAM_STATUSES,
} from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { makeStudent } from '../../testing/students-api.js';
import {
  installTeamsApi,
  makeTeam,
  memberOf,
  primaryOf,
  type TeamsApi,
} from '../../testing/teams-api.js';

/**
 * WP-18's UI fault sweep (step 8): WP-17's rendered-text scan extended to the
 * team enums, forced states, a write with the shell proxy as the only transport
 * (R78/F9), and the keyboard through the dialogs.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ASHA = makeStudent(7, {
  fullName: 'Asha Demo',
  tags: [
    {
      tagId: '0192f0c1-0000-7000-8000-000000008001',
      name: 'Python',
      relation: 'SKILL',
      proficiency: 1,
    },
  ],
});
const RAVI = makeStudent(8, { fullName: 'Ravi Demo', status: 'INACTIVE' });
const ALPHA = makeTeam(1, {
  name: 'Alpha',
  members: [memberOf(ASHA, { roleLabel: 'Backend', isLead: true }), memberOf(RAVI)],
  pastMembers: [memberOf(RAVI, { leftAt: '2026-10-01T10:00:00.000Z' })],
  mentors: [
    primaryOf(),
    { ...primaryOf('0192f0c1-0000-7000-8000-00000000a002'), role: 'CO_MENTOR' },
  ],
  pastMentors: [{ ...primaryOf(), role: 'CO_MENTOR', toAt: '2026-10-01T10:00:00.000Z' }],
  targets: ['Python', 'Figma', 'SQL'],
});

let api: TeamsApi;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  api = installTeamsApi({
    students: [ASHA, RAVI],
    teams: [ALPHA, makeTeam(2, { name: 'Old Team', status: 'ARCHIVED' })],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW_WORDS = [
  ...TEAM_STATUSES,
  ...MENTOR_ROLES,
  'CO_MENTOR',
  ...COVERAGE_STATES,
  ...STUDENT_STATUSES,
  'SKILL',
];
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function expectHumanText(): void {
  // Open every <details>, so the earlier members and mentors are scanned too.
  for (const details of document.querySelectorAll('details')) details.open = true;
  const text = document.getElementById('main')?.innerText ?? document.body.textContent ?? '';
  for (const word of RAW_WORDS)
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  expect(text).not.toMatch(ISO);
}

describe('no enum value or ISO timestamp reaches the screen', () => {
  it('on the list, any status', async () => {
    const user = userEvent.setup();
    await renderApp('/teams');
    await screen.findByText('Alpha');
    await user.click(screen.getByRole('button', { name: 'Any status' }));
    await screen.findByText('Old Team');
    expect(screen.getByText('Archived', { selector: 'td *, td' })).toBeInTheDocument();
    expectHumanText();
  });

  it('on the team page', async () => {
    await renderApp(`/teams/${ALPHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    expect(screen.getByText('Inactive — not counted in coverage')).toBeInTheDocument();
    expect(screen.getByText(/Co-mentor since/)).toBeInTheDocument();
    expectHumanText();
  });

  it('on the student page', async () => {
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('list', { name: 'Current teams' });
    expectHumanText();
  });
});

describe('forced states', () => {
  it('a team that does not exist says so and leads back', async () => {
    await renderApp('/teams/0192f0c1-0000-7000-8000-0000000fffff');
    expect(await screen.findByText('This team could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to teams' })).toBeInTheDocument();
  });

  it('a list that fails to load offers to try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () =>
            Promise.resolve(
              '{"type":"urn:compintel:problem:INTERNAL","title":"Something went wrong","status":500,"code":"INTERNAL","requestId":"r"}',
            ),
        }),
      ),
    );
    await renderApp('/teams');
    expect(
      await screen.findByText('The team list could not be loaded', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a slow list shows its skeleton, announced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    await renderApp('/teams');
    expect(await screen.findByText('Loading teams')).toBeInTheDocument();
    expect(screen.getByText('Loading teams').closest('[role="status"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('no teams at all suggests creating one', async () => {
    installTeamsApi({ students: [ASHA] });
    await renderApp('/teams');
    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a team' })).toBeInTheDocument();
  });

  it('archiving turns the page read-only at once', async () => {
    const user = userEvent.setup();
    await renderApp(`/teams/${ALPHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText(/This team is archived: everything is kept/);
    expect(screen.getByLabelText('Add a member')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hand over…' })).toBeDisabled();
    expect(api.teams.get(ALPHA.id)?.status).toBe('ARCHIVED');
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('makes a member lead with every request carried by the shell', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp(`/teams/${ALPHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    const list = screen.getByRole('list', { name: 'Current members' });
    await user.click(within(list).getByRole('button', { name: 'Actions for Ravi Demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make lead' }));
    await waitFor(() => {
      expect(api.teams.get(ALPHA.id)?.members.find((m) => m.studentId === RAVI.id)?.isLead).toBe(
        true,
      );
    });
    const proxied = invoke.mock.calls
      .filter((call) => call[0] === 'backend_request')
      .map((call) => (call[1] as { request: { method: string; path: string } }).request);
    expect(proxied).toContainEqual(expect.objectContaining({ method: 'PATCH' }));
  });
});

describe('the keyboard', () => {
  it('the hand-over dialog keeps Tab inside, closes on Esc and gives focus back', async () => {
    const user = userEvent.setup();
    await renderApp(`/teams/${ALPHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    const opener = screen.getByRole('button', { name: 'Hand over…' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('New primary mentor')).toHaveFocus();
    for (let step = 0; step < 5; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(opener).toHaveFocus();
  });
});
