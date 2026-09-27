import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { renderWithProviders } from '../../../testing/render.js';
import { installUsersApi, ONE_TIME } from '../../../testing/users-api.js';
import { UsersPage } from './UsersPage.js';

/**
 * Admin → Users. The thing worth testing beyond "the list renders" is the
 * one-time password: it arrives in one response, is shown once, and must not
 * end up anywhere a later reader could find it.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

/** The fixtures and the stubbed API live in `testing/users-api.ts` (ruling R89). */
const backend = installUsersApi;

const user = (): ReturnType<typeof userEvent.setup> => userEvent.setup({ delay: null });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  resetApiTransport();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the list', () => {
  it('shows everybody, their roles and what they still have to do', async () => {
    backend();
    renderWithProviders(<UsersPage />);

    expect(await screen.findByText('A. Administrator')).toBeInTheDocument();
    const row = screen.getByText('A. Professor').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Professor')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Must change password')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Never')).toBeInTheDocument();
  });

  it('suggests adding somebody when there is nobody', async () => {
    backend({ users: [] });
    renderWithProviders(<UsersPage />);
    expect(await screen.findByText('Nobody else yet')).toBeInTheDocument();
  });
});

describe('adding a person', () => {
  it('asks for no password, and shows the one the server made — once', async () => {
    backend();
    renderWithProviders(<UsersPage />);
    await screen.findByText('A. Administrator');

    await user().click(screen.getByRole('button', { name: /Add a person/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add a person' });
    // The admin never chooses anybody's password (ruling R38).
    expect(within(dialog).queryByLabelText(/password/i)).toBeNull();

    await user().type(within(dialog).getByLabelText('E-mail'), 'new@example.edu');
    await user().type(within(dialog).getByLabelText('Name'), 'New Person');
    await user().click(within(dialog).getByRole('button', { name: 'Add' }));

    const panel = await screen.findByRole('region', { name: 'One-time password' });
    expect(within(panel).getByText(ONE_TIME)).toBeInTheDocument();
    expect(within(panel).getByText(/not shown again/)).toBeInTheDocument();

    // It is in the response and on the screen, and nowhere a reload could find.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await user().click(screen.getByRole('button', { name: 'Dismiss the one-time password' }));
    expect(screen.queryByText(ONE_TIME)).toBeNull();
  });

  it('shows the server’s complaint about a duplicate address', async () => {
    backend({ failCreate: true });
    renderWithProviders(<UsersPage />);
    await screen.findByText('A. Administrator');

    await user().click(screen.getByRole('button', { name: /Add a person/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add a person' });
    await user().type(within(dialog).getByLabelText('E-mail'), 'taken@example.edu');
    await user().type(within(dialog).getByLabelText('Name'), 'Already Here');
    await user().click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });
});

describe('the row actions', () => {
  it('resets a password and shows the new one', async () => {
    backend();
    renderWithProviders(<UsersPage />);
    await screen.findByText('A. Professor');

    await user().click(
      screen.getByRole('button', { name: 'Reset the password for professor@example.edu' }),
    );
    const panel = await screen.findByRole('region', { name: 'One-time password' });
    expect(within(panel).getByText(ONE_TIME)).toBeInTheDocument();
  });

  it('disables an account', async () => {
    const calls = backend();
    renderWithProviders(<UsersPage />);
    await screen.findByText('A. Professor');

    await user().click(screen.getByRole('button', { name: 'Disable professor@example.edu' }));
    expect(calls.some((call) => call.path.endsWith('/disable') && call.method === 'POST')).toBe(
      true,
    );
  });

  it('sends the version it loaded, so a lost race is a 409 (§6.1)', async () => {
    const calls = backend();
    renderWithProviders(<UsersPage />);
    await screen.findByText('A. Professor');

    await user().click(screen.getByRole('button', { name: 'Edit professor@example.edu' }));
    const name = screen.getByLabelText('Name for professor@example.edu');
    await user().clear(name);
    await user().type(name, 'Renamed Professor');
    await user().click(
      screen.getByRole('button', { name: 'Save changes to professor@example.edu' }),
    );

    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toMatchObject({ displayName: 'Renamed Professor', version: 3 });
  });
});

// The axe passes over the list and the dialog live in `UsersPage.a11y.test.tsx` (R89).
