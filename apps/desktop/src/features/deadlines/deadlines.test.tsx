import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi } from '../../testing/competitions-api.js';
import { installDeadlinesApi, makeDueItem } from '../../testing/deadlines-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { dateText, daysUntil, urgencyText } from './deadline-model.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The Deadline Radar (WP-22, R106–R107, jsdom): words for urgency, dates with
 * their precision, groups in bucket order with the server's counts, filters
 * from a link as removable chips, and its empty and error states.
 */

const ist = (iso: string): number => Date.parse(`${iso}+05:30`);
const NOW = ist('2026-10-09T10:00:00');

describe('the words', () => {
  it('say the urgency from the server’s bucket', () => {
    expect(urgencyText({ bucket: 'OVERDUE', dueAt: '2026-10-07T06:00:00.000Z' }, NOW)).toBe(
      'Overdue by 2 days',
    );
    expect(urgencyText({ bucket: 'TODAY', dueAt: '2026-10-09T12:00:00.000Z' }, NOW)).toBe(
      'Due today',
    );
    expect(urgencyText({ bucket: 'DAYS_3', dueAt: '2026-10-10T06:00:00.000Z' }, NOW)).toBe(
      'Tomorrow',
    );
    expect(urgencyText({ bucket: 'DAYS_3', dueAt: '2026-10-12T06:00:00.000Z' }, NOW)).toBe(
      'In 3 days',
    );
    expect(urgencyText({ bucket: 'LATER', dueAt: '2026-10-14T06:00:00.000Z' }, NOW)).toBe(
      'Later — 14 Oct',
    );
    expect(daysUntil('2026-10-09T20:00:00.000Z', NOW)).toBe(1);
  });

  it('keep the precision — never 00:00', () => {
    expect(dateText({ dueAt: '2026-09-27T18:29:59.999Z', precision: 'DATE' })).toBe(
      '27 Sep (time not stated)',
    );
    expect(dateText({ dueAt: '2026-10-31T18:29:59.999Z', precision: 'MONTH' })).toBe(
      'Oct (date not stated)',
    );
    expect(dateText({ dueAt: '2026-10-09T12:00:00.000Z', precision: 'DATETIME' })).toBe(
      '9 Oct, 17:30',
    );
  });
});

describe('the Radar', () => {
  beforeEach(() => {
    localStorage.clear();
    resetApiTransport();
    installStudentsApi();
    installCompetitionsApi();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups by urgency in order, each heading with its count, rows with owner and source', async () => {
    installDeadlinesApi({
      items: [
        makeDueItem('LATER', { label: 'Wrap-up' }),
        makeDueItem('OVERDUE', { label: 'Book the lab' }),
        makeDueItem('OVERDUE', { label: 'Register' }),
        makeDueItem('TODAY', {
          itemKind: 'EVENT_DEADLINE',
          label: 'Registration closes',
          engagementId: null,
          competitionName: null,
          teamId: null,
          teamName: null,
          precision: 'DATE',
          sourceLabel: 'Stated by Devfolio',
        }),
      ],
    });
    await renderApp('/deadlines');
    await screen.findByRole('heading', { name: 'Overdue (2)' });
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
      .filter((text) => /\(\d+\)$/.test(text ?? ''));
    expect(headings).toEqual(['Overdue (2)', 'Today (1)', 'Later (1)']);
    expect(screen.getByText('4 due')).toBeInTheDocument();
    expect(screen.getByText('Stated by Devfolio')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: 'Team Rocket — Synthetic Hack' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Synthetic Hack' })).toBeInTheDocument();
  });

  it('a link’s filters arrive as removable chips and reach the request', async () => {
    const api = installDeadlinesApi({
      items: [
        makeDueItem('OVERDUE'),
        makeDueItem('TODAY'),
        makeDueItem('OVERDUE', { itemKind: 'STAGE' }),
      ],
    });
    const user = userEvent.setup();
    await renderApp('/deadlines?scope=MINE&itemKind=TASK&bucket=OVERDUE');
    expect(await screen.findByText('1 due')).toBeInTheDocument();
    const query = api.calls.at(-1)!.query;
    expect([query.get('itemKind'), query.get('bucket')]).toEqual(['TASK', 'OVERDUE']);
    await user.click(screen.getByRole('button', { name: 'Remove filter: Overdue only' }));
    expect(await screen.findByText('2 due')).toBeInTheDocument();
  });

  it('empty says what fills it', async () => {
    installDeadlinesApi({ items: [] });
    await renderApp('/deadlines');
    expect(
      await screen.findByText(
        'Nothing due — saved events and competitions show their deadlines here.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Discover' })).toBeInTheDocument();
  });

  it('an error offers to try again', async () => {
    installDeadlinesApi({ failDeadlines: true });
    await renderApp('/deadlines');
    expect(
      await screen.findByText('The deadlines could not be loaded', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
