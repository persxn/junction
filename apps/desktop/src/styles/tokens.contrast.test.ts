import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * §16.3 requires body-text contrast >= 4.5:1 in both themes. This reads the
 * token file and measures it, rather than trusting that the palette looks fine:
 * a one-character edit to a hex value is exactly the kind of change that ships
 * an unreadable label.
 *
 * The file is read from disk and parsed as text on purpose. vitest does not
 * process CSS (a `?raw` import of it comes back empty) and jsdom does not resolve
 * `var()`, so asking the DOM for these values would measure nothing — which is
 * also why axe's own `color-contrast` rule is switched off in `testing/axe.ts`
 * and replaced by this.
 */

const STYLES_DIR = 'apps/desktop/src/styles';

/** Finds a stylesheet from wherever vitest was started. */
function readStyle(file: string): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, STYLES_DIR, file);
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
    directory = dirname(directory);
  }
  throw new Error(`could not find ${file} from ${process.cwd()}`);
}

const CSS = readStyle('tokens.css');

type Theme = Record<string, string>;

/**
 * The custom properties a block declares, with `var(--x)` resolved against the
 * same block and then `inherited` — which is how a palette (WP-33, R67) maps a
 * semantic token onto its own `--ctp-*` ramp.
 */
function blockOf(css: string, selector: string, inherited: Theme = {}): Theme {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no "${selector}" block`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  const body = css.slice(start, end);
  const raw = Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
  const resolve = (value: string, depth = 0): string => {
    const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (reference === null || depth > 4) return value;
    const target = raw[reference[1]!] ?? inherited[reference[1]!];
    expect(target, `${value} points at nothing`).toBeDefined();
    return resolve(target!, depth + 1);
  };
  const out: Theme = { ...inherited };
  for (const [name, value] of Object.entries(raw)) {
    const resolved = resolve(value);
    if (/^#[0-9a-f]{6}$/.test(resolved)) out[name] = resolved;
  }
  return out;
}

const light = blockOf(CSS, ':root');
const dark = blockOf(CSS, ":root[data-theme='dark']", light);
const flavour = (name: string, base: Theme): Theme =>
  blockOf(readStyle(`palettes/${name}.css`), `:root[data-flavour='${name}']`, base);

/** R67: five flavours; Classic in both modes, each Catppuccin flavour in its own. */
const THEMES: readonly (readonly [string, Theme])[] = [
  ['classic light', light],
  ['classic dark', dark],
  ['latte (light)', flavour('latte', light)],
  ['frappe (dark)', flavour('frappe', dark)],
  ['macchiato (dark)', flavour('macchiato', dark)],
  ['mocha (dark)', flavour('mocha', dark)],
];

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(theme: Theme, foreground: string, background: string): number {
  const fg = theme[foreground];
  const bg = theme[background];
  expect(fg, `${foreground} is missing`).toBeDefined();
  expect(bg, `${background} is missing`).toBeDefined();
  const [lighter, darker] = [luminance(fg!), luminance(bg!)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Every colour that is ever drawn as text. */
const FOREGROUNDS = [
  '--ci-color-text',
  '--ci-color-text-muted',
  '--ci-color-text-subtle',
  '--ci-color-accent',
  '--ci-color-success',
  '--ci-color-warning',
  '--ci-color-danger',
  '--ci-color-info',
  '--ci-color-urgency-critical',
  '--ci-color-urgency-high',
  '--ci-color-urgency-medium',
  '--ci-color-urgency-low',
  '--ci-color-urgency-none',
] as const;

/** Every surface text can land on. */
const BACKGROUNDS = [
  '--ci-color-surface',
  '--ci-color-surface-raised',
  '--ci-color-surface-sunken',
  '--ci-color-surface-hover',
] as const;

/** Text on a filled control, and a semantic colour on its own quiet fill. */
const PAIRS = [
  ['--ci-color-text-on-accent', '--ci-color-accent'],
  ['--ci-color-accent', '--ci-color-accent-surface'],
  ['--ci-color-success', '--ci-color-success-surface'],
  ['--ci-color-warning', '--ci-color-warning-surface'],
  ['--ci-color-danger', '--ci-color-danger-surface'],
  ['--ci-color-info', '--ci-color-info-surface'],
] as const;

/** Non-text marks that must still be seen: 3:1 against the page (WCAG 1.4.11). */
const BOUNDARIES = [
  '--ci-focus-ring-color',
  '--ci-color-border-strong',
  '--ci-chart-1',
  '--ci-chart-2',
  '--ci-chart-3',
  '--ci-chart-4',
  '--ci-chart-5',
  '--ci-chart-6',
  '--ci-series-1',
  '--ci-series-2',
] as const;

describe.each(THEMES)('the %s theme', (_name, theme) => {
  it.each(FOREGROUNDS)('draws %s at 4.5:1 or better on every surface', (foreground) => {
    for (const background of BACKGROUNDS) {
      expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(PAIRS)('draws %s on %s at 4.5:1 or better', (foreground, background) => {
    expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOUNDARIES)('separates %s from the page at 3:1 or better', (token) => {
    expect(contrast(theme, token, '--ci-color-surface')).toBeGreaterThanOrEqual(3);
  });
});

describe('the palette layer (R67)', () => {
  it('never renames a semantic token: every flavour maps only names Classic defines', () => {
    for (const name of ['latte', 'frappe', 'macchiato', 'mocha']) {
      const css = readStyle(`palettes/${name}.css`);
      for (const [, token] of css.matchAll(/(--ci-[a-z0-9-]+):/g)) {
        expect(CSS, `${name} declares ${token!}, which tokens.css does not`).toContain(
          `${token!}:`,
        );
      }
    }
  });
});

describe('the token file itself', () => {
  it('defines both themes', () => {
    expect(Object.keys(light).length).toBeGreaterThan(20);
    expect(CSS).toContain(":root[data-theme='dark']");
  });

  it('keeps the §16.3 type scale', () => {
    for (const [token, size] of [
      ['--ci-text-xs', '12px'],
      ['--ci-text-sm', '13px'],
      ['--ci-text-base', '14px'],
      ['--ci-text-md', '16px'],
      ['--ci-text-lg', '20px'],
      ['--ci-text-xl', '24px'],
      ['--ci-text-2xl', '32px'],
    ] as const) {
      expect(CSS).toContain(`${token}: ${size};`);
    }
  });

  it('keeps the 4 px spacing grid', () => {
    for (const [index, token] of ['1', '2', '3', '4', '5', '6'].entries()) {
      expect(CSS).toContain(`--ci-space-${token}: ${String((index + 1) * 4)}px;`);
    }
  });

  it('honours reduced motion, and keeps motion inside the 120-200 ms band', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    for (const duration of ['--ci-motion-fast: 120ms', '--ci-motion-slow: 200ms']) {
      expect(CSS).toContain(duration);
    }
  });
});
