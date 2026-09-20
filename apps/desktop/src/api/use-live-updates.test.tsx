import type { BackendConnection } from '@compintel/contracts';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../testing/render.js';
import { useLiveUpdates } from './use-live-updates.js';
import type * as StreamModule from './stream.js';
import type { StreamHandlers, StreamSubscription, StreamUnavailableReason } from './stream.js';

/**
 * Ruling R30's half of live updates: what the app does when there is no stream.
 *
 * The SSE client itself is `stream.test.ts`; this is the hook above it, so
 * `openStream` is stubbed and the test drives `onUnavailable` directly — the
 * thing under test is the toast and the polling, not the socket.
 */

const openStream = vi.hoisted(() => vi.fn());
vi.mock('./stream.js', async (importOriginal) => ({
  ...(await importOriginal<typeof StreamModule>()),
  openStream,
}));

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

let handlers: StreamHandlers;
const close = vi.fn();

function Harness({ refresh }: { readonly refresh: () => Promise<void> }): React.JSX.Element {
  useLiveUpdates({ connection: CONNECTION, enabled: true, refresh, pollIntervalMs: 30_000 });
  return <p>signed in</p>;
}

function fail(reason: StreamUnavailableReason): void {
  handlers.onUnavailable?.(reason);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  close.mockReset();
  openStream.mockReset();
  openStream.mockImplementation((_options: unknown, given: StreamHandlers): StreamSubscription => {
    handlers = given;
    return { close, lastEventId: () => 0 };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('live updates (rulings R30 and R36)', () => {
  it('says nothing at all while the stream is up', async () => {
    renderWithProviders(<Harness refresh={() => Promise.resolve()} />);
    await screen.findByText('signed in');
    expect(screen.queryByText('Live updates unavailable')).toBeNull();
  });

  it('raises one persistent notice when the machine has no stream transport', async () => {
    renderWithProviders(<Harness refresh={() => Promise.resolve()} />);
    await screen.findByText('signed in');

    fail('NO_TRANSPORT');
    await screen.findByText('Live updates unavailable');
    expect(
      screen.getByText(/blocks the live connection, so CompIntel re-checks every 30 seconds/),
    ).toBeInTheDocument();

    // Six minutes of polling must not stack six toasts on top of each other.
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(screen.getAllByText('Live updates unavailable')).toHaveLength(1);
  });

  it('polls instead, at the R30 interval', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    renderWithProviders(<Harness refresh={refresh} />);
    await screen.findByText('signed in');

    fail('NO_TRANSPORT');
    await screen.findByText('Live updates unavailable');
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('takes the notice back down when the stream returns', async () => {
    renderWithProviders(<Harness refresh={() => Promise.resolve()} />);
    await screen.findByText('signed in');

    fail('DISCONNECTED');
    await screen.findByText('Live updates unavailable');

    handlers.onUnavailable?.(undefined);
    await waitFor(() => {
      expect(screen.queryByText('Live updates unavailable')).toBeNull();
    });
  });

  it('does not poll once the session is the thing that is gone', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    renderWithProviders(<Harness refresh={refresh} />);
    await screen.findByText('signed in');

    fail('UNAUTHENTICATED');
    await screen.findByText('Live updates unavailable');

    // The auth context is already tearing the session down; re-reading `/me` on
    // a timer would only produce a stream of 401s.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('closes the stream when the app stops needing it', async () => {
    const view = renderWithProviders(<Harness refresh={() => Promise.resolve()} />);
    await screen.findByText('signed in');
    view.unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
