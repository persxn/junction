import type { CompetitionDetail, StudentHistory } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { outcomeState } from '../../domain/outcomes/visibility.js';
import { assigned, freshStudent, makeEvent, move, teamWith } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';

/**
 * A student's history over HTTP (WP-21, R104): newest first, ties settled,
 * a result shown only to those on the roster when it was recorded, an erased
 * student's competitions and teams kept without achievements, and a student
 * in three teams with all three periods.
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

const historyOf = async (id: string): Promise<StudentHistory> => {
  const response = await call(server, 'GET', `/api/v1/students/${id}/history`, { as: h.bob });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown as StudentHistory;
};

async function walk(competition: CompetitionDetail, steps: string[]): Promise<CompetitionDetail> {
  let current = competition;
  for (const step of steps) {
    current = (await move(server, h.alice, current, step)).body as unknown as CompetitionDetail;
  }
  return current;
}

describe('R104: whose result it is', () => {
  it('on the roster when recorded → shown; removed before → "Left before the result"', () => {
    expect(outcomeState(10, null, 20)).toBe('SHOWN');
    expect(outcomeState(10, 30, 20)).toBe('SHOWN');
    expect(outcomeState(10, 15, 20)).toBe('LEFT_BEFORE_RESULT');
    expect(outcomeState(10, null, null)).toBe('NONE');
  });

  it('over HTTP: the one who left sees no result, the one who stayed sees it', async () => {
    const [stayed, left] = [freshStudent(h), freshStudent(h)];
    const team = await teamWith(server, h, h.alice, 'History Team', [stayed, left]);
    let competition = await assigned(server, h.alice, { eventId: makeEvent(h), teamId: team.id });
    competition = await walk(competition, ['APPLIED', 'PARTICIPATING']);
    h.clock.advance(60_000);
    const removed = await call(
      server,
      'POST',
      `/api/v1/competitions/${competition.id}/participants/${left}/remove`,
      { as: h.alice, body: { version: competition.version } },
    );
    expect(removed.status).toBe(200);
    h.clock.advance(60_000);
    const recorded = await call(server, 'PUT', `/api/v1/competitions/${competition.id}/outcome`, {
      as: h.alice,
      body: { result: 'RUNNER_UP', rank: 2, prizeMinor: 100_000, prizeCurrency: 'INR' },
    });
    expect(recorded.status).toBe(200);
    expect((await historyOf(stayed)).competitions[0]).toMatchObject({
      teamName: 'History Team',
      status: 'COMPLETED',
      outcomeState: 'SHOWN',
      outcome: { result: 'RUNNER_UP', rank: 2, prizeMinor: 100_000, prizeCurrency: 'INR' },
    });
    expect((await historyOf(left)).competitions[0]).toMatchObject({
      outcomeState: 'LEFT_BEFORE_RESULT',
      outcome: null,
    });
  });
});

describe('order and shape', () => {
  it('newest first, a tie settled by the later competition; an individual has no team', async () => {
    const student = freshStudent(h);
    const first = await assigned(server, h.alice, { eventId: makeEvent(h), studentIds: [student] });
    const second = await assigned(server, h.alice, {
      eventId: makeEvent(h),
      studentIds: [student],
    });
    h.clock.advance(1_000);
    const third = await assigned(server, h.alice, { eventId: makeEvent(h), studentIds: [student] });
    const history = await historyOf(student);
    expect(history.competitions.map((c) => c.competitionId)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(history.competitions[0]).toMatchObject({ teamName: null, outcomeState: 'NONE' });
  });

  it('a student in three teams lists all three periods, newest first', async () => {
    const student = freshStudent(h);
    const names = ['Three A', 'Three B', 'Three C'];
    for (const name of names) {
      await teamWith(server, h, h.alice, name, [student, freshStudent(h)]);
      h.clock.advance(1_000);
    }
    const history = await historyOf(student);
    expect(history.teams.map((t) => t.teamName)).toEqual(['Three C', 'Three B', 'Three A']);
    expect(history.teams.every((t) => t.leftAt === null)).toBe(true);
  });

  it('achievements newest year first, undated last', async () => {
    const student = freshStudent(h);
    for (const [title, year] of [
      ['Undated', null],
      ['Old', 2023],
      ['New', 2025],
    ] as const) {
      h.module.relations.addAchievement(h.context(h.alice), student, { title, year });
    }
    expect((await historyOf(student)).achievements.map((a) => a.title)).toEqual([
      'New',
      'Old',
      'Undated',
    ]);
  });

  it('an erased student keeps competitions and teams, and has no achievements', async () => {
    const created = h.module.records.create(h.context(h.alice), {
      universityId: 'ERASE0001',
      fullName: 'Synthetic Erasable',
      program: 'BTECH',
      mentorMe: false,
    });
    await teamWith(server, h, h.alice, 'Erasure Team', [created.id, freshStudent(h)]);
    await assigned(server, h.alice, { eventId: makeEvent(h), studentIds: [created.id] });
    h.module.relations.addAchievement(h.context(h.alice), created.id, { title: 'A prize' });
    h.module.lifecycle.erase(h.context(h.admin), created.id, { universityId: 'ERASE0001' });
    const history = await historyOf(created.id);
    expect(history.erased).toBe(true);
    expect(history.competitions).toHaveLength(1);
    expect(history.teams).toHaveLength(1);
    expect(history.achievements).toEqual([]);
    expect(JSON.stringify(history)).not.toContain('Synthetic Erasable');
  });
});
