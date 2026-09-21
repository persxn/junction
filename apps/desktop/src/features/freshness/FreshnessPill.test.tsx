import type { SourceStatusEntry, SourceStatusResponse } from '@compintel/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { renderWithProviders } from '../../testing/render.js';
import { FreshnessPill } from './FreshnessPill.js';

/**
 * The §16.1 freshness pill and its per-source popover, under a fake clock.
 *
 * The three things that matter here are the three §7.7 distinctions: a source
 * that is failing says what went wrong and when it will try again; a source we
 * are deliberately not asking says "paused by policy"; and being offline is an
 * **info** line (D-23), never an error. Every one of them is an icon and a
 * label, so none of it depends on colour (§16.3).
 */

const NOW = Date.parse('2026-09-22T06:30:00.000Z');
const MINUTE = 60_000;

function entry(overrides: Partial<SourceStatusEntry> = {}): SourceStatusEntry {
  return {
    key: 'devfolio',
    name: 'Devfolio',
    adapter: 'DEVFOLIO',
    isEnabled: true,
    health: 'OK',
    lastRunAt: new Date(NOW - 4 * MINUTE).toISOString(),
    lastSuccessAt: new Date(NOW - 4 * MINUTE).toISOString(),
    freshnessMinutes: 4,
    nextAttemptAt: new Date(NOW + 11 * MINUTE).toISOString(),
    consecutiveFailures: 0,
    lastOutcome: 'SUCCESS',
    lastErrorKind: null,
    message: 'Devfolio is up to date.',
    attributionText: 'Listing data from Devfolio.',
    ...overrides,
  };
}

function install(body: SourceStatusResponse): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response),
    ),
  );
}

async function open(body: SourceStatusResponse): Promise<ReturnType<typeof userEvent.setup>> {
  install(body);
  const user = userEvent.setup();
  renderWithProviders(<FreshnessPill refetchIntervalMs={600_000} />);
  await screen.findByText(/Updated|No updates yet/);
  await user.click(screen.getByTestId('freshness-pill'));
  return user;
}

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetApiTransport();
});

describe('the freshness pill', () => {
  it('says "Updated 4 min ago" from the newest successful run', async () => {
    install({
      sources: [entry()],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: false,
    });
    renderWithProviders(<FreshnessPill refetchIntervalMs={600_000} />);
    expect(await screen.findByText('Updated 4 min ago')).toBeInTheDocument();
  });

  it('says so plainly when nothing has ever succeeded', async () => {
    install({ sources: [entry({ health: 'NEVER_RUN' })], updatedAt: null, offline: false });
    renderWithProviders(<FreshnessPill refetchIntervalMs={600_000} />);
    expect(await screen.findByText('No updates yet')).toBeInTheDocument();
  });

  it('opens a per-source popover with each state as an icon and a label', async () => {
    await open({
      sources: [entry(), entry({ key: 'devpost', name: 'Devpost', health: 'PAUSED_BY_POLICY' })],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: false,
    });
    const popover = within(screen.getByTestId('freshness-popover'));
    expect(popover.getByText('OK')).toBeInTheDocument();
    expect(popover.getByText('Paused by policy')).toBeInTheDocument();
    expect(popover.getAllByText(/Last success: 4 min ago/)).toHaveLength(2);
    // Only the source that is actually scheduled promises a next run.
    expect(popover.getAllByText(/Next run: in 11 min/)).toHaveLength(1);
  });

  it('shows the §7.7 sentence for a failing source', async () => {
    await open({
      sources: [
        entry({
          health: 'FAILING',
          lastOutcome: 'FAILED',
          lastErrorKind: 'RATE_LIMITED',
          consecutiveFailures: 2,
          message: 'Devfolio asked us to slow down. Next attempt at 3:45 PM.',
        }),
      ],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: false,
    });
    const popover = within(screen.getByTestId('freshness-popover'));
    expect(popover.getByText('Failing')).toBeInTheDocument();
    expect(
      popover.getByText('Devfolio asked us to slow down. Next attempt at 3:45 PM.'),
    ).toBeInTheDocument();
  });

  it('treats being offline as information, not an error (D-23)', async () => {
    await open({
      sources: [
        entry({
          health: 'OFFLINE',
          lastOutcome: 'SKIPPED_OFFLINE',
          message:
            "You're offline. Showing events from the last update. Last successful update 4 min ago.",
        }),
      ],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: true,
    });
    const popover = screen.getByTestId('freshness-popover');
    expect(within(popover).getByText('Skipped, offline')).toBeInTheDocument();
    expect(popover).toHaveTextContent(/You're offline\. Showing events from the last update/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is operable from the keyboard and closes on Esc', async () => {
    install({
      sources: [entry()],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<FreshnessPill refetchIntervalMs={600_000} />);
    await screen.findByText('Updated 4 min ago');

    const pill = screen.getByTestId('freshness-pill');
    pill.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('freshness-popover')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('freshness-popover')).not.toBeInTheDocument();
    expect(pill).toHaveFocus();
  });

  it('leaves the manual pseudo-sources out: they have no cadence to be fresh against', async () => {
    await open({
      sources: [
        entry(),
        entry({ key: 'manual', name: 'Typed in by hand', adapter: 'MANUAL', health: 'NEVER_RUN' }),
        entry({
          key: 'url-import',
          name: 'Imported from a link',
          adapter: 'URL_IMPORT',
          health: 'NEVER_RUN',
        }),
      ],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: false,
    });
    const popover = within(screen.getByTestId('freshness-popover'));
    expect(popover.getByText('Devfolio')).toBeInTheDocument();
    expect(popover.queryByText('Typed in by hand')).not.toBeInTheDocument();
    expect(popover.queryByText('Imported from a link')).not.toBeInTheDocument();
  });

  it('promises no next run for a source nobody is asking', async () => {
    await open({
      sources: [
        entry({
          health: 'PAUSED_BY_POLICY',
          message: 'Updates from Devfolio are disabled by policy.',
        }),
      ],
      updatedAt: null,
      offline: false,
    });
    const popover = within(screen.getByTestId('freshness-popover'));
    expect(popover.getByText(/Last success:/)).toBeInTheDocument();
    expect(popover.queryByText(/Next run/)).not.toBeInTheDocument();
  });

  it('is accessible with the popover open', async () => {
    install({
      sources: [entry(), entry({ key: 'ctftime', name: 'CTFtime', health: 'FAILING' })],
      updatedAt: new Date(NOW - 4 * MINUTE).toISOString(),
      offline: false,
    });
    const { container } = renderWithProviders(
      <FreshnessPill defaultOpen refetchIntervalMs={600_000} />,
    );
    await screen.findByTestId('freshness-popover');
    await screen.findByText('CTFtime');
    await expect(container).toBeAccessible();
  });
});
