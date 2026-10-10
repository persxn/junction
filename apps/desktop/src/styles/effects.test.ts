import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `effects.css` (WP-33, R68), read as text — vitest does not process CSS. The
 * claims under test are structural: CALM has no rule at all, decorative rules
 * are scoped to STANDARD/SHOWCASE, animation touches compositor properties only,
 * and a paused document pauses everything.
 */

function readEffects(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'apps/desktop/src/styles/effects.css');
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    directory = dirname(directory);
  }
  throw new Error('effects.css not found');
}

const CSS = readEffects().replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level rules (not keyframes) as [selector, body]. */
function rules(): [string, string][] {
  const withoutKeyframes = CSS.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  return [...withoutKeyframes.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!]);
}

function keyframes(): [string, string][] {
  return [...CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)].map((m) => [
    m[1]!,
    m[2]!,
  ]);
}

describe('the effect layer', () => {
  it('has rules to check', () => {
    expect(rules().length).toBeGreaterThan(15);
    expect(keyframes().length).toBeGreaterThanOrEqual(6);
  });

  it('declares nothing for CALM: every rule is scoped to standard or showcase', () => {
    expect(CSS).not.toMatch(/data-effects='calm'/);
    for (const [selector] of rules()) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect(part, `"${part.trim()}" is not scoped to a tier`).toMatch(
          /data-effects='(standard|showcase)'/,
        );
      }
    }
  });

  it('animates only transform, opacity and filter', () => {
    for (const [name, body] of keyframes()) {
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const property of properties) {
        expect(
          ['transform', 'opacity', 'filter'],
          `@keyframes ${name} animates ${String(property)}`,
        ).toContain(property);
      }
    }
  });

  it('transitions only transform', () => {
    for (const [, body] of rules()) {
      for (const [, value] of body.matchAll(/transition\s*:\s*([^;]+);/g)) {
        expect(value!.trim().split(/\s+/)[0]).toBe('transform');
      }
    }
  });

  it('pauses every loop while the window is hidden or in the tray, and no one-shot', () => {
    const paused = rules().find(([, body]) => body.includes('animation-play-state: paused'));
    expect(paused, 'no paused rule').toBeDefined();
    const pausedTargets = paused![0]
      .split(/,(?![^(]*\))/)
      .map((part) => part.replace(/^[\s\S]*\[data-paused\]/, '').trim());
    const loops = rules().filter(([, body]) => /animation:[^;]*infinite/.test(body));
    expect(loops.length).toBeGreaterThan(0);
    for (const [selector] of loops) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        // The element the loop runs on, without its tier/preset prefix.
        const target = part
          .replace(/^\s*:root(?::is\([^)]*\)|:not\([^)]*\)|\[[^\]]*\])*\s+/, '')
          .trim();
        expect(pausedTargets, `${target} loops but is never paused`).toContain(target);
      }
    }
    // A one-shot frozen at its first frame would be invisible (opacity 0).
    expect(pausedTargets).not.toContain('.ci-stagger > *');
    expect(pausedTargets.some((target) => target.includes('*'))).toBe(false);
  });

  it('keeps the RGB cycle off text: hue-rotate only on decorative layers', () => {
    for (const [selector, body] of rules()) {
      if (!body.includes('ci-hue')) continue;
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect(part.trim()).toMatch(/::(before|after)$/);
      }
    }
  });
});
