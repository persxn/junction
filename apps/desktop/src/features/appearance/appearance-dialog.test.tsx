import { DEFAULT_APPEARANCE } from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installInsightsApi } from '../../testing/insights-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

/** The Appearance dialog (WP-33, R67–R68): saved to the account, applied at once. */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Appearance…' }));
  return screen.getByRole('dialog', { name: 'Appearance' });
}

describe('the Appearance dialog', () => {
  it('saves a choice to the account and applies it to the window', async () => {
    const api = installInsightsApi();
    await renderApp('/', { appearance: DEFAULT_APPEARANCE });
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole('radio', { name: /^Showcase/ }));
    await waitFor(() => {
      expect(document.documentElement.dataset.effects).toBe('showcase');
    });
    expect(api.saved).toContainEqual({ effects: 'SHOWCASE' });

    await userEvent.selectOptions(within(dialog).getByLabelText('Dark flavour'), 'frappe');
    expect(api.saved).toContainEqual({ flavourDark: 'frappe' });
  });

  it('offers RGB presets only at Showcase', async () => {
    installInsightsApi();
    await renderApp('/', { appearance: DEFAULT_APPEARANCE });
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText('RGB preset')).toHaveProperty('disabled', true);
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Showcase/ }));
    await waitFor(() => {
      expect(within(dialog).getByLabelText('RGB preset')).toHaveProperty('disabled', false);
    });
  });

  it('labels each select by its own name only', async () => {
    installInsightsApi();
    await renderApp('/', { appearance: DEFAULT_APPEARANCE });
    const dialog = await openDialog();
    for (const name of ['Light flavour', 'Dark flavour', 'RGB preset', 'Speed']) {
      expect(within(dialog).getByRole('combobox', { name })).toBeDefined();
    }
  });
});
