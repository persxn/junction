import { readLocal, writeLocal } from '../lib/storage.js';

/**
 * Theme resolution (ARCHITECTURE.md §16.3, "follows the system light/dark theme").
 *
 * Three choices, two outcomes: `system` is not a theme, it is a rule for picking
 * one. WebView2 follows Windows, so `prefers-color-scheme` is the system answer
 * and it can change while the app is open.
 *
 * The preference is per-machine and per-viewer — it is not account data and must
 * not travel — so it lives in `localStorage`, never in the backend.
 */

/** What the user picked. */
export const THEME_CHOICES = ['light', 'dark', 'system'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** What is actually rendered; this is what `data-theme` carries. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'compintel.theme';

/** The media query the system answer comes from. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice);
}

/** The remembered choice; `system` when nothing is stored or it is unreadable. */
export function readThemeChoice(): ThemeChoice {
  const stored = readLocal(THEME_STORAGE_KEY);
  return isThemeChoice(stored) ? stored : 'system';
}

export function storeThemeChoice(choice: ThemeChoice): void {
  writeLocal(THEME_STORAGE_KEY, choice);
}

/**
 * What Windows is currently set to. `matchMedia` is missing in some test
 * environments and can throw behind a strict policy, so a failure means "light" —
 * the safe default, never an exception on the render path.
 */
export function systemTheme(): ResolvedTheme {
  try {
    return globalThis.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function resolveTheme(choice: ThemeChoice, system: ResolvedTheme): ResolvedTheme {
  return choice === 'system' ? system : choice;
}

/** Writes `data-theme` on `<html>`, which is what `tokens.css` keys off. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Called from `main.tsx` before the first render, so the very first paint is
 * already the right theme instead of flashing light and correcting itself.
 */
export function applyStoredTheme(): ResolvedTheme {
  const theme = resolveTheme(readThemeChoice(), systemTheme());
  applyTheme(theme);
  return theme;
}

/**
 * Subscribes to Windows changing its theme while the app is open. Returns an
 * unsubscribe function; if `matchMedia` is unavailable it is a no-op, so callers
 * never have to check.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  let query: MediaQueryList;
  try {
    query = globalThis.matchMedia(DARK_SCHEME_QUERY);
  } catch {
    return () => undefined;
  }
  const handler = (event: MediaQueryListEvent): void => {
    onChange(event.matches ? 'dark' : 'light');
  };
  query.addEventListener('change', handler);
  return () => {
    query.removeEventListener('change', handler);
  };
}
