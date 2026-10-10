import type { BackendConnection } from '@compintel/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from '../api/auth-token.js';
import { resetApiTransport } from '../api/client.js';
import { SessionGate } from '../app/App.js';
import { TEST_USER } from '../testing/auth.js';
import { CORRECT_PASSWORD, installFakeApi, SESSION_TOKEN } from '../testing/fake-api.js';
import { renderWithProviders } from '../testing/render.js';

/**
 * Signing in, being made to change a password, and signing out again — against
 * the real `<AuthProvider>` and a stand-in for the API (§4.12, §10.3, R38).
 *
 * The one assertion the architecture actually turns on is the last one in the
 * first describe: §4.12 says the session token lives in memory and nowhere else.
 */

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

/** Every key and value currently in the browser's two stores. */
function stored(): string[] {
  const out: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) {
        out.push(key, storage.getItem(key) ?? '');
      }
    }
  }
  return out;
}

async function signIn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Email'), TEST_USER.email);
  await user.type(screen.getByLabelText('Password'), CORRECT_PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetApiTransport();
  setAuthToken(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(undefined);
});

describe('signing in (§10.3)', () => {
  it('asks for a password before anything else exists', async () => {
    installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    expect(await screen.findByRole('heading', { name: 'Sign in to Junction' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('puts the shell up once the password is right', async () => {
    const user = userEvent.setup();
    const api = installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
    expect(screen.getByRole('button', { name: TEST_USER.displayName })).toBeInTheDocument();
    // WP-34: the sign-in screen first asks whether a guest is offered.
    expect(api.calls.map((call) => call.path)).toContain('/api/v1/auth/login');
  });

  it('shows what the server said about a wrong password, and stays put', async () => {
    const user = userEvent.setup();
    installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await user.type(screen.getByLabelText('Email'), TEST_USER.email);
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is wrong');
    expect(alert).toHaveTextContent('Five wrong attempts lock the account');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('keeps the token in memory only (§4.12, ADR-0017)', async () => {
    const user = userEvent.setup();
    installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);
    await screen.findByRole('navigation', { name: 'Main' });

    // The token is real — the stream call proves the client is sending it — and
    // it is still nowhere a second process, a reload or a page could read it.
    expect(stored()).toStrictEqual([]);
    expect(document.cookie).toBe('');
    expect(stored().join('\u0000')).not.toContain(SESSION_TOKEN);
  });

  it('sends the bearer token on every call after the login', async () => {
    const user = userEvent.setup();
    const api = installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);
    await screen.findByRole('navigation', { name: 'Main' });

    await waitFor(() => {
      expect(api.authorizedTokens().length).toBeGreaterThan(0);
    });
    expect(new Set(api.authorizedTokens())).toStrictEqual(new Set([`Bearer ${SESSION_TOKEN}`]));
    expect(
      api.calls.find((call) => call.path === '/api/v1/auth/login')?.authorization,
    ).toBeUndefined();
  });
});

describe('the forced first change (ruling R38)', () => {
  it('goes login → change password → shell, and never shows the shell in between', async () => {
    const user = userEvent.setup();
    installFakeApi({ mustChangePassword: true });
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);

    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();

    await user.type(screen.getByLabelText('Current password'), CORRECT_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'a-much-better-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('says so when the current password is wrong, and stays on the screen', async () => {
    const user = userEvent.setup();
    installFakeApi({ mustChangePassword: true });
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);
    await screen.findByRole('heading', { name: 'Choose a new password' });

    await user.type(screen.getByLabelText('Current password'), 'something-else-entirely');
    await user.type(screen.getByLabelText('New password'), 'a-much-better-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That password does not match');
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('ends the session and comes back to the login screen', async () => {
    const user = userEvent.setup();
    const api = installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);
    await screen.findByRole('navigation', { name: 'Main' });

    await user.click(screen.getByRole('button', { name: TEST_USER.displayName }));
    await user.click(screen.getByRole('menuitem', { name: /Sign out/ }));

    expect(await screen.findByRole('heading', { name: 'Sign in to Junction' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path === '/api/v1/auth/logout')).toBe(true);
    expect(stored()).toStrictEqual([]);
  });
});

describe('the admin rail (ruling R32)', () => {
  it.each([
    ['PROFESSOR', false],
    ['ADMINISTRATOR', true],
  ] as const)('shows the Administration section for %s: %s', async (role, visible) => {
    const user = userEvent.setup();
    installFakeApi({ roles: [role] });
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);
    await screen.findByRole('navigation', { name: 'Main' });

    const admin = screen.queryByRole('navigation', { name: 'Administration' });
    expect(admin === null).toBe(!visible);
  });
});

// The axe passes over these screens live in `auth.a11y.test.tsx` (ruling R89).
