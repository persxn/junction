import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` — for countdowns, which must
 * move on their own ("Closes today" at midnight) without reading the clock
 * during render, where it would make the render impure.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
