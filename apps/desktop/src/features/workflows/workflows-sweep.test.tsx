import {
  DUE_ANCHORS,
  DUE_ORIGINS,
  OPEN_TASK_CHOICES,
  SCHEDULE_HEALTHS,
  STAGE_STATUSES,
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
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { HACKATHON, workflowFrom, workflowStage } from '../../testing/workflow-fixtures.js';

/**
 * WP-20a's UI fault sweep (step 9): the rendered-text scan extended to the
 * workflow enums, forced states (load failures, a blank workflow, the
 * templates list failing), a task tick with the shell proxy as the only
 * transport (R78/F9), and a keyboard-only walk through a stage.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const COMPETITION = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }), {
  progress: 25,
  health: 'OVERDUE',
  healthReason: 'Team & registration was due 3 days ago, 50% done',
});
// Every stage status, origin and marker on one page.
const base = workflowFrom(COMPETITION.id, HACKATHON);
const RICH = {
  ...base,
  health: 'OVERDUE' as const,
  healthReason: 'Team & registration was due 3 days ago, 50% done',
  stages: [
    {
      ...base.stages[0]!,
      status: 'IN_PROGRESS' as const,
      overdue: true,
      dueOrigin: 'MANUAL' as const,
    },
    workflowStage('Blocked one', { status: 'BLOCKED', blockedReason: 'Venue' }),
    workflowStage('Done one', { status: 'COMPLETED', completedWithOpenTasks: true }),
    workflowStage('Skipped one', { status: 'SKIPPED', progress: null }),
    workflowStage('Manual one', {
      progressOverride: 55,
      dueOrigin: 'RULE',
      dueAt: '2026-11-02T06:00:00.000Z',
    }),
  ],
};

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [COMPETITION] });
  api.workflows.workflows.set(COMPETITION.id, RICH);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW_WORDS = [
  ...STAGE_STATUSES,
  ...SCHEDULE_HEALTHS,
  ...DUE_ANCHORS,
  ...DUE_ORIGINS,
  ...OPEN_TASK_CHOICES,
];
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function expectHumanText(): void {
  for (const details of document.querySelectorAll('details')) details.open = true;
  // Option values are not text; what a <select> shows is its label.
  const text = document.getElementById('main')?.innerText ?? document.body.textContent ?? '';
  for (const word of RAW_WORDS) {
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  }
  expect(text).not.toMatch(ISO);
  expect(text.toLowerCase()).not.toContain('engagement');
}

describe('no enum value or ISO timestamp reaches the screen', () => {
  it('on a Competition page with every stage state', async () => {
    await renderApp(`/competitions/${COMPETITION.id}`);
    await screen.findByRole('list', { name: 'Stages in order' });
    expect(screen.getByText('Completed with open tasks')).toBeInTheDocument();
    expect(screen.getByText(/55% · manual/)).toBeInTheDocument();
    expectHumanText();
  });

  it('on the board and the templates', async () => {
    await renderApp('/competitions');
    await screen.findByText('25% done');
    expectHumanText();
  });

  it('on a template', async () => {
    await renderApp(`/competitions/templates/${HACKATHON.id}`);
    await screen.findByText('2 days before the registration deadline');
    expectHumanText();
  });
});

describe('forced states', () => {
  it('a workflow that fails to load says so; the rest of the page stays', async () => {
    vi.stubGlobal(
      'fetch',
      ((inner: typeof fetch) => (url: string, init?: RequestInit) =>
        new URL(url).pathname.endsWith('/workflow')
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
    await renderApp(`/competitions/${COMPETITION.id}`);
    expect(await screen.findByText(/The workflow did not load/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
  });

  it('a blank workflow invites the first stage', async () => {
    api.workflows.workflows.set(COMPETITION.id, workflowFrom(COMPETITION.id, null));
    await renderApp(`/competitions/${COMPETITION.id}`);
    expect(
      await screen.findByText(/No stages yet\. Add the first one below\./),
    ).toBeInTheDocument();
    expect(screen.getByText('No stage counts toward progress yet.')).toBeInTheDocument();
  });

  it('the templates list failing offers to try again', async () => {
    vi.stubGlobal(
      'fetch',
      ((inner: typeof fetch) => (url: string, init?: RequestInit) =>
        new URL(url).pathname === '/api/v1/workflow-templates'
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
    await renderApp('/competitions/templates');
    expect(
      await screen.findByText('The templates could not be loaded', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('ticks a task with every request carried by the shell', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await user.click(await screen.findByRole('checkbox', { name: 'Confirm the team' }));
    await waitFor(() => {
      expect(api.workflows.workflows.get(COMPETITION.id)?.stages[0]?.tasks[0]?.isDone).toBe(true);
    });
    const proxied = invoke.mock.calls
      .filter((call) => call[0] === 'backend_request')
      .map((call) => (call[1] as { request: { method: string; path: string } }).request);
    expect(proxied).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/api/v1/competitions/${COMPETITION.id}/workflow/tasks/${base.stages[0]!.tasks[0]!.id}/done`,
      }),
    );
  });
});

describe('a keyboard-only walk', () => {
  it('Tab to a task, Space ticks it; Alt+↓ moves its stage; Esc closes a dialog', async () => {
    api.workflows.workflows.set(COMPETITION.id, base);
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    const box = await screen.findByRole('checkbox', { name: 'Confirm the team' });
    for (let step = 0; step < 60 && document.activeElement !== box; step += 1) await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Confirm the team' })).toBeChecked();
    });
    const name = screen.getByRole('button', { name: /^Team & registration/ });
    name.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Team & registration/ })).toHaveFocus();
    });
    const status = screen.getByRole('combobox', { name: 'Status of Build prototype' });
    status.focus();
    await user.selectOptions(status, 'BLOCKED');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Reason/)).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.workflows.calls.some((call) => call.path.endsWith('/status'))).toBe(false);
  });
});
