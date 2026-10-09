import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../../testing/fake-search.js';
import { renderApp } from '../../../testing/render.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

// Whole-screen flows in jsdom: seconds each under full-suite load.
vi.setConfig({ testTimeout: 20_000 });

/**
 * Saved searches on Discover (WP-24 step 6): save with alerts on by default,
 * apply (the chips come back), update with the current filters, rename,
 * toggle alerts, delete with Undo — all from the keyboard-reachable menu —
 * and the NEW_MATCH route that applies a search.
 */

let api: FakeSearch;
beforeEach(() => {
  resetApiTransport();
  api = installFakeSearch(
    Array.from({ length: 6 }, (_unused, index) =>
      makeItem(index + 1, index % 2 === 0 ? { mode: 'ONLINE' } : {}),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDiscover(path = '/discover'): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp(path);
  await screen.findByRole('heading', { name: 'Event 1' });
  return user;
}

async function chooseOnline(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Mode filter' }));
  await user.click(screen.getByRole('checkbox', { name: /Online/ }));
  await user.keyboard('{Escape}');
  await screen.findByRole('button', { name: 'Mode filter: Online' });
}

async function saveAs(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Save this search' }));
  const dialog = await screen.findByRole('dialog', { name: 'Save this search' });
  expect(within(dialog).getByRole('checkbox', { name: /Tell me about new matches/ })).toBeChecked();
  await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), name);
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Save this search' })).toBeNull();
  });
}

const menu = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: /^Saved searches/ }));
  return screen.findByRole('list', { name: 'Saved searches' });
};

describe('saving and applying', () => {
  it('saves the chips with alerts on, and applying puts them back', async () => {
    const user = await openDiscover();
    await chooseOnline(user);
    await saveAs(user, 'Online events');
    const stored = api.savedSearches.searches[0];
    expect(stored).toMatchObject({ name: 'Online events', notifyOnNew: true });
    expect(stored?.query).toMatchObject({ modes: ['ONLINE'] });

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await screen.findByRole('button', { name: 'Mode filter' });
    const list = await menu(user);
    await user.click(within(list).getByRole('button', { name: 'Online events' }));
    await screen.findByRole('button', { name: 'Mode filter: Online' });
    expect(screen.getByRole('tab', { name: 'All events' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(api.searches().at(-1)).toMatchObject({ modes: ['ONLINE'] });
  });

  it('shows the server’s refusal of a taken name in the dialog', async () => {
    const user = await openDiscover();
    await saveAs(user, 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this search' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'MINE');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'already one of your saved searches',
    );
  });
});

describe('the menu, from the keyboard', () => {
  it('updates with the current filters, renames, toggles alerts and deletes with Undo', async () => {
    const user = await openDiscover();
    await saveAs(user, 'Everything');
    await chooseOnline(user);

    let list = await menu(user);
    await user.click(
      within(list).getByRole('button', { name: 'Update “Everything” with the current filters' }),
    );
    await waitFor(() => {
      expect(api.savedSearches.searches[0]?.query).toMatchObject({ modes: ['ONLINE'] });
    });

    list = await menu(user);
    const alerts = within(list).getByRole('button', { name: 'Alerts for “Everything”' });
    expect(alerts).toHaveAttribute('aria-pressed', 'true');
    alerts.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(api.savedSearches.searches[0]?.notifyOnNew).toBe(false);
    });

    await user.click(within(list).getByRole('button', { name: 'Rename “Everything”' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename saved search' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Online only{Enter}');
    await waitFor(() => {
      expect(api.savedSearches.searches[0]?.name).toBe('Online only');
    });

    list = await menu(user);
    await user.click(within(list).getByRole('button', { name: 'Delete “Online only”' }));
    await waitFor(() => {
      expect(api.savedSearches.searches).toHaveLength(0);
    });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.savedSearches.searches.map((s) => s.name)).toStrictEqual(['Online only']);
    });
  });

  it('says when there is nothing saved, and closes on Escape with focus back on its button', async () => {
    const user = await openDiscover();
    await user.click(screen.getByRole('button', { name: /^Saved searches/ }));
    expect(await screen.findByText(/No saved searches yet/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/No saved searches yet/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Saved searches/ })).toHaveFocus();
  });
});

describe('a NEW_MATCH route', () => {
  it('opens Discover with the search applied', async () => {
    const created = api.savedSearches.handle('POST', '/api/v1/saved-searches', {
      name: 'Online',
      query: { modes: ['ONLINE'] },
    }) as { id: string };
    await renderApp(`/discover/saved/${created.id}`);
    await screen.findByRole('button', { name: 'Mode filter: Online' });
    await waitFor(() => {
      expect(api.searches().at(-1)).toMatchObject({ modes: ['ONLINE'] });
    });
  });

  it('says so when the search was deleted, and shows all events', async () => {
    await renderApp('/discover/saved/01931f2a-0000-7000-8000-0000000000ff');
    expect(await screen.findByText('That saved search no longer exists')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Mode filter' });
  });
});
