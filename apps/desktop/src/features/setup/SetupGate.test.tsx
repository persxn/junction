import type { BackendConnection } from '@compintel/contracts';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from '../../api/auth-token.js';
import { resetApiTransport } from '../../api/client.js';
import { SetupGate } from '../../app/App.js';
import { renderWithProviders } from '../../testing/render.js';

/**
 * Ruling R39 as the app applies it: on a fresh installation the wizard is the
 * whole window, and there is no login screen to reach past it.
 */

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

function backend(status: { required: boolean } | 'FAILS'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/setup/status') {
        if (status === 'FAILS') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                required: status.required,
                hasAdmin: !status.required,
                hasOrganization: !status.required,
                hasBackupKey: !status.required,
              }),
            ),
        } as unknown as Response);
      }
      // Anything else: a stream that never delivers, so nothing reconnects.
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        body: { getReader: () => ({ read: () => new Promise<never>(() => undefined) }) },
      } as unknown as Response);
    }),
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  setAuthToken(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(undefined);
});

describe('the setup gate (ruling R39)', () => {
  it('shows the wizard, and no login screen, while setup is required', async () => {
    backend({ required: true });
    renderWithProviders(<SetupGate connection={CONNECTION} dataDir="C:\\Junction" />);

    expect(await screen.findByRole('heading', { name: 'Welcome to Junction' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in to Junction' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('goes straight to the login screen once an administrator exists', async () => {
    backend({ required: false });
    renderWithProviders(<SetupGate connection={CONNECTION} dataDir="C:\\Junction" />);

    expect(await screen.findByRole('heading', { name: 'Sign in to Junction' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome to Junction' })).toBeNull();
  });

  it('offers a retry rather than a wrong screen when the status call fails', async () => {
    backend('FAILS');
    renderWithProviders(<SetupGate connection={CONNECTION} dataDir="C:\\Junction" />);

    expect(
      await screen.findByRole('heading', { name: /could not read its own setup state/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // Neither of the two screens that would be a lie.
    expect(screen.queryByRole('heading', { name: 'Welcome to Junction' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sign in to Junction' })).toBeNull();
  });
});
