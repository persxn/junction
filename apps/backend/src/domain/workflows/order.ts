/**
 * R101's ordering, pure: positions are REAL, first written 1024 apart; a move
 * takes the midpoint of its neighbours, computed here from `{beforeId |
 * afterId}` — a client never sends a float — and when a gap falls below 1e-6
 * the whole list is renumbered 1024, 2048, … in the same transaction.
 */

export const POSITION_STEP = 1024;
export const MIN_GAP = 1e-6;

export interface Positioned {
  readonly id: string;
  readonly position: number;
}

/** The midpoint of two neighbours; an open end steps a whole 1024 away. */
export function midpoint(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return POSITION_STEP;
  if (before === undefined) return after! - POSITION_STEP;
  if (after === undefined) return before + POSITION_STEP;
  return (before + after) / 2;
}

/** True when two neighbours are too close for another midpoint to stay distinct. */
export function needsRenumber(a: number, b: number): boolean {
  return Math.abs(b - a) < MIN_GAP;
}

export interface Placement {
  readonly beforeId?: string;
  readonly afterId?: string;
}

export interface PlacementResult {
  readonly position: number;
  /** Set when the gap closed: every row's new position, in order. */
  readonly renumbered: readonly Positioned[] | undefined;
}

/**
 * Where an item goes among `rows` (sorted by position, the item itself left
 * out): just before `beforeId`, just after `afterId`, or at the end. Returns
 * the new position, and — if that would leave a gap under 1e-6 — the renumbered
 * list with the item already placed, for the caller to write in one transaction.
 */
export function place(
  rows: readonly Positioned[],
  placement: Placement,
  itemId: string,
): PlacementResult {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  let index = sorted.length;
  if (placement.beforeId !== undefined) {
    const found = sorted.findIndex((row) => row.id === placement.beforeId);
    if (found >= 0) index = found;
  } else if (placement.afterId !== undefined) {
    const found = sorted.findIndex((row) => row.id === placement.afterId);
    if (found >= 0) index = found + 1;
  }
  const before = sorted[index - 1]?.position;
  const after = sorted[index]?.position;
  const position = midpoint(before, after);
  const tight =
    (before !== undefined && needsRenumber(before, position)) ||
    (after !== undefined && needsRenumber(position, after));
  if (!tight) return { position, renumbered: undefined };
  const order = [...sorted.slice(0, index), { id: itemId, position }, ...sorted.slice(index)];
  const renumbered = order.map((row, at) => ({ id: row.id, position: (at + 1) * POSITION_STEP }));
  return {
    position: renumbered[index]?.position ?? position,
    renumbered,
  };
}
