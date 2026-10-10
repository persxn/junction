import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../../testing/fake-search.js';
import { renderApp } from '../../../testing/render.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

// A whole-screen test with an axe run: seconds each in jsdom, more under load.
vi.setConfig({ testTimeout: 20_000 });

/**
 * The drawer over the real Discover screen (§16.2, WP-16b): it opens without
 * the list losing its place, it traps focus, Esc returns focus to the card that
 * opened it, and — with it open — Discover is still axe-clean.
 */

const ITEMS = Array.from({ length: 30 }, (_unused, index) =>
  makeItem(index + 1, index === 2 ? { hasConflicts: true } : {}),
);

let api: FakeSearch;

beforeEach(() => {
  resetApiTransport();
  api = installFakeSearch(ITEMS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const cards = (): HTMLElement[] => screen.getAllByRole('article');

async function openDrawer(index = 2): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp('/discover');
  await screen.findByRole('heading', { name: 'Event 1' });
  cards()[index]!.focus();
  await user.keyboard('{Enter}');
  await screen.findByTestId('event-drawer');
  return user;
}

describe('the drawer', () => {
  it('shows every §16.2 section from one request', async () => {
    await openDrawer();
    await screen.findByTestId('sources-disagree');
    expect(screen.getByTestId('deadline-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('sources-list')).toBeInTheDocument();
    expect(screen.getByTestId('change-history')).toBeInTheDocument();
    expect(screen.getByTestId('category-chips')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Facts' })).toBeInTheDocument();

    // One round trip for the whole drawer (§16.2: "must not fan out").
    const detailCalls = api.calls.filter((call) => call.path.endsWith('/detail'));
    expect(detailCalls).toHaveLength(1);
  });

  it('shows "Sources disagree" on a conflicted event and not on a clean one', async () => {
    await openDrawer(2);
    expect(await screen.findByTestId('sources-disagree')).toHaveTextContent('Sources disagree');
    const panel = within(screen.getByTestId('sources-disagree'));
    expect(panel.getByTestId('conflict-registrationDeadlineAt')).toBeInTheDocument();
    expect(panel.getAllByText('Shown by Junction:').length).toBe(3);
  });

  it('carries each source with D-32 attribution', async () => {
    await openDrawer();
    const sources = within(await screen.findByTestId('sources-list'));
    expect(sources.getByText('Devfolio')).toBeInTheDocument();
    expect(sources.getByText('Listing data from Devfolio.')).toBeInTheDocument();
    expect(sources.getByText('Event data from CTFtime.org.')).toBeInTheDocument();
  });

  it('keeps the list where it was, and Esc returns focus to the card', async () => {
    const user = await openDrawer(1);
    const main = document.getElementById('main')!;
    main.scrollTop = 640;
    await screen.findByTestId('sources-list');

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('event-drawer')).not.toBeInTheDocument();
    });
    expect(main.scrollTop).toBe(640);
    expect(cards()[1]).toHaveFocus();
  });

  it('traps Tab inside the panel', async () => {
    const user = await openDrawer();
    await screen.findByTestId('sources-list');
    const drawer = screen.getByTestId('event-drawer');
    // Tab from the last control wraps back into the drawer, never behind it.
    for (let step = 0; step < 40; step += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
  });

  it('overrides a category optimistically, with Undo', async () => {
    const user = await openDrawer();
    const chips = await screen.findByTestId('category-chips');
    await user.click(within(chips).getByRole('button', { name: 'Remove AI/ML' }));

    await waitFor(() => {
      expect(within(screen.getByTestId('category-chips')).queryByText('AI/ML')).toBeNull();
    });
    expect(await screen.findByText('Categories updated')).toBeInTheDocument();
    expect(screen.getByText(/stays put when the rules change/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.categorySets).toHaveLength(2);
    });
    // The Undo sends the set as it was before the removal.
    expect(api.categorySets[1]).toHaveLength(2);
  });

  // The axe pass with every overlay open lives in `EventDrawer.a11y.test.tsx` (R89).
});
