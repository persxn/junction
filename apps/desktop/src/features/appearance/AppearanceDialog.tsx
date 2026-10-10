import {
  DARK_FLAVOURS,
  EFFECT_TIER_LABELS,
  EFFECT_TIERS,
  FLAVOUR_LABELS,
  LIGHT_FLAVOURS,
  RGB_PRESET_LABELS,
  RGB_PRESETS,
  RGB_SPEED_LABELS,
  RGB_SPEEDS,
  type EffectTier,
} from '@compintel/contracts';
import { useId } from 'react';

import { Dialog } from '../../components/Dialog.js';
import { Guide } from '../../components/Guide.js';
import { useAppearance } from '../../theme/appearance-context.js';
import { useSaveAppearance } from './AppearanceSync.js';

const TIER_HELP: Readonly<Record<EffectTier, string>> = {
  CALM: 'No decorative motion or glow. Everything still shows its icon and words.',
  STANDARD: 'Subtle: soft gradients, hover glows, shimmering placeholders, counting numbers.',
  SHOWCASE: 'The full treatment: animated borders, glowing urgent deadlines, RGB presets.',
};

/**
 * Appearance (WP-33, R67–R68): which flavour the light and dark modes use, the
 * effect tier, and the RGB preset. Saved to the account, so it follows the
 * person, not the machine. Light, dark or "follow Windows" stays in the menu.
 */
export function AppearanceDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const { appearance, reducedMotion } = useAppearance();
  const save = useSaveAppearance();
  const id = useId();
  const showcase = appearance.effects === 'SHOWCASE';

  return (
    <Dialog title="Appearance" onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-4">
        <Guide id="appearance" title="About appearance">
          <p>
            Pick a colour flavour for light and for dark mode, and how lively the app should be.
            Every flavour keeps text readable — colours that would be too faint for text are only
            used for borders, glows and charts. Your choice is saved to your account.
          </p>
        </Guide>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-light`}>Light flavour</label>
            <select
              id={`${id}-light`}
              value={appearance.flavourLight}
              onChange={(event) => {
                save({ flavourLight: event.target.value as (typeof LIGHT_FLAVOURS)[number] });
              }}
              className="rounded-md border border-line bg-surface px-2 py-1.5"
            >
              {LIGHT_FLAVOURS.map((flavour) => (
                <option key={flavour} value={flavour}>
                  {FLAVOUR_LABELS[flavour]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-dark`}>Dark flavour</label>
            <select
              id={`${id}-dark`}
              value={appearance.flavourDark}
              onChange={(event) => {
                save({ flavourDark: event.target.value as (typeof DARK_FLAVOURS)[number] });
              }}
              className="rounded-md border border-line bg-surface px-2 py-1.5"
            >
              {DARK_FLAVOURS.map((flavour) => (
                <option key={flavour} value={flavour}>
                  {FLAVOUR_LABELS[flavour]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Effects</legend>
          {reducedMotion && (
            <p className="rounded-md bg-info-surface p-2 text-sm text-fg">
              Windows is set to reduce motion, so Junction stays Calm whatever you pick here.
            </p>
          )}
          {EFFECT_TIERS.map((tier) => (
            <label key={tier} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-effects`}
                checked={appearance.effects === tier}
                onChange={() => {
                  save({ effects: tier });
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{EFFECT_TIER_LABELS[tier]}</span>
                <span className="block text-fg-muted">{TIER_HELP[tier]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-rgb`}>RGB preset</label>
            <select
              id={`${id}-rgb`}
              value={appearance.rgbPreset.preset}
              disabled={!showcase}
              aria-describedby={`${id}-rgb-hint`}
              onChange={(event) => {
                save({
                  rgbPreset: {
                    ...appearance.rgbPreset,
                    preset: event.target.value as (typeof RGB_PRESETS)[number],
                  },
                });
              }}
              className="rounded-md border border-line bg-surface px-2 py-1.5 disabled:opacity-60"
            >
              {RGB_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {RGB_PRESET_LABELS[preset]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-speed`}>Speed</label>
            <select
              id={`${id}-speed`}
              value={appearance.rgbPreset.speed}
              disabled={!showcase}
              onChange={(event) => {
                save({
                  rgbPreset: {
                    ...appearance.rgbPreset,
                    speed: event.target.value as (typeof RGB_SPEEDS)[number],
                  },
                });
              }}
              className="rounded-md border border-line bg-surface px-2 py-1.5 disabled:opacity-60"
            >
              {RGB_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {RGB_SPEED_LABELS[speed]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p id={`${id}-rgb-hint`} className="text-xs text-fg-muted">
          RGB presets colour borders and glows only — never text or a status — and only at Showcase.
          They stop whenever the window is hidden or in the tray.
        </p>
      </div>
    </Dialog>
  );
}
