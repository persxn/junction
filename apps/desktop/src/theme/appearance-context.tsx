import { DEFAULT_APPEARANCE, type Appearance, type EffectTier } from '@compintel/contracts';
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';

import { onWindowVisibility } from '../shell/visibility.js';
import {
  applyAppearance,
  attributesFor,
  cacheAppearance,
  prefersReducedMotion,
  readCachedAppearance,
  setPaused,
  watchReducedMotion,
} from './appearance.js';
import { useTheme } from './theme-context.js';

export interface AppearanceView {
  /** What the account chose. */
  readonly appearance: Appearance;
  /** What is rendered: CALM whenever the system asks for reduced motion. */
  readonly effects: EffectTier;
  readonly reducedMotion: boolean;
  /** True while the window is hidden, minimised or in the tray. */
  readonly paused: boolean;
  /** Replaces the whole value (the server's answer, or an edit). */
  readonly setAppearance: (next: Appearance) => void;
}

/**
 * Without a provider — a component test rendering one screen — the answer is
 * CALM: nothing animates, so what a test reads is the final text.
 */
const CALM_VIEW: AppearanceView = {
  appearance: DEFAULT_APPEARANCE,
  effects: 'CALM',
  reducedMotion: false,
  paused: false,
  setAppearance: () => undefined,
};

const AppearanceContext = createContext<AppearanceView>(CALM_VIEW);

/** Owns flavour, effect tier and pausing for the whole window (WP-33, R67–R68). */
export function AppearanceProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { resolved } = useTheme();
  const [appearance, setState] = useState<Appearance>(readCachedAppearance);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [inTray, setInTray] = useState(false);

  useEffect(() => watchReducedMotion(setReducedMotion), []);
  useEffect(() => {
    const onChange = (): void => {
      setHidden(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', onChange);
    const stop = onWindowVisibility((visible) => {
      setInTray(!visible);
    });
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      stop();
    };
  }, []);

  const { flavour, effects, rgb, rgbSpeed } = attributesFor(appearance, resolved, reducedMotion);
  useEffect(() => {
    applyAppearance({ flavour, effects, rgb, rgbSpeed });
  }, [flavour, effects, rgb, rgbSpeed]);

  const paused = hidden || inTray;
  useEffect(() => {
    setPaused(paused);
  }, [paused]);

  const setAppearance = useCallback((next: Appearance) => {
    setState(next);
    cacheAppearance(next);
  }, []);

  const value = useMemo<AppearanceView>(
    () => ({
      appearance,
      effects,
      reducedMotion,
      paused,
      setAppearance,
    }),
    [appearance, effects, reducedMotion, paused, setAppearance],
  );
  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}

export function useAppearance(): AppearanceView {
  return use(AppearanceContext);
}

/** True when decorative motion may run right now. */
export function useMotionAllowed(): boolean {
  const { effects, paused } = useAppearance();
  return effects !== 'CALM' && !paused;
}
