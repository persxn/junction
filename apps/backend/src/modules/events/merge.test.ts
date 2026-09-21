import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventChanges, type EventRow } from '../../db/schema/index.js';
import { AppError } from '../../platform/errors.js';
import {
  loadScenario,
  openEventsHarness,
  tableCounts,
  toCandidate,
  type EventsHarness,
} from '../../testing/events.js';
import type { Principal } from '../auth/types.js';

/** Merge, unmerge and reject (R66), at the service level. */

let h: EventsHarness;
let admin: Principal;

beforeEach(() => {
  h = openEventsHarness();
  admin = h.user('ADMINISTRATOR');
});

afterEach(() => {
  h.close();
});

/**
 * The two CodeStorm rounds, with their PENDING pair. The national round is
 * scraped an hour later, so after a merge its claims win the equal-trust
 * fields on the survivor — which gives the merge something to change.
 */
function pair(): { internal: EventRow; national: EventRow; candidateId: string; version: number } {
  const scenario = loadScenario('internal-round-vs-national-round');
  const [first, second] = scenario.records;
  const internal = h.ingest(
    'devfolio',
    toCandidate('devfolio', first!.externalKey, first!.candidate),
  );
  h.clock.set('2026-09-01T01:00:00.000Z');
  const national = h.ingest(
    'unstop',
    toCandidate('unstop', second!.externalKey, second!.candidate),
  );
  const [row] = h.module.candidates.list('PENDING', 10, 0);
  return {
    internal: h.eventOf(internal),
    national: h.eventOf(national),
    candidateId: row!.id,
    version: row!.version,
  };
}

/** An event's resolved columns, without the bookkeeping a merge is allowed to move. */
function resolved(id: string): Record<string, unknown> {
  const { version: _v, updatedAt: _u, lastChangedAt: _l, ...rest } = h.module.events.getById(id)!;
  return rest;
}

function selectedClaims(): string[] {
  return h.database.db.raw
    .prepare('select id from event_field_claims where is_selected = 1 order by id')
    .all()
    .map((row) => (row as { id: string }).id);
}

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return undefined;
}

describe('R66: a merge deletes nothing, and unmerge undoes it exactly', () => {
  it('merge → unmerge restores both events, the resolution and every row count', () => {
    const { internal, national, candidateId, version } = pair();
    const before = tableCounts(h.database);
    const beforeInternal = resolved(internal.id);
    const beforeNational = resolved(national.id);
    const beforeSelected = selectedClaims();

    h.clock.set('2026-09-02T00:00:00.000Z');
    const merged = h.module.merges.merge({ actor: admin }, candidateId, version);
    expect(merged.survivorId).toBe(internal.id);
    const during = tableCounts(h.database);
    expect({ ...during, event_changes: 0, audit_log: 0 }).toEqual({
      ...before,
      event_changes: 0,
      audit_log: 0,
    });

    const loser = h.module.events.getById(national.id)!;
    h.clock.set('2026-09-03T00:00:00.000Z');
    const undone = h.module.merges.unmerge({ actor: admin }, national.id, loser.version);
    expect(undone).toEqual({ restoredId: national.id, fromEventId: internal.id });

    const after = tableCounts(h.database);
    // History tables grow; nothing else does, and nothing shrinks.
    expect({ ...after, event_changes: 0, audit_log: 0 }).toEqual({
      ...before,
      event_changes: 0,
      audit_log: 0,
    });
    expect(resolved(internal.id)).toEqual(beforeInternal);
    expect(resolved(national.id)).toEqual(beforeNational);
    expect(selectedClaims()).toEqual(beforeSelected);
    expect(h.module.provenance.recordsOf(national.id).map((record) => record.externalKey)).toEqual([
      'codestorm-national',
    ]);
  });

  it('both directions write event_changes, with the cause and the admin', () => {
    const { internal, national, candidateId, version } = pair();
    h.module.merges.merge({ actor: admin }, candidateId, version);
    const loser = h.module.events.getById(national.id)!;
    h.module.merges.unmerge({ actor: admin }, national.id, loser.version);

    const rows = h.database.db.drizzle.select().from(eventChanges).all();
    const onLoser = rows.filter((row) => row.eventId === national.id && row.field === 'visibility');
    expect(onLoser.map((row) => [row.cause, row.newValueJson])).toEqual([
      ['MERGE', '"MERGED"'],
      ['UNMERGE', '"VISIBLE"'],
    ]);
    const onSurvivor = rows.filter((row) => row.eventId === internal.id);
    expect(onSurvivor.some((row) => row.cause === 'MERGE')).toBe(true);
    expect(onSurvivor.some((row) => row.cause === 'UNMERGE')).toBe(true);
    expect(
      rows.filter((row) => row.cause !== 'SCRAPE').every((row) => row.changedBy === admin.id),
    ).toBe(true);
  });

  it('the survivor is the event seen first, whichever side of the pair it is', () => {
    h.clock.set('2026-08-01T00:00:00.000Z');
    const national = h.ingest(
      'unstop',
      toCandidate(
        'unstop',
        'n',
        loadScenario('internal-round-vs-national-round').records[1]!.candidate,
      ),
    );
    h.clock.set('2026-08-05T00:00:00.000Z');
    h.ingest(
      'devfolio',
      toCandidate(
        'devfolio',
        'i',
        loadScenario('internal-round-vs-national-round').records[0]!.candidate,
      ),
    );
    const [row] = h.module.candidates.list('PENDING', 10, 0);
    const result = h.module.merges.merge({ actor: admin }, row!.id, row!.version);
    expect(result.survivorId).toBe(h.eventOf(national).id);
  });
});

describe('refusals', () => {
  it('a professor may not merge, reject or unmerge (§10.2)', () => {
    const professor = h.user('PROFESSOR');
    const { national, candidateId, version } = pair();
    expect(codeOf(() => h.module.merges.merge({ actor: professor }, candidateId, version))).toBe(
      'FORBIDDEN',
    );
    expect(codeOf(() => h.module.merges.reject({ actor: professor }, candidateId, version))).toBe(
      'FORBIDDEN',
    );
    expect(codeOf(() => h.module.merges.unmerge({ actor: professor }, national.id, 1))).toBe(
      'FORBIDDEN',
    );
  });

  it('a stale version is EVENT_VERSION_CONFLICT and changes nothing', () => {
    const { candidateId, version } = pair();
    const before = tableCounts(h.database);
    expect(codeOf(() => h.module.merges.merge({ actor: admin }, candidateId, version + 1))).toBe(
      'EVENT_VERSION_CONFLICT',
    );
    expect(tableCounts(h.database)).toEqual(before);
  });

  it('a decided pair is EVENT_CANDIDATE_DECIDED', () => {
    const { candidateId, version } = pair();
    const rejected = h.module.merges.reject({ actor: admin }, candidateId, version);
    expect(
      codeOf(() => h.module.merges.merge({ actor: admin }, candidateId, rejected.version)),
    ).toBe('EVENT_CANDIDATE_DECIDED');
  });

  it('merging a pair whose event is already merged is EVENT_ALREADY_MERGED', () => {
    const { internal, national, candidateId, version } = pair();
    // A second pending pair naming the national round.
    const third = h.ingest(
      'hackiitx-site',
      toCandidate('hackiitx-site', 'x', {
        title: 'Unrelated 2026',
        eventType: 'HACKATHON',
        mode: 'ONLINE',
      }),
    );
    const extra = h.module.candidates.insertIfAbsent(
      national.id,
      h.eventOf(third).id,
      0.8,
      { title: 0.5, organizer: 0, dateProximity: 1, locationMode: 1, urlMatch: false },
      0,
    )!;
    h.module.merges.merge({ actor: admin }, candidateId, version);
    expect(h.module.events.getById(national.id)?.mergedIntoEventId).toBe(internal.id);
    expect(codeOf(() => h.module.merges.merge({ actor: admin }, extra.id, extra.version))).toBe(
      'EVENT_ALREADY_MERGED',
    );
  });

  it('unmerging an event that was never merged is EVENT_NOT_MERGED', () => {
    const { internal } = pair();
    expect(
      codeOf(() => h.module.merges.unmerge({ actor: admin }, internal.id, internal.version)),
    ).toBe('EVENT_NOT_MERGED');
  });
});

describe('audit (R35)', () => {
  it('writes one USER audit row per action, and none for a refused one', () => {
    const { national, candidateId, version } = pair();
    const actions = (): string[] => h.audit.all().map((row) => `${row.action}:${row.actorKind}`);
    const start = actions().length;

    expect(codeOf(() => h.module.merges.merge({ actor: admin }, candidateId, version + 7))).toBe(
      'EVENT_VERSION_CONFLICT',
    );
    expect(actions()).toHaveLength(start);

    h.module.merges.merge({ actor: admin }, candidateId, version);
    const loser = h.module.events.getById(national.id)!;
    h.module.merges.unmerge({ actor: admin }, national.id, loser.version);
    expect(actions().slice(start)).toEqual(['event.merged:USER', 'event.unmerged:USER']);
    expect(
      h.audit
        .all()
        .slice(start)
        .every((row) => row.actorUserId === admin.id),
    ).toBe(true);
    expect(h.audit.verifyChain().ok).toBe(true);
  });
});
