import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';

/**
 * Discover, checked with axe in the four states a professor actually puts it in
 * (ruling R89's `pnpm test:a11y`).
 *
 * This was the slowest test in `pnpm verify` — four axe passes over a 30-card
 * list in jsdom, and the reason a 45-second per-test timeout had crept in. It
 * runs the same way here, with no timeout at all beyond the file's.
 */

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

vi.setConfig({ testTimeout: 20_000 });

const ITEMS = Array.from({ length: 30 }, (_unused, index) =>
  makeItem(index + 1, index === 2 ? { hasConflicts: true } : {}),
);

beforeEach(() => {
  resetApiTransport();
  installFakeSearch(ITEMS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const cards = (): HTMLElement[] => screen.getAllByRole('article');

describe('accessibility', () => {
  it('axe is clean on every tab, with a chip popover open and with the long list loaded', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(cards()).toHaveLength(30);
    });
    await user.click(within(cards()[0]!).getByRole('button', { name: 'Why relevant?' }));
    await expect(document.body).toBeAccessible();

    await user.click(screen.getByRole('button', { name: 'Registration filter' }));
    await expect(document.body).toBeAccessible();
    await user.keyboard('{Escape}');

    for (const tab of ['All events', 'Contest Calendar'] as const) {
      await user.click(screen.getByRole('tab', { name: tab }));
      // The calendar's preset admits contest types only, so it may render its empty state.
      await screen.findByRole('heading', { name: /^(Event 1|Nothing yet)$/ });
      await expect(document.body).toBeAccessible();
    }
  });
});
