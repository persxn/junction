import {
  coerceAppearance,
  DEFAULT_APPEARANCE,
  type Appearance,
  type EffectTier,
  type Flavour,
} from '@compintel/contracts';

import { readLocal, writeLocal } from '../lib/storage.js';
import type { ResolvedTheme } from './theme.js';

/**
 * Appearance on screen (WP-33, ADR-0019, R67–R68). The account's choice lives
 * in the backend's setting registry; this file turns it into four attributes on
 * `<html>` that the stylesheets key off:
 *
 *   data-flavour   which palette (`palettes/*.css`) maps the `--ci-*` tokens
 *   data-effects   `calm` | `standard` | `showcase` (`effects.css`)
 *   data-rgb       the RGB preset, only ever set at SHOWCASE
 *   data-rgb-speed how fast it cycles
 *
 * A copy is cached per machine so the first paint after a restart is already
 * the right flavour; the server's answer replaces it once signed in.
 */

export const APPEARANCE_CACHE_KEY = 'junction.appearance';

/** R68: the system asking for less motion forces CALM, whatever is stored. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function readCachedAppearance(): Appearance {
  const raw = readLocal(APPEARANCE_CACHE_KEY);
  if (raw === undefined) return DEFAULT_APPEARANCE;
  try {
    return coerceAppearance(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function cacheAppearance(appearance: Appearance): void {
  writeLocal(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
}

export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** Subscribes to the system motion setting; a no-op where `matchMedia` is missing. */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  let query: MediaQueryList;
  try {
    query = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  } catch {
    return () => undefined;
  }
  const handler = (event: MediaQueryListEvent): void => {
    onChange(event.matches);
  };
  query.addEventListener('change', handler);
  return () => {
    query.removeEventListener('change', handler);
  };
}

/** The tier actually rendered. */
export function effectiveEffects(stored: EffectTier, reducedMotion: boolean): EffectTier {
  return reducedMotion ? 'CALM' : stored;
}

/** The flavour for the theme on screen: light picks `flavourLight`, dark `flavourDark`. */
export function flavourFor(appearance: Appearance, theme: ResolvedTheme): Flavour {
  return theme === 'dark' ? appearance.flavourDark : appearance.flavourLight;
}

export interface AppearanceAttributes {
  readonly flavour: Flavour;
  readonly effects: EffectTier;
  /** `off` unless the tier is SHOWCASE. */
  readonly rgb: string;
  readonly rgbSpeed: string;
}

export function attributesFor(
  appearance: Appearance,
  theme: ResolvedTheme,
  reducedMotion: boolean,
): AppearanceAttributes {
  const effects = effectiveEffects(appearance.effects, reducedMotion);
  const rgbOn = effects === 'SHOWCASE' && appearance.rgbPreset.preset !== 'OFF';
  return {
    flavour: flavourFor(appearance, theme),
    effects,
    rgb: rgbOn ? appearance.rgbPreset.preset.toLowerCase().replace('_', '-') : 'off',
    rgbSpeed: appearance.rgbPreset.speed.toLowerCase(),
  };
}

export function applyAppearance(attributes: AppearanceAttributes): void {
  const { dataset } = document.documentElement;
  dataset.flavour = attributes.flavour;
  dataset.effects = attributes.effects.toLowerCase();
  dataset.rgb = attributes.rgb;
  dataset.rgbSpeed = attributes.rgbSpeed;
}

/** Called from `main.tsx` before the first paint, after `applyStoredTheme`. */
export function applyCachedAppearance(theme: ResolvedTheme): void {
  applyAppearance(attributesFor(readCachedAppearance(), theme, prefersReducedMotion()));
}

/**
 * Decorative animation stops while nobody can see it (R68, WP-32's soak):
 * `data-paused` on `<html>` pauses every animation in `effects.css`.
 */
export function setPaused(paused: boolean): void {
  if (paused) document.documentElement.dataset.paused = '';
  else delete document.documentElement.dataset.paused;
}

export function isPaused(): boolean {
  return document.documentElement.dataset.paused !== undefined;
}
