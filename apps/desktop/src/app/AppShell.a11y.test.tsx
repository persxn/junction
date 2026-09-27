import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../testing/render.js';
import { TEST_USER } from '../testing/auth.js';
import { MAIN_NAV } from './nav.js';

/**
 * The shell, checked with axe on every screen it can show (the §19 acceptance
 * criterion; ruling R89 moved it out of `pnpm verify` and into `pnpm test:a11y`).
 *
 * Nine passes over the whole document, one per rail destination plus the two
 * states that change the chrome rather than the route. Nothing is scoped: since
 * pre-M2a the rail's brand sits inside the `nav` landmark, so the `region` rule
 * can be left switched on and the whole `document.body` checked, which is what
 * makes these passes worth their seconds.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe('accessibility (the §19 acceptance criterion)', () => {
  it.each(MAIN_NAV.map((item) => [item.label, item.path] as const))(
    'has no axe violations on %s',
    async (_label, path) => {
      await renderApp(path);
      await expect(document.body).toBeAccessible();
    },
  );

  it('has no axe violations with the rail collapsed', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('button', { name: 'Collapse the navigation' }));
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations with the user menu open', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('button', { name: TEST_USER.displayName }));
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on an admin screen', async () => {
    await renderApp('/admin/users', { roles: ['ADMINISTRATOR'] });
    await expect(document.body).toBeAccessible();
  });
});
