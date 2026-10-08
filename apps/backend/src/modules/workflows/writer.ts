import type { WorkflowView } from '@compintel/contracts';

import { place } from '../../domain/workflows/order.js';
import { withAudit } from '../../platform/audit.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import { stageNotFound, workflowVersionConflict } from './errors.js';
import {
  WorkflowReader,
  type WorkflowsContext,
  type WorkflowsDependencies,
} from './workflow-reader.js';
import type { StageRecord, WorkflowRecord } from './workflow-repo.js';

/**
 * What every workflow write shares: the checks — the competition is open
 * (R97), the caller may edit it (R96's mentors, or an admin), the version is
 * the one the client saw — R101's placement, and the audited unit of work.
 */
export abstract class WorkflowWriter {
  protected readonly deps: WorkflowsDependencies;
  protected readonly clock: Clock;
  protected readonly reader: WorkflowReader;

  constructor(deps: WorkflowsDependencies) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.reader = new WorkflowReader(deps);
  }

  protected view(context: WorkflowsContext, competitionId: string): WorkflowView {
    return this.reader.view(context.actor, competitionId);
  }

  /** For a structural write: checked against the workflow's version. */
  protected guard(
    context: WorkflowsContext,
    competitionId: string,
    version: number,
  ): WorkflowRecord {
    const workflow = this.#allowed(context, competitionId);
    if (workflow.version !== version) throw workflowVersionConflict();
    return workflow;
  }

  /** For a stage's own write: checked against that stage's version. */
  protected guardStage(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    version: number,
  ): { workflow: WorkflowRecord; stage: StageRecord } {
    const workflow = this.#allowed(context, competitionId);
    const stage = this.stageOf(workflow.id, stageId);
    if (stage.version !== version) throw workflowVersionConflict();
    return { workflow, stage };
  }

  protected stageOf(workflowId: string, stageId: string): StageRecord {
    const stage = this.deps.workflows.stage(stageId);
    if (stage?.workflowId !== workflowId) throw stageNotFound();
    return stage;
  }

  /** R101: the server's midpoint; renumbers the workflow's stages when the gap closes. */
  protected placeStage(
    workflowId: string,
    placement: { beforeId?: string | undefined; afterId?: string | undefined },
    itemId: string,
  ): number {
    const others = this.deps.workflows.stages([workflowId]).filter((stage) => stage.id !== itemId);
    const result = place(
      others,
      {
        ...(placement.beforeId === undefined ? {} : { beforeId: placement.beforeId }),
        ...(placement.afterId === undefined ? {} : { afterId: placement.afterId }),
      },
      itemId,
    );
    for (const row of result.renumbered ?? []) {
      if (row.id !== itemId)
        this.deps.workflows.updateStage(row.id, { position: row.position }, false);
    }
    return result.position;
  }

  protected audited(
    context: WorkflowsContext,
    competitionId: string,
    action: string,
    summary: string,
    diff: Record<string, unknown>,
    work: (at: number) => void,
  ): void {
    const at = nowMs(this.clock);
    withAudit(
      this.deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action,
        entityKind: 'competition',
        entityId: competitionId,
        summary,
        diff,
        requestId: context.requestId ?? null,
      },
      () => {
        work(at);
      },
    );
  }

  #allowed(context: WorkflowsContext, competitionId: string): WorkflowRecord {
    const workflow = this.reader.require(competitionId);
    assertCan(context.actor, 'workflow.edit', this.reader.facts(context.actor, competitionId));
    this.reader.requireOpen(competitionId);
    return workflow;
  }
}
