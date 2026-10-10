import {
  coerceAppearance,
  DEFAULT_APPEARANCE,
  type Appearance,
  type AppearanceInput,
} from '@compintel/contracts';
import { z } from 'zod';

import { define, type SettingDefinition, type SettingsStore } from '../../platform/settings.js';

/**
 * Appearance (WP-33, R67–R68): four registry keys, each holding one value per
 * user, keyed by user id. The registry is the single place settings live
 * (§6.2); keying inside the value is what makes them per user without a table.
 *
 * Values are stored loosely (`unknown` per user) and read through
 * {@link coerceAppearance}, so a value an older or newer build wrote — an
 * unknown flavour, a removed preset — falls back to that field's default
 * instead of failing the whole read.
 */

const PerUser = z.record(z.string().min(1).max(64), z.unknown());
type PerUser = z.infer<typeof PerUser>;

export const APPEARANCE_FLAVOUR_LIGHT = define('appearance.flavourLight', {
  schema: PerUser,
  default: {},
  description: 'Each user’s light flavour: Catppuccin Latte (default) or Classic (WP-33, R67).',
});

export const APPEARANCE_FLAVOUR_DARK = define('appearance.flavourDark', {
  schema: PerUser,
  default: {},
  description:
    'Each user’s dark flavour: Catppuccin Mocha (default), Macchiato, Frappé or Classic (R67).',
});

export const APPEARANCE_EFFECTS = define('appearance.effects', {
  schema: PerUser,
  default: {},
  description: 'Each user’s effect tier: Calm, Standard (default) or Showcase (WP-33, R68).',
});

export const APPEARANCE_RGB_PRESET = define('appearance.rgbPreset', {
  schema: PerUser,
  default: {},
  description: 'Each user’s RGB preset and speed; used only at Showcase (WP-33, R68).',
});

const FIELDS: readonly (readonly [keyof Appearance, SettingDefinition<PerUser>])[] = [
  ['flavourLight', APPEARANCE_FLAVOUR_LIGHT],
  ['flavourDark', APPEARANCE_FLAVOUR_DARK],
  ['effects', APPEARANCE_EFFECTS],
  ['rgbPreset', APPEARANCE_RGB_PRESET],
];

/** One user's appearance; defaults for anything never chosen or no longer valid. */
export function readAppearance(settings: SettingsStore, userId: string): Appearance {
  const raw: Record<string, unknown> = {};
  for (const [field, definition] of FIELDS) {
    raw[field] = settings.get(definition)[userId] ?? DEFAULT_APPEARANCE[field];
  }
  return coerceAppearance(raw);
}

/** Writes the fields given and returns the whole, effective appearance. */
export function writeAppearance(
  settings: SettingsStore,
  userId: string,
  input: AppearanceInput,
): Appearance {
  for (const [field, definition] of FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    settings.set(definition, { ...settings.get(definition), [userId]: value }, userId);
  }
  return readAppearance(settings, userId);
}
