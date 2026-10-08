import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { installCompetitionsApi, type CompetitionsApi } from '../../../testing/competitions-api.js';
import { renderApp } from '../../../testing/render.js';
import { installStudentsApi } from '../../../testing/students-api.js';
import { HACKATHON, makeTemplate } from '../../../testing/workflow-fixtures.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * Competitions → Templates (WP-20a step 8, §10.2): defaults read-only to a
 * professor, Clone makes one of your own, and the owner edits its stages —
 * the date rule as anchor + days, default tasks one per line, order, removal.
 */

const MINE = makeTemplate(5, { name: 'My hackathon', ownedByMe: true, canEdit: true });
const THEIRS = makeTemplate(6, { name: 'Bob’s CTF', ownerName: 'Bob Professor' });

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi();
  for (const template of [MINE, THEIRS]) api.workflows.templates.set(template.id, template);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const lastCall = (suffix: string) =>
  api.workflows.calls.filter((call) => call.path.endsWith(suffix)).at(-1);

describe('the templates list', () => {
  it('is reached from Competitions and groups defaults, yours and others’', async () => {
    const user = userEvent.setup();
    await renderApp('/competitions');
    await user.click(await screen.findByRole('link', { name: 'Templates' }));
    await screen.findByRole('heading', { level: 1, name: 'Workflow templates' });
    const defaults = await screen.findByRole('region', { name: 'Department defaults' });
    expect(within(defaults).getByRole('link', { name: 'Hackathon' })).toBeInTheDocument();
    expect(within(defaults).getAllByText('Preselected for its type')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'Yours' })).getByRole('link', {
        name: 'My hackathon',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/by Bob Professor/)).toBeInTheDocument();
  });

  it('Clone makes one of your own and opens it for editing', async () => {
    const user = userEvent.setup();
    await renderApp('/competitions/templates');
    await user.click(await screen.findByRole('button', { name: 'Clone Hackathon' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hackathon (my copy)' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Hackathon (my copy)');
  });
});

describe('the template editor', () => {
  it('a default is read-only to a professor, with the reason and Clone', async () => {
    await renderApp(`/competitions/templates/${HACKATHON.id}`);
    expect(
      await screen.findByText(/Only an admin changes the department defaults/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByText('2 days before the registration deadline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone' })).toBeInTheDocument();
  });

  it('the owner edits a stage’s rule and tasks; each edit sends the version', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/templates/${MINE.id}`);
    const names = await screen.findAllByLabelText('Stage name');
    expect(names).toHaveLength(3);
    const anchors = screen.getAllByLabelText('From');
    await user.selectOptions(anchors[1]!, 'DEADLINE');
    await user.selectOptions(screen.getByLabelText('Which date'), 'PPT');
    fireEvent.change(screen.getAllByLabelText(/Days/)[1]!, { target: { value: '-1' } });
    expect(screen.getByText('Date rule: 1 day before the presentation date')).toBeInTheDocument();
    const tasks = screen.getAllByLabelText(/Default tasks/)[1]!;
    await user.clear(tasks);
    await user.type(tasks, 'Draft the deck{Enter}Rehearse');
    await user.click(screen.getAllByRole('button', { name: 'Save stage' })[1]!);
    await waitFor(() => {
      expect(lastCall(`stages/${MINE.stages[1]!.id}`)?.body).toEqual({
        name: 'Idea & problem',
        weight: 2,
        dueRule: { anchor: 'DEADLINE', kind: 'PPT', offsetDays: -1 },
        defaultTasks: ['Draft the deck', 'Rehearse'],
        versionNo: 1,
      });
    });
    expect(await screen.findByText(/version 2/)).toBeInTheDocument();
  });

  it('moves a stage from its menu and removes one after confirming', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/templates/${MINE.id}`);
    await user.click(await screen.findByRole('button', { name: 'Actions for Build prototype' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => {
      expect(
        screen.getAllByLabelText('Stage name').map((box) => (box as HTMLInputElement).value),
      ).toEqual(['Team & registration', 'Build prototype', 'Idea & problem']);
    });
    expect(lastCall('/move')?.body).toMatchObject({ beforeId: MINE.stages[1]!.id });
    await user.click(screen.getByRole('button', { name: 'Actions for Team & registration' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: /Remove the stage/ });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(screen.getAllByLabelText('Stage name')).toHaveLength(2);
    });
  });

  it('a stale version is refused in the house words', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/templates/${MINE.id}`);
    await screen.findAllByLabelText('Stage name');
    api.workflows.templates.set(MINE.id, { ...MINE, versionNo: 4 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Someone else changed this — reload to see their change.'),
    ).toBeInTheDocument();
  });
});
