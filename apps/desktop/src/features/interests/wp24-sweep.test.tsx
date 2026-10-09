import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';

/**
 * WP-24's UI fault sweep, as tests: saving a search and setting interests
 * work through the shell proxy alone (R78/F9); the menu and the dialog say
 * so when their data cannot be read; and no enum, slug, ISO string or
 * internal id reaches the screen.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

let api: FakeSearch;
beforeEach(() => {
  resetApiTransport();
  api = installFakeSearch(Array.from({ length: 4 }, (_unused, index) => makeItem(index + 1)));
  invoke.mockReset();
  installShellProxy(invoke);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const proxied = (): string[] =>
  invoke.mock.calls
    .filter((call) => call[0] === 'backend_request')
    .map((call) => {
      const request = (call[1] as { request: { method: string; path: string } }).request;
      return `${request.method} ${request.path.split('?')[0] ?? ''}`;
    });

describe('under the F9 fallback (R78)', () => {
  it('saves a search and sets an interest with the shell as the only transport', async () => {
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this search' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Through the shell');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.savedSearches.searches).toHaveLength(1);
    });
    await user.click(await screen.findByRole('button', { name: 'Pick your interests' }));
    const interests = await screen.findByRole('dialog', { name: 'My interests' });
    await user.click(await within(interests).findByRole('checkbox', { name: 'AI/ML' }));
    await waitFor(() => {
      expect(api.savedSearches.interests.categoryIds).toHaveLength(1);
    });
    expect(proxied()).toEqual(
      expect.arrayContaining([
        'POST /api/v1/saved-searches',
        'GET /api/v1/saved-searches',
        'GET /api/v1/me/interests',
        expect.stringMatching(/^POST \/api\/v1\/me\/interests\/categories\//),
      ]),
    );
  });
});

describe('error and empty states', () => {
  it('the menu and the dialog say when their data cannot be read', async () => {
    api.failNext(/^\/api\/v1\/saved-searches$/);
    // The banner's read, then the dialog's own read when it opens.
    api.failNext(/^\/api\/v1\/me\/interests$/);
    api.failNext(/^\/api\/v1\/me\/interests$/);
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await user.click(screen.getByRole('button', { name: /^Saved searches/ }));
    expect(await screen.findByText('Your saved searches could not be loaded.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // No banner when interests could not be read; the menu offers them instead.
    expect(screen.queryByText(/Pick your interests to sharpen these/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Ada Lovelace|Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'My interests' }));
    const dialog = await screen.findByRole('dialog', { name: 'My interests' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});

describe('no raw values on screen', () => {
  it('shows no enum, slug, ISO string or id across Discover, the menu and the dialogs', async () => {
    api.savedSearches.handle('POST', '/api/v1/saved-searches', {
      name: 'AI hackathons',
      query: { eventTypes: ['HACKATHON'], categories: ['ai-ml'], modes: ['OFFLINE'] },
    });
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await user.click(screen.getByRole('button', { name: /^Saved searches/ }));
    await screen.findByRole('list', { name: 'Saved searches' });
    const texts = [document.body.textContent ?? ''];
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save this search' }));
    await screen.findByRole('dialog', { name: 'Save this search' });
    texts.push(document.body.textContent ?? '');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Pick your interests' }));
    await screen.findByRole('checkbox', { name: 'AI/ML' });
    texts.push(document.body.textContent ?? '');
    for (const text of texts) {
      expect(text).not.toMatch(
        /\b(HACKATHON|OFFLINE|RELEVANCE|NEW_MATCH|CATEGORY_MATCH|INTEREST|ai-ml)\b/,
      );
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(text).not.toMatch(/01931f2a-/);
    }
  });
});
