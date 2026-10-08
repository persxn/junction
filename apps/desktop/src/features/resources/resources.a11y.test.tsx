import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import {
  installCompetitionsApi,
  makeCompetition,
  makeEvent,
} from '../../testing/competitions-api.js';
import { renderApp } from '../../testing/render.js';
import { installResourcesApi, makeResource } from '../../testing/resources-api.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { HACKATHON, workflowFrom } from '../../testing/workflow-fixtures.js';

/**
 * WP-20b's screens with axe (R89's `pnpm test:a11y`): the Resources section
 * with its guide, a stage's and a task's rows, a row's menu, and the add
 * dialog.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const COMPETITION = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }));
const base = workflowFrom(COMPETITION.id, HACKATHON);

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  const api = installCompetitionsApi({ competitions: [COMPETITION] });
  api.workflows.workflows.set(COMPETITION.id, base);
  installResourcesApi({
    resources: [
      makeResource('ENGAGEMENT', COMPETITION.id, { kind: 'GITHUB', label: 'acme/rocket' }),
      makeResource('ENGAGEMENT', COMPETITION.id, {
        kind: 'LOCAL_PATH',
        uri: 'C:\\Team\\deck.pdf',
        label: 'deck.pdf',
        machineLabel: 'LAB-PC-07',
      }),
      makeResource('STAGE', base.stages[0]!.id, { label: 'Stage brief' }),
      makeResource('TASK', base.stages[0]!.tasks[0]!.id, { label: 'Form link' }),
    ],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the Resources section, a stage’s and a task’s rows, and a row menu', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await screen.findByRole('list', { name: 'Resources of this competition' });
    expect(screen.getByRole('list', { name: 'Resources of Confirm the team' })).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
    await user.click(screen.getByRole('button', { name: 'Actions for acme/rocket' }));
    await expect(document.body).toBeAccessible();
  });

  it('the add dialog', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await user.click(
      await screen.findByRole('button', { name: 'Add a resource to this competition' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Link or path')).toHaveFocus();
    await expect(document.body).toBeAccessible();
  });
});
