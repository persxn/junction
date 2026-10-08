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
import { renderApp, renderWithProviders } from '../../testing/render.js';
import { installStudentsApi, makeStudent } from '../../testing/students-api.js';
import { installUsersApi } from '../../testing/users-api.js';
import { UsersPage } from '../admin/users/UsersPage.js';

/**
 * WP-21's screens with axe (R89's `pnpm test:a11y`): the outcome panel empty
 * and recorded, the outcome form, the transfer dialog, and the Student page's
 * Competitions & outcomes.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const DONE = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }), { status: 'COMPLETED' });

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the outcome panel, its form, and the recorded outcome', async () => {
    installStudentsApi();
    api = installCompetitionsApi({ competitions: [DONE] });
    const user = userEvent.setup();
    await renderApp(`/competitions/${DONE.id}`);
    await user.click(await screen.findByRole('button', { name: 'Record outcome' }));
    await screen.findByRole('dialog');
    await expect(document.body).toBeAccessible();
    await user.type(screen.getByLabelText('Prize amount (optional)'), '500');
    await user.type(screen.getByLabelText('Currency'), 'usd');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Record outcome' }),
    );
    await screen.findByRole('button', { name: 'Edit outcome' });
    expect(api.competitions.get(DONE.id)?.outcome?.prizeCurrency).toBe('USD');
    await expect(document.body).toBeAccessible();
  });

  it('the transfer dialog', async () => {
    installUsersApi();
    const user = userEvent.setup();
    // In the `<main>` the shell renders routes into, as WP-07b's Users test does.
    renderWithProviders(
      <main>
        <UsersPage />
      </main>,
    );
    await user.click(await screen.findByRole('button', { name: 'Transfer ownership…' }));
    await screen.findByRole('dialog', { name: 'Transfer ownership' });
    await expect(document.body).toBeAccessible();
  });

  it('the Student page’s competitions and outcomes', async () => {
    installStudentsApi({ students: [ASHA] });
    installCompetitionsApi();
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByText(/No competitions yet/);
    await expect(document.body).toBeAccessible();
  });
});
