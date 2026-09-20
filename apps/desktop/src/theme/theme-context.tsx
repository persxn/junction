import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';

import {
  applyTheme,
  readThemeChoice,
  resolveTheme,
  storeThemeChoice,
  systemTheme,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme.js';

export interface ThemeView {
  /** What the user picked: `light`, `dark` or `system`. */
  readonly choice: ThemeChoice;
  /** What is on screen right now — `system` has already been resolved. */
  readonly resolved: ResolvedTheme;
  readonly setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeView | undefined>(undefined);

/**
 * Owns the theme for the whole app. The logic it wraps lives in `theme.ts`; this
 * is only the React binding — state, the system subscription and the attribute.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [choice, setChoiceState] = useState<ThemeChoice>(readThemeChoice);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  // Windows can change theme while we are running, and WebView2 follows it.
  useEffect(() => watchSystemTheme(setSystem), []);

  const resolved = resolveTheme(choice, system);
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    storeThemeChoice(next);
  }, []);

  const value = useMemo<ThemeView>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeView {
  const value = use(ThemeContext);
  if (value === undefined) {
    throw new Error('useTheme() needs a <ThemeProvider> above it');
  }
  return value;
}
