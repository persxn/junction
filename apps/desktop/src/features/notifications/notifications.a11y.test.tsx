import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installNotificationsApi, makeNotification } from '../../testing/notifications-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

/** WP-23's screens with axe (R89): the Inbox with a snooze menu and preferences open, the bell, empty. */

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  installCompetitionsApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the Inbox, with a snooze menu and the preferences open', async () => {
    installNotificationsApi([
      makeNotification({ severity: 'CRITICAL', title: 'Book the lab is due today' }),
      makeNotification({ severity: 'WARNING' }),
      makeNotification({ readAt: '2026-10-08T00:00:00.000Z' }),
    ]);
    const user = userEvent.setup();
    await renderApp('/notifications');
    await user.click(
      await screen.findByRole('button', { name: 'Snooze: Book the lab is due today' }),
    );
    await user.click(screen.getByRole('button', { name: 'Notification settings' }));
    await screen.findByRole('form', { name: 'Notification settings' });
    await expect(document.body).toBeAccessible();
  });

  it('the open bell and an empty Inbox', async () => {
    installNotificationsApi([]);
    const user = userEvent.setup();
    await renderApp('/notifications');
    await screen.findByText('You’re all caught up');
    await user.click(screen.getByTestId('notification-bell'));
    await screen.findByRole('dialog', { name: 'Latest notifications' });
    await expect(document.body).toBeAccessible();
  });
});
