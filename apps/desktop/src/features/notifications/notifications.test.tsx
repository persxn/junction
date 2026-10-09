import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import {
  installNotificationsApi,
  makeNotification,
  type NotificationsApi,
} from '../../testing/notifications-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The bell, the Inbox and the preferences (WP-23, R111, jsdom): the count is
 * named, opening marks read and goes where it points, dismiss has Undo, the
 * four snooze choices work from the keyboard, and preferences save.
 */

let api: NotificationsApi;

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  installCompetitionsApi();
  api = installNotificationsApi([
    makeNotification({
      title: 'Book the lab is due today',
      severity: 'CRITICAL',
      route: '/notifications',
    }),
    makeNotification({ title: 'Registration is due in 3 days' }),
    makeNotification({ title: 'An old one', readAt: '2026-10-08T00:00:00.000Z' }),
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bell', () => {
  it('names the count, shows the latest, and opening one marks it read and goes there', async () => {
    const user = userEvent.setup();
    await renderApp('/deadlines');
    const bell = await screen.findByRole('button', { name: '2 unread notifications' });
    expect(within(bell).getByText('2')).toBeInTheDocument();
    await user.click(bell);
    const popover = screen.getByRole('dialog', { name: 'Latest notifications' });
    expect(within(popover).getAllByTestId('notification')).toHaveLength(3);
    await user.click(within(popover).getByRole('button', { name: /Book the lab is due today/ }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'POST' && c.path.endsWith('/read'))).toBe(true);
    });
    expect(
      await screen.findByRole('button', { name: '1 unread notification' }),
    ).toBeInTheDocument();
    // It pointed at the Inbox, from the Radar: opening it went there.
    expect(
      await screen.findByRole('heading', { name: 'Notifications', level: 1 }),
    ).toBeInTheDocument();
  });
});

describe('the Inbox', () => {
  it('shows unread first, with severity in words; Mark read and Mark all read move the count', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    expect(
      await screen.findByRole('heading', { name: 'Notifications', level: 1 }),
    ).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Notifications' });
    expect(within(list).getAllByTestId('notification')).toHaveLength(2);
    expect(within(list).getByText('Urgent')).toBeInTheDocument();
    expect(within(list).getAllByText(/Due 12 Oct \(time not stated\)/).length).toBeGreaterThan(0);
    await user.click(
      screen.getByRole('button', { name: 'Mark read: Registration is due in 3 days' }),
    );
    expect(await screen.findByText('1 unread notification')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findAllByTestId('notification')).toHaveLength(3);
  });

  it('dismiss offers Undo, which brings it back', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    await user.click(
      await screen.findByRole('button', { name: 'Dismiss: Registration is due in 3 days' }),
    );
    expect(await screen.findByText('Notification dismissed')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Dismiss: Registration/ })).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await screen.findByRole('button', { name: /Dismiss: Registration/ }),
    ).toBeInTheDocument();
  });

  it('snooze: the choices and a typed time, all by keyboard', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    const snooze = await screen.findByRole('button', {
      name: 'Snooze: Registration is due in 3 days',
    });
    snooze.focus();
    await user.keyboard('{Enter}');
    const group = screen.getByRole('group', { name: 'Snooze until' });
    expect(within(group).getByRole('button', { name: 'For 1 hour' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Until tomorrow, 9:00' })).toBeInTheDocument();
    await user.type(
      within(group).getByLabelText('Or choose a time (Indian time)'),
      '2099-01-02T10:30',
    );
    await user.click(within(group).getByRole('button', { name: 'Snooze' }));
    await waitFor(() => {
      const call = api.calls.find((c) => c.path.endsWith('/snooze'));
      expect(call?.body).toEqual({ until: '2099-01-02T05:00:00.000Z' });
    });
    expect(await screen.findByText(/comes back within five minutes/)).toBeInTheDocument();
  });

  it('empty and error states say what to do', async () => {
    api.rows.length = 0;
    const user = userEvent.setup();
    await renderApp('/notifications');
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
    api.failList = true;
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByText('The notifications could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('preferences: turn a type off, change its days and toasts, save', async () => {
    const user = userEvent.setup();
    await renderApp('/notifications');
    await user.click(await screen.findByRole('button', { name: 'Notification settings' }));
    const form = await screen.findByRole('form', { name: 'Notification settings' });
    await user.click(within(form).getByRole('checkbox', { name: 'Stage due dates' }));
    const tasks = within(form).getByRole('group', { name: 'Task due dates: remind me' });
    await user.click(within(tasks).getByRole('checkbox', { name: '14 days' }));
    await user.click(within(form).getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Notification settings saved')).toBeInTheDocument();
    const put = api.calls.find((c) => c.method === 'PUT')!.body as {
      preferences: { type: string; isEnabled: boolean; thresholds: { days: number[] } | null }[];
    };
    expect(put.preferences.find((p) => p.type === 'STAGE_DUE')?.isEnabled).toBe(false);
    expect(put.preferences.find((p) => p.type === 'TASK_DUE')?.thresholds?.days).toEqual([
      14, 7, 3, 1,
    ]);
  });
});
