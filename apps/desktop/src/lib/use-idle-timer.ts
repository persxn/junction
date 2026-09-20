import { useEffect, useRef } from 'react';

/** What counts as the user still being there. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Calls `onIdle` after `minutes` without any sign of the user (§10.5).
 *
 * The server is the authority: `idle_expires_at` is what actually ends the
 * session, and this only decides when to put the lock screen up. That is why it
 * is allowed to be approximate, and why a machine that was asleep comes back to
 * a locked screen either way.
 */
export function useIdleTimer(minutes: number | undefined, onIdle: () => void): void {
  const callback = useRef(onIdle);

  // In an effect rather than in the render body: a ref written during render is
  // a render with a side effect, which React may throw away and run again.
  useEffect(() => {
    callback.current = onIdle;
  });

  useEffect(() => {
    if (minutes === undefined || minutes <= 0) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        callback.current();
      }, minutes * 60_000);
    };

    arm();
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, arm, { passive: true });
    }
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, arm);
      }
    };
  }, [minutes]);
}
