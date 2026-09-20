import { describe, expect, it, vi } from 'vitest';

import { isTypingTarget, matchesHotkey, type Hotkey } from './hotkeys.js';
import { readLocal, writeLocal } from './storage.js';
import { absoluteTime, relativeTime } from './time.js';

const noop = (): void => undefined;
const hotkey = (partial: Partial<Hotkey>): Hotkey => ({ key: 'k', onPress: noop, ...partial });

function keyEvent(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>> = {},
): Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe('matching a shortcut (§16.3)', () => {
  it('matches Ctrl+K and Cmd+K', () => {
    const shortcut = hotkey({ key: 'k', ctrl: true });
    expect(matchesHotkey(keyEvent('k', { ctrlKey: true }), shortcut)).toBe(true);
    expect(matchesHotkey(keyEvent('K', { metaKey: true }), shortcut)).toBe(true);
  });

  it('does not match a bare k when Ctrl is required', () => {
    expect(matchesHotkey(keyEvent('k'), hotkey({ key: 'k', ctrl: true }))).toBe(false);
  });

  it('does not match Ctrl+/ when a bare / is wanted', () => {
    expect(matchesHotkey(keyEvent('/', { ctrlKey: true }), hotkey({ key: '/' }))).toBe(false);
    expect(matchesHotkey(keyEvent('/'), hotkey({ key: '/' }))).toBe(true);
  });

  it('never matches when Alt is held, so menu shortcuts are left alone', () => {
    expect(
      matchesHotkey(keyEvent('k', { ctrlKey: true, altKey: true }), hotkey({ ctrl: true })),
    ).toBe(false);
  });
});

describe('not stealing a keystroke from someone typing', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('treats a %s as a typing target', (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it('treats a contenteditable as a typing target', () => {
    const element = document.createElement('div');
    element.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(element, 'isContentEditable', { value: true });
    expect(isTypingTarget(element)).toBe(true);
  });

  it('does not treat a button or nothing at all as a typing target', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('localStorage wrappers', () => {
  it('round-trips a value', () => {
    writeLocal('compintel.test', 'value');
    expect(readLocal('compintel.test')).toBe('value');
  });

  it('returns undefined for a key that was never written', () => {
    expect(readLocal('compintel.absent')).toBeUndefined();
  });

  it('survives a store that throws on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLocal('compintel.test')).toBeUndefined();
    expect(() => {
      writeLocal('compintel.test', 'value');
    }).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('relative time', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it.each([
    [10_000, 'just now'],
    [4 * 60_000, '4 minutes ago'],
    [3 * 3_600_000, '3 hours ago'],
    [2 * 86_400_000, '2 days ago'],
  ])('describes %d ms ago as "%s"', (ago, expected) => {
    expect(relativeTime(new Date(now.getTime() - ago), now)).toBe(expected);
  });

  it('handles the future too', () => {
    expect(relativeTime(new Date(now.getTime() + 2 * 3_600_000), now)).toBe('in 2 hours');
  });

  it('has an absolute form for tooltips', () => {
    expect(absoluteTime(new Date('2026-09-20T12:00:00.000Z'))).toMatch(/2026/);
  });
});
