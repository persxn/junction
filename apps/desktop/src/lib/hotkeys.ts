import { useEffect } from 'react';

/**
 * Global keyboard shortcuts (§16.3: "Ctrl+K, `/` focus search, J/K move in lists,
 * Enter open, S save, A assign, Esc close"). WP-06 wires the first two; the rest
 * belong to the screens that have lists.
 *
 * The matching is a pure function so the awkward part — not stealing a keystroke
 * from someone who is typing — is tested without a DOM event loop.
 */

export interface Hotkey {
  /** `event.key`, compared case-insensitively. */
  readonly key: string;
  /** Ctrl (or Cmd) must be held. Defaults to false. */
  readonly ctrl?: boolean;
  /** Fire even while the user is typing in a field. Defaults to false. */
  readonly allowWhileTyping?: boolean;
  readonly onPress: () => void;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Whether the event target is somewhere the user is entering text. A bare `/`
 * must reach a search field as a slash, not as a shortcut.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable === true;
}

export function matchesHotkey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  hotkey: Hotkey,
): boolean {
  if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) {
    return false;
  }
  if (event.altKey) {
    return false;
  }
  const wantsModifier = hotkey.ctrl ?? false;
  const hasModifier = event.ctrlKey || event.metaKey;
  return wantsModifier === hasModifier;
}

/** Binds the shortcuts to the document for as long as the component is mounted. */
export function useGlobalHotkeys(hotkeys: readonly Hotkey[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = isTypingTarget(event.target);
      for (const hotkey of hotkeys) {
        if (typing && hotkey.allowWhileTyping !== true) {
          continue;
        }
        if (matchesHotkey(event, hotkey)) {
          event.preventDefault();
          hotkey.onPress();
          return;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hotkeys]);
}
