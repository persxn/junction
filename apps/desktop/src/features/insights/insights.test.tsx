import type { Appearance } from '@compintel/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installInsightsApi, makeInsights } from '../../testing/insights-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';
import {
  barSummary,
  fractionText,
  funnelRows,
  niceMax,
  outcomeRows,
  presetFrom,
} from './insights-model.js';
import { MILESTONES_SEEN_KEY } from './MilestoneCelebration.js';

/** The Insights screen (WP-33, R69). */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const tier = (effects: Appearance['effects']): Appearance => ({
  flavourLight: 'latte',
  flavourDark: 'mocha',
  effects,
  rgbPreset: { preset: effects === 'SHOWCASE' ? 'AURORA' : 'OFF', speed: 'MEDIUM' },
});

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the wording', () => {
  it('shows a rate with its counts, never a bare percentage', () => {
    expect(fractionText({ numerator: 1, denominator: 3 })).toBe('1 of 3 (33%)');
    expect(fractionText({ numerator: 0, denominator: 0 })).toBe('none yet');
  });

  it('words each funnel step against the one before', () => {
    const rows = funnelRows(makeInsights());
    expect(rows.map((row) => row.value)).toEqual([4, 4, 3, 2, 1]);
    expect(rows[2]?.detail).toBe('3 of 4 (75%) of assigned');
    expect(rows[0]?.detail).toBeUndefined();
  });

  it('lists only outcomes somebody has, best first', () => {
    expect(outcomeRows(makeInsights()).map((row) => row.key)).toEqual(['WINNER']);
  });

  it('summarises a chart in one sentence', () => {
    expect(barSummary('Outcomes', [])).toBe('Outcomes: nothing in this period.');
    expect(niceMax(7)).toBe(10);
    expect(niceMax(0)).toBe(1);
  });

  it('keeps every preset inside the backend’s five-year cap', () => {
    expect(presetFrom('12m', '2026-10-10')).toBeUndefined();
    expect(presetFrom('3m', '2026-10-10')).toBe('2026-08-01');
    expect(presetFrom('year', '2026-10-10')).toBe('2026-01-01');
    expect(presetFrom('all', '2026-10-10')).toBe('2021-11-01');
  });
});

describe('the Insights screen', () => {
  it('is in the rail and shows the headline numbers', async () => {
    installInsightsApi();
    await renderApp('/insights');
    expect(screen.getByRole('link', { name: 'Insights' })).toBeDefined();
    expect(await screen.findByTestId('insights-active-now')).toHaveProperty('textContent', '3');
    expect(screen.getByText('1 of 3 (33%)')).toBeDefined();
    expect(screen.getByText('4 met')).toBeDefined();
  });

  it('links the active count to the Competitions list with its filter', async () => {
    installInsightsApi();
    await renderApp('/insights');
    const link = (await screen.findByTestId('insights-active-now')).closest('a');
    expect(link?.getAttribute('href')).toContain('/competitions');
    expect(link?.getAttribute('href')).toContain('ASSIGNED');
  });

  it('offers every chart as a table', async () => {
    installInsightsApi();
    await renderApp('/insights');
    const figure = await screen.findByRole('figure', { name: 'Participation over time' });
    await userEvent.click(within(figure).getByText('Show as table'));
    const table = within(figure).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: /Oct 2026/ })).toBeDefined();
    expect(screen.getAllByText('Show as table').length).toBeGreaterThanOrEqual(9);
  });

  it('asks for the chosen period', async () => {
    const api = installInsightsApi();
    await renderApp('/insights');
    await screen.findByTestId('insights-active-now');
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'year');
    await screen.findByTestId('insights-active-now');
    expect(api.queries.at(-1)?.get('from')).toMatch(/^\d{4}-01-01$/);
  });

  it('shows an empty state on a fresh install, not a page of zeros', async () => {
    installInsightsApi({ insights: makeInsights({ isEmpty: true, activeNow: 0, milestones: [] }) });
    await renderApp('/insights');
    expect(await screen.findByRole('heading', { name: 'Nothing to show yet' })).toBeDefined();
    expect(screen.queryByTestId('insights-active-now')).toBeNull();
  });
});

describe('milestones', () => {
  it('celebrates once at STANDARD and never again', async () => {
    installInsightsApi({ appearance: tier('STANDARD') });
    const first = await renderApp('/insights', { appearance: tier('STANDARD') });
    expect(await screen.findByRole('complementary', { name: 'Milestone' })).toBeDefined();
    expect(localStorage.getItem(MILESTONES_SEEN_KEY)).toContain('FIRST_WINNER');
    first.unmount();
    await renderApp('/insights', { appearance: tier('STANDARD') });
    await screen.findByTestId('insights-active-now');
    expect(screen.queryByRole('complementary', { name: 'Milestone' })).toBeNull();
  });

  it('stays quiet at CALM', async () => {
    installInsightsApi({ appearance: tier('CALM') });
    await renderApp('/insights', { appearance: tier('CALM') });
    await screen.findByTestId('insights-active-now');
    expect(screen.queryByRole('complementary', { name: 'Milestone' })).toBeNull();
  });
});

describe('information parity across tiers (R68: never glow alone)', () => {
  it('reads the same at CALM and SHOWCASE', async () => {
    const read = async (effects: Appearance['effects']): Promise<string> => {
      localStorage.setItem(MILESTONES_SEEN_KEY, JSON.stringify(['FIRST_WINNER']));
      installInsightsApi({ appearance: tier(effects) });
      const view = await renderApp('/insights', { appearance: tier(effects) });
      await screen.findByTestId('insights-active-now');
      expect(document.documentElement.dataset.effects).toBe(effects.toLowerCase());
      const main = screen.getByRole('main');
      const names = within(main)
        .getAllByRole('figure')
        .map((figure) =>
          figure.getAttribute('aria-labelledby') === null ? '' : figure.textContent,
        );
      const text = `${main.textContent ?? ''}|${names.join('|')}`;
      view.unmount();
      vi.unstubAllGlobals();
      return text.replace(/:r[0-9a-z]+:/g, '');
    };
    expect(await read('SHOWCASE')).toBe(await read('CALM'));
  });
});
