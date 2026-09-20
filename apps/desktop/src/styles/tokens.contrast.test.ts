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

const TOKENS_PATH = 'apps/desktop/src/styles/tokens.css';

/** Finds the token file from wherever vitest was started. */
function readTokensCss(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, TOKENS_PATH);
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
    directory = dirname(directory);
  }
  throw new Error(`could not find ${TOKENS_PATH} from ${process.cwd()}`);
}

const CSS = readTokensCss();

function blockOf(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `tokens.css has no "${selector}" block`).toBeGreaterThanOrEqual(0);
  const end = CSS.indexOf('\n}', start);
  const body = CSS.slice(start, end);
  return Object.fromEntries(
    [...body.matchAll(/(--ci-[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
}

const light = blockOf(':root');
const dark = { ...light, ...blockOf(":root[data-theme='dark']") };
const THEMES: readonly (readonly [string, Record<string, string>])[] = [
  ['light', light],
  ['dark', dark],
];

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(theme: Record<string, string>, foreground: string, background: string): number {
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

describe.each(THEMES)('the %s theme', (_name, theme) => {
  it.each(FOREGROUNDS)('draws %s at 4.5:1 or better on every surface', (foreground) => {
    for (const background of BACKGROUNDS) {
      expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(PAIRS)('draws %s on %s at 4.5:1 or better', (foreground, background) => {
    expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('separates the focus ring from the surface it is drawn on', () => {
    // 3:1 is the WCAG minimum for a non-text indicator.
    expect(contrast(theme, '--ci-focus-ring-color', '--ci-color-surface')).toBeGreaterThanOrEqual(
      3,
    );
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
