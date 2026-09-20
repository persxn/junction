import { useEffect, useState } from 'react';

/**
 * False until the component has been mounted for `delayMs`, then true.
 *
 * This is what stops a loading state from flickering: §16.3 asks for "skeletons
 * for loads > 150 ms", which means a load that finishes in 40 ms must show
 * nothing at all rather than one frame of grey boxes. The component that is
 * waiting unmounts when the wait ends, so there is nothing to reset.
 */
export function useElapsed(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setElapsed(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs]);

  return elapsed;
}
