import { HISTORY_OUTCOME_STATES, OUTCOME_RESULTS, TRANSFER_ITEM_KINDS } from '@compintel/contracts';
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
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { installStudentsApi, makeStudent } from '../../testing/students-api.js';
import { HACKATHON } from '../../testing/workflow-fixtures.js';

/**
 * WP-21's UI fault sweep, M2's closing pass (step 9): the rendered-text scan
 * extended to results, history states and transfer kinds; forced states
 * (the history failing to load); and one write per new screen with the shell
 * proxy as the only transport (R78/F9) — recording an outcome, cloning a
 * template.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const ALL = OUTCOME_RESULTS.map((result, index) =>
  makeCompetition(makeEvent(20 + index, { title: `Result ${String(index)}` }), {
    status: 'COMPLETED',
    result,
  }),
);

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  installStudentsApi({ students: [ASHA] });
  api = installCompetitionsApi({ competitions: ALL });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW = [...OUTCOME_RESULTS, ...HISTORY_OUTCOME_STATES, ...TRANSFER_ITEM_KINDS];
function expectHumanText(): void {
  const text = document.getElementById('main')?.textContent ?? document.body.textContent ?? '';
  for (const word of RAW)
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
}

describe('no enum value or ISO timestamp reaches the screen', () => {
  it('on the list with every result', async () => {
    await renderApp('/competitions?view=list&closed=true');
    await screen.findByRole('table');
    expect(screen.getByText('Did not participate')).toBeInTheDocument();
    expectHumanText();
  });

  it('on a Student page with a shown result and one left before', async () => {
    api.outcomes.histories.set(ASHA.id, {
      studentId: ASHA.id,
      erased: false,
      competitions: ['SHOWN', 'LEFT_BEFORE_RESULT', 'NONE'].map((state, index) => ({
        competitionId: ALL[index]!.id,
        eventTitle: `Result ${String(index)}`,
        startsAt: null,
        endsAt: null,
        datePrecision: 'UNKNOWN' as const,
        teamName: null,
        status: 'COMPLETED' as const,
        outcomeState: state as 'SHOWN',
        outcome:
          state === 'SHOWN'
            ? {
                result: 'WINNER' as const,
                rank: 1,
                prizeText: null,
                prizeMinor: null,
                prizeCurrency: null,
              }
            : null,
        addedAt: '2026-09-01T06:00:00.000Z',
        removedAt: null,
      })),
      teams: [],
      achievements: [],
    });
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('list', { name: 'Competitions and outcomes' });
    expectHumanText();
  });
});

describe('forced states', () => {
  it('the history failing to load says so; the rest of the page stays', async () => {
    vi.stubGlobal(
      'fetch',
      ((inner: typeof fetch) => (url: string, init?: RequestInit) =>
        new URL(url).pathname.endsWith('/history')
          ? Promise.resolve({
              ok: false,
              status: 500,
              text: () =>
                Promise.resolve(
                  '{"type":"urn:compintel:problem:INTERNAL","title":"Something went wrong","status":500,"code":"INTERNAL","requestId":"r"}',
                ),
            })
          : inner(url, init))(globalThis.fetch),
    );
    await renderApp(`/students/${ASHA.id}`);
    expect(
      await screen.findByText(/The competition history did not load/, {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Teams' })).toBeInTheDocument();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  const proxied = () =>
    invoke.mock.calls
      .filter((call) => call[0] === 'backend_request')
      .map((call) => (call[1] as { request: { method: string; path: string } }).request);

  it('records an outcome', async () => {
    const live = makeCompetition(makeEvent(40, { title: 'Live Hack' }), {
      status: 'PARTICIPATING',
    });
    api.competitions.set(live.id, live);
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp(`/competitions/${live.id}`);
    await user.click(await screen.findByRole('button', { name: 'Record outcome' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Record outcome' }),
    );
    await waitFor(() => {
      expect(api.competitions.get(live.id)?.status).toBe('COMPLETED');
    });
    expect(proxied()).toContainEqual(
      expect.objectContaining({ method: 'PUT', path: `/api/v1/competitions/${live.id}/outcome` }),
    );
  });

  it('clones a template', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp('/competitions/templates');
    await user.click(await screen.findByRole('button', { name: 'Clone Hackathon' }));
    await screen.findByRole('heading', { level: 1, name: 'Hackathon (my copy)' });
    expect(proxied()).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/api/v1/workflow-templates/${HACKATHON.id}/clone`,
      }),
    );
  });
});
