import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi, makeDueItem } from '../../testing/deadlines-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

/** WP-22's screens with axe (R89): the Dashboard with every panel, and the Radar. */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  installFakeSearch([makeItem(1), makeItem(2)]);
  installCompetitionsApi();
  installDeadlinesApi({
    items: [makeDueItem('OVERDUE'), makeDueItem('TODAY'), makeDueItem('LATER')],
    tiles: [
      {
        key: 'OVERDUE_TASKS',
        label: 'Overdue tasks',
        value: 1,
        totalIsApproximate: false,
        link: { to: '/deadlines', search: { scope: 'MINE', itemKind: 'TASK', bucket: 'OVERDUE' } },
      },
    ],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the Dashboard', async () => {
    await renderApp('/');
    await screen.findByRole('list', { name: 'Next deadlines' });
    await screen.findByRole('list', { name: 'Recommended' });
    await expect(document.body).toBeAccessible();
  });

  it('the Deadline Radar', async () => {
    await renderApp('/deadlines');
    await screen.findByRole('heading', { name: /^Overdue/ });
    await expect(document.body).toBeAccessible();
  });
});
