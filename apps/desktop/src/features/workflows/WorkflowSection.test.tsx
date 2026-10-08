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
import { installStudentsApi } from '../../testing/students-api.js';
import { HACKATHON, workflowFrom } from '../../testing/workflow-fixtures.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The Competition page's workflow (WP-20a step 7, §16.2) in jsdom: progress
 * and health, ticking with Undo, keyboard-only reorder, both dialogs, the
 * R100 banner, a stale version, and a removal that confirms.
 */

const COMPETITION = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }));
const base = workflowFrom(COMPETITION.id, HACKATHON);

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [COMPETITION] });
  api.workflows.workflows.set(COMPETITION.id, base);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPage() {
  const user = userEvent.setup();
  await renderApp(`/competitions/${COMPETITION.id}`);
  await screen.findByRole('list', { name: 'Stages in order' });
  return user;
}

const stageNames = (): string[] =>
  within(screen.getByRole('list', { name: 'Stages in order' }))
    .getAllByRole('heading', { level: 3 })
    .map((heading) => within(heading).getAllByRole('button')[0]?.textContent ?? '');
const lastCall = (suffix: string) =>
  api.workflows.calls.filter((call) => call.path.endsWith(suffix)).at(-1);

describe('the workflow on the Competition page', () => {
  it('shows progress in words, health as icon + label + reason, and undated stages', async () => {
    await openPage();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Workflow progress' })).toHaveAttribute(
      'aria-valuetext',
      '0%',
    );
    expect(screen.getByText('On track')).toBeInTheDocument();
    expect(screen.getByText(/Next: Team & registration due 18 Oct/)).toBeInTheDocument();
    expect(stageNames()).toEqual(['Team & registration', 'Idea & problem', 'Build prototype']);
    expect(screen.getAllByText(/No date — set one/)).toHaveLength(2);
  });

  it('a tick moves progress at once, sends the value, and Undo takes it back', async () => {
    const user = await openPage();
    await user.click(screen.getByRole('checkbox', { name: 'Confirm the team' }));
    expect(screen.getByRole('checkbox', { name: 'Confirm the team' })).toBeChecked();
    await waitFor(() => {
      expect(screen.getByText('7%')).toBeInTheDocument();
    });
    expect(lastCall('/done')?.body).toMatchObject({ done: true });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Confirm the team' })).not.toBeChecked();
    });
    expect(lastCall('/done')?.body).toMatchObject({ done: false });
  });

  it('reorders by keyboard alone: Alt+↓ on a stage, Alt+↑ on a task', async () => {
    const user = await openPage();
    const first = screen.getByRole('button', { name: /^Team & registration/ });
    first.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => {
      expect(stageNames()).toEqual(['Idea & problem', 'Team & registration', 'Build prototype']);
    });
    expect(lastCall(`stages/${base.stages[0]!.id}/move`)?.body).toMatchObject({
      afterId: base.stages[1]!.id,
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Team & registration/ })).toHaveFocus();
    });

    screen.getByRole('checkbox', { name: 'Register on the site' }).focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => {
      const tasks = within(screen.getByRole('list', { name: 'Tasks of Team & registration' }));
      expect(tasks.getAllByRole('checkbox').map((box) => box.getAttribute('id'))).toEqual(
        [base.stages[0]!.tasks[1]!.id, base.stages[0]!.tasks[0]!.id].map((id) => `task-${id}`),
      );
    });
    // The menu's Move up/down do the same.
    await user.click(screen.getByRole('button', { name: 'Actions for Build prototype' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => {
      expect(stageNames()).toEqual(['Idea & problem', 'Build prototype', 'Team & registration']);
    });
  });

  it('completing with open tasks asks: Yes closes them, Complete anyway keeps them', async () => {
    const user = await openPage();
    const status = screen.getByRole('combobox', { name: 'Status of Team & registration' });
    await user.selectOptions(status, 'COMPLETED');
    const dialog = await screen.findByRole('dialog', { name: 'Complete “Team & registration”?' });
    expect(within(dialog).getByText('Mark the remaining 2 tasks done?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(lastCall('/status')).toBeUndefined();

    await user.selectOptions(status, 'COMPLETED');
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(lastCall('/status')?.body).toMatchObject({ status: 'COMPLETED', openTasks: 'CLOSE' });
    });
    expect(await screen.findByRole('checkbox', { name: 'Confirm the team' })).toBeChecked();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Status of Idea & problem' }),
      'COMPLETED',
    );
    await user.click(await screen.findByRole('button', { name: 'Complete anyway' }));
    expect(await screen.findByText('Completed with open tasks')).toBeInTheDocument();
    expect(lastCall('/status')?.body).toMatchObject({ openTasks: 'KEEP' });
  });

  it('Blocked asks for a reason and turns health to Blocked', async () => {
    const user = await openPage();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Status of Build prototype' }),
      'BLOCKED',
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'What is blocking “Build prototype”?',
    });
    expect(within(dialog).getByRole('button', { name: 'Mark blocked' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), 'Waiting on the GPU quota');
    await user.click(within(dialog).getByRole('button', { name: 'Mark blocked' }));
    expect(await screen.findByText('Blocked: Waiting on the GPU quota')).toBeInTheDocument();
    expect(
      screen.getByText(/Blocked: Build prototype — Waiting on the GPU quota/),
    ).toBeInTheDocument();
  });

  it('the R100 banner offers the new dates and applies them only on request', async () => {
    api.workflows.workflows.set(COMPETITION.id, {
      ...base,
      dateChanges: [
        {
          stageId: base.stages[0]!.id,
          stageName: 'Team & registration',
          current: '2026-10-18T18:29:59.999Z',
          proposed: '2026-10-23T18:29:59.999Z',
        },
      ],
    });
    const user = await openPage();
    expect(screen.getByText('Event deadline changed — update stage dates?')).toBeInTheDocument();
    expect(lastCall('apply-date-changes')).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Update stage dates' }));
    await waitFor(() => {
      expect(screen.queryByText('Event deadline changed — update stage dates?')).toBeNull();
    });
    expect(lastCall('apply-date-changes')?.body).toMatchObject({
      stageIds: [base.stages[0]!.id],
    });
  });

  it('a stale version says so in the house words and offers a reload', async () => {
    const user = await openPage();
    // Someone else changes the first stage meanwhile.
    const current = api.workflows.workflows.get(COMPETITION.id)!;
    api.workflows.workflows.set(COMPETITION.id, {
      ...current,
      stages: current.stages.map((s, i) => (i === 0 ? { ...s, version: s.version + 1 } : s)),
    });
    await user.click(screen.getByRole('checkbox', { name: 'Confirm the team' }));
    expect(await screen.findByText('Someone else changed this')).toBeInTheDocument();
    expect(
      screen.getByText('Someone else changed this — reload to see their change.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Confirm the team' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('removing a stage confirms first; adding one puts it at the end', async () => {
    const user = await openPage();
    await user.click(screen.getByRole('button', { name: 'Actions for Idea & problem' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove the stage “Idea & problem”?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(stageNames()).toEqual(['Team & registration', 'Build prototype']);
    });
    await user.type(screen.getByLabelText('New stage name'), 'Mentor check-in');
    await user.click(screen.getByRole('button', { name: 'Add stage' }));
    await waitFor(() => {
      expect(stageNames().at(-1)).toBe('Mentor check-in');
    });
  });
});

describe('before a workflow exists', () => {
  it('a competition being considered says one comes with assignment', async () => {
    installCompetitionsApi({ competitions: [{ ...COMPETITION, status: 'CONSIDERING' }] });
    await renderApp(`/competitions/${COMPETITION.id}`);
    expect(await screen.findByText(/No workflow yet/)).toBeInTheDocument();
  });
});
