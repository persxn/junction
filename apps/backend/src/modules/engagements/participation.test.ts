import type {
  AssignPreview,
  CompetitionDetail,
  StudentDetail,
  TeamDetail,
} from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assign,
  assigned,
  freshStudent,
  getCompetition,
  makeEvent,
  move,
  teamWith,
} from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { getTeam } from '../../testing/teams.js';

/**
 * The §19 AC "one active participation per student per event" (A14, R97), and
 * the rest of the assign flow (R96, R98): one team per event, the frozen roster
 * and mentors, the empty roster, several students at once, a merged event,
 * who may assign, and the team and student pages.
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

const count = (sql: string): number => (h.database.db.raw.prepare(sql).get() as { n: number }).n;
const competitions = (): number => count('SELECT count(*) AS n FROM engagements');

describe('one active participation per student per event (§19 AC)', () => {
  it('refuses a team, an individual and a roster add while the student is active elsewhere', async () => {
    const event = makeEvent(h, { title: 'HackXYZ 2026' });
    const kavya = freshStudent(h);
    const rocket = await teamWith(server, h, h.alice, 'Team Rocket', [kavya, freshStudent(h)]);
    const first = await assigned(server, h.alice, { eventId: event, teamId: rocket.id });
    const before = competitions();

    const other = await teamWith(server, h, h.alice, 'Team Comet', [kavya, freshStudent(h)]);
    const team = await assign(server, h.alice, { eventId: event, teamId: other.id });
    expect(team.status).toBe(409);
    expect(team.body.code).toBe('ENGAGEMENT_STUDENT_ALREADY_ACTIVE');
    expect(String(team.body.detail)).toContain(
      'already in Team Rocket — HackXYZ 2026 for this event',
    );
    expect(team.body.related).toEqual([{ id: first.id, name: 'Team Rocket — HackXYZ 2026' }]);

    const alone = await assign(server, h.alice, { eventId: event, studentIds: [kavya] });
    expect(alone.body.code).toBe('ENGAGEMENT_STUDENT_ALREADY_ACTIVE');

    const solo = await assigned(server, h.alice, { eventId: event, studentIds: [freshStudent(h)] });
    const add = await call(server, 'POST', `/api/v1/competitions/${solo.id}/participants`, {
      as: h.alice,
      body: { studentId: kavya, version: solo.version },
    });
    expect(add.body.code).toBe('ENGAGEMENT_STUDENT_ALREADY_ACTIVE');
    // Nothing written by any of the three refusals.
    expect(competitions()).toBe(before + 1);
  });

  it('frees the student once the other competition is WITHDRAWN, not once it is COMPLETED', async () => {
    const kavya = freshStudent(h);
    const done = makeEvent(h);
    const finished = await assigned(server, h.alice, { eventId: done, studentIds: [kavya] });
    let current = finished;
    for (const to of ['APPLIED', 'PARTICIPATING', 'COMPLETED']) {
      current = (await move(server, h.alice, current, to)).body as unknown as CompetitionDetail;
    }
    const again = await assign(server, h.alice, { eventId: done, studentIds: [kavya] });
    expect(again.body.code).toBe('ENGAGEMENT_STUDENT_ALREADY_ACTIVE');

    const open = makeEvent(h);
    const withdrawn = await assigned(server, h.alice, { eventId: open, studentIds: [kavya] });
    expect((await move(server, h.alice, withdrawn, 'WITHDRAWN')).status).toBe(200);
    expect((await assign(server, h.alice, { eventId: open, studentIds: [kavya] })).status).toBe(
      200,
    );
  });

  it('a raw insert that bypasses the service hits the index', async () => {
    const event = makeEvent(h);
    const kavya = freshStudent(h);
    const first = await assigned(server, h.alice, { eventId: event, studentIds: [kavya] });
    const second = await assigned(server, h.alice, {
      eventId: event,
      studentIds: [freshStudent(h)],
    });
    expect(() =>
      h.database.db.raw
        .prepare(
          `INSERT INTO engagement_participants (engagement_id, student_id, event_id, added_at)
           VALUES (?, ?, ?, 0)`,
        )
        .run(second.id, kavya, event),
    ).toThrow(/UNIQUE/);
    expect(first.roster).toHaveLength(1);
  });
});

describe('the assign flow (R96, R98)', () => {
  it('one team per event while open, again after WITHDRAWN', async () => {
    const event = makeEvent(h);
    const team = await teamWith(server, h, h.alice, 'Alpha');
    const first = await assigned(server, h.alice, { eventId: event, teamId: team.id });
    const again = await assign(server, h.alice, { eventId: event, teamId: team.id });
    expect(again.body.code).toBe('ENGAGEMENT_TEAM_ALREADY_ASSIGNED');
    await move(server, h.alice, first, 'WITHDRAWN');
    expect((await assign(server, h.alice, { eventId: event, teamId: team.id })).status).toBe(200);
  });

  it('freezes roster and mentors at assignment; explicit edits change them', async () => {
    const [a, b] = [freshStudent(h), freshStudent(h)];
    const team = await teamWith(server, h, h.alice, 'Frozen', [a, b]);
    const competition = await assigned(server, h.alice, { eventId: makeEvent(h), teamId: team.id });
    expect(competition.roster.map((p) => p.studentId).sort()).toEqual([a, b].sort());
    expect(competition.mentors.map((m) => [m.userId, m.role])).toEqual([[h.alice.id, 'PRIMARY']]);

    // The team changes; the competition does not.
    const joined = await call(server, 'POST', `/api/v1/teams/${team.id}/members`, {
      as: h.alice,
      body: { studentId: freshStudent(h), version: team.version },
    });
    expect(joined.status).toBe(200);
    expect((await getCompetition(server, competition.id, h.alice)).roster).toHaveLength(2);

    // Explicit edits do.
    const removed = await call(
      server,
      'POST',
      `/api/v1/competitions/${competition.id}/participants/${a}/remove`,
      { as: h.alice, body: { version: competition.version } },
    );
    const afterRemove = removed.body as unknown as CompetitionDetail;
    expect(afterRemove.roster.map((p) => p.studentId)).toEqual([b]);
    expect(afterRemove.pastRoster[0]).toMatchObject({ studentId: a, removalReason: 'REMOVED' });
    const mentor = await call(server, 'POST', `/api/v1/competitions/${competition.id}/mentors`, {
      as: h.alice,
      body: { userId: h.bob.id, version: afterRemove.version },
    });
    expect((mentor.body as unknown as CompetitionDetail).mentors.map((m) => m.role)).toEqual([
      'PRIMARY',
      'CO_MENTOR',
    ]);
  });

  it('a team whose members are all inactive is an empty roster', async () => {
    const kavya = freshStudent(h);
    const team = await teamWith(server, h, h.alice, 'Ghosts', [kavya]);
    const student = h.module.records.get(h.context(h.alice), kavya);
    h.module.lifecycle.deactivate(h.context(h.admin), kavya, { version: student.version });
    const preview = (
      await call(server, 'POST', '/api/v1/competitions/assign/preview', {
        as: h.alice,
        body: { eventId: makeEvent(h), teamId: team.id },
      })
    ).body as unknown as AssignPreview;
    expect(preview.canAssign).toBe(false);
    expect(preview.leftOut.map((entry) => entry.studentId)).toEqual([kavya]);
    const refused = await assign(server, h.alice, { eventId: makeEvent(h), teamId: team.id });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('ENGAGEMENT_EMPTY_ROSTER');
  });

  it('several students make that many individual competitions, in one transaction', async () => {
    const event = makeEvent(h);
    const ids = [freshStudent(h), freshStudent(h), freshStudent(h)];
    const response = await assign(server, h.alice, { eventId: event, studentIds: ids });
    const made = response.body.competitions as {
      kind: string;
      primaryMentor: { userId: string };
    }[];
    expect(made).toHaveLength(3);
    expect(
      made.every((c) => c.kind === 'INDIVIDUAL' && c.primaryMentor.userId === h.alice.id),
    ).toBe(true);

    // One clash → none of the batch is written.
    const before = competitions();
    const clash = await assign(server, h.alice, {
      eventId: event,
      studentIds: [freshStudent(h), ids[0]],
    });
    expect(clash.status).toBe(409);
    expect(competitions()).toBe(before);
  });

  it('warns without blocking, and refuses a merged event naming the survivor', async () => {
    const soon = makeEvent(h, {
      registrationDeadlineAt: h.clock.now().getTime() + 86_400_000,
      teamMin: 3,
      cancellation: 'POSTPONED',
    });
    const team = await teamWith(server, h, h.alice, 'Warned');
    const preview = (
      await call(server, 'POST', '/api/v1/competitions/assign/preview', {
        as: h.alice,
        body: { eventId: soon, teamId: team.id },
      })
    ).body as unknown as AssignPreview;
    expect(preview.warnings.map((w) => w.code)).toEqual([
      'REGISTRATION_CLOSING',
      'EVENT_POSTPONED',
      'TEAM_TOO_SMALL',
    ]);
    expect(preview.canAssign).toBe(true);

    const survivor = makeEvent(h, { title: 'The Real One' });
    const merged = makeEvent(h, { mergedInto: survivor });
    const refused = await assign(server, h.alice, { eventId: merged, teamId: team.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ENGAGEMENT_EVENT_MERGED');
    expect(refused.body.related).toEqual([{ id: survivor, name: 'The Real One' }]);
  });
});

describe('who may do what (R96)', () => {
  it('a team is assigned by its mentors; the competition is edited by its own', async () => {
    const team = await teamWith(server, h, h.alice, 'Owned');
    const event = makeEvent(h);
    const stranger = await assign(server, h.bob, { eventId: event, teamId: team.id });
    expect(stranger.status).toBe(403);
    const competition = await assigned(server, h.alice, { eventId: event, teamId: team.id });
    expect((await move(server, h.bob, competition, 'APPLIED')).status).toBe(403);
    expect((await getCompetition(server, competition.id, h.bob)).can.edit).toBe(false);
    // Any professor may assign students, and becomes the primary.
    const solo = await assigned(server, h.bob, { eventId: event, studentIds: [freshStudent(h)] });
    expect(solo.mentors[0]).toMatchObject({ userId: h.bob.id, role: 'PRIMARY' });
    // Only an administrator names someone else.
    const named = await assign(server, h.bob, {
      eventId: event,
      studentIds: [freshStudent(h)],
      primaryUserId: h.alice.id,
    });
    expect(named.status).toBe(403);
    expect((await move(server, h.admin, competition, 'APPLIED')).status).toBe(200);
  });

  it('a co-mentor edits the status but cannot change the mentors', async () => {
    const competition = await assigned(server, h.alice, {
      eventId: makeEvent(h),
      studentIds: [freshStudent(h)],
    });
    const withBob = (
      await call(server, 'POST', `/api/v1/competitions/${competition.id}/mentors`, {
        as: h.alice,
        body: { userId: h.bob.id, version: competition.version },
      })
    ).body as unknown as CompetitionDetail;
    expect((await move(server, h.bob, withBob, 'APPLIED')).status).toBe(200);
    const after = await getCompetition(server, competition.id, h.bob);
    const transfer = await call(
      server,
      'POST',
      `/api/v1/competitions/${competition.id}/transfer-primary`,
      { as: h.bob, body: { toUserId: h.bob.id, stepAway: true, version: after.version } },
    );
    expect(transfer.status).toBe(403);
  });
});

describe('the team and student pages (WP-18 extended)', () => {
  it('list the competitions, and a team with an open one cannot be archived', async () => {
    const kavya = freshStudent(h);
    const team = await teamWith(server, h, h.alice, 'Busy', [kavya]);
    const competition = await assigned(server, h.alice, {
      eventId: makeEvent(h, { title: 'Open Hack' }),
      teamId: team.id,
    });
    const page = await getTeam(server, team.id, h.alice);
    expect(page.competitions).toEqual([
      expect.objectContaining({ id: competition.id, eventTitle: 'Open Hack', status: 'ASSIGNED' }),
    ]);
    const student = (await call(server, 'GET', `/api/v1/students/${kavya}`, { as: h.alice }))
      .body as unknown as StudentDetail;
    expect(student.competitions).toEqual([
      expect.objectContaining({ id: competition.id, teamName: 'Busy', onRoster: true }),
    ]);

    const archive = await call(server, 'POST', `/api/v1/teams/${team.id}/archive`, {
      as: h.alice,
      body: { version: page.version },
    });
    expect(archive.status).toBe(409);
    expect(archive.body.code).toBe('TEAM_HAS_ACTIVE_COMPETITIONS');
    expect(String(archive.body.detail)).toContain('Busy — Open Hack');

    await move(server, h.alice, competition, 'WITHDRAWN');
    const later = (
      await call(server, 'POST', `/api/v1/teams/${team.id}/archive`, {
        as: h.alice,
        body: { version: page.version },
      })
    ).body as unknown as TeamDetail;
    expect(later.status).toBe('ARCHIVED');
  });
});
