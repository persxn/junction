import type { RoleKey } from '@compintel/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { SessionGate } from '../../app/App.js';
import { mockAuth, MockAuthProvider } from '../../testing/auth.js';
import { renderWithProviders, TEST_CONNECTION } from '../../testing/render.js';
import { ConnectSourcesGate } from './ConnectSourcesGate.js';

/**
 * The one-time "Connect your sources" step (R74's product flow, pre-M2a item 5).
 *
 * Three properties, and the third is the important one: a step that could stand
 * between somebody and signing in would be a step that can lock them out of
 * their own installation.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const DEVFOLIO = {
  id: '0192f0c1-0000-7000-8000-000000000001',
  key: 'devfolio',
  name: 'Devfolio',
  adapter: 'DEVFOLIO',
  isEnabled: true,
  complianceStatus: 'APPROVED_WITH_LIMITS',
  complianceNotes: '',
  cadenceMinutes: 15,
  manualMinIntervalMinutes: 5,
  minDelayMs: 3000,
  maxRequestsPerRun: 11,
  allowedPaths: [],
  trustRank: 60,
  attributionText: null,
  complianceReviewDueAt: null,
  version: 1,
};

const SESSION = {
  supported: true,
  isSet: false,
  state: 'NONE',
  capturedAt: null,
  lastVerifiedAt: null,
  loginUrl: 'https://devfolio.co/login',
  hosts: ['devfolio.co'],
};

interface Recorded {
  readonly method: string;
  readonly path: string;
}

/** The backend, as far as this screen can tell: one signed-in source, step owed. */
function backend(options: { pending?: boolean } = {}): Recorded[] {
  const calls: Recorded[] = [];
  let pending = options.pending ?? true;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const json = (value: unknown): Promise<Response> =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(value)),
        } as unknown as Response);

      if (path === '/api/v1/sources/connect-prompt') {
        return json({ pending, keys: ['devfolio'] });
      }
      if (path === '/api/v1/admin/sources/connect-prompt/seen') {
        pending = false;
        return json({ pending: false, keys: ['devfolio'] });
      }
      if (path === '/api/v1/sources') {
        return json({ sources: [DEVFOLIO] });
      }
      if (path.endsWith('/session')) {
        return json(SESSION);
      }
      // The stream, which never delivers, plus anything else this screen's
      // neighbours might ask for.
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
        body: { getReader: () => ({ read: () => new Promise<never>(() => undefined) }) },
      } as unknown as Response);
    }),
  );
  return calls;
}

function render(roles: readonly RoleKey[], children = <p>The application</p>): void {
  const auth = mockAuth({ roles });
  renderWithProviders(
    <MockAuthProvider value={auth}>
      <ConnectSourcesGate>{children}</ConnectSourcesGate>
    </MockAuthProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the connect-sources step', () => {
  it('is offered once to an administrator, with the read-only promise in words', async () => {
    backend();
    render(['ADMINISTRATOR']);

    expect(
      await screen.findByRole('heading', { name: 'Connect your sources' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(screen.getByText(/stay anonymous/)).toBeInTheDocument();
    // Reuses the one sign-in flow there is (item 3), not a second one.
    expect(await screen.findByRole('button', { name: 'Sign in to Devfolio' })).toBeInTheDocument();
    expect(screen.queryByText('The application')).toBeNull();
  });

  it('is hidden for good once it is skipped', async () => {
    const calls = backend();
    render(['ADMINISTRATOR']);

    await screen.findByRole('heading', { name: 'Connect your sources' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(await screen.findByText('The application')).toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' && call.path === '/api/v1/admin/sources/connect-prompt/seen',
      ),
    ).toBe(true);
  });

  it('is not shown at all once the installation has been through it', async () => {
    backend({ pending: false });
    render(['ADMINISTRATOR']);

    expect(await screen.findByText('The application')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect your sources' })).toBeNull();
  });

  it('is never shown to an account that may not manage sources, and asks nothing', async () => {
    const calls = backend();
    render(['PROFESSOR']);

    expect(await screen.findByText('The application')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect your sources' })).toBeNull();
    expect(calls).toStrictEqual([]);
  });

  /**
   * The step lives above the router and below the session, so a signed-out
   * window shows the login screen and never asks about sources.
   */
  it('never stands between anybody and the login screen', async () => {
    const calls = backend();
    const auth = mockAuth({ roles: ['ADMINISTRATOR'], status: 'SIGNED_OUT' });
    renderWithProviders(
      <MockAuthProvider value={auth}>
        <SessionGate connection={TEST_CONNECTION} />
      </MockAuthProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Sign in to CompIntel' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect your sources' })).toBeNull();
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/v1/sources/connect-prompt')).toBe(false);
    });
  });
});
