import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { renderWithProviders } from '../../../testing/render.js';
import { installUsersApi } from '../../../testing/users-api.js';
import { UsersPage } from './UsersPage.js';

/**
 * Admin → Users, with axe (ruling R89's `pnpm test:a11y`): the list, and the add
 * dialog that is portalled to `document.body` on top of it.
 *
 * The page is wrapped in the `<main>` the shell renders its routes into
 * (AppShell.tsx). Without it, the pass would fail on the test's own scaffolding —
 * a table in no landmark — rather than on anything the screen does wrong.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const user = (): ReturnType<typeof userEvent.setup> => userEvent.setup({ delay: null });

beforeEach(() => {
  invoke.mockReset();
  resetApiTransport();
  installUsersApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderUsers(): void {
  renderWithProviders(
    <main>
      <UsersPage />
    </main>,
  );
}

describe('accessibility', () => {
  it('has no axe violations on the list', async () => {
    renderUsers();
    await screen.findByText('A. Administrator');
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations with the add dialog open', async () => {
    renderUsers();
    await screen.findByText('A. Administrator');
    await user().click(screen.getByRole('button', { name: /Add a person/ }));
    await expect(document.body).toBeAccessible();
  });
});
