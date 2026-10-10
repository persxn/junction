import { useElapsed } from '../lib/use-elapsed.js';

/** §16.3: "skeletons for loads > 150 ms". Below that, show nothing at all. */
export const SKELETON_DELAY_MS = 150;

export interface SkeletonProps {
  /** How many placeholder lines to draw. */
  readonly lines?: number;
  /** What is loading, announced to screen readers. */
  readonly label?: string;
  /** Overrides the 150 ms threshold; the tests use it, screens should not. */
  readonly delayMs?: number;
}

/**
 * A loading placeholder that appears only once the wait is long enough to be
 * worth acknowledging. Rendering it unconditionally is the bug this prevents: a
 * fast local query would flash grey boxes for two frames on every navigation.
 */
export function Skeleton({
  lines = 3,
  label = 'Loading',
  delayMs = SKELETON_DELAY_MS,
}: SkeletonProps): React.JSX.Element | null {
  const visible = useElapsed(delayMs);
  if (!visible) {
    return null;
  }
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_unused, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="ci-skeleton-bar block h-3 rounded-sm bg-surface-sunken"
          style={{ width: `${String(100 - index * 12)}%` }}
        />
      ))}
    </div>
  );
}
