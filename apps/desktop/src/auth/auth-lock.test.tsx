import type { BackendConnection } from '@compintel/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from '../api/auth-token.js';
import { resetApiTransport } from '../api/client.js';
import { SessionGate } from '../app/App.js';
import { TEST_USER } from '../testing/auth.js';
import { CORRECT_PASSWORD, installFakeApi, SESSION_TOKEN } from '../testing/fake-api.js';
import { renderWithProviders } from '../testing/render.js';

/**
 * Auto-lock and unlocking (§10.5, ruling R37).
 *
 * The clock is faked because the wait under test is fifteen minutes long. What
 * is not faked is the session: R37 says unlocking extends the *same* session, so
 * the assertion that matters is that the bearer token never changes across a
 * lock and an unlock — the UI must not be quietly signing in again.
 */

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

const AUTO_LOCK_MINUTES = 15;

function setup(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({
    advanceTimers: (delay) => {
      vi.advanceTimersByTime(delay);
    },
  });
}

async function signIn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Email'), TEST_USER.email);
  await user.type(screen.getByLabelText('Password'), CORRECT_PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('navigation', { name: 'Main' });
}

beforeEach(() => {
  // `shouldAdvanceTime` keeps the fake clock moving with the real one, which is
  // what Testing Library's `waitFor` and `findBy*` poll on: without it they wait
  // on a clock only the test can move, and every one of them hangs.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  resetApiTransport();
  setAuthToken(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAuthToken(undefined);
});

describe('auto-lock (§10.5)', () => {
  it('stays put while the session is being used', async () => {
    const user = setup();
    installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);

    await vi.advanceTimersByTimeAsync((AUTO_LOCK_MINUTES - 1) * 60_000);
    expect(screen.queryByRole('heading', { name: 'CompIntel is locked' })).toBeNull();

    // A keystroke is the user still being there; the countdown starts again.
    await user.keyboard('a');
    await vi.advanceTimersByTimeAsync((AUTO_LOCK_MINUTES - 1) * 60_000);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('locks the window after the configured idle time', async () => {
    const user = setup();
    installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);

    await vi.advanceTimersByTimeAsync(AUTO_LOCK_MINUTES * 60_000);

    expect(await screen.findByRole('heading', { name: 'CompIntel is locked' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TEST_USER.email))).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('locks at once from the user menu, without waiting for the clock', async () => {
    const user = setup();
    installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);

    await user.click(screen.getByRole('button', { name: TEST_USER.displayName }));
    await user.click(screen.getByRole('menuitem', { name: /Lock/ }));

    expect(await screen.findByRole('heading', { name: 'CompIntel is locked' })).toBeInTheDocument();
  });
});

describe('unlocking (ruling R37)', () => {
  it('puts the shell back on the same session, without a second login', async () => {
    const user = setup();
    const api = installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);

    await vi.advanceTimersByTimeAsync(AUTO_LOCK_MINUTES * 60_000);
    await screen.findByRole('heading', { name: 'CompIntel is locked' });

    await user.type(screen.getByLabelText('Password'), CORRECT_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();

    const unlock = api.calls.filter((call) => call.path === '/api/v1/auth/unlock');
    expect(unlock).toHaveLength(1);
    // The same token before the lock and after it — the session was extended,
    // not replaced, which is the whole point of R37.
    expect(unlock[0]?.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(new Set(api.authorizedTokens())).toStrictEqual(new Set([`Bearer ${SESSION_TOKEN}`]));
    expect(api.calls.filter((call) => call.path === '/api/v1/auth/login')).toHaveLength(1);
  });

  it('refuses a wrong password and stays locked', async () => {
    const user = setup();
    installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);

    await vi.advanceTimersByTimeAsync(AUTO_LOCK_MINUTES * 60_000);
    await screen.findByRole('heading', { name: 'CompIntel is locked' });

    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That password does not match');
    expect(screen.getByRole('heading', { name: 'CompIntel is locked' })).toBeInTheDocument();
  });

  it('offers a way out for somebody else at the keyboard', async () => {
    const user = setup();
    installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);

    await vi.advanceTimersByTimeAsync(AUTO_LOCK_MINUTES * 60_000);
    await screen.findByRole('heading', { name: 'CompIntel is locked' });

    await user.click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to CompIntel' }),
    ).toBeInTheDocument();
  });
});

// The axe pass over the lock screen lives in `auth.a11y.test.tsx` (ruling R89).
