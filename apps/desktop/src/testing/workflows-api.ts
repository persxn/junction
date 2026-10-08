import {
  problemType,
  type CompetitionDetail,
  type StageStatus,
  type WorkflowStage,
  type WorkflowTemplateDetail,
  type WorkflowView,
} from '@compintel/contracts';
import { vi } from 'vitest';

import {
  CTF,
  HACKATHON,
  nextId,
  recompute,
  workflowFrom,
  workflowStage,
} from './workflow-fixtures.js';

/**
 * The WP-20a backend, as far as its screens can tell — in memory, synthetic
 * only (D-33): templates (list, get, resolve, clone, edit) and a
 * competition's workflow with its stage and task writes. Everything else goes
 * to the fake installed before it, so a screen sees one backend.
 */

export interface WorkflowsApiOptions {
  readonly templates?: WorkflowTemplateDetail[];
  /** WP-19's competitions: an assigned one without a workflow gets the type's default. */
  readonly competitions?: Map<string, CompetitionDetail>;
  readonly workflows?: WorkflowView[];
}

export interface WorkflowsApi {
  readonly templates: Map<string, WorkflowTemplateDetail>;
  readonly workflows: Map<string, WorkflowView>;
  readonly calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
}

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

const problem = (status: number, code: string, detail: string, extra: object = {}): Response =>
  respond(status, {
    type: problemType(code as never),
    title: detail,
    status,
    code,
    detail,
    requestId: 'r',
    ...extra,
  });

const STALE = 'Someone else changed this — reload to see their change.';
const OPEN: readonly StageStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'];

/** Moves `item` before/after another one; neither → the end. */
function placed<T extends { id: string }>(
  list: readonly T[],
  item: T,
  body: Record<string, unknown>,
): T[] {
  const rest = list.filter((entry) => entry.id !== item.id);
  const before = rest.findIndex((entry) => entry.id === body.beforeId);
  const after = rest.findIndex((entry) => entry.id === body.afterId);
  const at = before >= 0 ? before : after >= 0 ? after + 1 : rest.length;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

export function installWorkflowsApi(options: WorkflowsApiOptions = {}): WorkflowsApi {
  const delegate = globalThis.fetch;
  const templates = new Map((options.templates ?? [HACKATHON, CTF]).map((t) => [t.id, t]));
  const workflows = new Map((options.workflows ?? []).map((w) => [w.competitionId, w]));
  const calls: WorkflowsApi['calls'] = [];

  const workflowOf = (competitionId: string): WorkflowView | undefined => {
    const known = workflows.get(competitionId);
    if (known !== undefined) return known;
    const competition = options.competitions?.get(competitionId);
    // Like the server: a competition that has been assigned keeps its first copy.
    const wasAssigned = competition?.history.some((entry) => entry.to === 'ASSIGNED') === true;
    if (competition === undefined || (competition.status === 'CONSIDERING' && !wasAssigned)) {
      return undefined;
    }
    const template =
      [...templates.values()].find(
        (t) => t.isDefaultForType && t.appliesToEventType === competition.event.eventType,
      ) ?? null;
    const made = workflowFrom(competitionId, template, {
      roster: competition.roster.map(({ studentId, fullName }) => ({ studentId, fullName })),
    });
    workflows.set(competitionId, made);
    return made;
  };

  const saved = (view: WorkflowView, stageId?: string, structural = false): Response => {
    const next = recompute({
      ...view,
      version: structural ? view.version + 1 : view.version,
      stages: view.stages.map((s) => (s.id === stageId ? { ...s, version: s.version + 1 } : s)),
    });
    workflows.set(view.competitionId, next);
    return respond(200, next);
  };

  const withStage = (view: WorkflowView, stageId: string, patch: Partial<WorkflowStage>) => ({
    ...view,
    stages: view.stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)),
  });

  const templateRoute = (method: string, rest: string, body: Record<string, unknown>) => {
    if (rest === '' && method === 'GET') {
      return respond(200, { items: [...templates.values()].map(({ stages: _s, ...t }) => t) });
    }
    const [templateId = '', action, ...deeper] = rest.slice(1).split('/');
    const template = templates.get(templateId);
    if (template === undefined)
      return problem(404, 'WORKFLOW_TEMPLATE_NOT_FOUND', 'No such template.');
    if (action === 'resolve') {
      return respond(200, {
        templateId,
        templateName: template.name,
        stages: template.stages.map((s, index) => ({
          templateStageId: s.id,
          name: s.name,
          dueAt: index === 0 ? '2026-10-18T18:29:59.999Z' : null,
          taskCount: s.defaultTasks.length,
        })),
      });
    }
    if (method === 'GET') return respond(200, template);
    if (action === 'clone') {
      const copy: WorkflowTemplateDetail = {
        ...template,
        id: nextId(),
        name: (body.name as string | undefined) ?? `${template.name} (my copy)`,
        isDefaultForType: false,
        isDepartmentDefault: false,
        ownedByMe: true,
        ownerName: 'Test Professor',
        canEdit: true,
        versionNo: 1,
        stages: template.stages.map((s) => ({ ...s, id: nextId() })),
      };
      templates.set(copy.id, copy);
      return respond(200, copy);
    }
    if (!template.canEdit) {
      return problem(
        403,
        'WORKFLOW_TEMPLATE_READ_ONLY',
        'Only its owner or an admin can change this template.',
      );
    }
    if (body.versionNo !== template.versionNo)
      return problem(409, 'WORKFLOW_VERSION_CONFLICT', STALE);
    const { versionNo: _v, beforeId: _b, afterId: _a, ...fields } = body;
    const bump = (stages = template.stages, patch: object = {}): Response => {
      const next = {
        ...template,
        ...patch,
        stages,
        stageCount: stages.length,
        versionNo: template.versionNo + 1,
      };
      templates.set(templateId, next);
      return respond(200, next);
    };
    if (action === undefined) return bump(template.stages, fields);
    if (action === 'archive') return bump(template.stages, { isArchived: true });
    if (action === 'stages' && deeper.length === 0) {
      const added = {
        id: nextId(),
        description: null,
        weight: 1,
        dueRule: null,
        defaultTasks: [],
        ...fields,
      } as unknown as WorkflowTemplateDetail['stages'][number];
      return bump(placed(template.stages, added, body));
    }
    const [stageId, op] = deeper;
    const stage = template.stages.find((s) => s.id === stageId);
    if (stage === undefined) return problem(404, 'WORKFLOW_STAGE_NOT_FOUND', 'No such stage.');
    if (op === 'remove') return bump(template.stages.filter((s) => s.id !== stageId));
    if (op === 'move') return bump(placed(template.stages, stage, body));
    return bump(template.stages.map((s) => (s.id === stageId ? { ...s, ...fields } : s)));
  };

  const workflowRoute = (
    competitionId: string,
    method: string,
    rest: string,
    body: Record<string, unknown>,
  ) => {
    const view = workflowOf(competitionId);
    if (view === undefined)
      return problem(404, 'WORKFLOW_NOT_FOUND', 'This competition has no workflow.');
    if (method === 'GET' && rest === '') return respond(200, view);
    const [kind, itemId, op] = rest.slice(1).split('/');
    if (
      kind === 'apply-date-changes' ||
      (kind === 'stages' && (itemId === undefined || op === 'move' || op === 'remove'))
    ) {
      if (body.version !== view.version) return problem(409, 'WORKFLOW_VERSION_CONFLICT', STALE);
    }
    if (kind === 'apply-date-changes') {
      const ids = body.stageIds as string[];
      return saved(
        {
          ...view,
          stages: view.stages.map((s) => {
            const change = view.dateChanges.find((c) => c.stageId === s.id && ids.includes(s.id));
            return change === undefined ? s : { ...s, dueAt: change.proposed };
          }),
          dateChanges: view.dateChanges.filter((c) => !ids.includes(c.stageId)),
        },
        undefined,
        true,
      );
    }
    if (kind === 'stages' && itemId === undefined) {
      const added = workflowStage(String(body.name), { weight: Number(body.weight ?? 1) }, []);
      return saved({ ...view, stages: placed(view.stages, added, body) }, undefined, true);
    }
    const stage =
      kind === 'stages'
        ? view.stages.find((s) => s.id === itemId)
        : view.stages.find((s) => s.tasks.some((t) => t.id === itemId));
    if (stage === undefined) return problem(404, 'WORKFLOW_STAGE_NOT_FOUND', 'No such stage.');
    if (kind === 'stages' && op === 'move')
      return saved({ ...view, stages: placed(view.stages, stage, body) }, undefined, true);
    if (kind === 'stages' && op === 'remove')
      return saved(
        { ...view, stages: view.stages.filter((s) => s.id !== stage.id) },
        undefined,
        true,
      );
    if (body.version !== stage.version) return problem(409, 'WORKFLOW_VERSION_CONFLICT', STALE);
    if (kind === 'stages' && op === 'status') {
      const status = body.status as StageStatus;
      const open = stage.tasks.filter((t) => !t.isDone).length;
      if (
        status === 'BLOCKED' &&
        (typeof body.blockedReason === 'string' ? body.blockedReason : '').trim() === ''
      ) {
        return problem(422, 'WORKFLOW_BLOCKED_REASON_REQUIRED', 'A blocked stage needs a reason.');
      }
      if (
        status === 'COMPLETED' &&
        stage.status !== 'COMPLETED' &&
        open > 0 &&
        body.openTasks === undefined
      ) {
        return problem(422, 'WORKFLOW_OPEN_TASKS', `${String(open)} tasks are still open.`, {
          count: open,
        });
      }
      return saved(
        withStage(view, stage.id, {
          status,
          blockedReason: status === 'BLOCKED' ? String(body.blockedReason) : null,
          completedWithOpenTasks: status === 'COMPLETED' && body.openTasks === 'KEEP' && open > 0,
          overdue: stage.overdue && OPEN.includes(status),
          tasks:
            status === 'COMPLETED' && body.openTasks === 'CLOSE'
              ? stage.tasks.map((t) => ({ ...t, isDone: true }))
              : stage.tasks,
        }),
        stage.id,
      );
    }
    if (kind === 'stages' && op === 'override')
      return saved(
        withStage(view, stage.id, { progressOverride: body.progressOverride as number | null }),
        stage.id,
      );
    if (kind === 'stages' && op === 'tasks') {
      const [task] = workflowStage('', {}, [String(body.title)]).tasks;
      return saved(withStage(view, stage.id, { tasks: [...stage.tasks, task!] }), stage.id);
    }
    if (kind === 'stages') {
      const { version: _v, ...fields } = body;
      return saved(
        withStage(view, stage.id, {
          ...fields,
          ...(body.dueAt === undefined
            ? {}
            : { dueOrigin: body.dueAt === null ? 'NONE' : 'MANUAL' }),
        }),
        stage.id,
      );
    }
    const task = stage.tasks.find((t) => t.id === itemId)!;
    const tasks =
      op === 'done'
        ? stage.tasks.map((t) => (t.id === task.id ? { ...t, isDone: body.done === true } : t))
        : op === 'remove'
          ? stage.tasks.filter((t) => t.id !== task.id)
          : op === 'move'
            ? placed(stage.tasks, task, body)
            : stage.tasks.map((t) =>
                t.id === task.id
                  ? { ...t, title: typeof body.title === 'string' ? body.title : t.title }
                  : t,
              );
    const starts = op === 'done' && body.done === true && stage.status === 'NOT_STARTED';
    return saved(
      withStage(view, stage.id, { tasks, ...(starts ? { status: 'IN_PROGRESS' as const } : {}) }),
      stage.id,
    );
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname;
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      let answer: Response | undefined;
      if (path.startsWith('/api/v1/workflow-templates')) {
        answer = templateRoute(method, path.slice('/api/v1/workflow-templates'.length), body);
      } else {
        const match = /^\/api\/v1\/competitions\/([^/]+)\/workflow(\/.*)?$/.exec(path);
        if (match !== null) answer = workflowRoute(match[1] ?? '', method, match[2] ?? '', body);
      }
      if (answer === undefined) return delegate(url, init);
      calls.push({ method, path, body: init.body === undefined ? undefined : body });
      return Promise.resolve(answer);
    }),
  );
  return { templates, workflows, calls };
}
