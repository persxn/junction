import {
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TRANSITIONS,
  type CompetitionDetail,
  type EngagementStatus,
} from '@compintel/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  assigned,
  freshStudent,
  getCompetition,
  makeEvent,
  move,
} from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';

/**
 * The §19 AC "invalid transitions are rejected" (R97): every (from, to) pair
 * over HTTP against the contracts table — an allowed move writes one history
 * row and one audit row, a refused one answers 409 with the allowed list and
 * writes nothing — and an audit failure takes the status change back with it.
 */

let h: StudentsHarness;
let server: TestServer;
// One database and server per file: every test makes its own events, students
// and uniquely named teams, so they cannot see each other (R89's time budget).
beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await server.close();
  h.close();
});

/** How to reach each status from a fresh assignment. */
const PATHS: Record<EngagementStatus, EngagementStatus[]> = {
  CONSIDERING: [],
  ASSIGNED: [],
  APPLIED: ['APPLIED'],
  PARTICIPATING: ['APPLIED', 'PARTICIPATING'],
  COMPLETED: ['APPLIED', 'PARTICIPATING', 'COMPLETED'],
  WITHDRAWN: ['WITHDRAWN'],
  NOT_SELECTED: ['APPLIED', 'NOT_SELECTED'],
};

async function at(status: EngagementStatus, eventId: string): Promise<CompetitionDetail> {
  let current = await assigned(server, h.alice, {
    eventId,
    studentIds: [freshStudent(h)],
    initialStatus: status === 'CONSIDERING' ? 'CONSIDERING' : 'ASSIGNED',
  });
  for (const step of PATHS[status]) {
    const response = await move(server, h.alice, current, step);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    current = response.body as unknown as CompetitionDetail;
  }
  expect(current.status).toBe(status);
  return current;
}

const count = (sql: string, id: string): number =>
  (h.database.db.raw.prepare(sql).get(id) as { n: number }).n;
const historyRows = (id: string): number =>
  count('SELECT count(*) AS n FROM engagement_status_history WHERE engagement_id = ?', id);
const auditRows = (id: string): number =>
  count('SELECT count(*) AS n FROM audit_log WHERE entity_id = ?', id);

describe('invalid transitions are rejected (§19 AC)', () => {
  const pairs = ENGAGEMENT_STATUSES.flatMap((from) =>
    ENGAGEMENT_STATUSES.map((to) => [from, to] as const),
  );

  it('covers all 49 pairs', () => {
    expect(pairs).toHaveLength(49);
  });

  it.each(pairs)('%s → %s', async (from, to) => {
    const eventId = makeEvent(h);
    const start = await at(from, eventId);
    const history = historyRows(start.id);
    const audit = auditRows(start.id);
    const response = await move(server, h.alice, start, to);
    const after = await getCompetition(server, start.id, h.alice);

    if (ENGAGEMENT_TRANSITIONS[from].includes(to)) {
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(after.status).toBe(to);
      expect(historyRows(start.id)).toBe(history + 1);
      expect(auditRows(start.id)).toBe(audit + 1);
      expect(after.history.at(-1)).toMatchObject({ from, to });
    } else {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ENGAGEMENT_INVALID_TRANSITION');
      expect(response.body.allowed).toEqual([...ENGAGEMENT_TRANSITIONS[from]]);
      expect(String(response.body.detail)).toMatch(/^Can't move from /);
      expect(after.status).toBe(from);
      expect(after.version).toBe(start.version);
      expect(historyRows(start.id)).toBe(history);
      expect(auditRows(start.id)).toBe(audit);
    }
  });

  it('an audit write that fails leaves no status change and no history row', async () => {
    const start = await at('ASSIGNED', makeEvent(h));
    const history = historyRows(start.id);
    vi.spyOn(h.audit, 'append').mockImplementation(() => {
      throw new Error('the audit log is broken');
    });
    const response = await move(server, h.alice, start, 'APPLIED');
    expect(response.status).toBe(500);
    vi.restoreAllMocks();
    const after = await getCompetition(server, start.id, h.alice);
    expect(after.status).toBe('ASSIGNED');
    expect(after.version).toBe(start.version);
    expect(historyRows(start.id)).toBe(history);
  });
});

describe('around the machine', () => {
  it('withdrawing releases the roster; completing keeps it', async () => {
    const withdrawn = await at('WITHDRAWN', makeEvent(h));
    expect(withdrawn.roster).toEqual([]);
    expect(withdrawn.pastRoster[0]?.removalReason).toBe('ENGAGEMENT_CLOSED');
    const completed = await at('COMPLETED', makeEvent(h));
    expect(completed.roster).toHaveLength(1);
  });

  it('a stale version is a 409 in words, and nothing is written', async () => {
    const start = await at('ASSIGNED', makeEvent(h));
    const response = await move(
      server,
      h.alice,
      { ...start, version: start.version + 5 },
      'APPLIED',
    );
    expect(response.status).toBe(409);
    expect(response.body.detail).toBe(
      'Someone else changed this competition — reload to see their changes.',
    );
    expect((await getCompetition(server, start.id, h.alice)).status).toBe('ASSIGNED');
  });

  it('a terminal competition refuses edits to its notes and roster', async () => {
    const done = await at('COMPLETED', makeEvent(h));
    const notes = await call(server, 'PATCH', `/api/v1/competitions/${done.id}`, {
      as: h.alice,
      body: { notes: 'late', version: done.version },
    });
    expect(notes.body.code).toBe('ENGAGEMENT_CLOSED');
    const add = await call(server, 'POST', `/api/v1/competitions/${done.id}/participants`, {
      as: h.alice,
      body: { studentId: freshStudent(h), version: done.version },
    });
    expect(add.body.code).toBe('ENGAGEMENT_CLOSED');
  });

  it('entering ASSIGNED runs the registered hooks inside the transaction (R98)', async () => {
    const seen: string[] = [];
    const hooked = (await import('./wiring.js')).createEngagementsModule({
      db: h.database.db,
      audit: h.audit,
      onAssigned: [(assignedNow) => seen.push(assignedNow.engagementId)],
    });
    const result = hooked.assign.assign(h.context(h.alice), {
      eventId: makeEvent(h),
      studentIds: [freshStudent(h)],
      initialStatus: 'CONSIDERING',
    });
    const id = result.competitions[0]!.id;
    expect(seen).toEqual([]);
    hooked.records.transition(h.context(h.alice), id, { to: 'ASSIGNED', version: 1 });
    expect(seen).toEqual([id]);
  });
});
