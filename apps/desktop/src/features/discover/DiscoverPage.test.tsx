import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

// Whole-screen tests with axe runs: seconds each in jsdom, more under full-suite load.
vi.setConfig({ testTimeout: 20_000 });

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
const titles = (): string[] =>
  cards().map((card) => within(card).getByRole('heading', { level: 3 }).textContent ?? '');

async function openDiscover(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp('/discover');
  await screen.findByRole('heading', { name: 'Event 1' });
  return user;
}

describe('the list', () => {
  it('shows 25 dense cards, announces the count, and Load more appends without duplicates', async () => {
    const user = await openDiscover();
    expect(cards()).toHaveLength(25);
    expect(document.getElementById('discover-count')).toHaveTextContent('30 events');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(cards()).toHaveLength(30);
    });
    expect(new Set(titles()).size).toBe(30);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    // The first page asked for facets, the second did not.
    expect(api.searches().map((body) => body.facets)).toEqual([true, false]);
  });

  it('the conflict marker is on the conflicted card only', async () => {
    await openDiscover();
    expect(screen.getAllByTestId('conflict-marker')).toHaveLength(1);
    expect(within(cards()[2]!).getByTestId('conflict-marker')).toHaveTextContent(
      'Sources disagree',
    );
  });

  it('"Why relevant?" shows the backend\'s reasons as written', async () => {
    const user = await openDiscover();
    await user.click(within(cards()[0]!).getByRole('button', { name: 'Why relevant?' }));
    expect(screen.getByRole('list', { name: 'Why relevant' })).toHaveTextContent(
      'Registration open until 2 Oct',
    );
  });
});

describe('the keyboard (§16.3)', () => {
  it('J/K move the selection; Enter opens the drawer; Esc closes it with scroll and focus kept', async () => {
    const user = await openDiscover();
    const main = document.getElementById('main')!;

    await user.keyboard('j');
    expect(cards()[1]).toHaveFocus();
    await user.keyboard('j');
    await user.keyboard('k');
    expect(cards()[1]).toHaveFocus();

    main.scrollTop = 640;
    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('complementary', { name: 'Event 2' });
    expect(drawer).toBeInTheDocument();
    // The list stayed mounted underneath.
    expect(cards()).toHaveLength(25);

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Event 2' })).toBeNull();
    });
    expect(main.scrollTop).toBe(640);
    expect(cards()[1]).toHaveFocus();
  });

  it('S saves the selected card; Assign is live (WP-19)', async () => {
    const user = await openDiscover();
    await user.keyboard('j');
    await user.keyboard('s');
    await waitFor(() => {
      expect(api.saved.has(ITEMS[1]?.id ?? '')).toBe(true);
    });
    const assign = within(cards()[0]!).getByRole('button', { name: 'Assign' });
    expect(assign).toBeEnabled();
    expect(assign).toHaveAttribute('aria-keyshortcuts', 'A');
  });

  it('"/" focuses the search box, and Enter searches Discover', async () => {
    const user = await openDiscover();
    await user.keyboard('/');
    const box = screen.getByRole('searchbox', { name: 'Search events' });
    expect(box).toHaveFocus();
    await user.keyboard('Event 3{Enter}');
    await waitFor(() => {
      expect(api.searches().at(-1)).toMatchObject({ text: 'Event 3' });
    });
  });
});

describe('optimistic Save and Hide (§16.3)', () => {
  it('Save shows at once and rolls back, with a visible error, when the server fails', async () => {
    const user = await openDiscover();
    api.failNext(/watchlist$/, 150);
    const save = within(cards()[0]!).getByRole('button', { name: 'Save' });
    await user.click(save);
    // Immediately pressed…
    expect(within(cards()[0]!).getByRole('button', { name: 'Saved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // …then put back, and the failure said out loud.
    await screen.findByText('Could not save “Event 1”');
    expect(within(cards()[0]!).getByRole('button', { name: 'Save' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(api.saved.size).toBe(0);
  });

  it('Save succeeds and Undo reverses it', async () => {
    const user = await openDiscover();
    await user.click(within(cards()[0]!).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved “Event 1”');
    expect(api.saved.has(ITEMS[0]?.id ?? '')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.saved.size).toBe(0);
    });
    expect(within(cards()[0]!).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('Hide removes the row with a "Hidden — Undo" toast, and Undo puts it back in place', async () => {
    const user = await openDiscover();
    await user.click(within(cards()[3]!).getByRole('button', { name: 'Hide' }));
    expect(titles()).not.toContain('Event 4');
    await screen.findByText('Hidden — “Event 4”');
    expect(api.hidden.has(ITEMS[3]?.id ?? '')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(titles()[3]).toBe('Event 4');
    });
    await waitFor(() => {
      expect(api.hidden.size).toBe(0);
    });
  });
});

describe('filter chips', () => {
  it('a chip writes the query, shows its value, and the count is re-announced', async () => {
    const user = await openDiscover();
    await user.click(screen.getByRole('button', { name: 'Mode filter' }));
    await user.click(screen.getByRole('checkbox', { name: /Online/ }));
    await waitFor(() => {
      expect(api.searches().at(-1)).toMatchObject({ modes: ['ONLINE'] });
    });
    await waitFor(() => {
      expect(document.getElementById('discover-count')).toHaveTextContent('0 events');
    });
    expect(screen.getByRole('button', { name: 'Mode filter: Online' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Mode filter: Online' })).toHaveFocus();
    // No match → the empty state names the next action.
    expect(
      screen.getByRole('heading', { name: 'No events match these filters' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await screen.findByRole('heading', { name: 'Event 1' });
  });

  it("the distance chip reads in D-06's words", async () => {
    const user = await openDiscover();
    await user.click(screen.getByRole('button', { name: 'Distance filter' }));
    await user.click(screen.getByRole('radio', { name: /Within 250 km/ }));
    expect(
      await screen.findByRole('button', { name: 'Distance filter: Within 250 km (in person)' }),
    ).toBeInTheDocument();
  });
});

describe('tabs', () => {
  it('arrow keys move between tabs; each tab sends its preset', async () => {
    const user = await openDiscover();
    screen.getByRole('tab', { name: 'Featured' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'All events' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => {
      expect(api.searches().at(-1)).toMatchObject({ sort: 'DEADLINE' });
    });
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(api.searches().at(-1)).toMatchObject({ sort: 'START', recurringOnly: true });
    });
    expect(screen.getByRole('tab', { name: 'Contest Calendar' })).toHaveFocus();
  });
});

describe('the error state', () => {
  it('says what happened and offers Retry', async () => {
    api.failNext(/search/);
    const user = userEvent.setup();
    await renderApp('/discover');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Event 1' });
  });
});

// The four-pass axe run over the whole screen lives in `DiscoverPage.a11y.test.tsx` (R89).
