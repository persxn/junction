import type { WorkflowStage, WorkflowView } from '@compintel/contracts';

/**
 * The Competition page's workflow logic that is not drawing (WP-20a step 7):
 * where a keyboard move sends an item (R101's `{beforeId | afterId}`, the
 * server computes the position), the optimistic copies, and the words.
 */

export type Direction = 'up' | 'down';

export type Placement = { readonly beforeId: string } | { readonly afterId: string };

/** Up → before the previous item; down → after the next one; at an end → nothing. */
export function placementFor(
  ids: readonly string[],
  id: string,
  direction: Direction,
): Placement | undefined {
  const index = ids.indexOf(id);
  if (index < 0) return undefined;
  if (direction === 'up') {
    const previous = ids[index - 1];
    return previous === undefined ? undefined : { beforeId: previous };
  }
  const next = ids[index + 1];
  return next === undefined ? undefined : { afterId: next };
}

/** The list as it will look after the move, for the optimistic copy. */
export function reordered<T extends { readonly id: string }>(
  list: readonly T[],
  id: string,
  direction: Direction,
): T[] {
  const index = list.findIndex((item) => item.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  if (item !== undefined) copy.splice(target, 0, item);
  return copy;
}

export function withStage(
  view: WorkflowView,
  stageId: string,
  change: (stage: WorkflowStage) => WorkflowStage,
): WorkflowView {
  return {
    ...view,
    stages: view.stages.map((stage) => (stage.id === stageId ? change(stage) : stage)),
  };
}

/** The optimistic tick: the server's answer replaces it a moment later. */
export function withTaskDone(
  view: WorkflowView,
  stageId: string,
  taskId: string,
  done: boolean,
): WorkflowView {
  return withStage(view, stageId, (stage) => ({
    ...stage,
    status: done && stage.status === 'NOT_STARTED' ? 'IN_PROGRESS' : stage.status,
    tasks: stage.tasks.map((task) => (task.id === taskId ? { ...task, isDone: done } : task)),
  }));
}

export const openTaskCount = (stage: WorkflowStage): number =>
  stage.tasks.filter((task) => !task.isDone).length;

/** "62%" or the reason there is no number (R99 never shows 0 % for "nothing counted"). */
export function progressText(view: Pick<WorkflowView, 'progress' | 'progressReason'>): string {
  if (view.progress === null) return view.progressReason ?? 'No progress yet';
  return `${String(Math.round(view.progress))}%`;
}

export const tasksText = (stage: WorkflowStage): string => {
  const done = stage.tasks.length - openTaskCount(stage);
  return `${String(done)} of ${String(stage.tasks.length)} tasks done`;
};
