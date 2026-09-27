import type { BackendConnection } from '@compintel/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from '../api/auth-token.js';
import { resetApiTransport } from '../api/client.js';
import { SessionGate } from '../app/App.js';
import { TEST_USER } from '../testing/auth.js';
import { CORRECT_PASSWORD, installFakeApi } from '../testing/fake-api.js';
import { renderWithProviders } from '../testing/render.js';

/**
 * The three credential screens, checked with axe (ruling R89's `pnpm test:a11y`).
 *
 * Each pass is over the whole document, and each one had to be *reached* — signed
 * in, made to change a password, left alone until the lock came down — which is
 * why they are integration passes rather than component ones. Since pre-M2a
 * `CredentialScreen` renders a `main`, so nothing has to be scoped away.
 */

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

const AUTO_LOCK_MINUTES = 15;

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
  vi.useRealTimers();
});

describe('the credential screens', () => {
  it('has no axe violations on the login screen', async () => {
    installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await screen.findByRole('heading', { name: 'Sign in to CompIntel' });
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on the change-password screen', async () => {
    const user = userEvent.setup();
    installFakeApi({ mustChangePassword: true });
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await signIn(user);
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on the lock screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (delay) => {
        vi.advanceTimersByTime(delay);
      },
    });
    installFakeApi({ autoLockMinutes: AUTO_LOCK_MINUTES });
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    await signIn(user);
    await screen.findByRole('navigation', { name: 'Main' });

    await vi.advanceTimersByTimeAsync(AUTO_LOCK_MINUTES * 60_000);
    await screen.findByRole('heading', { name: 'CompIntel is locked' });
    await expect(document.body).toBeAccessible();
  });
});
