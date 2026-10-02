/**
 * What one run has spent, shared by every view of its client.
 *
 * A run hands its adapter more than one {@link PoliteHttpClient} — an anonymous
 * one for the listing walk and, for a stored event's detail page, one that may
 * read signed in (R75) — and both must draw on the same budget. A second
 * client with a fresh count would be a second allowance, which is the bug the
 * per-run cap exists to make impossible. So the counts live here, in one object
 * the views share, and nowhere else.
 */
export interface RunLedger {
  /** Every request made, signed in or not: `scrape_runs.requests_made`. */
  requestsMade: number;
  /** R75: requests that carried the professor's session. */
  signedInMade: number;
  /** When the last signed-in request was sent, so the next waits its turn. */
  lastSignedInAt: number | undefined;
  /** R80: the site refused the session this run; it is not offered again. */
  sessionRejected: boolean;
  /** R80: the site refused the API key this run. */
  credentialRejected: boolean;
  /** R77: the exemption line is logged once per run, not once per request. */
  exemptionLogged: boolean;
  /** Hosts whose robots.txt could not be read; skipped for the rest of the run. */
  readonly unreadableHosts: Set<string>;
}

export function newRunLedger(): RunLedger {
  return {
    requestsMade: 0,
    signedInMade: 0,
    lastSignedInAt: undefined,
    sessionRejected: false,
    credentialRejected: false,
    exemptionLogged: false,
    unreadableHosts: new Set<string>(),
  };
}
