import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadScenario,
  openEventsHarness,
  toCandidate,
  type EventsHarness,
} from '../../testing/events.js';
import type { Principal } from '../auth/types.js';

/**
 * Ruling R88: `events.top_trust_rank` is the highest trust_rank among the
 * sources listing the event, kept by the resolver on every link, merge and
 * unmerge — so RELEVANCE can read a column instead of a per-row lookup.
 */

let h: EventsHarness;
let admin: Principal;

beforeEach(() => {
  h = openEventsHarness();
  admin = h.user('ADMINISTRATOR');
  // Two sources of different standing, so a merge has something to change.
  h.source('lowtrust', 20);
  h.source('hightrust', 80);
});

afterEach(() => {
  h.close();
});

function trustOf(id: string): number {
  return h.module.events.getById(id)!.topTrustRank;
}

/** The CodeStorm pair (a PENDING duplicate), one under each source. */
function pair(): { low: string; high: string; candidateId: string; version: number } {
  const [first, second] = loadScenario('internal-round-vs-national-round').records;
  const low = h.eventOf(
    h.ingest('lowtrust', toCandidate('lowtrust', first!.externalKey, first!.candidate)),
  );
  h.clock.set('2026-09-01T01:00:00.000Z');
  const high = h.eventOf(
    h.ingest('hightrust', toCandidate('hightrust', second!.externalKey, second!.candidate)),
  );
  const [row] = h.module.candidates.list('PENDING', 10, 0);
  return { low: low.id, high: high.id, candidateId: row!.id, version: row!.version };
}

describe('R88 — top_trust_rank', () => {
  it('is the listing source’s rank after a link', () => {
    const { low, high } = pair();
    expect(trustOf(low)).toBe(20);
    expect(trustOf(high)).toBe(80);
  });

  it('is the higher of the two on the survivor after a merge, and each its own after unmerge', () => {
    const { low, high, candidateId, version } = pair();
    h.clock.set('2026-09-02T00:00:00.000Z');
    const { survivorId } = h.module.merges.merge({ actor: admin }, candidateId, version);
    const loserId = survivorId === low ? high : low;
    expect(trustOf(survivorId)).toBe(80);

    h.clock.set('2026-09-03T00:00:00.000Z');
    const loser = h.module.events.getById(loserId)!;
    h.module.merges.unmerge({ actor: admin }, loserId, loser.version);
    expect(trustOf(low)).toBe(20);
    expect(trustOf(high)).toBe(80);
  });

  it('agrees with a fresh computation for every event after all of it', () => {
    const { candidateId, version } = pair();
    h.module.merges.merge({ actor: admin }, candidateId, version);
    const stale = h.database.db.raw
      .prepare(
        `SELECT count(*) AS n FROM events e WHERE e.merged_into_event_id IS NULL AND e.top_trust_rank <>
           coalesce((SELECT max(s.trust_rank) FROM source_records sr JOIN sources s ON s.id = sr.source_id
                     WHERE sr.event_id = e.id), 0)`,
      )
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });
});
