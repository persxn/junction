import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../testing/render.js';

/**
 * The palette, open, over the whole shell (ruling R89's `pnpm test:a11y`).
 *
 * It is here rather than in `CommandPalette.test.tsx` because the pass is over
 * the whole document with a portalled dialog in it — the palette on top of the
 * rail, the top bar and a route — which is the integration case R89 moved out of
 * `pnpm verify`, not a single component's assertion.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe('the Ctrl+K palette (§16.3)', () => {
  it('has no axe violations while it is open', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
  });
});
