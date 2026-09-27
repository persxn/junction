import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';

/**
 * Every write a professor makes on Discover, on a machine where the page cannot
 * reach the backend at all (ruling R78, finding F9) — the acceptance case for
 * pre-M2a item 1, at the level of the screens rather than the client.
 *
 * `client.test.ts` proves the five methods and their bodies go through the proxy.
 * This proves the screens do: Save, Hide with its Undo, a category override and a
 * text search all succeed with `fetch` unreachable, which is precisely what M1
 * shipped broken — "invisible on this machine, total on an LNA-enforcing one".
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

vi.setConfig({ testTimeout: 20_000 });

const ITEMS = Array.from({ length: 5 }, (_unused, index) => makeItem(index + 1));

let api: FakeSearch;

beforeEach(() => {
  resetApiTransport();
  api = installFakeSearch(ITEMS);
  invoke.mockReset();
  installShellProxy(invoke);
  // The state the app reaches after its first request on such a machine.
  useShellTransportForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every request the shell carried, as `METHOD /path`. */
function proxied(): string[] {
  return invoke.mock.calls
    .filter((call) => call[0] === 'backend_request')
    .map((call) => {
      const request = (call[1] as { request: { method: string; path: string } }).request;
      return `${request.method} ${request.path}`;
    });
}

describe('Discover with the shell proxy as the only transport (R78)', () => {
  it('loads the list at all, and every request went through the shell', async () => {
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    expect(proxied()).toContain('POST /api/v1/search/events');
  });

  it('saves a card', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    const card = screen.getAllByRole('article')[0]!;

    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.saved.size).toBe(1);
    });
    expect(proxied().some((entry) => /^PUT .*\/watchlist$/.test(entry))).toBe(true);
  });

  it('hides a card, and takes it back', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    const card = screen.getAllByRole('article')[0]!;

    await user.click(within(card).getByRole('button', { name: 'Hide' }));
    await waitFor(() => {
      expect(api.hidden.size).toBe(1);
    });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.hidden.size).toBe(0);
    });
    expect(proxied().some((entry) => /^POST .*\/hide$/.test(entry))).toBe(true);
    expect(proxied().some((entry) => /^POST .*\/unhide$/.test(entry))).toBe(true);
  });

  it('overrides an event category from the drawer', async () => {
    const user = userEvent.setup();
    await renderApp('/discover', { roles: ['ADMINISTRATOR'] });
    await screen.findByRole('heading', { name: 'Event 1' });
    screen.getAllByRole('article')[0]!.focus();
    await user.keyboard('{Enter}');
    await screen.findByTestId('event-drawer');

    // Removing a category is the override (D-15): a PUT, and the one write on
    // this screen that M1 could not make on a machine that needs the fallback.
    const chips = await screen.findByTestId('category-chips');
    await user.click(within(chips).getByRole('button', { name: 'Remove AI/ML' }));

    await waitFor(() => {
      expect(api.categorySets).toHaveLength(1);
    });
    expect(proxied().some((entry) => /^PUT .*\/categories$/.test(entry))).toBe(true);
  });

  it('searches from the top bar', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });

    await user.type(screen.getByRole('searchbox', { name: 'Search events' }), 'Event 2{Enter}');
    await waitFor(() => {
      expect(api.searches().some((body) => body.text === 'Event 2')).toBe(true);
    });
    // Nothing in this whole test ever used `fetch` directly.
    expect(proxied().every((entry) => entry.startsWith('POST') || entry.startsWith('GET'))).toBe(
      true,
    );
  });
});
