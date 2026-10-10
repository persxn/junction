/**
 * WP-34 (O-6): a student who has just finished the wizard goes straight into the
 * app as the guest, on either student mode — the sign-in screen would only ask
 * them a question they answered a moment ago. The wizard marks it; the auth
 * provider, mounted right after, takes it once. Module memory, not storage: it
 * is about this window, this minute, and must not survive a restart.
 */

let justSetUp = false;

export function markJustSetUp(): void {
  justSetUp = true;
}

/** True once after `markJustSetUp`, then false. */
export function takeJustSetUp(): boolean {
  const value = justSetUp;
  justSetUp = false;
  return value;
}
