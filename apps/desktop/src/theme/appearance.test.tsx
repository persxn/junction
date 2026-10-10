import { DEFAULT_APPEARANCE, type Appearance } from '@compintel/contracts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setMatchingMedia } from '../testing/match-media.js';
import {
  APPEARANCE_CACHE_KEY,
  attributesFor,
  cacheAppearance,
  effectiveEffects,
  readCachedAppearance,
  REDUCED_MOTION_QUERY,
} from './appearance.js';
import { AppearanceProvider, useAppearance } from './appearance-context.js';
import { ThemeProvider } from './theme-context.js';

/** WP-33 (R67–R68): flavour and tier on <html>, reduced motion, pausing. */

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const SHOWCASE: Appearance = {
  flavourLight: 'latte',
  flavourDark: 'macchiato',
  effects: 'SHOWCASE',
  rgbPreset: { preset: 'SYNTHWAVE', speed: 'FAST' },
};

function Probe(): React.JSX.Element {
  const { effects, paused } = useAppearance();
  return <p data-testid="probe">{`${effects} ${paused ? 'paused' : 'running'}`}</p>;
}

function mount(): void {
  render(
    <ThemeProvider>
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    </ThemeProvider>,
  );
}

const html = (): DOMStringMap => document.documentElement.dataset;

beforeEach(() => {
  localStorage.clear();
  setMatchingMedia([]);
});
afterEach(() => {
  setMatchingMedia([]);
});

describe('the appearance rules', () => {
  it('forces CALM under reduced motion, whatever is stored', () => {
    expect(effectiveEffects('SHOWCASE', true)).toBe('CALM');
    expect(effectiveEffects('SHOWCASE', false)).toBe('SHOWCASE');
  });

  it('turns RGB on only at SHOWCASE', () => {
    expect(attributesFor(SHOWCASE, 'light', false).rgb).toBe('synthwave');
    expect(attributesFor({ ...SHOWCASE, effects: 'STANDARD' }, 'light', false).rgb).toBe('off');
    expect(attributesFor(SHOWCASE, 'light', true).rgb).toBe('off');
  });

  it('picks the flavour for the mode on screen', () => {
    expect(attributesFor(SHOWCASE, 'light', false).flavour).toBe('latte');
    expect(attributesFor(SHOWCASE, 'dark', false).flavour).toBe('macchiato');
  });

  it('falls back field by field for an unknown cached flavour or preset', () => {
    localStorage.setItem(
      APPEARANCE_CACHE_KEY,
      JSON.stringify({
        ...SHOWCASE,
        flavourDark: 'neon',
        rgbPreset: { preset: 'DISCO', speed: 'FAST' },
      }),
    );
    expect(readCachedAppearance()).toEqual({
      ...SHOWCASE,
      flavourDark: DEFAULT_APPEARANCE.flavourDark,
      rgbPreset: { preset: 'OFF', speed: 'FAST' },
    });
    localStorage.setItem(APPEARANCE_CACHE_KEY, '{not json');
    expect(readCachedAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('<AppearanceProvider>', () => {
  it('writes the flavour and tier on <html>', () => {
    cacheAppearance(SHOWCASE);
    mount();
    expect(html().flavour).toBe('latte');
    expect(html().effects).toBe('showcase');
    expect(html().rgb).toBe('synthwave');
    expect(html().rgbSpeed).toBe('fast');
  });

  it('renders CALM when the system asks for reduced motion, even with SHOWCASE stored', () => {
    cacheAppearance(SHOWCASE);
    setMatchingMedia([REDUCED_MOTION_QUERY]);
    mount();
    expect(html().effects).toBe('calm');
    expect(html().rgb).toBe('off');
    expect(screen.getByTestId('probe').textContent).toBe('CALM running');
  });

  it('follows the system setting changing while open', () => {
    cacheAppearance(SHOWCASE);
    mount();
    expect(html().effects).toBe('showcase');
    act(() => {
      setMatchingMedia([REDUCED_MOTION_QUERY]);
    });
    expect(html().effects).toBe('calm');
  });

  it('pauses decorative animation when the document is hidden', () => {
    cacheAppearance(SHOWCASE);
    mount();
    expect(html().paused).toBeUndefined();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(html().paused).toBe('');
    expect(screen.getByTestId('probe').textContent).toBe('SHOWCASE paused');
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(html().paused).toBeUndefined();
    visibility.mockRestore();
  });
});
