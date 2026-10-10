import { useEffect, useRef } from 'react';

import { useMotionAllowed } from '../theme/appearance-context.js';

export interface AnimatedCountProps {
  readonly value: number;
  /** How the number is written; the final frame is exactly `format(value)`. */
  readonly format: (value: number) => string;
  readonly durationMs?: number;
  readonly className?: string;
  readonly testId?: string;
}

/**
 * A number that counts up once when it first appears (WP-33, R68: STANDARD and
 * up). React renders the final value — that is what the DOM, a screen reader
 * and a test see — and the count-up only rewrites the text frame by frame
 * afterwards, ending on the same string. At CALM, or while the window is
 * hidden, nothing moves: the number is simply there.
 */
export function AnimatedCount({
  value,
  format,
  durationMs = 600,
  className,
  testId,
}: AnimatedCountProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const motion = useMotionAllowed();
  const final = format(value);

  useEffect(() => {
    // The text node React rendered: rewritten in place, never replaced, so
    // React keeps owning it and its next render lands on the same node.
    const text = ref.current?.firstChild;
    if (!(text instanceof Text) || !motion || value <= 0) return;
    let frame = 0;
    let started: number | undefined;
    const step = (time: number): void => {
      started ??= time;
      const t = Math.min(1, Math.max(0, (time - started) / durationMs));
      const eased = 1 - (1 - t) ** 3;
      text.nodeValue = t < 1 ? format(Math.round(value * eased)) : final;
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      text.nodeValue = final;
    };
    // `format` is a pure formatter; the string it makes is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, final, motion, durationMs]);

  return (
    <span ref={ref} className={className} data-testid={testId}>
      {final}
    </span>
  );
}
