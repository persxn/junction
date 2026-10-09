import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';

/**
 * WP-24's screens under axe (R89's `pnpm test:a11y`): Discover's Recommended
 * with the interests banner, the save dialog, the Saved searches menu with
 * a search in it, the rename dialog, My interests with the combobox's list
 * open, and the drawer with "More like this".
 */

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

let api: FakeSearch;
beforeEach(() => {
  resetApiTransport();
  api = installFakeSearch(Array.from({ length: 6 }, (_unused, index) => makeItem(index + 1)));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility (WP-24)', () => {
  it('axe is clean on the banner, the save dialog, the menu and the rename dialog', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await screen.findByText(/Pick your interests to sharpen these/);
    await expect(document.body).toBeAccessible();

    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this search' });
    await expect(document.body).toBeAccessible();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Everything{Enter}');
    await waitFor(() => {
      expect(api.savedSearches.searches).toHaveLength(1);
    });

    await user.click(screen.getByRole('button', { name: /^Saved searches/ }));
    const list = await screen.findByRole('list', { name: 'Saved searches' });
    await expect(document.body).toBeAccessible();
    await user.click(within(list).getByRole('button', { name: 'Rename “Everything”' }));
    await screen.findByRole('dialog', { name: 'Rename saved search' });
    await expect(document.body).toBeAccessible();
  });

  it('axe is clean on My interests with the combobox open, and on the drawer', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await user.click(await screen.findByRole('button', { name: 'Pick your interests' }));
    const dialog = await screen.findByRole('dialog', { name: 'My interests' });
    const box = await within(dialog).findByRole('combobox');
    await user.type(box, 'Ru');
    await within(dialog).findByRole('option', { name: 'Rust' });
    await expect(document.body).toBeAccessible();
    await user.keyboard('{Escape}{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'My interests' })).toBeNull();
    });

    await user.click(screen.getAllByRole('article')[0]!);
    await user.keyboard('{Enter}');
    await screen.findAllByRole('button', { name: /^More like this: add / });
    await expect(document.body).toBeAccessible();
  });
});
