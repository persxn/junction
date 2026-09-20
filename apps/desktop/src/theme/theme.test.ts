import { afterEach, describe, expect, it, vi } from 'vitest';

import { setSystemTheme } from '../testing/match-media.js';
import {
  applyStoredTheme,
  applyTheme,
  readThemeChoice,
  resolveTheme,
  storeThemeChoice,
  systemTheme,
  THEME_STORAGE_KEY,
  watchSystemTheme,
} from './theme.js';

afterEach(() => {
  vi.restoreAllMocks();
  setSystemTheme('light');
});

describe('the remembered choice', () => {
  it('is "system" when nothing has been stored', () => {
    expect(readThemeChoice()).toBe('system');
  });

  it('round-trips through localStorage', () => {
    storeThemeChoice('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemeChoice()).toBe('dark');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readThemeChoice()).toBe('system');
  });

  it('falls back to "system" when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data is blocked');
    });
    expect(readThemeChoice()).toBe('system');
  });

  it('does not throw when localStorage refuses to be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => {
      storeThemeChoice('dark');
    }).not.toThrow();
  });
});

describe('resolving a choice to a theme', () => {
  it('passes an explicit choice through, whatever Windows says', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('follows the system for "system"', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });
});

describe('the system answer', () => {
  it('reads prefers-color-scheme', () => {
    setSystemTheme('dark');
    expect(systemTheme()).toBe('dark');
    setSystemTheme('light');
    expect(systemTheme()).toBe('light');
  });

  it('is "light" when matchMedia is unavailable', () => {
    vi.spyOn(globalThis, 'matchMedia').mockImplementation(() => {
      throw new Error('not supported');
    });
    expect(systemTheme()).toBe('light');
  });

  it('notifies a watcher when Windows changes theme', () => {
    const seen: string[] = [];
    const stop = watchSystemTheme((theme) => seen.push(theme));
    setSystemTheme('dark');
    setSystemTheme('light');
    stop();
    setSystemTheme('dark');
    expect(seen).toStrictEqual(['dark', 'light']);
  });

  it('hands back a no-op unsubscribe when matchMedia is unavailable', () => {
    vi.spyOn(globalThis, 'matchMedia').mockImplementation(() => {
      throw new Error('not supported');
    });
    expect(() => {
      watchSystemTheme(() => undefined)();
    }).not.toThrow();
  });
});

describe('applying a theme', () => {
  it('writes data-theme on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the stored choice before the first render', () => {
    storeThemeChoice('dark');
    setSystemTheme('light');
    expect(applyStoredTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the system theme when nothing is stored', () => {
    setSystemTheme('dark');
    expect(applyStoredTheme()).toBe('dark');
  });
});
