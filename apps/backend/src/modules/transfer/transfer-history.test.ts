import type {
  CompetitionDetail,
  TeamDetail,
  TransferPreview,
  TransferResult,
} from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assigned, freshStudent, makeEvent, move, teamWith } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';

/**
 * The §19 acceptance "transfer preserves history; audit complete" (WP-21,
 * R105): a synthetic department — two professors, three teams (one archived,
 * one where *to* is already co-mentor), seven competitions (one per status) and
 * four mentorships — snapshotted before and after one commit. The only
 * differences allowed are the planned closes and opens at one instant.
 */

let h: StudentsHarness;
let server: TestServer;
beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});
afterAll(async () => {
  await server.close();
  h.close();
});

const TABLES: Record<string, string> = {
  team_mentors: 'id',
  engagement_mentors: 'id',
  mentorships: 'id',
  team_members: 'id',
  engagement_participants: "engagement_id || ':' || student_id",
  engagement_status_history: 'id',
  engagement_outcomes: 'engagement_id',
  audit_log: 'id',
};
type Snapshot = Record<string, Map<string, Record<string, unknown>>>;

function snapshot(): Snapshot {
  const out: Snapshot = {};
  for (const [table, key] of Object.entries(TABLES)) {
    const rows = h.database.db.raw.prepare(`SELECT ${key} AS k, * FROM ${table}`).all() as ({
      k: string;
    } & Record<string, unknown>)[];
    out[table] = new Map(rows.map(({ k, ...row }) => [k, row]));
  }
  return out;
}

const ok = async (method: string, path: string, body: unknown, as = h.alice) => {
  const response = await call(server, method, path, { as, body });
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(200);
  return response.body;
};

async function competitionAt(status: string): Promise<string> {
  const paths: Record<string, string[]> = {
    CONSIDERING: [],
    ASSIGNED: [],
    APPLIED: ['APPLIED'],
    PARTICIPATING: ['APPLIED', 'PARTICIPATING'],
    COMPLETED: ['APPLIED', 'PARTICIPATING', 'COMPLETED'],
    WITHDRAWN: ['WITHDRAWN'],
    NOT_SELECTED: ['APPLIED', 'NOT_SELECTED'],
  };
  let current = await assigned(server, h.alice, {
    eventId: makeEvent(h),
    studentIds: [freshStudent(h)],
    initialStatus: status === 'CONSIDERING' ? 'CONSIDERING' : 'ASSIGNED',
  });
  for (const step of paths[status] ?? []) {
    current = (await move(server, h.alice, current, step)).body as unknown as CompetitionDetail;
  }
  return current.id;
}

describe('§19: transfer preserves history; audit complete', () => {
  it('changes only the planned rows, at one instant, and audits every entity', async () => {
    // Three teams, all Alice's: one plain, one where Bob already co-mentors, one archived.
    const plain = await teamWith(server, h, h.alice, 'Transfer Plain');
    const shared = await teamWith(server, h, h.alice, 'Transfer Shared');
    await ok('POST', `/api/v1/teams/${shared.id}/mentors`, {
      userId: h.bob.id,
      version: shared.version,
    });
    const old = await teamWith(server, h, h.alice, 'Transfer Archived');
    await ok('POST', `/api/v1/teams/${old.id}/archive`, { version: old.version });
    // Seven competitions, one per status; the completed one has an outcome.
    const statuses = [
      'CONSIDERING',
      'ASSIGNED',
      'APPLIED',
      'PARTICIPATING',
      'COMPLETED',
      'WITHDRAWN',
      'NOT_SELECTED',
    ];
    const competitions = new Map<string, string>();
    for (const status of statuses) competitions.set(status, await competitionAt(status));
    await ok('PUT', `/api/v1/competitions/${competitions.get('COMPLETED')!}/outcome`, {
      result: 'WINNER',
    });
    // Four mentorships of Alice's; Bob already mentors the last student.
    const mentees = [freshStudent(h), freshStudent(h), freshStudent(h), freshStudent(h)];
    for (const id of mentees) await ok('POST', `/api/v1/students/${id}/mentorships`, {});
    await ok('POST', `/api/v1/students/${mentees[3]!}/mentorships`, {}, h.bob);

    const preview = (await ok(
      'POST',
      '/api/v1/admin/ownership-transfer/preview',
      {
        fromUserId: h.alice.id,
        toUserId: h.bob.id,
      },
      h.admin,
    )) as unknown as TransferPreview;
    expect(preview.teams.map((item) => item.name)).toEqual(['Transfer Plain', 'Transfer Shared']);
    expect(preview.competitions).toHaveLength(4);
    expect(preview.mentorships).toHaveLength(4);
    expect(preview.staysWith.map((item) => item.kind).sort()).toEqual([
      'COMPETITION',
      'COMPETITION',
      'COMPETITION',
      'TEAM',
    ]);

    h.clock.advance(60_000);
    const at = h.clock.now().getTime();
    const before = snapshot();
    const result = (await ok(
      'POST',
      '/api/v1/admin/ownership-transfer/commit',
      {
        fromUserId: h.alice.id,
        toUserId: h.bob.id,
        previewToken: preview.previewToken,
      },
      h.admin,
    )) as unknown as TransferResult;
    expect(result).toEqual({ teams: 2, competitions: 4, mentorships: 4, auditRows: 11 });
    const after = snapshot();

    // History, rosters and outcomes: identical.
    for (const table of [
      'team_members',
      'engagement_participants',
      'engagement_status_history',
      'engagement_outcomes',
    ]) {
      expect([...after[table]!.entries()], table).toEqual([...before[table]!.entries()]);
    }

    const open = new Set(
      ['CONSIDERING', 'ASSIGNED', 'APPLIED', 'PARTICIPATING'].map((s) => competitions.get(s)!),
    );
    const activeTeams = new Set([plain.id, shared.id]);
    // Which old rows should have closed, worked out from the "before" snapshot.
    const shouldClose = (table: string, row: Record<string, unknown>): boolean => {
      if (table === 'mentorships')
        return row.mentor_user_id === h.alice.id && row.ended_at === null;
      const parent = String(table === 'team_mentors' ? row.team_id : row.engagement_id);
      const eligible = table === 'team_mentors' ? activeTeams.has(parent) : open.has(parent);
      if (!eligible || row.to_at !== null) return false;
      // Alice's row, and Bob's co-mentor row on the shared team (R105's collision).
      return row.user_id === h.alice.id || (parent === shared.id && row.user_id === h.bob.id);
    };
    for (const table of ['team_mentors', 'engagement_mentors', 'mentorships']) {
      const end = table === 'mentorships' ? 'ended_at' : 'to_at';
      const start = table === 'mentorships' ? 'started_at' : 'from_at';
      for (const [id, row] of before[table]!) {
        const now = after[table]!.get(id);
        if (shouldClose(table, row)) expect(now, `${table} ${id}`).toEqual({ ...row, [end]: at });
        else expect(now, `${table} ${id}`).toEqual(row);
      }
      const added = [...after[table]!]
        .filter(([id]) => !before[table]!.has(id))
        .map(([, row]) => row);
      for (const row of added) {
        expect(row[start], table).toBe(at);
        expect(row[end], table).toBeNull();
        expect(table === 'mentorships' ? row.mentor_user_id : row.user_id).toBe(h.bob.id);
      }
      const expected = { team_mentors: 2, engagement_mentors: 4, mentorships: 3 }[table];
      expect(added, table).toHaveLength(expected!);
      if (table !== 'mentorships') expect(added.every((row) => row.role === 'PRIMARY')).toBe(true);
    }

    // One PRIMARY active per team and competition.
    const doubles = h.database.db.raw
      .prepare(
        `SELECT 'team' AS kind, team_id AS id FROM team_mentors WHERE to_at IS NULL AND role = 'PRIMARY'
           GROUP BY team_id HAVING count(*) <> 1
         UNION ALL
         SELECT 'competition', engagement_id FROM engagement_mentors WHERE to_at IS NULL AND role = 'PRIMARY'
           GROUP BY engagement_id HAVING count(*) <> 1`,
      )
      .all();
    expect(doubles).toEqual([]);

    // Audit: exactly entities + 1 new rows, the right entities, one request id, an intact chain.
    const newAudit = [...after.audit_log!]
      .filter(([id]) => !before.audit_log!.has(id))
      .map(([, row]) => row);
    expect(newAudit).toHaveLength(11);
    expect(new Set(newAudit.map((row) => row.request_id)).size).toBe(1);
    const entities = newAudit
      .map((row) => `${String(row.entity_kind)}:${String(row.entity_id)}`)
      .sort();
    expect(entities).toEqual(
      [
        `team:${plain.id}`,
        `team:${shared.id}`,
        ...[...open].map((id) => `competition:${id}`),
        ...mentees.map((id) => `student:${id}`),
        `user:${h.alice.id}`,
      ].sort(),
    );
    for (const [id, row] of before.audit_log!) expect(after.audit_log!.get(id)).toEqual(row);
    expect(h.audit.verifyChain().ok).toBe(true);

    // Every touched parent's version moved, so an edit in flight gets its own 409.
    const team = (await call(server, 'GET', `/api/v1/teams/${plain.id}`, { as: h.admin }))
      .body as unknown as TeamDetail;
    expect(team.version).toBeGreaterThan(plain.version);
  });
});
