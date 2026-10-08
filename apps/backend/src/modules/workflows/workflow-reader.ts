import {
  isEngagementMentor,
  isEngagementPrimaryMentor,
  type EngagementStatus,
  type OwnershipFacts,
  type WorkflowStage,
  type WorkflowView,
} from '@compintel/contracts';

import { isTerminal } from '../../domain/engagements/status.js';
import { resolveDueAt } from '../../domain/workflows/due.js';
import { scheduleHealth } from '../../domain/workflows/health.js';
import {
  roundProgress,
  stageProgress,
  workflowProgress,
  type StageProgress,
} from '../../domain/workflows/progress.js';
import type { AuditLog } from '../../platform/audit.js';
import { APP_TIMEZONE, nowMs, systemClock, type Clock } from '../../platform/time.js';
import { can } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { competitionClosed, competitionNotFound } from '../engagements/errors.js';
import { mentorshipOf, type WorkflowSummary } from '../engagements/reader.js';
import type { EngagementRecord, EngagementsRepository } from '../engagements/repository.js';
import { workflowNotFound } from './errors.js';
import { parseRule, type TemplatesRepository } from './templates-repo.js';
import type {
  StageRecord,
  TaskRecord,
  WorkflowRecord,
  WorkflowRepository,
} from './workflow-repo.js';

/** What every workflow service holds. */
export interface WorkflowsDependencies {
  readonly workflows: WorkflowRepository;
  readonly templates: TemplatesRepository;
  readonly engagements: EngagementsRepository;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export interface WorkflowsContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());

interface Computed {
  readonly stage: StageRecord;
  readonly tasks: TaskRecord[];
  readonly done: number;
  readonly progress: StageProgress;
}

/** R99: a closed competition shows its status, not a health; Considering has no workflow yet. */
const showsHealth = (status: EngagementStatus): boolean =>
  !isTerminal(status) && status !== 'CONSIDERING';

/**
 * Loading a workflow and everything §11 says about it: per-stage progress, the
 * workflow's progress and health with their reasons, R100's date offers, and
 * whether the caller may change it (R96's competition mentors, or an admin).
 */
export class WorkflowReader {
  readonly #deps: WorkflowsDependencies;
  readonly #clock: Clock;

  constructor(deps: WorkflowsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  competition(id: string): EngagementRecord {
    const row = this.#deps.engagements.find(id);
    if (row === undefined) throw competitionNotFound();
    return row;
  }

  require(competitionId: string): WorkflowRecord {
    this.competition(competitionId);
    const workflow = this.#deps.workflows.forCompetition(competitionId);
    if (workflow === undefined) throw workflowNotFound();
    return workflow;
  }

  facts(actor: Principal, competitionId: string): OwnershipFacts {
    const mentorship = mentorshipOf(this.#deps.engagements.openMentors(competitionId));
    return {
      isCompetitionMentor: isEngagementMentor(actor, mentorship),
      isCompetitionPrimaryMentor: isEngagementPrimaryMentor(actor, mentorship),
    };
  }

  /** A write needs an open competition (R97). */
  requireOpen(competitionId: string): EngagementRecord {
    const competition = this.competition(competitionId);
    if (isTerminal(competition.status)) throw competitionClosed(competition.status);
    return competition;
  }

  #computed(stages: readonly StageRecord[], tasks: readonly TaskRecord[]): Computed[] {
    return stages.map((stage) => {
      const own = tasks.filter((task) => task.stageId === stage.id);
      const done = own.filter((task) => task.isDone === 1).length;
      const progress = stageProgress({
        status: stage.status,
        progressOverride: stage.progressOverride,
        tasksDone: done,
        tasksTotal: own.length,
      });
      return { stage, tasks: own, done, progress };
    });
  }

  #health(computed: readonly Computed[], now: number) {
    return scheduleHealth({
      stages: computed.map(({ stage, tasks, done, progress }) => ({
        name: stage.name,
        status: stage.status,
        dueAt: stage.dueAt,
        progress: progress.value,
        tasksDone: done,
        tasksTotal: tasks.length,
        blockedReason: stage.blockedReason,
      })),
      now,
      zone: APP_TIMEZONE,
    });
  }

  /** The board's columns: progress and health per competition, in two queries. */
  summaries(
    competitions: readonly { id: string; status: EngagementStatus }[],
  ): Map<string, WorkflowSummary> {
    const result = new Map<string, WorkflowSummary>();
    const now = nowMs(this.#clock);
    const workflows = competitions.flatMap((competition) => {
      const workflow = this.#deps.workflows.forCompetition(competition.id);
      return workflow === undefined ? [] : [{ competition, workflow }];
    });
    const stages = this.#deps.workflows.stages(workflows.map((entry) => entry.workflow.id));
    const tasks = this.#deps.workflows.tasks(stages.map((stage) => stage.id));
    for (const { competition, workflow } of workflows) {
      const computed = this.#computed(
        stages.filter((stage) => stage.workflowId === workflow.id),
        tasks,
      );
      const progress = workflowProgress(
        computed.map(({ stage, progress: p }) => ({ weight: stage.weight, progress: p.value })),
      );
      const health = showsHealth(competition.status) ? this.#health(computed, now) : undefined;
      result.set(competition.id, {
        progress: progress.value === null ? null : roundProgress(progress.value),
        health: health?.health ?? null,
        healthReason: health?.reason ?? null,
      });
    }
    return result;
  }

  view(actor: Principal, competitionId: string): WorkflowView {
    const competition = this.competition(competitionId);
    const workflow = this.require(competitionId);
    const now = nowMs(this.#clock);
    const stages = this.#deps.workflows.stages([workflow.id]);
    const tasks = this.#deps.workflows.tasks(stages.map((stage) => stage.id));
    const assignees = this.#deps.workflows.assignees(stages.map((stage) => stage.id));
    const computed = this.#computed(stages, tasks);
    const progress = workflowProgress(
      computed.map(({ stage, progress: p }) => ({ weight: stage.weight, progress: p.value })),
    );
    const health = showsHealth(competition.status) ? this.#health(computed, now) : undefined;
    const dates = this.#deps.templates.eventDates(competition.eventId);
    const views: WorkflowStage[] = computed.map(({ stage, tasks: own, progress: p }) => ({
      id: stage.id,
      name: stage.name,
      description: stage.description,
      weight: stage.weight,
      status: stage.status,
      blockedReason: stage.blockedReason,
      dueAt: iso(stage.dueAt),
      dueOrigin: stage.dueOrigin,
      dueRule: parseRule(stage.dueRuleJson),
      startedAt: iso(stage.startedAt),
      completedAt: iso(stage.completedAt),
      completedBy: stage.completedBy,
      progressOverride: stage.progressOverride,
      completedWithOpenTasks: stage.completedWithOpenTasks === 1,
      notes: stage.notes,
      progress: p.value === null ? null : roundProgress(p.value),
      overdue:
        stage.dueAt !== null &&
        stage.dueAt < now &&
        ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'].includes(stage.status),
      assignees: assignees
        .filter((row) => row.stageId === stage.id)
        .map((row) => ({ studentId: row.studentId, fullName: row.fullName })),
      tasks: own.map((task) => ({
        id: task.id,
        title: task.title,
        isDone: task.isDone === 1,
        doneAt: iso(task.doneAt),
        doneBy: task.doneBy,
        assigneeStudentId: task.assigneeStudentId,
        assigneeName: task.assigneeStudentId === null ? null : task.assigneeName,
        dueAt: iso(task.dueAt),
        notes: task.notes,
      })),
      version: stage.version,
    }));
    // R100: a RULE date whose anchor moved is offered back, never applied silently.
    const dateChanges = stages.flatMap((stage) => {
      const rule = parseRule(stage.dueRuleJson);
      if (stage.dueOrigin !== 'RULE' || rule === null || dates === undefined) return [];
      const proposed = resolveDueAt(rule, dates, APP_TIMEZONE);
      return proposed === stage.dueAt
        ? []
        : [
            {
              stageId: stage.id,
              stageName: stage.name,
              current: iso(stage.dueAt),
              proposed: iso(proposed),
            },
          ];
    });
    const open = !isTerminal(competition.status);
    return {
      id: workflow.id,
      competitionId,
      templateId: workflow.templateId,
      templateName: workflow.templateName,
      templateVersionNo: workflow.templateVersionNo,
      progress: progress.value === null ? null : roundProgress(progress.value),
      progressReason: progress.reason,
      health: health?.health ?? null,
      healthReason:
        health?.reason ??
        `This competition is ${competition.status === 'COMPLETED' ? 'completed' : 'closed'}.`,
      stages: views,
      dateChanges,
      roster: this.#deps.workflows.roster(competitionId),
      canEdit: open && can(actor, 'workflow.edit', this.facts(actor, competitionId)),
      version: workflow.version,
    };
  }
}
