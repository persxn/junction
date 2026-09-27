import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

import { axeMatchers } from './axe.js';
import { setSystemTheme } from './match-media.js';

/**
 * The jsdom project's setup (vitest.config.ts). Three jobs: the DOM matchers,
 * the axe matcher, and the handful of browser APIs jsdom does not implement but
 * the UI libraries assume exist.
 */

expect.extend(axeMatchers);

// Every screen is a lazy route since pre-M2a, so entering one waits on a dynamic
// import as well as on a render. Under a full suite that can take longer than the
// one second `findBy*` allows by default, and a test that fails because a chunk
// was still loading is noise. Five seconds is still a quarter of the 20 s ceiling
// ruling R89 puts on any test in `pnpm verify`.
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no `matchMedia`. The theme reads it, and so does anything that asks
// about reduced motion, so every test starts from a known system state.
setSystemTheme('light');

// cmdk scrolls the selected item into view on every arrow key; jsdom has no
// layout, so this is a no-op that simply has to exist.
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  value: () => undefined,
  writable: true,
});

// Radix (under cmdk's dialog) measures its content.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {
      /* no layout in jsdom */
    }
    unobserve(): void {
      /* no layout in jsdom */
    }
    disconnect(): void {
      /* no layout in jsdom */
    }
  };
}

// TanStack Router restores scroll position on navigation; jsdom has no layout.
globalThis.scrollTo = () => undefined;

if (!('PointerEvent' in globalThis)) {
  globalThis.PointerEvent = globalThis.MouseEvent as unknown as typeof PointerEvent;
}
for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, {
      value: () => false,
      writable: true,
    });
  }
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});
