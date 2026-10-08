import type { StageStatus } from '@compintel/contracts';

/**
 * R99's progress arithmetic (A12, §11), pure.
 *
 * Stage: SKIPPED → excluded (null) · COMPLETED → 100, open tasks or not · an
 * override (0 included) → that value, marked manual · tasks → done ÷ total ·
 * else 0. BLOCKED keeps whatever the rest computes.
 *
 * Workflow: Σ(weight × p) ÷ Σ(weight) over the counted (non-SKIPPED) stages;
 * nothing counted, or counted weights summing to 0 → null with its reason.
 */

export interface StageProgressInput {
  readonly status: StageStatus;
  readonly progressOverride: number | null;
  readonly tasksDone: number;
  readonly tasksTotal: number;
}

export interface StageProgress {
  /** 0–100, or null for a SKIPPED stage. */
  readonly value: number | null;
  /** The value is a person's override. */
  readonly manual: boolean;
}

export function stageProgress(stage: StageProgressInput): StageProgress {
  if (stage.status === 'SKIPPED') return { value: null, manual: false };
  if (stage.status === 'COMPLETED') return { value: 100, manual: false };
  if (stage.progressOverride !== null) return { value: stage.progressOverride, manual: true };
  if (stage.tasksTotal > 0) {
    return { value: (stage.tasksDone / stage.tasksTotal) * 100, manual: false };
  }
  return { value: 0, manual: false };
}

export interface WeightedStage {
  readonly weight: number;
  /** From `stageProgress`; null means SKIPPED, which is never counted. */
  readonly progress: number | null;
}

export interface WorkflowProgress {
  readonly value: number | null;
  /** Why there is no number; null when there is one. */
  readonly reason: string | null;
}

export function workflowProgress(stages: readonly WeightedStage[]): WorkflowProgress {
  if (stages.length === 0) return { value: null, reason: 'No stages yet' };
  const counted = stages.filter(
    (stage): stage is { weight: number; progress: number } => stage.progress !== null,
  );
  if (counted.length === 0) return { value: null, reason: 'Every stage is skipped' };
  const weights = counted.reduce((sum, stage) => sum + stage.weight, 0);
  if (weights === 0) return { value: null, reason: 'Every counted stage has weight 0' };
  const total = counted.reduce((sum, stage) => sum + stage.weight * stage.progress, 0);
  return { value: total / weights, reason: null };
}

/** One decimal at most, for the screen: 66.666… → 66.7, 50 → 50. */
export function roundProgress(value: number): number {
  return Math.round(value * 10) / 10;
}
