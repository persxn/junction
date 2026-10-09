import { NOTIFICATION_TYPES, type DueItem } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { TYPE_DEFAULTS, effectivePreference } from '../../modules/notifications/types.js';
import {
  changeRecipients,
  collapseChanges,
  recipientsFor,
  type EventChange,
} from './recipients.js';
import {
  crossedThresholds,
  dedupeKey,
  pickMostUrgent,
  resurfaceable,
  severityOf,
  typeForItem,
  type Threshold,
} from './rules.js';

/** R108–R111, pure (WP-23 step 3). */

const T = { days: [7, 3, 1], dueDay: true, overdue: true };
const item = (patch: Partial<DueItem>): Pick<DueItem, 'bucket' | 'daysLeft' | 'itemKind'> => ({
  bucket: 'LATER',
  daysLeft: 10,
  itemKind: 'TASK',
  ...patch,
});

describe('thresholds (R108)', () => {
  it('reads WP-22’s bucket and days, most urgent first', () => {
    expect(crossedThresholds(item({ daysLeft: 10 }), T)).toEqual([]);
    expect(crossedThresholds(item({ daysLeft: 7, bucket: 'DAYS_7' }), T)).toEqual(['D7']);
    expect(crossedThresholds(item({ daysLeft: 2, bucket: 'DAYS_3' }), T)).toEqual(['D3', 'D7']);
    expect(crossedThresholds(item({ daysLeft: 0, bucket: 'TODAY' }), T)).toEqual([
      'DUE_DAY',
      'D1',
      'D3',
      'D7',
    ]);
    expect(crossedThresholds(item({ daysLeft: -1, bucket: 'OVERDUE' }), T)[0]).toBe('OVERDUE');
  });

  it('an event’s own date is never overdue; an override [14, 2] is honoured', () => {
    expect(
      crossedThresholds(item({ itemKind: 'EVENT_DEADLINE', bucket: 'OVERDUE', daysLeft: 0 }), T)[0],
    ).toBe('DUE_DAY');
    expect(
      crossedThresholds(item({ daysLeft: 10 }), { days: [14, 2], dueDay: false, overdue: false }),
    ).toEqual(['D14']);
  });

  it('fires only the most urgent unfired one — a skipped one never fires later', () => {
    const crossed: Threshold[] = ['D1', 'D3', 'D7'];
    expect(pickMostUrgent(crossed, new Set(['D7']))).toBe('D1');
    expect(pickMostUrgent(crossed, new Set(['D1']))).toBeUndefined();
    expect(pickMostUrgent([], new Set())).toBeUndefined();
  });

  it('the key carries the due time, so a moved deadline re-arms', () => {
    const base = {
      type: 'TASK_DUE' as const,
      subjectKind: 'task',
      subjectId: 't1',
      threshold: 'D3',
    };
    expect(dedupeKey({ ...base, dueAt: '2026-10-12T06:00:00.000Z' })).toBe(
      'TASK_DUE:task:t1:D3:2026-10-12T06:00:00.000Z',
    );
    expect(dedupeKey({ ...base, dueAt: 'a' })).not.toBe(dedupeKey({ ...base, dueAt: 'b' }));
    expect(typeForItem({ itemKind: 'EVENT_DEADLINE', deadlineKind: 'REGISTRATION' }, 'D3')).toBe(
      'REG_DEADLINE',
    );
    expect(typeForItem({ itemKind: 'TASK', deadlineKind: null }, 'OVERDUE')).toBe('OVERDUE');
  });
});

describe('severity (R110)', () => {
  it.each([
    [{ kind: 'THRESHOLD', threshold: 'D7' }, 'INFO'],
    [{ kind: 'THRESHOLD', threshold: 'D3' }, 'INFO'],
    [{ kind: 'THRESHOLD', threshold: 'D1' }, 'WARNING'],
    [{ kind: 'THRESHOLD', threshold: 'DUE_DAY' }, 'CRITICAL'],
    [{ kind: 'THRESHOLD', threshold: 'OVERDUE' }, 'CRITICAL'],
    [{ kind: 'MOVED', earlier: true }, 'WARNING'],
    [{ kind: 'MOVED', earlier: false }, 'INFO'],
    [{ kind: 'CANCELLED', hasActiveCompetition: true }, 'CRITICAL'],
    [{ kind: 'CANCELLED', hasActiveCompetition: false }, 'WARNING'],
    [{ kind: 'TYPE', type: 'BACKUP_FAILED' }, 'CRITICAL'],
    [{ kind: 'TYPE', type: 'SOURCE_BLOCKED' }, 'WARNING'],
    [{ kind: 'TYPE', type: 'NEW_MATCH' }, 'INFO'],
  ] as const)('%j → %s', (input, severity) => {
    expect(severityOf(input)).toBe(severity);
  });
});

describe('recipients and changes (R109)', () => {
  const facts = {
    mentorsOf: (id: string) => (id === 'c1' ? ['ada', 'grace'] : []),
    saversOf: (id: string) => (id === 'e1' ? ['sam', 'ada'] : []),
    competitionMentorsOfEvent: (id: string) => (id === 'e1' ? ['grace'] : []),
  };

  it('work goes to the competition’s mentors; an event’s date to savers and competing mentors', () => {
    expect(recipientsFor({ itemKind: 'TASK', engagementId: 'c1', eventId: 'e1' }, facts)).toEqual([
      'ada',
      'grace',
    ]);
    expect(
      recipientsFor(
        { itemKind: 'EVENT_DEADLINE', engagementId: null, eventId: 'e1' },
        facts,
      ).sort(),
    ).toEqual(['ada', 'grace', 'sam']);
  });

  it('collapses one event’s changes into one, keyed on the newest, never telling the changer', () => {
    const changes: EventChange[] = [
      {
        id: '01a',
        eventId: 'e1',
        field: 'registrationDeadlineAt',
        oldValue: 2000,
        newValue: 1500,
        changedBy: 'sam',
      },
      {
        id: '01b',
        eventId: 'e1',
        field: 'registrationDeadlineAt',
        oldValue: 1500,
        newValue: 1000,
        changedBy: null,
      },
    ];
    const [collapsed] = collapseChanges(changes);
    expect(collapsed).toMatchObject({
      eventId: 'e1',
      changeId: '01b',
      kind: 'MOVED',
      earlier: true,
    });
    expect(changeRecipients(collapsed!, facts).sort()).toEqual(['ada', 'grace']);
    const [cancelled] = collapseChanges([
      {
        id: '02',
        eventId: 'e1',
        field: 'cancellation',
        oldValue: 'NONE',
        newValue: 'CANCELLED',
        changedBy: null,
      },
    ]);
    expect(cancelled?.kind).toBe('CANCELLED');
  });
});

describe('snooze and the registry (R111)', () => {
  it('resurfaces snoozed rows whose time has come; dismissed ones never', () => {
    const rows = [
      { id: 'a', snoozedUntil: 100, dismissedAt: null },
      { id: 'b', snoozedUntil: 300, dismissedAt: null },
      { id: 'c', snoozedUntil: 100, dismissedAt: 50 },
      { id: 'd', snoozedUntil: null, dismissedAt: null },
    ];
    expect(resurfaceable(rows, 200).map((row) => row.id)).toEqual(['a']);
  });

  it('every type has a registry default', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(TYPE_DEFAULTS[type], type).toBeDefined();
      expect(effectivePreference(type, undefined).isDefault).toBe(true);
    }
    expect(
      effectivePreference('TASK_DUE', {
        type: 'TASK_DUE',
        isEnabled: true,
        thresholdsJson: '{"days":[14,2],"dueDay":false,"overdue":true}',
        toastEnabled: false,
      }).thresholds?.days,
    ).toEqual([14, 2]);
  });
});
