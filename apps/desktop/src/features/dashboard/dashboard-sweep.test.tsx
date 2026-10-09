import {
  DEADLINE_GROUPS,
  DEADLINE_SCOPES,
  DUE_ITEM_KINDS,
  KPI_KEYS,
  URGENCY_BUCKETS,
  type KpiTile,
} from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi, makeDueItem } from '../../testing/deadlines-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { installStudentsApi } from '../../testing/students-api.js';

/**
 * WP-22's UI fault sweep: the rendered-text scan over buckets, kinds, scopes,
 * groups and KPI keys (and no ISO string) on the Dashboard and the Radar;
 * Save from the Recommended panel with the shell proxy as the only transport
 * (R78/F9); and a keyboard walk — Tab reaches the tiles, Enter opens one.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const TILE: KpiTile = {
  key: 'OVERDUE_TASKS',
  label: 'Overdue tasks',
  value: 1,
  totalIsApproximate: false,
  link: { to: '/deadlines', search: { scope: 'MINE', itemKind: 'TASK', bucket: 'OVERDUE' } },
};
const ITEMS = [
  makeDueItem('OVERDUE', { precision: 'DATE' }),
  makeDueItem('TODAY'),
  makeDueItem('DAYS_3', { itemKind: 'STAGE', sourceLabel: 'Workflow stage' }),
  makeDueItem('DAYS_7', {
    itemKind: 'EVENT_DEADLINE',
    deadlineKind: 'PPT',
    engagementId: null,
    competitionName: null,
    teamId: null,
    teamName: null,
    precision: 'MONTH',
    sourceLabel: 'Stated by Devfolio',
  }),
  makeDueItem('LATER'),
];

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  installStudentsApi();
  installFakeSearch([makeItem(1), makeItem(2)]);
  installCompetitionsApi();
  installDeadlinesApi({ items: ITEMS, tiles: [TILE] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW = [
  ...URGENCY_BUCKETS,
  ...DUE_ITEM_KINDS,
  ...DEADLINE_SCOPES,
  ...DEADLINE_GROUPS,
  ...KPI_KEYS,
];
function expectHumanText(): void {
  const text = document.getElementById('main')?.textContent ?? document.body.textContent ?? '';
  for (const word of RAW)
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  expect(text).not.toMatch(/\b00:00\b/);
}

describe('no enum value, ISO string or 00:00 on screen', () => {
  it('on the Dashboard', async () => {
    await renderApp('/');
    await screen.findByRole('list', { name: 'Next deadlines' });
    await screen.findByRole('list', { name: 'Recommended' });
    expectHumanText();
  });

  it('on the Radar with every bucket, kind and precision', async () => {
    await renderApp('/deadlines');
    await screen.findByRole('heading', { name: /^Later/ });
    expect(screen.getByText(/^· 9 Oct \(time not stated\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(date not stated\)$/)).toBeInTheDocument();
    expectHumanText();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('saves an event from the Recommended panel', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp('/');
    const panel = await screen.findByRole('list', { name: 'Recommended' });
    const card = within(panel).getAllByRole('article')[0]!;
    await user.click(within(card).getByRole('button', { name: /^Save/ }));
    await waitFor(() => {
      const proxied = invoke.mock.calls
        .filter((call) => call[0] === 'backend_request')
        .map((call) => (call[1] as { request: { method: string; path: string } }).request);
      expect(
        proxied.some((request) => request.method === 'PUT' && request.path.endsWith('/watchlist')),
      ).toBe(true);
    });
  });
});

describe('a keyboard-only walk', () => {
  it('Tab reaches the tiles with visible focus; Enter opens the list', async () => {
    const user = userEvent.setup();
    await renderApp('/');
    const strip = await screen.findByRole('list', { name: 'Key numbers' });
    const tile = within(strip).getByRole('link', { name: /Overdue tasks/ });
    for (let step = 0; step < 60 && document.activeElement !== tile; step += 1) await user.tab();
    expect(tile).toHaveFocus();
    expect(tile.className).toContain('focus-visible:outline');
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Deadline Radar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove filter: Overdue only' })).toBeInTheDocument();
  });
});
