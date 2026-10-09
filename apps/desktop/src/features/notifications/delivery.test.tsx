import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import {
  installNotificationsApi,
  makeNotification,
  type NotificationsApi,
} from '../../testing/notifications-api.js';
import { renderApp, renderInRouter } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { NotificationBell } from './NotificationBell.js';
import { DEGRADED_POLL_MS, LiveDegradedContext } from './use-notifications.js';

const invoke = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve(undefined)));
const navigateHandler = vi.hoisted(() => ({
  current: undefined as ((e: { payload: string }) => void) | undefined,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, handler: (e: { payload: string }) => void) => {
    if (name === 'app://navigate') navigateHandler.current = handler;
    return Promise.resolve(() => undefined);
  }),
}));
vi.setConfig({ testTimeout: 20_000 });

/**
 * What leaves the window (R90, R24, WP-23): the tray badge follows the count;
 * a new notification that asks for a toast is handed to the shell once — old
 * ones never pop at sign-in; a clicked toast opens only an internal route; and
 * with live updates down the badge re-checks every minute (R30).
 */

let api: NotificationsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  invoke.mockClear();
  installStudentsApi();
  installCompetitionsApi();
  api = installNotificationsApi([
    makeNotification({ title: 'Already here', severity: 'CRITICAL', toast: true }),
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command);

describe('tray and toasts', () => {
  it('sets the badge, toasts only what is new and asks for it, and opens internal routes only', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    await waitFor(() => {
      expect(calls('tray_set_unread').at(-1)?.[1]).toEqual({ count: 1 });
    });
    expect(calls('notify_critical')).toEqual([]);

    api.add(
      makeNotification({
        title: 'Book the lab is due today',
        severity: 'CRITICAL',
        toast: true,
        route: '/deadlines',
      }),
    );
    api.add(makeNotification({ title: 'Quiet one', severity: 'INFO', toast: false }));
    // Any action re-reads the notifications, as the stream would.
    await user.click(await screen.findByRole('button', { name: 'Mark read: Already here' }));
    await waitFor(() => {
      expect(calls('notify_critical')).toHaveLength(1);
    });
    expect(calls('notify_critical')[0]?.[1]).toMatchObject({
      toast: { title: 'Book the lab is due today', route: '/deadlines' },
    });
    await waitFor(() => {
      expect(calls('tray_set_unread').at(-1)?.[1]).toEqual({ count: 2 });
    });

    navigateHandler.current?.({ payload: 'https://evil.example/' });
    expect(screen.getByRole('heading', { name: 'Notifications', level: 1 })).toBeInTheDocument();
    navigateHandler.current?.({ payload: '/deadlines' });
    expect(await screen.findByRole('heading', { name: 'Deadline Radar' })).toBeInTheDocument();
  });
});

describe('live updates down (R30)', () => {
  it('the badge re-checks every minute and says live updates are unavailable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderInRouter(
      <LiveDegradedContext.Provider value={true}>
        <NotificationBell defaultOpen />
      </LiveDegradedContext.Provider>,
    );
    expect(await screen.findByText(/Live updates unavailable/)).toBeInTheDocument();
    const counts = () => api.calls.filter((c) => c.path.endsWith('/unread-count')).length;
    await waitFor(() => {
      expect(counts()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(DEGRADED_POLL_MS + 100);
    await waitFor(() => {
      expect(counts()).toBe(2);
    });
  });
});
