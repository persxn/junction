import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../testing/render.js';
import { ADMIN_NAV, MAIN_NAV } from './nav.js';
import { RAIL_STORAGE_KEY } from './use-rail.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe('the left rail (§16.1)', () => {
  it('lists every main item and nothing else', async () => {
    await renderApp();
    const rail = screen.getByRole('navigation', { name: 'Main' });
    const labels = within(rail)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim());
    expect(labels).toStrictEqual(MAIN_NAV.map((item) => item.label));
  });

  it('shows no admin item, because nothing knows the user yet', async () => {
    await renderApp();
    for (const item of ADMIN_NAV) {
      expect(screen.queryByRole('link', { name: item.label })).toBeNull();
    }
  });

  it('does not make an admin screen reachable by typing its URL', async () => {
    await renderApp('/admin/users');
    expect(screen.getByText('That screen does not exist')).toBeInTheDocument();
  });

  it('routes to every rail item', async () => {
    const user = userEvent.setup();
    await renderApp();
    const rail = screen.getByRole('navigation', { name: 'Main' });

    for (const item of MAIN_NAV) {
      await user.click(within(rail).getByRole('link', { name: item.label }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.label);
      });
    }
  });

  it('collapses, and remembers it across a restart', async () => {
    const user = userEvent.setup();
    const first = await renderApp();

    const collapse = screen.getByRole('button', { name: 'Collapse the navigation' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await user.click(collapse);

    expect(screen.getByRole('button', { name: 'Expand the navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe('true');
    // Collapsed, the labels move into the accessible name and stay reachable.
    expect(screen.getByRole('link', { name: 'Discover' })).toBeInTheDocument();

    first.unmount();
    await renderApp();
    expect(screen.getByRole('button', { name: 'Expand the navigation' })).toBeInTheDocument();
  });

  it('starts expanded when localStorage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data is blocked');
    });
    await renderApp();
    expect(screen.getByRole('button', { name: 'Collapse the navigation' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe('the keyboard (§16.3)', () => {
  it('puts the skip link, the rail and the top bar in a sensible tab order', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Collapse the navigation' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus();
  });

  it('reaches the search box, the bell and the user menu from the rail', async () => {
    const user = userEvent.setup();
    await renderApp();

    const topBar = within(screen.getByRole('banner'));
    topBar.getByRole('button', { name: /Search or ask/ }).focus();
    await user.tab();
    expect(topBar.getByRole('link', { name: 'Notifications' })).toHaveFocus();
    await user.tab();
    expect(topBar.getByRole('button', { name: /Preferences/ })).toHaveFocus();
  });

  it('marks the search box with its shortcut', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: /Search or ask/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+K',
    );
  });
});

describe('the user menu', () => {
  it('offers the theme choice and "Exit completely", and nothing that needs a session', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /Preferences/ }));
    const menu = screen.getByRole('menu', { name: 'Preferences' });
    expect(within(menu).getByRole('menuitemradio', { name: /Follow Windows/ })).toBeChecked();
    expect(within(menu).getByRole('menuitem', { name: /Exit completely/ })).toBeInTheDocument();
    // WP-07a brings these.
    expect(within(menu).queryByText(/Sign out/)).toBeNull();
    expect(within(menu).queryByText(/Lock/)).toBeNull();

    await user.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('asks the shell to exit completely', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /Preferences/ }));
    await user.click(screen.getByRole('menuitem', { name: /Exit completely/ }));
    expect(invoke).toHaveBeenCalledWith('exit_completely');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /Preferences/ }));
    expect(screen.getByRole('menu', { name: 'Preferences' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Preferences' })).toBeNull();
  });
});

describe('accessibility (the §19 acceptance criterion)', () => {
  it.each(MAIN_NAV.map((item) => [item.label, item.path] as const))(
    'has no axe violations on %s',
    async (_label, path) => {
      const { container } = await renderApp(path);
      await expect(container).toBeAccessible();
    },
  );

  it('has no axe violations with the rail collapsed', async () => {
    const user = userEvent.setup();
    const { container } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Collapse the navigation' }));
    await expect(container).toBeAccessible();
  });

  it('has no axe violations with the user menu open', async () => {
    const user = userEvent.setup();
    const { container } = await renderApp();
    await user.click(screen.getByRole('button', { name: /Preferences/ }));
    await expect(container).toBeAccessible();
  });
});
