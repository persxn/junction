import { openExternalUrl } from '../shell/backend.js';

/**
 * Opening a link that is not ours (§13 "Opening safely", ruling R78).
 *
 * M1 handed the URL to `window.open`. Inside the packaged WebView that call is
 * refused, so "Open registration" was a button that did nothing on the only
 * machine that matters — the built app. R78 moves the hand-off to the shell,
 * which is what §3.2 rule 2 allows IPC for, and the shell refuses anything that
 * is not http, https or mailto.
 *
 * The refusal rules live in Rust, not here: every URL is scraped or typed input,
 * and the check that matters is the one on the side that can start a program.
 * This function keeps a cheap local check so an obviously unopenable link never
 * costs an IPC round trip, and reports `false` either way so the caller can show
 * the URL to copy instead of leaving a dead button.
 */

/** The three schemes §13 allows, matching `external.rs`. */
const OPENABLE = new Set(['http:', 'https:', 'mailto:']);

export function isExternalUrl(url: string): boolean {
  try {
    return OPENABLE.has(new URL(url.trim()).protocol);
  } catch {
    return false;
  }
}

/**
 * Hands a link to the default browser. `false` means it was refused — not an
 * openable URL, or the shell would not open it — and the caller says so rather
 * than leaving a button that appears to do nothing.
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isExternalUrl(url)) {
    return false;
  }
  try {
    await openExternalUrl(url);
    return true;
  } catch {
    return false;
  }
}
