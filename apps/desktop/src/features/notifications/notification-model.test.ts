import { describe, expect, it } from 'vitest';

import {
  badgeText,
  chosenTime,
  dueLine,
  isInternalRoute,
  nineAmIst,
  snoozeChoices,
  unreadLabel,
} from './notification-model.js';

/** The inbox's pure rules (WP-23, R111): snooze times in Indian time, routes, words. */

// 9 Oct 2026, 15:00 IST.
const NOW = Date.parse('2026-10-09T09:30:00.000Z');

describe('snooze choices (R111)', () => {
  it('1 h, tomorrow 09:00 IST, and the due day 09:00 IST when it is ahead', () => {
    const choices = snoozeChoices(NOW, '2026-10-12T12:30:00.000Z');
    expect(choices.map((c) => c.label)).toEqual([
      'For 1 hour',
      'Until tomorrow, 9:00',
      'Until the due day, 9:00',
    ]);
    expect(new Date(choices[0]!.until).toISOString()).toBe('2026-10-09T10:30:00.000Z');
    expect(new Date(choices[1]!.until).toISOString()).toBe('2026-10-10T03:30:00.000Z');
    expect(new Date(choices[2]!.until).toISOString()).toBe('2026-10-12T03:30:00.000Z');
  });

  it('leaves out the due day when it is past, today already past 9:00, or the same as tomorrow', () => {
    expect(snoozeChoices(NOW, null)).toHaveLength(2);
    expect(snoozeChoices(NOW, '2026-10-09T12:00:00.000Z')).toHaveLength(2);
    expect(snoozeChoices(NOW, '2026-10-10T12:00:00.000Z')).toHaveLength(2);
  });

  it('a chosen time is Indian time and must be ahead', () => {
    expect(chosenTime('2026-10-09T18:00', NOW)).toBe(Date.parse('2026-10-09T12:30:00.000Z'));
    expect(chosenTime('2026-10-09T14:00', NOW)).toBeUndefined();
    expect(chosenTime('soon', NOW)).toBeUndefined();
    // A UTC instant late in the evening belongs to the next Kolkata day.
    expect(new Date(nineAmIst(Date.parse('2026-10-09T20:00:00.000Z'))).toISOString()).toBe(
      '2026-10-10T03:30:00.000Z',
    );
  });
});

describe('routes, words and the badge', () => {
  it('opens only our own paths', () => {
    expect(isInternalRoute('/competitions/0192')).toBe(true);
    expect(isInternalRoute('/discover/event/abc')).toBe(true);
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      '/a?b=c',
      7,
    ]) {
      expect(isInternalRoute(bad), String(bad)).toBe(false);
    }
  });

  it('keeps precision: a date without a time is never midnight', () => {
    expect(dueLine({ dueAt: '2026-09-27T00:00:00.000Z', precision: 'DATE' })).toBe(
      'Due 27 Sep (time not stated)',
    );
    expect(dueLine({ dueAt: '2026-10-01T00:00:00.000Z', precision: 'MONTH' })).toBe(
      'Due Oct (date not stated)',
    );
    expect(dueLine({ dueAt: null, precision: null })).toBeUndefined();
    expect(dueLine({ dueAt: '2026-09-27T06:30:00.000Z', precision: 'DATETIME' })).not.toMatch(
      /00:00/,
    );
  });

  it('names the count and caps the badge at 9+', () => {
    expect(unreadLabel(3)).toBe('3 unread notifications');
    expect(unreadLabel(1)).toBe('1 unread notification');
    expect(unreadLabel(0)).toBe('No unread notifications');
    expect([1, 9, 10, 250].map(badgeText)).toEqual(['1', '9', '9+', '9+']);
  });
});
