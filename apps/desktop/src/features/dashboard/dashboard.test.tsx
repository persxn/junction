import type { KpiTile } from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi, makeDueItem } from '../../testing/deadlines-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { installNotificationsApi } from '../../testing/notifications-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The Dashboard (WP-22, R107, jsdom): each tile lands on its list with
 * exactly the tile's filter as chips; the scope toggle asks again; each panel
 * loads and fails on its own.
 */

const TILES: KpiTile[] = [
  {
    key: 'UPCOMING_EVENTS',
    label: 'Upcoming events',
    value: 1234,
    totalIsApproximate: true,
    link: {
      to: '/discover',
      search: { tab: 'all', view: 'recommended', filters: { eventDate: { from: '2026-10-09' } } },
    },
  },
  {
    key: 'CLOSING_SOON',
    label: 'Closing soon',
    value: 3,
    totalIsApproximate: false,
    link: {
      to: '/discover',
      search: {
        tab: 'all',
        view: 'recommended',
        filters: { registration: { states: ['CLOSING_SOON'] } },
      },
    },
  },
  {
    key: 'ACTIVE_COMPETITIONS',
    label: 'Active competitions',
    value: 2,
    totalIsApproximate: false,
    link: {
      to: '/competitions',
      search: { view: 'list', status: ['ASSIGNED', 'APPLIED', 'PARTICIPATING'], mine: true },
    },
  },
  {
    key: 'OVERDUE_TASKS',
    label: 'Overdue tasks',
    value: 1,
    totalIsApproximate: false,
    link: { to: '/deadlines', search: { scope: 'MINE', itemKind: 'TASK', bucket: 'OVERDUE' } },
  },
];

let deadlines: ReturnType<typeof installDeadlinesApi>;
function install(options: { failDeadlines?: boolean } = {}): void {
  localStorage.clear();
  resetApiTransport();
  // The students fake answers every unknown path, so the search fake goes on top of it.
  installStudentsApi();
  installFakeSearch([makeItem(1), makeItem(2)]);
  installCompetitionsApi();
  deadlines = installDeadlinesApi({
    items: [makeDueItem('OVERDUE', { label: 'Book the lab' }), makeDueItem('TODAY')],
    tiles: TILES,
    ...options,
  });
  installNotificationsApi();
}
beforeEach(() => {
  install();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openTile(key: string): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp('/');
  const strip = await screen.findByRole('list', { name: 'Key numbers' });
  await user.click(within(strip).getByTestId(`kpi-${key}`));
  return user;
}

describe('the KPI tiles', () => {
  it('format their number like the list header does', async () => {
    await renderApp('/');
    expect(await screen.findByTestId('kpi-UPCOMING_EVENTS')).toHaveTextContent('about 1,234');
    expect(screen.getByTestId('kpi-OVERDUE_TASKS')).toHaveTextContent('1');
  });

  it('Upcoming events opens All events with the Dates chip', async () => {
    await openTile('UPCOMING_EVENTS');
    expect(await screen.findByRole('button', { name: /^Dates filter: / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Registration filter: / })).toBeNull();
  });

  it('Closing soon opens All events with the Registration chip', async () => {
    await openTile('CLOSING_SOON');
    expect(
      await screen.findByRole('button', {
        name: /^Registration filter: Registration: Closing soon/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Dates filter: / })).toBeNull();
  });

  it('Active competitions opens the list on the active statuses and Mine', async () => {
    await openTile('ACTIVE_COMPETITIONS');
    await screen.findByRole('heading', { level: 1, name: 'Competitions' });
    expect(await screen.findByRole('button', { name: /I mentor/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const status of ['Assigned', 'Applied', 'Participating']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${status}`) })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    expect(screen.getByRole('button', { name: /^Completed/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('Overdue tasks opens the Radar with exactly those chips', async () => {
    await openTile('OVERDUE_TASKS');
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Overdue only' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove filter: Tasks only' })).toBeInTheDocument();
    expect(await screen.findByText('1 due')).toBeInTheDocument();
  });
});

describe('the scope toggle and the panels', () => {
  it('Everyone’s asks for the ALL scope', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    await screen.findByRole('list', { name: 'Key numbers' });
    await user.click(screen.getByRole('button', { name: 'Everyone’s' }));
    await waitFor(() => {
      expect(deadlines.calls.some((call) => call.query.get('scope') === 'ALL')).toBe(true);
    });
  });

  it('a failing Radar fails alone; the rest of the Dashboard stays', async () => {
    vi.unstubAllGlobals();
    install({ failDeadlines: true });
    await renderApp('/');
    expect(
      await screen.findByText(/The deadlines did not load/, {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Key numbers' })).toBeInTheDocument();
    const recommended = await screen.findByRole('region', { name: 'Recommended' });
    expect(
      await within(recommended).findByRole('list', { name: 'Recommended' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/You’re all caught up/)).toBeInTheDocument();
  });

  it('the Radar panel shows the next items and leads to all of them', async () => {
    await renderApp('/');
    const panel = await screen.findByRole('region', { name: 'Deadline Radar' });
    expect(await within(panel).findByText('Book the lab')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'View all' })).toBeInTheDocument();
  });
});
