/**
 * `localStorage` is per-viewer convenience only: a remembered theme, a collapsed
 * rail. Nothing the app needs to work correctly lives here.
 *
 * Every access is wrapped, because it can throw rather than return nothing —
 * private browsing, blocked site data, a quota that is already full. A UI that
 * only handles "empty" still crashes on "throws", so both are handled once, here.
 */

/** The remembered value, or `undefined` when there is none or it is unreadable. */
export function readLocal(key: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remembers a value. A failure is not an error the user needs to hear about. */
export function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the preference simply will not survive this session.
  }
}
