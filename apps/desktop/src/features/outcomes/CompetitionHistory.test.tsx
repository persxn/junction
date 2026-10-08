import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { installCompetitionsApi, type CompetitionsApi } from '../../testing/competitions-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi, makeStudent } from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The Student page's "Competitions & outcomes" (WP-21, R104, jsdom): the
 * team's result for someone on the roster when it was recorded, "Left before
 * the result" for someone who was not, and an empty state that suggests the
 * next step.
 */

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const id = (n: number) => `0192f0c1-0000-7000-8000-${String(n).padStart(12, '0')}`;

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi({ students: [ASHA] });
  api = installCompetitionsApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Competitions & outcomes', () => {
  it('shows the result to those who were there, and says who left before it', async () => {
    api.outcomes.histories.set(ASHA.id, {
      studentId: ASHA.id,
      erased: false,
      competitions: [
        {
          competitionId: id(0xe101),
          eventTitle: 'Alpha Hack',
          startsAt: null,
          endsAt: null,
          datePrecision: 'UNKNOWN',
          teamName: 'Team Rocket',
          status: 'COMPLETED',
          outcomeState: 'SHOWN',
          outcome: {
            result: 'WINNER',
            rank: 1,
            prizeText: 'First prize',
            prizeMinor: 5_000_000,
            prizeCurrency: 'INR',
          },
          addedAt: '2026-09-01T06:00:00.000Z',
          removedAt: null,
        },
        {
          competitionId: id(0xe102),
          eventTitle: 'Beta Hack',
          startsAt: null,
          endsAt: null,
          datePrecision: 'UNKNOWN',
          teamName: null,
          status: 'COMPLETED',
          outcomeState: 'LEFT_BEFORE_RESULT',
          outcome: null,
          addedAt: '2026-08-01T06:00:00.000Z',
          removedAt: '2026-08-10T06:00:00.000Z',
        },
      ],
      teams: [],
      achievements: [],
    });
    await renderApp(`/students/${ASHA.id}`);
    const list = await screen.findByRole('list', { name: 'Competitions and outcomes' });
    const [alpha, beta] = within(list).getAllByRole('listitem');
    expect(alpha).toHaveTextContent(/Alpha Hack.*Team Rocket · Completed/);
    expect(within(alpha!).getByText('Winner')).toBeInTheDocument();
    expect(alpha).toHaveTextContent('₹50,000.00');
    expect(beta).toHaveTextContent(/Individual/);
    expect(within(beta!).getByText('Left before the result')).toBeInTheDocument();
  });

  it('with none yet, suggests Discover', async () => {
    await renderApp(`/students/${ASHA.id}`);
    const empty = (await screen.findByText(/No competitions yet/)).closest('p')!;
    expect(within(empty).getByRole('link', { name: 'Discover' })).toBeInTheDocument();
  });
});
