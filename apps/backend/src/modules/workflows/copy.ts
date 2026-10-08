import type { ResolvedTemplate, WorkflowChoice } from '@compintel/contracts';

import { resolveDueAt } from '../../domain/workflows/due.js';
import { POSITION_STEP } from '../../domain/workflows/order.js';
import { withAudit } from '../../platform/audit.js';
import { notFound } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { APP_TIMEZONE } from '../../platform/time.js';
import type { OnAssignedHook } from '../engagements/reader.js';
import { templateNotFound } from './errors.js';
import { parseRule, parseTasks, type TemplateRecord } from './templates-repo.js';
import type { WorkflowsDependencies } from './workflow-reader.js';

/**
 * Copy-on-assign (§11, R98, R100): when a competition enters ASSIGNED, the
 * chosen template — or the department default for the event's type, or a
 * blank workflow — is copied into it with its stages, default tasks and
 * resolved dates, inside the transition's own transaction. Later template
 * edits never touch the copy; its template version is recorded.
 */
export class WorkflowCopier {
  readonly #deps: WorkflowsDependencies;

  constructor(deps: WorkflowsDependencies) {
    this.#deps = deps;
  }

  #template(choice: WorkflowChoice | undefined, eventType: string): TemplateRecord | undefined {
    if (choice === undefined) {
      return this.#deps.templates.defaultFor(eventType as never);
    }
    if (choice.templateId === null) return undefined;
    const template = this.#deps.templates.find(choice.templateId);
    if (template === undefined) throw templateNotFound();
    return template;
  }

  /** What a template would give this event: each stage's date, or none (R100). */
  resolve(templateId: string | null, eventId: string): ResolvedTemplate {
    const dates = this.#deps.templates.eventDates(eventId);
    if (dates === undefined) throw notFound('That event does not exist.');
    if (templateId === null) return { templateId: null, templateName: null, stages: [] };
    const template = this.#deps.templates.find(templateId);
    if (template === undefined) throw templateNotFound();
    return {
      templateId,
      templateName: template.name,
      stages: this.#deps.templates.stages(templateId).map((stage) => {
        const rule = parseRule(stage.dueRuleJson);
        const at = rule === null ? null : resolveDueAt(rule, dates, APP_TIMEZONE);
        return {
          templateStageId: stage.id,
          name: stage.name,
          dueAt: at === null ? null : new Date(at).toISOString(),
          taskCount: parseTasks(stage.defaultTasksJson).length,
        };
      }),
    };
  }

  /** Called inside the caller's transaction; does nothing if a workflow already exists. */
  copy(input: {
    readonly engagementId: string;
    readonly eventId: string;
    readonly actorId: string;
    readonly at: number;
    readonly choice: WorkflowChoice | undefined;
  }): void {
    if (this.#deps.workflows.forCompetition(input.engagementId) !== undefined) return;
    const dates = this.#deps.templates.eventDates(input.eventId);
    if (dates === undefined) throw notFound('That event does not exist.');
    const template = this.#template(input.choice, dates.eventType);
    const overrides = input.choice?.dueOverrides ?? {};
    const workflowId = uuid7();
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: input.actorId,
        action: 'workflow.created',
        entityKind: 'competition',
        entityId: input.engagementId,
        summary:
          template === undefined
            ? 'Started a blank workflow'
            : `Copied the “${template.name}” workflow template`,
        diff: {
          templateId: template?.id ?? null,
          templateVersionNo: template?.versionNo ?? null,
          manualDates: Object.keys(overrides).length,
        },
      },
      () => {
        this.#deps.workflows.insertWorkflow({
          id: workflowId,
          engagementId: input.engagementId,
          templateId: template?.id ?? null,
          templateVersionNo: template?.versionNo ?? null,
          at: input.at,
        });
        if (template === undefined) return;
        this.#deps.templates.stages(template.id).forEach((source, index) => {
          const rule = parseRule(source.dueRuleJson);
          const ruled = rule === null ? null : resolveDueAt(rule, dates, APP_TIMEZONE);
          const manual = Object.hasOwn(overrides, source.id);
          const override = overrides[source.id] ?? null;
          const dueAt = manual ? (override === null ? null : Date.parse(override)) : ruled;
          const stageId = uuid7();
          this.#deps.workflows.insertStage({
            id: stageId,
            workflowId,
            position: (index + 1) * POSITION_STEP,
            name: source.name,
            description: source.description,
            weight: source.weight,
            dueAt,
            dueRule: rule,
            // A rule stays a rule even while it gives no date: when the event's date
            // arrives, R100 offers it.
            dueOrigin: manual
              ? dueAt === null
                ? 'NONE'
                : 'MANUAL'
              : rule === null
                ? 'NONE'
                : 'RULE',
          });
          parseTasks(source.defaultTasksJson).forEach((title, at) => {
            this.#deps.workflows.insertTask({
              id: uuid7(),
              stageId,
              position: (at + 1) * POSITION_STEP,
              title,
              assigneeStudentId: null,
              dueAt: null,
            });
          });
        });
      },
    );
  }

  /** R98's seam: registered on the competitions module, run as a competition enters ASSIGNED. */
  readonly onAssigned: OnAssignedHook = (assigned) => {
    this.copy({
      engagementId: assigned.engagementId,
      eventId: assigned.eventId,
      actorId: assigned.actorId,
      at: assigned.at,
      choice: assigned.workflow,
    });
  };
}
