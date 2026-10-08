import {
  ASSIGN_WARNING_CODES,
  ENGAGEMENT_STATUSES,
  PARTICIPANT_KINDS,
  REMOVAL_REASONS,
} from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import {
  installCompetitionsApi,
  makeCompetition,
  makeEvent,
  type CompetitionsApi,
} from '../../testing/competitions-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { installStudentsApi, makeStudent } from '../../testing/students-api.js';
import { makeTeam, memberOf } from '../../testing/teams-api.js';

/**
 * WP-19's UI fault sweep (step 8): the rendered-text scan extended to the
 * competition enums, forced states, a status change with the shell proxy as the
 * only transport (R78/F9), and a keyboard-only walk from Discover through the
 * assignment to a status change.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const ITEMS = [makeItem(1)];
const EVENT = makeEvent(1, { id: ITEMS[0]!.id, title: ITEMS[0]!.title });
const ROCKET = makeTeam(1, { name: 'Team Rocket', members: [memberOf(ASHA)] });
const removed = {
  studentId: makeStudent(8).id,
  fullName: 'Ravi Demo',
  universityId: 'DEMO0008',
  studentStatus: 'ACTIVE' as const,
  roleLabel: null,
  addedAt: '2026-10-01T06:00:00.000Z',
  removedAt: '2026-10-02T06:00:00.000Z',
  removalReason: 'ENGAGEMENT_CLOSED' as const,
};
const ALL = ENGAGEMENT_STATUSES.map((status, index) =>
  makeCompetition(makeEvent(10 + index, { title: `Hack ${String(index)}` }), {
    status,
    pastRoster: [removed],
    ...(index % 2 === 0
      ? {}
      : {
          kind: 'INDIVIDUAL' as const,
          team: null,
          student: { id: ASHA.id, fullName: 'Asha Demo' },
        }),
  }),
);

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  installFakeSearch(ITEMS);
  api = installCompetitionsApi({ competitions: ALL, teams: [ROCKET], events: [EVENT] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW_WORDS = [
  ...ENGAGEMENT_STATUSES,
  ...PARTICIPANT_KINDS,
  ...REMOVAL_REASONS,
  ...ASSIGN_WARNING_CODES,
  'CO_MENTOR',
  'PRIMARY',
  'REGISTRATION',
];
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function expectHumanText(): void {
  for (const details of document.querySelectorAll('details')) details.open = true;
  const text = document.getElementById('main')?.innerText ?? document.body.textContent ?? '';
  for (const word of RAW_WORDS)
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  expect(text).not.toMatch(ISO);
  expect(text.toLowerCase()).not.toContain('engagement');
}

describe('no enum value, ISO timestamp or "engagement" reaches the screen', () => {
  it('on the board', async () => {
    await renderApp('/competitions');
    await screen.findByRole('article', { name: /^Hack 0/ });
    expectHumanText();
  });

  it('on the list, closed ones included', async () => {
    await renderApp('/competitions?view=list&closed=true');
    await screen.findByRole('table');
    expect(screen.getByRole('row', { name: /Hack 6/ })).toHaveTextContent('Not selected');
    expectHumanText();
  });

  it('on a closed competition’s page', async () => {
    installStudentsApi({ students: [ASHA] });
    installCompetitionsApi({ competitions: ALL });
    await renderApp(`/competitions/${ALL[5]!.id}`);
    await screen.findByRole('heading', { level: 1, name: /Hack 5/ });
    expect(screen.getByText(/Released when the competition closed/)).toBeInTheDocument();
    expectHumanText();
  });
});

describe('forced states', () => {
  it('a competition that does not exist says so and leads back', async () => {
    await renderApp('/competitions/0192f0c1-0000-7000-8000-0000000fffff');
    expect(await screen.findByText('This competition could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to competitions' })).toBeInTheDocument();
  });

  it('no competitions at all points to Discover', async () => {
    installCompetitionsApi();
    await renderApp('/competitions');
    expect(await screen.findByText('No competitions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Discover' })).toBeInTheDocument();
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
    await renderApp('/competitions');
    expect(
      await screen.findByText('The competitions could not be loaded', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('a slow board shows its skeleton, announced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    await renderApp('/competitions');
    expect(await screen.findByText('Loading competitions')).toBeInTheDocument();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('moves a competition with every request carried by the shell', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp('/competitions');
    const card = await screen.findByRole('article', { name: /^Hack 1/ });
    card.focus();
    await user.keyboard('m{Enter}');
    await waitFor(() => {
      expect(api.competitions.get(ALL[1]!.id)?.status).toBe('APPLIED');
    });
    const proxied = invoke.mock.calls
      .filter((call) => call[0] === 'backend_request')
      .map((call) => (call[1] as { request: { method: string; path: string } }).request);
    expect(proxied).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/api/v1/competitions/${ALL[1]!.id}/transitions`,
      }),
    );
  });
});

describe('a keyboard-only walk', () => {
  it('Discover → A → team → review → confirm → open → Move to Applied', async () => {
    installFakeSearch(ITEMS);
    api = installCompetitionsApi({ teams: [ROCKET], events: [EVENT] });
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: ITEMS[0]!.title });
    await user.keyboard('a');
    const dialog = await screen.findByRole('dialog');
    const radio = await within(dialog).findByRole('radio', { name: /Team Rocket/ });
    radio.focus();
    await user.keyboard(' ');
    expect(radio).toBeChecked();
    // Tab to Next and press it three times, then Tab to Assign.
    const press = async (name: string): Promise<void> => {
      for (let step = 0; step < 12 && document.activeElement?.textContent !== name; step += 1) {
        await user.tab();
      }
      expect(document.activeElement).toHaveTextContent(name);
      await user.keyboard('{Enter}');
    };
    await press('Next');
    expect(await within(dialog).findByRole('radio', { name: /^Hackathon/ })).toBeChecked();
    await press('Next');
    await within(dialog).findByText('Registration closes');
    await press('Next');
    await press('Assign');
    const open = await screen.findByRole('button', { name: 'Open competition' });
    open.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: `Team Rocket — ${ITEMS[0]!.title}` });
    screen.getByRole('button', { name: /Move Team Rocket to/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Move to Applied' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect([...api.competitions.values()][0]?.status).toBe('APPLIED');
    });
  });
});
