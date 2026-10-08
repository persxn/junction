import type { ScheduleHealth, WorkflowView } from '@compintel/contracts';

import type { Principal } from '../modules/auth/types.js';
import type { WorkflowsModule } from '../modules/workflows/wiring.js';

/**
 * WP-20a step 9: the demo competitions' workflows in states that show all five
 * schedule healths (R99) — through the real stage and task writes, so each
 * change is audited like a person's. Synthetic data only (D-33).
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** In R99's order; the open competitions take these in turn. */
export const DEMO_HEALTHS: readonly ScheduleHealth[] = [
  'BLOCKED',
  'OVERDUE',
  'AT_RISK',
  'ON_TRACK',
  'NO_DATES',
];

export function shapeDemoWorkflows(
  workflows: WorkflowsModule,
  competitionIds: readonly string[],
  professor: Principal,
  now: number,
): number {
  const context = { actor: professor };
  const view = (id: string): WorkflowView => workflows.reader.view(professor, id);
  const date = (offset: number): string => new Date(now + offset).toISOString();
  // Every stage dated ahead (or none), so only the shaped stage decides the health.
  const dateAll = (id: string, offsets: (index: number) => number | null): void => {
    view(id).stages.forEach((stage, index) => {
      const offset = offsets(index);
      const current = view(id).stages.find((s) => s.id === stage.id);
      if (current === undefined) return;
      workflows.stages.update(context, id, stage.id, {
        dueAt: offset === null ? null : date(offset),
        version: current.version,
      });
    });
  };
  const tick = (id: string, stageIndex: number, count: number): void => {
    for (let n = 0; n < count; n += 1) {
      const stage = view(id).stages[stageIndex];
      const task = stage?.tasks.find((t) => !t.isDone);
      if (stage === undefined || task === undefined) return;
      workflows.tasks.setDone(context, id, task.id, { done: true, version: stage.version });
    }
  };

  let shaped = 0;
  competitionIds.slice(0, DEMO_HEALTHS.length).forEach((id, index) => {
    const health = DEMO_HEALTHS[index];
    if (view(id).stages.length === 0) return;
    if (health === 'NO_DATES') dateAll(id, () => null);
    else dateAll(id, (i) => (i + 1) * 10 * DAY);
    if (health === 'BLOCKED') {
      const stage = view(id).stages[1] ?? view(id).stages[0];
      if (stage !== undefined) {
        workflows.stages.setStatus(context, id, stage.id, {
          status: 'BLOCKED',
          blockedReason: 'Waiting for the organisers to confirm the venue',
          version: stage.version,
        });
      }
    }
    if (health === 'OVERDUE') {
      const stage = view(id).stages[0];
      if (stage !== undefined) {
        workflows.stages.update(context, id, stage.id, {
          dueAt: date(-3 * DAY),
          version: stage.version,
        });
      }
    }
    if (health === 'AT_RISK') {
      const stage = view(id).stages[0];
      if (stage !== undefined) {
        workflows.stages.update(context, id, stage.id, {
          dueAt: date(20 * HOUR),
          version: stage.version,
        });
      }
    }
    if (health === 'ON_TRACK') tick(id, 0, 2);
    shaped += 1;
  });
  return shaped;
}
