import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assigned, freshStudent, makeEvent, move } from '../testing/competitions.js';
import type { TestServer } from '../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../testing/students.js';
import { ok, withWorkflow, write } from '../testing/workflows.js';
import { uuid7 } from '../platform/ids.js';
import type { CompetitionDetail } from '@compintel/contracts';

/**
 * Migration 0029's `v_deadlines` (WP-22, R106): it exists after migrate, holds
 * exactly the rows R106 names — no completed or skipped stage, no done task,
 * no hidden-by-merge or cancelled event, no Considering competition — and no
 * deadline twice when an event has both the column and a row of that kind.
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

const rows = (eventId: string) =>
  h.database.db.raw
    .prepare(
      'SELECT id, item_kind AS kind, label, deadline_kind AS deadlineKind FROM v_deadlines WHERE event_id = ? ORDER BY id',
    )
    .all(eventId) as { id: string; kind: string; label: string; deadlineKind: string | null }[];

function addDeadline(eventId: string, kind: string, label: string): void {
  h.database.db.raw
    .prepare(
      `INSERT INTO event_deadlines (id, event_id, kind, label, due_at, precision, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'DATE', 'SOURCE', 0, 0)`,
    )
    .run(uuid7(), eventId, kind, label, h.clock.now().getTime() + 86_400_000 * 5);
}

const eventOfCompetition = (competitionId: string): string =>
  (
    h.database.db.raw
      .prepare('SELECT event_id AS e FROM engagements WHERE id = ?')
      .get(competitionId) as { e: string }
  ).e;

const save = (eventId: string): void => {
  h.database.db.raw
    .prepare('INSERT INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, 0)')
    .run(h.alice.id, eventId);
};

describe('v_deadlines (migration 0029)', () => {
  it('is a view after migrate', () => {
    const view = h.database.db.raw
      .prepare("SELECT type FROM sqlite_master WHERE name = 'v_deadlines'")
      .get() as { type: string } | undefined;
    expect(view?.type).toBe('view');
  });

  it('a saved event: its row, and the registration column only when no row of that kind exists', () => {
    const plain = makeEvent(h);
    save(plain);
    expect(rows(plain).map((r) => r.id)).toEqual([`event-reg:${plain}`]);
    const both = makeEvent(h);
    save(both);
    addDeadline(both, 'REGISTRATION', 'Registration closes');
    addDeadline(both, 'PPT', 'Deck due');
    const listed = rows(both);
    expect(listed.filter((r) => r.deadlineKind === 'REGISTRATION')).toHaveLength(1);
    expect(listed.map((r) => r.label).sort()).toEqual(['Deck due', 'Registration closes']);
  });

  it('an unsaved event without a competition, a cancelled one and a merged one are absent', () => {
    const lonely = makeEvent(h);
    const cancelled = makeEvent(h, { cancellation: 'CANCELLED' });
    save(cancelled);
    const target = makeEvent(h);
    const merged = makeEvent(h, { mergedInto: target });
    save(merged);
    expect([...rows(lonely), ...rows(cancelled), ...rows(merged)]).toEqual([]);
  });

  it('a Considering competition brings nothing; an assigned one brings its event and open work', async () => {
    const eventId = makeEvent(h);
    await assigned(server, h.alice, {
      eventId,
      studentIds: [freshStudent(h)],
      initialStatus: 'CONSIDERING',
    });
    expect(rows(eventId)).toEqual([]);
    const { view } = await withWorkflow(server, h, h.alice);
    const kinds = rows(eventOfCompetition(view.competitionId));
    expect(kinds.some((r) => r.kind === 'EVENT_DEADLINE')).toBe(true);
    expect(kinds.some((r) => r.kind === 'STAGE')).toBe(true);
  });

  it('a completed or skipped stage and a done task leave; an open task with a date stays', async () => {
    const { view, competitionId } = await withWorkflow(server, h, h.alice);
    const eventOf = eventOfCompetition(competitionId);
    // Date every stage and the first stage's first task.
    let current = view;
    for (const stage of view.stages) {
      current = await ok(
        write(server, h.alice, competitionId, 'PATCH', `stages/${stage.id}`, {
          dueAt: '2026-10-20T06:00:00.000Z',
          version: current.stages.find((s) => s.id === stage.id)!.version,
        }),
      );
    }
    const [first, second, third] = current.stages;
    current = await ok(
      write(server, h.alice, competitionId, 'PATCH', `tasks/${first!.tasks[0]!.id}`, {
        dueAt: '2026-10-15T06:00:00.000Z',
        version: first!.version,
      }),
    );
    const taskId = first!.tasks[0]!.id;
    expect(rows(eventOf).map((r) => r.id)).toContain(`task:${taskId}`);
    const f = current.stages[0]!;
    current = await ok(
      write(server, h.alice, competitionId, 'POST', `tasks/${taskId}/done`, {
        done: true,
        version: f.version,
      }),
    );
    current = await ok(
      write(server, h.alice, competitionId, 'POST', `stages/${second!.id}/status`, {
        status: 'SKIPPED',
        version: current.stages[1]!.version,
      }),
    );
    await ok(
      write(server, h.alice, competitionId, 'POST', `stages/${third!.id}/status`, {
        status: 'COMPLETED',
        openTasks: 'CLOSE',
        version: current.stages[2]!.version,
      }),
    );
    const ids = rows(eventOf).map((r) => r.id);
    expect(ids).not.toContain(`task:${taskId}`);
    expect(ids).not.toContain(`stage:${second!.id}`);
    expect(ids).not.toContain(`stage:${third!.id}`);
    expect(ids).toContain(`stage:${first!.id}`);
  });

  it('a withdrawn competition’s work leaves', async () => {
    const competition = await assigned(server, h.alice, {
      eventId: makeEvent(h),
      studentIds: [freshStudent(h)],
    });
    const eventId = competition.event.id;
    expect(rows(eventId).length).toBeGreaterThan(0);
    await move(server, h.alice, competition, 'WITHDRAWN');
    expect(rows(eventId)).toEqual([]);
    const page = (
      await call(server, 'GET', `/api/v1/competitions/${competition.id}`, { as: h.alice })
    ).body as unknown as CompetitionDetail;
    expect(page.status).toBe('WITHDRAWN');
  });

  it('no row appears twice anywhere', () => {
    const dupes = h.database.db.raw
      .prepare('SELECT id, count(*) AS n FROM v_deadlines GROUP BY id HAVING n > 1')
      .all();
    expect(dupes).toEqual([]);
  });
});
