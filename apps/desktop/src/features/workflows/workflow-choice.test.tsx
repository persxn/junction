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

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The board's Considering → Assigned (WP-20a step 6): the move asks for the
 * workflow first, with the assign flow's two steps; cancelling moves nothing.
 */

const CONSIDERING = makeCompetition(makeEvent(3, { title: 'Gamma Hack' }), {
  status: 'CONSIDERING',
  team: { id: '0192f0c1-0000-7000-8000-00000000b003', name: 'Team Nova' },
});

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [CONSIDERING] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function moveToAssigned() {
  const user = userEvent.setup();
  await renderApp('/competitions');
  const card = await screen.findByRole('article', { name: /^Gamma Hack/ });
  card.focus();
  await user.keyboard('m');
  const menu = screen.getByRole('menu', { name: 'Move Team Nova to' });
  await user.click(within(menu).getByRole('menuitem', { name: 'Move to Assigned' }));
  const dialog = await screen.findByRole('dialog', { name: 'Assign “Gamma Hack”' });
  return { user, dialog };
}

const transition = () =>
  api.calls.find((call) => call.path === `/api/v1/competitions/${CONSIDERING.id}/transitions`);

describe('Considering → Assigned on the board', () => {
  it('runs the template and dates steps, then moves with the choice', async () => {
    const { user, dialog } = await moveToAssigned();
    expect(within(dialog).getByText('Step 1 of 2')).toBeInTheDocument();
    expect(await within(dialog).findByRole('radio', { name: /^Hackathon/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await within(dialog).findByText(/Stage dates — Hackathon/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(api.competitions.get(CONSIDERING.id)?.status).toBe('ASSIGNED');
    });
    expect(transition()?.body).toMatchObject({
      to: 'ASSIGNED',
      workflow: { templateId: expect.any(String) as string, dueOverrides: {} },
    });
  });

  it('Cancel moves nothing and shows no error', async () => {
    const { user, dialog } = await moveToAssigned();
    await within(dialog).findByRole('radio', { name: /^Hackathon/ });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(transition()).toBeUndefined();
    expect(api.competitions.get(CONSIDERING.id)?.status).toBe('CONSIDERING');
    expect(await screen.findByText('Team Nova was not moved.')).toBeInTheDocument();
  });
});
