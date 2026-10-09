import { NOTIFICATION_TYPES, SEVERITIES } from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { createAppRouter } from '../../app/router.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi } from '../../testing/deadlines-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { installNotificationsApi, makeNotification } from '../../testing/notifications-api.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { installStudentsApi } from '../../testing/students-api.js';

/**
 * WP-23's UI fault sweep: the rendered-text scan (no type or severity enum, no
 * ISO string, no 00:00) on the bell, the Inbox, the preferences and the
 * Dashboard; snooze and dismiss with the shell proxy as the only transport
 * (R78/F9); a keyboard walk through the bell and a row; and every route a
 * notification can carry lands on a real screen, not "not found".
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ROWS = () => [
  makeNotification({ title: 'Book the lab is due today', severity: 'CRITICAL', type: 'TASK_DUE' }),
  makeNotification({
    title: 'Registration is due in 3 days',
    type: 'REG_DEADLINE',
    precision: 'DATE',
    dueAt: '2026-10-12T00:00:00.000Z',
  }),
  makeNotification({
    title: 'Synthetic Hack: a deadline moved earlier',
    type: 'EVENT_CHANGED',
    severity: 'WARNING',
    precision: 'MONTH',
    dueAt: '2026-11-01T00:00:00.000Z',
  }),
  makeNotification({
    title: 'Synthetic Source was blocked after repeated refusals',
    type: 'SOURCE_BLOCKED',
    severity: 'WARNING',
    dueAt: null,
    precision: null,
    route: '/admin/sources',
  }),
];

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  installStudentsApi();
  installFakeSearch([makeItem(1)]);
  installCompetitionsApi();
  installDeadlinesApi();
  installNotificationsApi(ROWS());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW = [...NOTIFICATION_TYPES, ...SEVERITIES];
function expectHumanText(): void {
  const text = document.body.textContent ?? '';
  for (const word of RAW)
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  expect(text).not.toMatch(/\b00:00\b/);
}

describe('no enum value, ISO string or 00:00 on screen', () => {
  it('in the Inbox, its preferences and the open bell', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    await screen.findByRole('list', { name: 'Notifications' });
    expect(screen.getAllByText(/Due 12 Oct \(time not stated\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Due Nov \(date not stated\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Notification settings' }));
    await screen.findByRole('form', { name: 'Notification settings' });
    await user.click(screen.getByTestId('notification-bell'));
    await screen.findByRole('dialog', { name: 'Latest notifications' });
    expectHumanText();
  });

  it('on the Dashboard', async () => {
    await renderApp('/');
    const panel = await screen.findByRole('region', { name: 'Recent notifications' });
    await within(panel).findAllByTestId('notification');
    expectHumanText();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('snoozes and dismisses', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp('/notifications');
    await user.click(
      await screen.findByRole('button', { name: 'Snooze: Book the lab is due today' }),
    );
    await user.click(screen.getByRole('button', { name: 'For 1 hour' }));
    await user.click(
      await screen.findByRole('button', { name: 'Dismiss: Registration is due in 3 days' }),
    );
    await waitFor(() => {
      const proxied = invoke.mock.calls
        .filter((call) => call[0] === 'backend_request')
        .map((call) => (call[1] as { request: { method: string; path: string } }).request);
      expect(proxied.some((r) => r.method === 'POST' && r.path.endsWith('/snooze'))).toBe(true);
      expect(proxied.some((r) => r.method === 'POST' && r.path.endsWith('/dismiss'))).toBe(true);
    });
  });
});

describe('a keyboard-only walk', () => {
  it('Tab reaches the bell; Enter opens it; Escape closes it and returns focus', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    const bell = await screen.findByRole('button', { name: '4 unread notifications' });
    for (let step = 0; step < 40 && document.activeElement !== bell; step += 1) await user.tab();
    expect(bell).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Latest notifications' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Latest notifications' })).toBeNull();
    expect(bell).toHaveFocus();
    const markRead = screen.getByRole('button', { name: 'Mark read: Book the lab is due today' });
    for (let step = 0; step < 60 && document.activeElement !== markRead; step += 1)
      await user.tab();
    expect(markRead).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('button', { name: '3 unread notifications' }),
    ).toBeInTheDocument();
  });
});

describe('every screen a notification opens', () => {
  it.each([
    [
      'a competition, its stages and tasks',
      '/competitions/0192f0c1-0000-7000-8000-00000000e001',
      '/competitions/$competitionId',
    ],
    [
      'an event (the drawer)',
      '/discover/event/0192f0c1-0000-7000-8000-00000000d001',
      '/discover/event/$eventId',
    ],
    ['Sources', '/admin/sources', '/admin/sources'],
    ['the Inbox', '/notifications', '/notifications'],
  ])('%s', async (_name, path, routeId) => {
    const router = createAppRouter(path, { can: () => true });
    await router.load();
    expect(router.state.matches.at(-1)?.routeId).toBe(routeId);
  });
});
