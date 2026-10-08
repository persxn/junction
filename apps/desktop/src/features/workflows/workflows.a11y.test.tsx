import { screen, within } from '@testing-library/react';
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
import { HACKATHON, makeTemplate, workflowFrom } from '../../testing/workflow-fixtures.js';

/**
 * WP-20a's screens with axe (R89's `pnpm test:a11y`): the Competition page's
 * workflow with its guide and a stage's details open, the R100 banner, the
 * stage menu, the complete-with-open-tasks and blocked dialogs, and the board
 * with progress and health on its cards; the Templates list and editor.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const COMPETITION = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }), {
  progress: 40,
  health: 'AT_RISK',
  healthReason: 'Build prototype due tomorrow, 1 of 2 tasks done',
});
const base = workflowFrom(COMPETITION.id, HACKATHON);

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [COMPETITION] });
  api.workflows.workflows.set(COMPETITION.id, {
    ...base,
    dateChanges: [
      {
        stageId: base.stages[0]!.id,
        stageName: base.stages[0]!.name,
        current: base.stages[0]!.dueAt,
        proposed: '2026-10-23T18:29:59.999Z',
      },
    ],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the workflow, its banner, guide, details and stage menu', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await screen.findByRole('list', { name: 'Stages in order' });
    expect(screen.getByText('Event deadline changed — update stage dates?')).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
    const guide = screen.getByRole('button', { name: /How stages and progress work/ });
    if (guide.getAttribute('aria-expanded') === 'false') await user.click(guide);
    await user.click(screen.getAllByText('Date, progress, people and notes')[0]!);
    await user.click(screen.getByRole('button', { name: 'Actions for Idea & problem' }));
    await expect(document.body).toBeAccessible();
  });

  it('both stage dialogs', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await screen.findByRole('list', { name: 'Stages in order' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Status of Team & registration' }),
      'COMPLETED',
    );
    const complete = await screen.findByRole('dialog');
    await expect(document.body).toBeAccessible();
    await user.click(within(complete).getByRole('button', { name: 'Cancel' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Status of Team & registration' }),
      'BLOCKED',
    );
    await screen.findByRole('dialog', { name: /What is blocking/ });
    await expect(document.body).toBeAccessible();
  });

  it('the board with progress and health on a card', async () => {
    await renderApp('/competitions');
    const card = await screen.findByRole('article', { name: /^Alpha Hack/ });
    expect(within(card).getByText('40% done')).toBeInTheDocument();
    expect(within(card).getByText('At risk')).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
  });

  it('the templates list', async () => {
    await renderApp('/competitions/templates');
    await screen.findByRole('region', { name: 'Department defaults' });
    await expect(document.body).toBeAccessible();
  });

  it('an editable template', async () => {
    const mine = makeTemplate(5, { name: 'My hackathon', ownedByMe: true, canEdit: true });
    api.workflows.templates.set(mine.id, mine);
    await renderApp(`/competitions/templates/${mine.id}`);
    await screen.findAllByLabelText('Stage name');
    await expect(document.body).toBeAccessible();
  });
});
