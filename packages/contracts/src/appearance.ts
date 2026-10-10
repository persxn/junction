import { z } from 'zod';

/**
 * Appearance (WP-33, ADR-0019, rulings R67–R68). Per user, stored through the
 * setting registry, so a choice survives sign-out and follows the account to
 * another machine. The light/dark/system *mode* stays WP-06's per-machine
 * choice; it decides which of the two flavours below applies.
 */

/** Flavours that render as a light theme. Classic = WP-06's neutrals. */
export const LIGHT_FLAVOURS = ['latte', 'classic'] as const;
export const LightFlavour = z.enum(LIGHT_FLAVOURS);
export type LightFlavour = z.infer<typeof LightFlavour>;

/** Flavours that render as a dark theme. */
export const DARK_FLAVOURS = ['mocha', 'macchiato', 'frappe', 'classic'] as const;
export const DarkFlavour = z.enum(DARK_FLAVOURS);
export type DarkFlavour = z.infer<typeof DarkFlavour>;

export type Flavour = LightFlavour | DarkFlavour;

export const FLAVOUR_LABELS: Readonly<Record<Flavour, string>> = {
  latte: 'Catppuccin Latte',
  frappe: 'Catppuccin Frappé',
  macchiato: 'Catppuccin Macchiato',
  mocha: 'Catppuccin Mocha',
  classic: 'Classic',
};

/** R68: one setting, three tiers. CALM is forced by reduced-motion. */
export const EFFECT_TIERS = ['CALM', 'STANDARD', 'SHOWCASE'] as const;
export const EffectTier = z.enum(EFFECT_TIERS);
export type EffectTier = z.infer<typeof EffectTier>;

export const EFFECT_TIER_LABELS: Readonly<Record<EffectTier, string>> = {
  CALM: 'Calm',
  STANDARD: 'Standard',
  SHOWCASE: 'Showcase',
};

/** RGB hue-cycle presets (R68): borders, glows and accent fills only. */
export const RGB_PRESETS = ['OFF', 'AURORA', 'SYNTHWAVE', 'MOCHA_GLOW'] as const;
export const RgbPresetName = z.enum(RGB_PRESETS);
export type RgbPresetName = z.infer<typeof RgbPresetName>;

export const RGB_PRESET_LABELS: Readonly<Record<RgbPresetName, string>> = {
  OFF: 'Off',
  AURORA: 'Aurora',
  SYNTHWAVE: 'Synthwave',
  MOCHA_GLOW: 'Mocha Glow',
};

export const RGB_SPEEDS = ['STATIC', 'SLOW', 'MEDIUM', 'FAST'] as const;
export const RgbSpeed = z.enum(RGB_SPEEDS);
export type RgbSpeed = z.infer<typeof RgbSpeed>;

export const RGB_SPEED_LABELS: Readonly<Record<RgbSpeed, string>> = {
  STATIC: 'Static',
  SLOW: 'Slow',
  MEDIUM: 'Medium',
  FAST: 'Fast',
};

export const RgbPreset = z.object({ preset: RgbPresetName, speed: RgbSpeed }).strict();
export type RgbPreset = z.infer<typeof RgbPreset>;

export const Appearance = z
  .object({
    flavourLight: LightFlavour,
    flavourDark: DarkFlavour,
    effects: EffectTier,
    rgbPreset: RgbPreset,
  })
  .strict();
export type Appearance = z.infer<typeof Appearance>;

export const DEFAULT_APPEARANCE: Appearance = {
  flavourLight: 'latte',
  flavourDark: 'mocha',
  effects: 'STANDARD',
  rgbPreset: { preset: 'OFF', speed: 'MEDIUM' },
};

/** `PUT /me/appearance`: any subset; what is left out keeps its value. */
export const AppearanceInput = Appearance.partial().strict();
export type AppearanceInput = z.infer<typeof AppearanceInput>;

/**
 * Reads any stored or cached value, field by field: an unknown flavour or
 * preset falls back to that field's default rather than rendering unstyled.
 */
export function coerceAppearance(raw: unknown): Appearance {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  const rgb =
    typeof record.rgbPreset === 'object' && record.rgbPreset !== null
      ? (record.rgbPreset as Record<string, unknown>)
      : {};
  return {
    flavourLight: pick(LightFlavour, record.flavourLight, DEFAULT_APPEARANCE.flavourLight),
    flavourDark: pick(DarkFlavour, record.flavourDark, DEFAULT_APPEARANCE.flavourDark),
    effects: pick(EffectTier, record.effects, DEFAULT_APPEARANCE.effects),
    rgbPreset: {
      preset: pick(RgbPresetName, rgb.preset, DEFAULT_APPEARANCE.rgbPreset.preset),
      speed: pick(RgbSpeed, rgb.speed, DEFAULT_APPEARANCE.rgbPreset.speed),
    },
  };
}
