import { EFFECT_TIERS, type Appearance, type EffectTier } from '@compintel/contracts';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi, makeDueItem } from '../../testing/deadlines-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { installInsightsApi } from '../../testing/insights-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';

/**
 * WP-33 with axe (R89): `/insights` and one existing route (the Dashboard) at
 * each of CALM, STANDARD and SHOWCASE, and the Dashboard's urgency badges and
 * counters reading the same at every tier (R68: never glow alone).
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const tier = (effects: EffectTier): Appearance => ({
  flavourLight: 'latte',
  flavourDark: 'mocha',
  effects,
  rgbPreset: { preset: effects === 'SHOWCASE' ? 'MOCHA_GLOW' : 'OFF', speed: 'SLOW' },
});

const DUE = [makeDueItem('OVERDUE'), makeDueItem('TODAY'), makeDueItem('LATER')];

function installDashboard(effects: EffectTier): void {
  installStudentsApi();
  installFakeSearch([makeItem(1), makeItem(2)]);
  installCompetitionsApi();
  installDeadlinesApi({
    items: DUE,
    tiles: [
      {
        key: 'OVERDUE_TASKS',
        label: 'Overdue tasks',
        value: 7,
        totalIsApproximate: false,
        link: { to: '/deadlines', search: { scope: 'MINE', itemKind: 'TASK', bucket: 'OVERDUE' } },
      },
    ],
  });
  installInsightsApi({ appearance: tier(effects) });
}

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(EFFECT_TIERS)('at %s', (effects) => {
  it('Insights is accessible', async () => {
    installStudentsApi();
    installInsightsApi({ appearance: tier(effects) });
    await renderApp('/insights', { appearance: tier(effects) });
    await screen.findByTestId('insights-active-now');
    expect(document.documentElement.dataset.effects).toBe(effects.toLowerCase());
    await expect(document.body).toBeAccessible();
  });

  it('the Dashboard is accessible', async () => {
    installDashboard(effects);
    await renderApp('/', { appearance: tier(effects) });
    await screen.findByRole('list', { name: 'Next deadlines' });
    await expect(document.body).toBeAccessible();
  });
});

describe('information parity on the Dashboard', () => {
  it('reads the same at CALM and SHOWCASE', async () => {
    const read = async (effects: EffectTier): Promise<string> => {
      installDashboard(effects);
      const view = await renderApp('/', { appearance: tier(effects) });
      await screen.findByRole('list', { name: 'Next deadlines' });
      const kpi = await screen.findByTestId('kpi-OVERDUE_TASKS');
      // At SHOWCASE the counter runs; compare the state it settles on.
      await waitFor(() => {
        expect(kpi.textContent).toBe('7');
      });
      const main = screen.getByRole('main');
      const urgency = [...main.querySelectorAll('[data-urgency]')].map((n) => n.textContent);
      const text = `${main.textContent ?? ''}|${urgency.join('|')}`;
      view.unmount();
      vi.unstubAllGlobals();
      return text;
    };
    const calm = await read('CALM');
    expect(calm).toContain('7');
    expect(await read('SHOWCASE')).toBe(calm);
  });
});
