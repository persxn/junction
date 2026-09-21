import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventChanges } from '../../db/schema/index.js';
import {
  openEventsHarness,
  tableCounts,
  toCandidate,
  type EventsHarness,
} from '../../testing/events.js';
import { DEDUP_AUTO_MERGE_THRESHOLD } from './settings.js';

/** Linking, change detection and the R65 settings, through WP-09a's `processItem`. */

let h: EventsHarness;

beforeEach(() => {
  h = openEventsHarness();
});

afterEach(() => {
  h.close();
});

const BASE = {
  title: 'HackX 2026',
  eventType: 'HACKATHON' as const,
  organizerName: 'HackX Society',
  mode: 'ONLINE' as const,
  startsAt: '2026-10-10T04:30:00Z',
  endsAt: '2026-10-11T04:30:00Z',
  registrationDeadlineAt: '2026-10-03T18:29:00Z',
  editionYear: 2026,
};

function changesOf(eventId: string): (typeof eventChanges.$inferSelect)[] {
  return h.database.db.drizzle
    .select()
    .from(eventChanges)
    .all()
    .filter((row) => row.eventId === eventId);
}

describe('change detection', () => {
  it('a re-scrape that moves the registration deadline writes exactly one event_changes row', () => {
    const record = h.ingest('devfolio', toCandidate('devfolio', 'hackx', BASE));
    const event = h.eventOf(record);
    expect(changesOf(event.id)).toEqual([]);

    h.clock.set('2026-09-02T00:00:00.000Z');
    h.ingest(
      'devfolio',
      toCandidate('devfolio', 'hackx', { ...BASE, registrationDeadlineAt: '2026-10-05T18:29:00Z' }),
    );
    const changes = changesOf(event.id);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: 'registrationDeadlineAt',
      oldValueJson: String(Date.parse('2026-10-03T18:29:00Z')),
      newValueJson: String(Date.parse('2026-10-05T18:29:00Z')),
      cause: 'SCRAPE',
      sourceRecordId: record.id,
      changedBy: null,
    });
    const after = h.module.events.getById(event.id)!;
    expect(after.registrationDeadlineAt).toBe(Date.parse('2026-10-05T18:29:00Z'));
    expect(after.lastChangedAt).toBe(Date.parse('2026-09-02T00:00:00.000Z'));
    expect(after.version).toBe(event.version + 1);
  });

  it('a re-scrape that changes nothing writes nothing', () => {
    const record = h.ingest('devfolio', toCandidate('devfolio', 'hackx', BASE));
    const before = tableCounts(h.database);
    h.ingest('devfolio', toCandidate('devfolio', 'hackx', BASE));
    expect(changesOf(h.eventOf(record).id)).toEqual([]);
    expect(tableCounts(h.database)).toEqual(before);
  });

  it('creates no notification — WP-23 reads event_changes later', () => {
    const record = h.ingest('devfolio', toCandidate('devfolio', 'hackx', BASE));
    h.ingest(
      'devfolio',
      toCandidate('devfolio', 'hackx', { ...BASE, registrationDeadlineAt: '2026-10-05T18:29:00Z' }),
    );
    expect(Object.keys(tableCounts(h.database))).not.toContain('notifications');
    expect(changesOf(h.eventOf(record).id)).toHaveLength(1);
  });
});

describe('linking', () => {
  it('writes one claim per field for each record, and a POLICY_HIDDEN event still links', () => {
    const record = h.ingest(
      'devfolio',
      toCandidate('devfolio', 'seoul', {
        ...BASE,
        title: 'Seoul Hack 2026',
        mode: 'OFFLINE',
        city: 'Seoul',
        countryCode: 'KR',
      }),
    );
    const event = h.eventOf(record);
    expect(event.visibility).toBe('POLICY_HIDDEN');
    expect(event.policyReason).toBe('IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES');
    const claims = h.module.provenance.claimsOf(event.id);
    expect(claims.length).toBe(37);
    expect(claims.every((claim) => claim.sourceRecordId === record.id)).toBe(true);
    expect(h.record('devfolio', 'seoul')).toMatchObject({
      eventId: event.id,
      originEventId: event.id,
      matchMethod: 'NEW',
    });
  });

  it('audits the creation as SYSTEM in the same transaction', () => {
    const before = h.audit.all().length;
    h.ingest('devfolio', toCandidate('devfolio', 'hackx', BASE));
    const rows = h.audit.all().slice(before);
    expect(rows.map((row) => [row.action, row.actorKind])).toEqual([['event.created', 'SYSTEM']]);
    expect(h.audit.verifyChain().ok).toBe(true);
  });

  describe('R65: the auto-merge threshold is read at call time', () => {
    // Identical but for a start 30 h later: ≈ 0.917 (see dedup.test.ts).
    const { registrationDeadlineAt: _deadline, ...first } = BASE;
    const second = {
      ...first,
      startsAt: '2026-10-11T10:30:00Z',
      endsAt: '2026-10-12T10:30:00Z',
    };

    it('at the default 0.90 the pair auto-merges', () => {
      h.ingest('devfolio', toCandidate('devfolio', 'a', first));
      h.ingest('unstop', toCandidate('unstop', 'b', second));
      expect(h.record('unstop', 'b').matchMethod).toBe('AUTO_SCORE');
      expect(h.module.events.allEvents()).toHaveLength(1);
    });

    it('at 0.95 the same pair is a PENDING candidate, with no code change', () => {
      h.settings.set(DEDUP_AUTO_MERGE_THRESHOLD, 0.95);
      h.ingest('devfolio', toCandidate('devfolio', 'a', first));
      h.ingest('unstop', toCandidate('unstop', 'b', second));
      expect(h.record('unstop', 'b').matchMethod).toBe('NEW');
      expect(h.module.events.allEvents()).toHaveLength(2);
      const [pending] = h.module.candidates.list('PENDING', 10, 0);
      expect(pending?.score).toBeGreaterThanOrEqual(0.9);
      expect(pending?.score).toBeLessThan(0.95);
    });
  });
});
