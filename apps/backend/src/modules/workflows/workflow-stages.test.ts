import type { CompetitionDetail, WorkflowView } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshStudent } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { auditActions, ok, withWorkflow, workflowOf, write } from '../../testing/workflows.js';

/**
 * A workflow's stage and task writes (WP-20a step 7, §11, R99, R101) over
 * HTTP: the status rules, explicit task done, roster-only assignees, stale
 * versions, audited reorder with R101's renumber, and who may write.
 */

let h: StudentsHarness;
let server: TestServer;
/** A professor with no part in any competition here. */
let carol: StudentsHarness['alice'];
beforeAll(async () => {
  h = openStudentsHarness();
  carol = h.user('Carol Professor', ['PROFESSOR']);
  server = await startStudentsServer(h, [carol]);
});
afterAll(async () => {
  await server.close();
  h.close();
});

const stageWrite = (
  view: WorkflowView,
  index: number,
  path: string,
  body: Record<string, unknown>,
  as = h.alice,
) => {
  const stage = view.stages[index]!;
  return write(server, as, view.competitionId, 'POST', `stages/${stage.id}/${path}`, {
    ...body,
    version: stage.version,
  });
};

describe('stage status (§11)', () => {
  it('BLOCKED needs a reason; the first IN_PROGRESS sets started_at once', async () => {
    const { view } = await withWorkflow(server, h, h.alice);
    const refused = await stageWrite(view, 0, 'status', { status: 'BLOCKED', blockedReason: ' ' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('WORKFLOW_BLOCKED_REASON_REQUIRED');
    const started = await ok(stageWrite(view, 0, 'status', { status: 'IN_PROGRESS' }));
    const at = started.stages[0]?.startedAt;
    expect(at).not.toBeNull();
    h.clock.advance(60_000);
    const blocked = await ok(
      stageWrite(started, 0, 'status', {
        status: 'BLOCKED',
        blockedReason: 'Waiting on the venue',
      }),
    );
    expect(blocked.stages[0]).toMatchObject({ blockedReason: 'Waiting on the venue' });
    expect(blocked.health).toBe('BLOCKED');
    expect(blocked.healthReason).toBe('Blocked: Team & registration — Waiting on the venue');
    const again = await ok(stageWrite(blocked, 0, 'status', { status: 'IN_PROGRESS' }));
    expect(again.stages[0]).toMatchObject({ startedAt: at, blockedReason: null });
  });

  it('COMPLETED with open tasks: 422 with the count, CLOSE ticks them, KEEP flags it', async () => {
    const { view } = await withWorkflow(server, h, h.alice);
    const open = view.stages[0]!.tasks.length;
    const refused = await stageWrite(view, 0, 'status', { status: 'COMPLETED' });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'WORKFLOW_OPEN_TASKS', count: open });

    const closed = await ok(
      stageWrite(view, 0, 'status', { status: 'COMPLETED', openTasks: 'CLOSE' }),
    );
    expect(closed.stages[0]?.tasks.every((task) => task.isDone)).toBe(true);
    expect(closed.stages[0]).toMatchObject({ completedWithOpenTasks: false, progress: 100 });
    expect(closed.stages[0]?.completedBy).toBe('Alice Professor');

    const kept = await ok(
      stageWrite(view, 1, 'status', { status: 'COMPLETED', openTasks: 'KEEP' }),
    );
    expect(kept.stages[1]).toMatchObject({ completedWithOpenTasks: true, progress: 100 });
    expect(kept.stages[1]?.tasks.some((task) => !task.isDone)).toBe(true);

    // Leaving COMPLETED clears when, by whom and the flag.
    const reopened = await ok(stageWrite(kept, 1, 'status', { status: 'IN_PROGRESS' }));
    expect(reopened.stages[1]).toMatchObject({
      completedAt: null,
      completedBy: null,
      completedWithOpenTasks: false,
    });
  });

  it('an override is shown and cleared; progress follows R99', async () => {
    const { view } = await withWorkflow(server, h, h.alice);
    const set = await ok(stageWrite(view, 2, 'override', { progressOverride: 0 }));
    expect(set.stages[2]).toMatchObject({ progressOverride: 0, progress: 0 });
    const cleared = await ok(stageWrite(set, 2, 'override', { progressOverride: null }));
    expect(cleared.stages[2]?.progressOverride).toBeNull();
  });
});

describe('tasks', () => {
  it('done is an explicit value; the first tick starts the stage', async () => {
    const { view, competitionId } = await withWorkflow(server, h, h.alice);
    const task = view.stages[0]!.tasks[0]!;
    const path = `tasks/${task.id}/done`;
    const ticked = await ok(
      write(server, h.alice, competitionId, 'POST', path, {
        done: true,
        version: view.stages[0]!.version,
      }),
    );
    expect(ticked.stages[0]).toMatchObject({ status: 'IN_PROGRESS' });
    expect(ticked.stages[0]?.startedAt).not.toBeNull();
    // Sending done: true again keeps it done (never a toggle).
    const twice = await ok(
      write(server, h.alice, competitionId, 'POST', path, {
        done: true,
        version: ticked.stages[0]!.version,
      }),
    );
    expect(twice.stages[0]?.tasks[0]?.isDone).toBe(true);
    expect(twice.progress).toBeGreaterThan(0);
    const unticked = await ok(
      write(server, h.alice, competitionId, 'POST', path, {
        done: false,
        version: twice.stages[0]!.version,
      }),
    );
    expect(unticked.stages[0]?.tasks[0]?.isDone).toBe(false);
    expect(unticked.stages[0]?.status).toBe('IN_PROGRESS');
  });

  it('add, edit and remove a task; an off-roster assignee is refused', async () => {
    const { view, competitionId, studentIds } = await withWorkflow(server, h, h.alice);
    const stage = view.stages[0]!;
    const offRoster = await write(
      server,
      h.alice,
      competitionId,
      'POST',
      `stages/${stage.id}/tasks`,
      {
        title: 'Book a room',
        assigneeStudentId: freshStudent(h),
        version: stage.version,
      },
    );
    expect(offRoster.status).toBe(422);
    expect(offRoster.body.code).toBe('WORKFLOW_ASSIGNEE_NOT_ON_ROSTER');
    const added = await ok(
      write(server, h.alice, competitionId, 'POST', `stages/${stage.id}/tasks`, {
        title: 'Book a room',
        assigneeStudentId: studentIds[0],
        version: stage.version,
      }),
    );
    const task = added.stages[0]!.tasks.at(-1)!;
    expect(task).toMatchObject({ title: 'Book a room', assigneeStudentId: studentIds[0] });
    const edited = await ok(
      write(server, h.alice, competitionId, 'PATCH', `tasks/${task.id}`, {
        title: 'Book the lab',
        version: added.stages[0]!.version,
      }),
    );
    expect(edited.stages[0]?.tasks.at(-1)?.title).toBe('Book the lab');
    const removed = await ok(
      write(server, h.alice, competitionId, 'POST', `tasks/${task.id}/remove`, {
        version: edited.stages[0]!.version,
      }),
    );
    expect(removed.stages[0]?.tasks.map((t) => t.id)).not.toContain(task.id);

    const refused = await write(
      server,
      h.alice,
      competitionId,
      'PUT',
      `stages/${stage.id}/assignees`,
      {
        studentIds: [freshStudent(h)],
        version: removed.stages[0]!.version,
      },
    );
    expect(refused.body.code).toBe('WORKFLOW_ASSIGNEE_NOT_ON_ROSTER');
    const set = await ok(
      write(server, h.alice, competitionId, 'PUT', `stages/${stage.id}/assignees`, {
        studentIds: [studentIds[1]],
        version: removed.stages[0]!.version,
      }),
    );
    expect(set.stages[0]?.assignees.map((a) => a.studentId)).toEqual([studentIds[1]]);
  });
});

describe('concurrency and order (R101)', () => {
  it('a stale version gives a 409 with the house words and writes nothing', async () => {
    const { view, competitionId } = await withWorkflow(server, h, h.alice);
    await ok(stageWrite(view, 0, 'status', { status: 'IN_PROGRESS' }));
    const before = auditActions(h, competitionId).length;
    const stale = await stageWrite(view, 0, 'status', { status: 'SKIPPED' });
    expect(stale.status).toBe(409);
    expect(stale.body.detail).toBe('Someone else changed this — reload to see their change.');
    expect(auditActions(h, competitionId)).toHaveLength(before);
    // Another stage's version is its own: ticking stage 2 is not stale.
    expect((await stageWrite(view, 1, 'status', { status: 'IN_PROGRESS' })).status).toBe(200);
  });

  it('moves are audited; 60 inserts at one spot keep their order through the renumbers', async () => {
    let { view } = await withWorkflow(server, h, h.alice, { workflow: { templateId: null } });
    const { competitionId } = view;
    view = await ok(
      write(server, h.alice, competitionId, 'POST', 'stages', {
        name: 'First',
        version: view.version,
      }),
    );
    view = await ok(
      write(server, h.alice, competitionId, 'POST', 'stages', {
        name: 'Last',
        version: view.version,
      }),
    );
    const last = view.stages[1]!.id;
    for (let n = 1; n <= 60; n += 1) {
      view = await ok(
        write(server, h.alice, competitionId, 'POST', 'stages', {
          name: `Insert ${String(n)}`,
          beforeId: last,
          version: view.version,
        }),
      );
    }
    expect(view.stages.map((stage) => stage.name)).toEqual([
      'First',
      ...Array.from({ length: 60 }, (_, i) => `Insert ${String(i + 1)}`),
      'Last',
    ]);
    const positions = h.database.db.raw
      .prepare('SELECT position FROM workflow_stages WHERE workflow_id = ? ORDER BY position')
      .all(view.id) as { position: number }[];
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]!.position - positions[i - 1]!.position).toBeGreaterThanOrEqual(1e-6);
    }
    const moved = await ok(
      write(server, h.alice, competitionId, 'POST', `stages/${last}/move`, {
        beforeId: view.stages[0]!.id,
        version: view.version,
      }),
    );
    expect(moved.stages[0]?.name).toBe('Last');
    expect(auditActions(h, competitionId)).toContain('workflow.stage_moved');
    const removed = await ok(
      write(server, h.alice, competitionId, 'POST', `stages/${last}/remove`, {
        version: moved.version,
      }),
    );
    expect(removed.stages).toHaveLength(61);
    expect(auditActions(h, competitionId)).toContain('workflow.stage_removed');
  });
});

describe('who may write (R96, §10.2)', () => {
  it('mentor and co-mentor and admin may; another professor gets 403 and reads only', async () => {
    const { view, competitionId } = await withWorkflow(server, h, h.alice);
    const competition = (
      await call(server, 'GET', `/api/v1/competitions/${competitionId}`, { as: h.alice })
    ).body as unknown as CompetitionDetail;
    await call(server, 'POST', `/api/v1/competitions/${competitionId}/mentors`, {
      as: h.alice,
      body: { userId: h.bob.id, version: competition.version },
    });
    const rows: [string, typeof h.alice, number][] = [
      ['other professor', carol, 403],
      ['primary mentor', h.alice, 200],
      ['co-mentor', h.bob, 200],
      ['admin', h.admin, 200],
    ];
    let current = view;
    for (const [who, as, status] of rows) {
      const response = await stageWrite(current, 2, 'override', { progressOverride: 40 }, as);
      expect(response.status, who).toBe(status);
      if (status === 200) current = response.body as unknown as WorkflowView;
    }
  });
});

describe('a closed competition', () => {
  it('keeps its workflow read-only and shows its status, not a health', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const competition = (
      await call(server, 'GET', `/api/v1/competitions/${competitionId}`, { as: h.alice })
    ).body as unknown as CompetitionDetail;
    await call(server, 'POST', `/api/v1/competitions/${competitionId}/transitions`, {
      as: h.alice,
      body: { to: 'WITHDRAWN', version: competition.version },
    });
    const view = await workflowOf(server, competitionId, h.alice);
    expect(view).toMatchObject({ canEdit: false, health: null });
    const refused = await stageWrite(view, 0, 'status', { status: 'IN_PROGRESS' });
    expect(refused.status).toBe(409);
  });
});
