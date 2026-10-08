import type { WorkflowStage, WorkflowTemplateDetail, WorkflowView } from '@compintel/contracts';

/**
 * Synthetic workflow templates and workflows for the WP-20a screens (D-33),
 * and R99's arithmetic as far as the fake backend needs it to move a progress
 * bar.
 */

const id = (n: number): string => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
let serial = 0;
export const nextId = (): string => {
  serial += 1;
  return id(0xa000 + serial);
};

const stage = (
  n: number,
  name: string,
  weight: number,
  tasks: string[],
): WorkflowTemplateDetail['stages'][number] => ({
  id: id(0x9000 + n),
  name,
  description: null,
  weight,
  dueRule: n % 10 === 1 ? { anchor: 'REGISTRATION_DEADLINE', offsetDays: -2 } : null,
  defaultTasks: tasks,
});

export function makeTemplate(
  n: number,
  patch: Partial<WorkflowTemplateDetail> = {},
): WorkflowTemplateDetail {
  const stages = patch.stages ?? [
    stage(n * 10 + 1, 'Team & registration', 1, ['Confirm the team', 'Register on the site']),
    stage(n * 10 + 2, 'Idea & problem', 2, ['Pick a problem', 'Write a one-pager']),
    stage(n * 10 + 3, 'Build prototype', 4, ['Set up the repo', 'Build the demo path']),
  ];
  return {
    id: id(0x8000 + n),
    name: `Template ${String(n)}`,
    description: null,
    appliesToEventType: null,
    isDefaultForType: false,
    isDepartmentDefault: false,
    ownerName: null,
    ownedByMe: false,
    isArchived: false,
    versionNo: 1,
    stageCount: stages.length,
    canEdit: false,
    ...patch,
    stages,
  };
}

export const HACKATHON = makeTemplate(1, {
  name: 'Hackathon',
  appliesToEventType: 'HACKATHON',
  isDefaultForType: true,
  isDepartmentDefault: true,
});
export const CTF = makeTemplate(2, {
  name: 'CTF',
  appliesToEventType: 'CTF',
  isDefaultForType: true,
  isDepartmentDefault: true,
});

/** R99's stage progress: SKIPPED → null, COMPLETED → 100, override, tasks, else 0. */
export function stageProgress(stage: WorkflowStage): number | null {
  if (stage.status === 'SKIPPED') return null;
  if (stage.status === 'COMPLETED') return 100;
  if (stage.progressOverride !== null) return stage.progressOverride;
  if (stage.tasks.length === 0) return 0;
  const done = stage.tasks.filter((task) => task.isDone).length;
  return Math.round((done / stage.tasks.length) * 1000) / 10;
}

/** Recomputes every stage's progress and the weighted whole (R99). */
export function recompute(view: WorkflowView): WorkflowView {
  const stages = view.stages.map((s) => ({ ...s, progress: stageProgress(s) }));
  const counted = stages.filter((s) => s.progress !== null);
  const weights = counted.reduce((sum, s) => sum + s.weight, 0);
  const progress =
    weights === 0
      ? null
      : Math.round(
          (counted.reduce((sum, s) => sum + s.weight * (s.progress ?? 0), 0) / weights) * 10,
        ) / 10;
  const blocked = stages.find((s) => s.status === 'BLOCKED');
  return {
    ...view,
    stages,
    progress,
    progressReason: progress === null ? 'No stage counts toward progress yet.' : null,
    ...(blocked === undefined
      ? {}
      : {
          health: 'BLOCKED' as const,
          healthReason: `Blocked: ${blocked.name} — ${blocked.blockedReason ?? ''}`,
        }),
  };
}

export function workflowStage(
  name: string,
  patch: Partial<WorkflowStage> = {},
  tasks: string[] = ['First task', 'Second task'],
): WorkflowStage {
  return {
    id: nextId(),
    name,
    description: null,
    weight: 1,
    status: 'NOT_STARTED',
    blockedReason: null,
    dueAt: null,
    dueOrigin: 'NONE',
    dueRule: null,
    startedAt: null,
    completedAt: null,
    completedBy: null,
    progressOverride: null,
    completedWithOpenTasks: false,
    notes: null,
    progress: 0,
    overdue: false,
    assignees: [],
    tasks: tasks.map((title) => ({
      id: nextId(),
      title,
      isDone: false,
      doneAt: null,
      doneBy: null,
      assigneeStudentId: null,
      assigneeName: null,
      dueAt: null,
      notes: null,
    })),
    version: 1,
    ...patch,
  };
}

/** A workflow copied from `template` for a competition (WP-20a's copy, in memory). */
export function workflowFrom(
  competitionId: string,
  template: WorkflowTemplateDetail | null,
  patch: Partial<WorkflowView> = {},
): WorkflowView {
  return recompute({
    id: nextId(),
    competitionId,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    templateVersionNo: template?.versionNo ?? null,
    progress: 0,
    progressReason: null,
    health: 'ON_TRACK',
    healthReason: 'Next: Team & registration due 18 Oct',
    stages: (template?.stages ?? []).map((source, index) =>
      workflowStage(
        source.name,
        {
          weight: source.weight,
          dueRule: source.dueRule,
          dueOrigin: source.dueRule === null ? 'NONE' : 'RULE',
          dueAt: index === 0 ? '2026-10-18T18:29:59.999Z' : null,
        },
        source.defaultTasks,
      ),
    ),
    dateChanges: [],
    roster: [],
    canEdit: true,
    version: 1,
    ...patch,
  });
}
