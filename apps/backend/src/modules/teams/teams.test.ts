import type { StudentDetail, TeamDetail } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Principal } from '../auth/types.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { createTeam, getTeam, makeTeamStudent } from '../../testing/teams.js';

/**
 * WP-18 over HTTP: the §19 AC "student in three teams", R95's lifecycle,
 * the permission rows as real 403s, and the transfer.
 */

let h: StudentsHarness;
let server: TestServer;
beforeEach(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});
afterEach(async () => {
  await server.close();
  h.close();
});

const student = (n: number, skills: [string, 1 | 2 | 3 | null][] = []): string =>
  makeTeamStudent(h, n, skills);
const team = (as: Principal, body: Record<string, unknown>): Promise<TeamDetail> =>
  createTeam(server, as, body);
const get = (id: string, as: Principal = h.alice): Promise<TeamDetail> => getTeam(server, id, as);

describe('student in three teams (§19 AC)', () => {
  it('joins three teams with a role in each, counts in each, and leaving keeps the row', async () => {
    const kavya = student(1, [['Python', 2]]);
    const [a, b, c] = [
      await team(h.alice, {
        name: 'Alpha',
        members: [{ studentId: kavya, roleLabel: 'Backend', isLead: true }],
      }),
      await team(h.alice, { name: 'Beta', members: [{ studentId: kavya, roleLabel: 'Frontend' }] }),
      await team(h.bob, {
        name: 'Gamma',
        members: [{ studentId: kavya, roleLabel: 'Pitch' }],
        targets: ['Python'],
      }),
    ];
    for (const t of [a, b, c]) expect(t.members.map((m) => m.studentId)).toEqual([kavya]);
    expect(a.members[0]).toMatchObject({ roleLabel: 'Backend', isLead: true });
    expect(c.coverage.chips).toEqual([
      { name: 'Python', state: 'COVERED', holders: 1, isTarget: true },
    ]);

    const detail = (await call(server, 'GET', `/api/v1/students/${kavya}`, { as: h.bob }))
      .body as unknown as StudentDetail;
    expect(detail.teams.map((t) => [t.teamName, t.roleLabel, t.isLead])).toEqual([
      ['Alpha', 'Backend', true],
      ['Beta', 'Frontend', false],
      ['Gamma', 'Pitch', false],
    ]);
    // §10.2: the mentors of all three may deactivate.
    expect(h.module.records.get(h.context(h.bob), kavya).canDeactivate).toBe(true);

    const left = await call(
      server,
      'POST',
      `/api/v1/teams/${b.id}/members/${b.members[0]!.id}/leave`,
      {
        as: h.alice,
        body: { version: b.version },
      },
    );
    expect(left.status).toBe(200);
    const beta = left.body as unknown as TeamDetail;
    expect(beta.members).toEqual([]);
    expect(beta.pastMembers).toHaveLength(1);
    const after = h.module.records.get(h.context(h.alice), kavya).teams;
    expect(after.filter((t) => t.leftAt === null)).toHaveLength(2);
    expect(after.filter((t) => t.leftAt !== null).map((t) => t.teamName)).toEqual(['Beta']);
    // R92: the team audit names students as "student 01a0…", never by name.
    const named = h.database.db.raw
      .prepare(
        "SELECT count(*) AS n FROM audit_log WHERE entity_kind = 'team' AND (summary LIKE '%Team Student%' OR diff_json LIKE '%Team Student%')",
      )
      .get() as { n: number };
    expect(named.n).toBe(0);
  });

  it('a mentor of an archived team loses the deactivate right; the others keep it', async () => {
    const kavya = student(2);
    const carol = h.user('Carol Professor', ['PROFESSOR']);
    await team(h.alice, { name: 'Alpha', members: [{ studentId: kavya }] });
    const delta = await team(h.admin, {
      name: 'Delta',
      primaryUserId: carol.id,
      members: [{ studentId: kavya }],
    });
    expect(h.module.records.get(h.context(carol), kavya).canDeactivate).toBe(true);
    await call(server, 'POST', `/api/v1/teams/${delta.id}/archive`, {
      as: h.admin,
      body: { version: delta.version },
    });
    expect(h.module.records.get(h.context(carol), kavya).canDeactivate).toBe(false);
    expect(h.module.records.get(h.context(h.alice), kavya).canDeactivate).toBe(true);
  });
});

describe('R95 lifecycle', () => {
  it('names are unique among active teams, case-insensitively, and free again once archived', async () => {
    const first = await team(h.alice, { name: 'Byte Busters' });
    const clash = await call(server, 'POST', '/api/v1/teams', {
      as: h.bob,
      body: { name: '  byte  busters ' },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('TEAM_NAME_TAKEN');
    await call(server, 'POST', `/api/v1/teams/${first.id}/archive`, {
      as: h.alice,
      body: { version: first.version },
    });
    const second = await team(h.bob, { name: 'byte busters' });
    const unarchive = await call(server, 'POST', `/api/v1/teams/${first.id}/unarchive`, {
      as: h.alice,
      body: { version: first.version + 1 },
    });
    expect(unarchive.status).toBe(409);
    expect(unarchive.body.code).toBe('TEAM_NAME_TAKEN');
    expect(second.status).toBe('ACTIVE');
  });

  it('an archived team refuses every write with TEAM_ARCHIVED', async () => {
    const t = await team(h.alice, { name: 'Frozen' });
    const archived = (
      await call(server, 'POST', `/api/v1/teams/${t.id}/archive`, {
        as: h.alice,
        body: { version: 1 },
      })
    ).body as unknown as TeamDetail;
    const v = archived.version;
    const writes: [string, string, Record<string, unknown>][] = [
      ['PATCH', `/api/v1/teams/${t.id}`, { name: 'Thawed', version: v }],
      ['POST', `/api/v1/teams/${t.id}/members`, { studentId: student(3), version: v }],
      ['POST', `/api/v1/teams/${t.id}/mentors`, { userId: h.bob.id, version: v }],
      [
        'POST',
        `/api/v1/teams/${t.id}/transfer-primary`,
        { toUserId: h.bob.id, stepAway: true, version: v },
      ],
      ['POST', `/api/v1/teams/${t.id}/archive`, { version: v }],
    ];
    for (const [method, route, body] of writes) {
      const response = await call(server, method, route, { as: h.alice, body });
      expect(response.body.code, route).toBe('TEAM_ARCHIVED');
    }
  });

  it('only active students join; rejoining opens a new row; one lead at a time', async () => {
    const one = student(4);
    const two = student(5);
    const inactive = student(6);
    const row = h.module.records.get(h.context(h.alice), inactive);
    h.module.lifecycle.deactivate(h.context(h.admin), inactive, { version: row.version });
    let t = await team(h.alice, {
      name: 'Leads',
      members: [{ studentId: one, isLead: true }, { studentId: two }],
    });
    const refused = await call(server, 'POST', `/api/v1/teams/${t.id}/members`, {
      as: h.alice,
      body: { studentId: inactive, version: t.version },
    });
    expect(refused.body.code).toBe('TEAM_STUDENT_NOT_ACTIVE');

    const second = t.members.find((m) => m.studentId === two)!;
    t = (
      await call(server, 'PATCH', `/api/v1/teams/${t.id}/members/${second.id}`, {
        as: h.alice,
        body: { isLead: true, version: t.version },
      })
    ).body as unknown as TeamDetail;
    expect(t.members.filter((m) => m.isLead).map((m) => m.studentId)).toEqual([two]);

    t = (
      await call(server, 'POST', `/api/v1/teams/${t.id}/members/${second.id}/leave`, {
        as: h.alice,
        body: { version: t.version },
      })
    ).body as unknown as TeamDetail;
    t = (
      await call(server, 'POST', `/api/v1/teams/${t.id}/members`, {
        as: h.alice,
        body: { studentId: two, version: t.version },
      })
    ).body as unknown as TeamDetail;
    expect(t.members.some((m) => m.studentId === two)).toBe(true);
    expect(t.pastMembers.some((m) => m.studentId === two)).toBe(true);
  });

  it('a stale version is a 409 in words, and nothing is written', async () => {
    const t = await team(h.alice, { name: 'Stale' });
    await call(server, 'PATCH', `/api/v1/teams/${t.id}`, {
      as: h.alice,
      body: { description: 'x', version: 1 },
    });
    const stale = await call(server, 'PATCH', `/api/v1/teams/${t.id}`, {
      as: h.alice,
      body: { name: 'Lost', version: 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.detail).toBe('Someone else changed this team — reload to see their changes.');
    expect((await get(t.id)).name).toBe('Stale');
  });

  it('every partial index refuses a raw insert that bypasses the service', async () => {
    const s = student(7);
    const t = await team(h.alice, { name: 'Raw', members: [{ studentId: s, isLead: true }] });
    const raw = h.database.db.raw;
    const at = Date.now();
    expect(() =>
      raw
        .prepare(
          "INSERT INTO teams (id, department_id, name, name_key, status, created_at, updated_at) VALUES ('x1', ?, 'RAW', 'raw', 'ACTIVE', ?, ?)",
        )
        .run(h.departmentId, at, at),
    ).toThrow(/UNIQUE/);
    expect(() =>
      raw
        .prepare(
          "INSERT INTO team_members (id, team_id, student_id, joined_at) VALUES ('x2', ?, ?, ?)",
        )
        .run(t.id, s, at),
    ).toThrow(/UNIQUE/);
    const other = student(8);
    expect(() =>
      raw
        .prepare(
          "INSERT INTO team_members (id, team_id, student_id, is_lead, joined_at) VALUES ('x3', ?, ?, 1, ?)",
        )
        .run(t.id, other, at),
    ).toThrow(/UNIQUE/);
    expect(() =>
      raw
        .prepare(
          "INSERT INTO team_mentors (id, team_id, user_id, role, from_at) VALUES ('x4', ?, ?, 'PRIMARY', ?)",
        )
        .run(t.id, h.bob.id, at),
    ).toThrow(/UNIQUE/);
    expect(() =>
      raw
        .prepare(
          "INSERT INTO team_mentors (id, team_id, user_id, role, from_at) VALUES ('x5', ?, ?, 'CO_MENTOR', ?)",
        )
        .run(t.id, h.alice.id, at),
    ).toThrow(/UNIQUE/);
  });
});

describe('who may do what (§10.2)', () => {
  it('a co-mentor edits members but cannot add mentors, archive or transfer; a stranger only views and creates', async () => {
    const carol = h.user('Carol Professor', ['PROFESSOR']);
    await server.close();
    server = await (
      await import('../../testing/harness.js')
    ).startTestServer({
      auth: (await import('../../testing/students.js')).principalAuth([
        h.admin,
        h.alice,
        h.bob,
        carol,
      ]),
      students: () => h.module,
      teams: () => h.teams,
    });
    let t = await team(h.alice, { name: 'Perms' });
    t = (
      await call(server, 'POST', `/api/v1/teams/${t.id}/mentors`, {
        as: h.alice,
        body: { userId: h.bob.id, version: t.version },
      })
    ).body as unknown as TeamDetail;
    const added = await call(server, 'POST', `/api/v1/teams/${t.id}/members`, {
      as: h.bob,
      body: { studentId: student(9), version: t.version },
    });
    expect(added.status).toBe(200);
    const v = (added.body as unknown as TeamDetail).version;
    for (const [route, body] of [
      ['mentors', { userId: carol.id, version: v }],
      ['archive', { version: v }],
      ['transfer-primary', { toUserId: h.bob.id, stepAway: false, version: v }],
    ] as const) {
      expect(
        (await call(server, 'POST', `/api/v1/teams/${t.id}/${route}`, { as: h.bob, body })).status,
        route,
      ).toBe(403);
    }
    expect(
      (
        await call(server, 'PATCH', `/api/v1/teams/${t.id}`, {
          as: carol,
          body: { description: 'x', version: v },
        })
      ).status,
    ).toBe(403);
    expect((await call(server, 'GET', `/api/v1/teams/${t.id}`, { as: carol })).status).toBe(200);
    expect(
      (await call(server, 'POST', '/api/v1/teams', { as: carol, body: { name: 'Carol’s' } }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(server, 'POST', `/api/v1/teams/${t.id}/archive`, {
          as: h.admin,
          body: { version: v },
        })
      ).status,
    ).toBe(200);
  });

  it('only an administrator names someone else as the primary', async () => {
    const response = await call(server, 'POST', '/api/v1/teams', {
      as: h.alice,
      body: { name: 'Mine', primaryUserId: h.bob.id },
    });
    expect(response.status).toBe(403);
    const admin = await team(h.admin, { name: 'Theirs', primaryUserId: h.bob.id });
    expect(admin.mentors).toMatchObject([{ userId: h.bob.id, role: 'PRIMARY' }]);
    // An administrator without the Professor role cannot be the primary.
    expect(
      (await call(server, 'POST', '/api/v1/teams', { as: h.admin, body: { name: 'Nobody' } })).body
        .code,
    ).toBe('TEAM_MENTOR_NOT_PROFESSOR');
  });
});
