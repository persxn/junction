import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { installFakeSearch, makeItem } from '../../../testing/fake-search.js';
import { renderApp } from '../../../testing/render.js';

/**
 * The drawer open over Discover, with everything in it that opens (ruling R89's
 * `pnpm test:a11y`): the conflict panel, a provenance disclosure and the top
 * bar's freshness popover, all on screen at once — three overlays over a
 * 30-card list, which is the state nothing else exercises.
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

describe('the drawer', () => {
  it('is axe-clean with the drawer, the conflict panel and the freshness popover open', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    screen.getAllByRole('article')[2]!.focus();
    await user.keyboard('{Enter}');
    await screen.findByTestId('event-drawer');

    await screen.findByTestId('sources-disagree');
    // A provenance disclosure open too — the panel a keyboard user reaches.
    await user.click(screen.getByTestId('provenance-registrationDeadlineAt'));
    await user.click(screen.getByTestId('freshness-pill'));
    await screen.findByTestId('freshness-popover');
    await expect(document.body).toBeAccessible();
  });
});
