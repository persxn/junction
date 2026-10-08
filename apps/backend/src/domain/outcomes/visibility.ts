import type { HistoryOutcomeState } from '@compintel/contracts';

/**
 * Whose result is it (R104, WP-21): the team's, shown in a student's history
 * only if they were on the roster when it was recorded.
 */

/** R104: on the roster when the result was recorded — or "Left before the result". */
export function outcomeState(
  addedAt: number,
  removedAt: number | null,
  recordedAt: number | null,
): HistoryOutcomeState {
  if (recordedAt === null) return 'NONE';
  const onRoster = addedAt <= recordedAt && (removedAt === null || removedAt > recordedAt);
  return onRoster ? 'SHOWN' : 'LEFT_BEFORE_RESULT';
}
