import type {
  CompetitionDetail,
  CompetitionListResponse,
  ResolvedTemplate,
  WorkflowTemplateDetail,
} from '@compintel/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { assign, freshStudent, makeEvent, move } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import {
  HACKATHON_TEMPLATE,
  auditActions,
  ok,
  withWorkflow,
  workflowOf,
  write,
} from '../../testing/workflows.js';
import { WorkflowRepository } from './workflow-repo.js';

/**
 * Copy-on-assign (WP-20a step 6, §11, R98, R100) over HTTP: the copy equals
 * its template and records the version, later template edits never reach it,
 * a failing confirm leaves nothing behind, the board's CONSIDERING → ASSIGNED
 * copies too, and R100's rule dates are offered back, never applied silently.
 */

let h: StudentsHarness;
let server: TestServer;
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

const DAY = 86_400_000;
const template = async (id: string): Promise<WorkflowTemplateDetail> =>
  (await call(server, 'GET', `/api/v1/workflow-templates/${id}`, { as: h.alice }))
    .body as unknown as WorkflowTemplateDetail;
const count = (sql: string, ...args: unknown[]): number =>
  (h.database.db.raw.prepare(sql).get(...args) as { n: number }).n;

describe('the copy', () => {
  it('equals the type’s default template, records its version, and keeps it', async () => {
    const source = await template(HACKATHON_TEMPLATE);
    const { view, competitionId } = await withWorkflow(server, h, h.alice);
    expect(view).toMatchObject({
      templateId: HACKATHON_TEMPLATE,
      templateName: 'Hackathon',
      templateVersionNo: source.versionNo,
      canEdit: true,
    });
    expect(view.stages.map((stage) => [stage.name, stage.weight, stage.dueRule])).toEqual(
      source.stages.map((stage) => [stage.name, stage.weight, stage.dueRule]),
    );
    expect(view.stages.map((stage) => stage.tasks.map((task) => task.title))).toEqual(
      source.stages.map((stage) => stage.defaultTasks),
    );
    expect(view.stages.every((stage) => stage.status === 'NOT_STARTED')).toBe(true);
    expect(auditActions(h, competitionId)).toContain('workflow.created');

    // An admin edits the default: the existing copy does not move.
    const edited = await call(server, 'PATCH', `/api/v1/workflow-templates/${HACKATHON_TEMPLATE}`, {
      as: h.admin,
      body: { name: 'Hackathon v2', versionNo: source.versionNo },
    });
    expect(edited.status).toBe(200);
    await call(
      server,
      'PATCH',
      `/api/v1/workflow-templates/${HACKATHON_TEMPLATE}/stages/${source.stages[0]!.id}`,
      { as: h.admin, body: { name: 'Renamed', versionNo: source.versionNo + 1 } },
    );
    const after = await workflowOf(server, competitionId, h.alice);
    expect(after.templateVersionNo).toBe(source.versionNo);
    expect(after.stages.map((stage) => stage.name)).toEqual(view.stages.map((s) => s.name));
    // A new assignment takes the new version.
    const next = await withWorkflow(server, h, h.alice);
    expect(next.view.templateVersionNo).toBe(source.versionNo + 2);
    expect(next.view.stages[0]?.name).toBe('Renamed');
  });

  it('“Blank workflow” gives no stages; a chosen template and manual dates are kept', async () => {
    const blank = await withWorkflow(server, h, h.alice, {
      workflow: { templateId: null },
    });
    expect(blank.view.templateId).toBeNull();
    expect(blank.view.stages).toEqual([]);
    expect(blank.view.health).toBe('NO_DATES');
    expect(blank.view.progress).toBeNull();

    const eventId = makeEvent(h);
    const resolved = (
      await call(server, 'POST', `/api/v1/workflow-templates/${HACKATHON_TEMPLATE}/resolve`, {
        as: h.alice,
        body: { eventId },
      })
    ).body as unknown as ResolvedTemplate;
    const [first, second] = resolved.stages;
    expect(first?.dueAt).not.toBeNull();
    expect(second?.dueAt).toBeNull();
    const manual = '2026-11-20T12:30:00.000Z';
    const response = await assign(server, h.alice, {
      eventId,
      studentIds: [freshStudent(h)],
      workflow: {
        templateId: HACKATHON_TEMPLATE,
        dueOverrides: { [first!.templateStageId]: null, [second!.templateStageId]: manual },
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const id = (response.body.competitions as { id: string }[])[0]!.id;
    const view = await workflowOf(server, id, h.alice);
    expect(view.stages[0]).toMatchObject({ dueAt: null, dueOrigin: 'NONE' });
    expect(view.stages[1]).toMatchObject({ dueAt: manual, dueOrigin: 'MANUAL' });
    // A rule that gives no date yet stays a rule (R100).
    expect(view.stages[2]).toMatchObject({ dueAt: null, dueOrigin: 'RULE' });
  });

  it('a confirm failing mid-way leaves no competition, workflow or audit row', async () => {
    const eventId = makeEvent(h);
    const student = freshStudent(h);
    const before = {
      competitions: count('SELECT count(*) AS n FROM engagements'),
      workflows: count('SELECT count(*) AS n FROM workflows'),
      stages: count('SELECT count(*) AS n FROM workflow_stages'),
      audit: count('SELECT count(*) AS n FROM audit_log'),
    };
    vi.spyOn(h.workflows.copier, 'copy').mockImplementation(() => {
      throw new Error('the copy broke half-way');
    });
    const response = await assign(server, h.alice, { eventId, studentIds: [student] });
    expect(response.status).toBe(500);
    expect({
      competitions: count('SELECT count(*) AS n FROM engagements'),
      workflows: count('SELECT count(*) AS n FROM workflows'),
      stages: count('SELECT count(*) AS n FROM workflow_stages'),
      audit: count('SELECT count(*) AS n FROM audit_log'),
    }).toEqual(before);
  });

  it('a stage insert failing inside the copy takes the whole assignment back', async () => {
    const eventId = makeEvent(h);
    const before = [
      count('SELECT count(*) AS n FROM engagements'),
      count('SELECT count(*) AS n FROM workflows'),
      count('SELECT count(*) AS n FROM workflow_stages'),
      count('SELECT count(*) AS n FROM tasks'),
    ];
    // The real method, called with the repository as `this` below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const real = WorkflowRepository.prototype.insertStage;
    let calls = 0;
    vi.spyOn(WorkflowRepository.prototype, 'insertStage').mockImplementation(function (
      this: WorkflowRepository,
      ...args
    ) {
      calls += 1;
      if (calls === 3) throw new Error('disk full');
      real.apply(this, args);
    });
    const response = await assign(server, h.alice, { eventId, studentIds: [freshStudent(h)] });
    expect(response.status).toBe(500);
    expect(calls).toBe(3);
    expect([
      count('SELECT count(*) AS n FROM engagements'),
      count('SELECT count(*) AS n FROM workflows'),
      count('SELECT count(*) AS n FROM workflow_stages'),
      count('SELECT count(*) AS n FROM tasks'),
    ]).toEqual(before);
  });
});

describe('the board’s CONSIDERING → ASSIGNED', () => {
  it('copies then, with the chosen template; Considering has none', async () => {
    const response = await assign(server, h.alice, {
      eventId: makeEvent(h),
      studentIds: [freshStudent(h)],
      initialStatus: 'CONSIDERING',
    });
    const id = (response.body.competitions as { id: string }[])[0]!.id;
    const none = await call(server, 'GET', `/api/v1/competitions/${id}/workflow`, { as: h.alice });
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('WORKFLOW_NOT_FOUND');
    const competition = (await call(server, 'GET', `/api/v1/competitions/${id}`, { as: h.alice }))
      .body as unknown as CompetitionDetail;
    const moved = await call(server, 'POST', `/api/v1/competitions/${id}/transitions`, {
      as: h.alice,
      body: { to: 'ASSIGNED', version: competition.version, workflow: { templateId: null } },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await workflowOf(server, id, h.alice)).templateId).toBeNull();
    // Back to Considering and forward again: the first copy stays, no second one.
    const back = await move(server, h.alice, moved.body as never, 'CONSIDERING');
    await move(server, h.alice, back.body as never, 'ASSIGNED');
    expect(count('SELECT count(*) AS n FROM workflows WHERE engagement_id = ?', id)).toBe(1);
  });
});

describe('dates (R100)', () => {
  it('a MANUAL date stays put; a RULE date is offered back and applied only on confirm', async () => {
    const { competitionId, eventId, view } = await withWorkflow(server, h, h.alice);
    const [ruled, manual] = view.stages;
    const set = await ok(
      write(server, h.alice, competitionId, 'PATCH', `stages/${manual!.id}`, {
        dueAt: '2026-11-01T06:00:00.000Z',
        version: manual!.version,
      }),
    );
    expect(set.stages[1]?.dueOrigin).toBe('MANUAL');
    h.database.db.raw
      .prepare(
        'UPDATE events SET registration_deadline_at = registration_deadline_at + ? WHERE id = ?',
      )
      .run(5 * DAY, eventId);
    const moved = await workflowOf(server, competitionId, h.alice);
    expect(moved.stages[0]?.dueAt).toBe(ruled!.dueAt);
    expect(moved.stages[1]?.dueAt).toBe('2026-11-01T06:00:00.000Z');
    expect(moved.dateChanges).toEqual([
      {
        stageId: ruled!.id,
        stageName: ruled!.name,
        current: ruled!.dueAt,
        proposed: new Date(Date.parse(ruled!.dueAt!) + 5 * DAY).toISOString(),
      },
    ]);
    const applied = await ok(
      write(server, h.alice, competitionId, 'POST', 'apply-date-changes', {
        stageIds: [ruled!.id],
        version: moved.version,
      }),
    );
    expect(applied.stages[0]?.dueAt).toBe(moved.dateChanges[0]?.proposed);
    expect(applied.dateChanges).toEqual([]);
    expect(applied.stages[1]?.dueAt).toBe('2026-11-01T06:00:00.000Z');
    expect(auditActions(h, competitionId)).toContain('workflow.dates_updated');
  });
});

describe('the list (WP-19’s DTO)', () => {
  it('carries progress and health', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const list = (await call(server, 'GET', '/api/v1/competitions', { as: h.alice }))
      .body as unknown as CompetitionListResponse;
    const item = list.items.find((row) => row.id === competitionId);
    expect(item?.progress).toBe(0);
    expect(item?.health).toBe('ON_TRACK');
    expect(item?.healthReason).toMatch(/^Next: .+ due /);
  });
});
