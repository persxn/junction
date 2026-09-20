import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../testing/render.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

function palette(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Command palette' });
}

describe('the Ctrl+K palette (§16.3)', () => {
  it('opens on Ctrl+K and closes on Escape', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(palette()).toBeNull();

    await user.keyboard('{Control>}k{/Control}');
    expect(palette()).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(palette()).toBeNull();
    });
  });

  it('also opens from the search box', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('button', { name: /Search or ask/ }));
    expect(palette()).toBeInTheDocument();
  });

  it('focuses the search box on "/" without opening anything', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('/');
    expect(screen.getByRole('button', { name: /Search or ask/ })).toHaveFocus();
    expect(palette()).toBeNull();
  });

  it('puts the caret in its own input, so typing filters', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');

    const input = screen.getByPlaceholderText('Type a command…');
    await waitFor(() => {
      expect(input).toHaveFocus();
    });

    await user.keyboard('discov');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Discover');
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('zzzzz');

    expect(screen.getByText('No matching command.')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('moves with the arrow keys and runs the selection with Enter', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    // The second entry is "Discover".
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Discover');
    });
    // Running a command closes the palette.
    expect(palette()).toBeNull();
  });

  it('changes the theme from the palette', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByRole('option', { name: 'Theme: dark' }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
    expect(palette()).toBeNull();
  });

  it.each([
    ['Open logs folder', 'open_logs_folder'],
    ['Hide to tray', 'hide_to_tray'],
    ['Exit completely', 'exit_completely'],
  ])('dispatches %s to the shell exactly once', async (label, command) => {
    const user = userEvent.setup();
    await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByRole('option', { name: label }));

    await waitFor(() => {
      expect(invoke.mock.calls.filter((call) => call[0] === command)).toHaveLength(1);
    });
  });

  it('has no axe violations while it is open', async () => {
    const user = userEvent.setup();
    const { baseElement } = await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await expect(baseElement).toBeAccessible();
  });
});
