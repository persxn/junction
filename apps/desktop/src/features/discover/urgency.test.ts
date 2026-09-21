import { describe, expect, it } from 'vitest';

import { formatDistance, formatPrize, formatTeam, weekOf } from './format.js';
import { groupItems } from './grouping.js';
import { countdown } from './urgency.js';
import { makeItem, NOW } from '../../testing/fake-search.js';

const DAY = 86_400_000;

describe('countdown urgency (§12) with a fixed clock', () => {
  it.each([
    [0, 'critical', 'Closes today', 'Critical'],
    [2, 'high', 'Closes in 2 days', 'High urgency'],
    [6, 'medium', 'Closes in 6 days', 'Medium urgency'],
    [30, 'normal', 'Closes 22 Oct', 'Open'],
  ] as const)('%i days out → %s', (days, level, label, levelLabel) => {
    // NOW is noon IST; +days keeps the same local time of day.
    const due = countdown(NOW + days * DAY, 'DATETIME', NOW);
    expect(due).toMatchObject({ level, label, levelLabel });
    // Every level has an icon and a text label, never colour alone (§16.3).
    expect(due.icon).toBeDefined();
    expect(due.label.length).toBeGreaterThan(0);
  });

  it('a deadline later today is still "today"; one at 23:59 IST tonight too', () => {
    expect(countdown(NOW + 5 * 3_600_000, 'DATETIME', NOW).label).toBe('Closes today');
    expect(countdown(Date.parse('2026-09-22T18:29:00Z'), 'DATETIME', NOW).label).toBe(
      'Closes today',
    );
    expect(countdown(Date.parse('2026-09-22T18:31:00Z'), 'DATETIME', NOW).label).toBe(
      'Closes tomorrow',
    );
  });

  it('closed and unknown are states too, with words', () => {
    expect(countdown(NOW - DAY, 'DATE', NOW)).toMatchObject({
      level: 'closed',
      label: 'Registration closed 21 Sep',
    });
    expect(countdown(null, 'UNKNOWN', NOW)).toMatchObject({
      level: 'unknown',
      label: 'Deadline not announced',
    });
  });
});

describe('card wording', () => {
  it('distance follows D-06', () => {
    expect(formatDistance(179.6, 'OFFLINE')).toBe('~180 km (straight line)');
    expect(formatDistance(0.4, 'HYBRID')).toBe('< 1 km (straight line)');
    expect(formatDistance(null, 'ONLINE')).toBe('Online');
    expect(formatDistance(null, 'OFFLINE')).toBe('Distance unknown');
  });

  it('prize and team size', () => {
    expect(formatPrize({ text: null, totalMinor: 10_000_000, currency: 'INR' })).toBe('₹1,00,000');
    expect(formatPrize({ text: 'Swag', totalMinor: null, currency: null })).toBe('Swag');
    expect(formatTeam(2, 4)).toBe('Team 2–4');
    expect(formatTeam(null, 4)).toBe('Team up to 4');
    expect(formatTeam(null, null)).toBeUndefined();
  });

  it('weeks start on Monday in the display zone', () => {
    expect(weekOf(Date.parse('2026-09-27T20:00:00Z'))).toBe('2026-09-28'); // Monday 01:30 IST
    expect(weekOf(NOW)).toBe('2026-09-21');
  });
});

describe('grouping', () => {
  it('All events sections by type; the calendar by week, undated last', () => {
    const items = [
      makeItem(1, { eventType: 'CTF' }),
      makeItem(2),
      makeItem(3, { eventType: 'CTF', startsAt: null }),
    ];
    expect(
      groupItems(items, 'eventType').map((group) => [group.label, group.items.length]),
    ).toEqual([
      ['Hackathon', 1],
      ['CTF', 2],
    ]);
    const weeks = groupItems(items, 'week').map((group) => group.label);
    expect(weeks[weeks.length - 1]).toBe('Start date not announced');
    expect(weeks[0]).toMatch(/^Week of /);
  });
});
