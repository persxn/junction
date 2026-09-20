/**
 * The session-token seam (ADR-0017).
 *
 * WP-07a owns login, sessions and the lock screen. All WP-06 does is decide where
 * the token lives and who reads it, so that the API client can already send
 * `Authorization` the moment there is something to send.
 *
 * Memory only, on purpose: ADR-0017 keeps session tokens out of cookies and out of
 * storage, so closing the window ends the session's presence on this machine.
 * There is deliberately no persistence hook here to be tempted by later.
 */

let sessionToken: string | undefined;

/** The current bearer token, or `undefined` while nobody is signed in. */
export function authToken(): string | undefined {
  return sessionToken;
}

/** Set on sign-in; cleared on sign-out, lock and on any 401 (WP-07a). */
export function setAuthToken(token: string | undefined): void {
  sessionToken = token;
}
