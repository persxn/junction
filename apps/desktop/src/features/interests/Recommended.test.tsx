import type { RelevanceReason } from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi } from '../../testing/deadlines-api.js';
import { CATEGORY_OPTIONS } from '../../testing/fake-saved-searches.js';
import { installFakeSearch, makeItem, type FakeSearch } from '../../testing/fake-search.js';
import { installNotificationsApi } from '../../testing/notifications-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * Recommended explains itself (WP-24, §19 M3 "reasons shown for every
 * recommendation"): every card on Discover's Recommended and the Dashboard
 * panel prints its first two reasons as text; with no interests a banner
 * offers to pick some and the list still shows; any interest change re-asks
 * every RELEVANCE list. Plus the dialog's keyboard paths and "More like this".
 */

const R = (code: RelevanceReason['code'], text: string): RelevanceReason => ({
  code,
  text,
  weightApplied: 5,
});
const REASONS: RelevanceReason[][] = [
  [R('REGISTRATION_OPEN', 'Registration open until 2 Oct')],
  [R('CATEGORY_MATCH', 'AI/ML matches your interests'), R('CLOSING_SOON', 'Closes in 3 days')],
  [
    R('TAG_MATCH', 'Tagged Rust, one of your interests'),
    R('TRUSTED_SOURCE', 'Listed by Devfolio'),
    R('NO_CONFLICTS', 'Sources agree'),
  ],
];
const ITEMS = Array.from({ length: 9 }, (_unused, index) =>
  makeItem(index + 1, { reasons: REASONS[index % 3] ?? [] }),
);

let api: FakeSearch;
function install(): void {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installFakeSearch(ITEMS);
  installCompetitionsApi();
  installDeadlinesApi({ items: [], tiles: [] });
  installNotificationsApi();
}
beforeEach(install);
afterEach(() => {
  vi.unstubAllGlobals();
});

const relevanceSearches = (): number =>
  api.searches().filter((body) => body.sort === 'RELEVANCE').length;

function expectEveryCardExplained(cards: HTMLElement[]): void {
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    const title = within(card).getByRole('heading', { level: 3 }).textContent ?? '';
    const item = ITEMS.find((candidate) => candidate.title === title);
    const line = within(card).getByTestId('card-reasons');
    expect(line.textContent?.trim().length, title).toBeGreaterThan(0);
    expect(line).toHaveTextContent(
      (item?.reasons ?? [])
        .slice(0, 2)
        .map((reason) => reason.text)
        .join(' · '),
    );
    expect(line).toBeVisible();
  }
}

describe('every recommendation shows its reasons', () => {
  it('on Discover, without interests: a banner, and the list still shows, explained', async () => {
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    expect(await screen.findByText(/Pick your interests to sharpen these/)).toBeInTheDocument();
    expectEveryCardExplained(screen.getAllByRole('article'));
  });

  it('on Discover, with interests: no banner, every card still explained', async () => {
    api.savedSearches.interests.categoryIds = [CATEGORY_OPTIONS[0]!.id];
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await waitFor(() => {
      expect(api.calls.some((call) => call.path === '/api/v1/me/interests')).toBe(true);
    });
    expect(screen.queryByText(/Pick your interests to sharpen these/)).toBeNull();
    expectEveryCardExplained(screen.getAllByRole('article'));
  });

  it('on the Dashboard panel, with and without interests', async () => {
    await renderApp('/');
    const panel = await screen.findByRole('list', { name: 'Recommended' });
    expect(await screen.findByText(/Pick your interests to sharpen these/)).toBeInTheDocument();
    expectEveryCardExplained(within(panel).getAllByRole('article'));
  });
});

describe('My interests', () => {
  it('ticking a category saves it, drops the banner and re-asks every RELEVANCE list', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    const before = relevanceSearches();
    await user.click(await screen.findByRole('button', { name: 'Pick your interests' }));
    const dialog = await screen.findByRole('dialog', { name: 'My interests' });
    await user.click(await within(dialog).findByRole('checkbox', { name: 'AI/ML' }));
    await waitFor(() => {
      expect(api.savedSearches.interests.categoryIds).toStrictEqual([CATEGORY_OPTIONS[0]!.id]);
    });
    await waitFor(() => {
      expect(relevanceSearches()).toBeGreaterThan(before);
    });
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByText(/Pick your interests to sharpen these/)).toBeNull();
    });
  });

  it('opens from the user menu; the tag combobox works from the keyboard', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await user.click(screen.getByRole('button', { name: /Ada Lovelace|Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'My interests' }));
    const dialog = await screen.findByRole('dialog', { name: 'My interests' });
    const box = await within(dialog).findByRole('combobox', { name: /technology, theme or skill/ });
    await user.click(box);
    await user.type(box, 'Ru');
    expect(await within(dialog).findByRole('option', { name: 'Rust' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await waitFor(() => {
      expect(api.savedSearches.interests.tags.map((tag) => tag.name)).toContain('Rust');
    });
    await user.type(box, 'Zig');
    const add = await within(dialog).findByRole('option', { name: 'Add “Zig” as an interest' });
    expect(add).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(api.savedSearches.interests.tags.map((tag) => tag.name)).toContain('Zig');
    });
    // Esc closes the list first, then the dialog.
    await user.type(box, 'R');
    await within(dialog).findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'My interests' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove Zig' }));
    await waitFor(() => {
      expect(api.savedSearches.interests.tags.map((tag) => tag.name)).not.toContain('Zig');
    });
  });

  it('"More like this" in the drawer adds the category, with Undo', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: 'Event 1' });
    await user.click(screen.getAllByRole('article')[0]!);
    await user.keyboard('{Enter}');
    const more = await screen.findAllByRole('button', { name: /^More like this: add / });
    const name = /add (.+) to your interests/.exec(more[0]!.getAttribute('aria-label') ?? '')?.[1];
    await user.click(more[0]!);
    expect(await screen.findByText(`Added ${name ?? ''} to your interests`)).toBeInTheDocument();
    await waitFor(() => {
      expect(api.savedSearches.interests.categoryIds.length).toBe(1);
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.savedSearches.interests.categoryIds).toStrictEqual([]);
    });
  });
});
