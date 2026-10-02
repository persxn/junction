/**
 * Whether one request may carry the professor's session (ruling R75).
 *
 * R74 lets the app read Devfolio and Unstop with the professor's own session.
 * R75 narrows *when*: Unstop's Terms let it block every user behind an IP
 * address, and on a campus network that is many students who never accepted
 * the risk. So a listing walk is always anonymous, the session is used only for
 * the targeted reads R75 names, at most five a run, ten seconds apart, and never
 * in a catch-up burst after the machine wakes.
 *
 * Pure, like the compliance gate beside it: the client asks, this answers, and
 * every branch is provable without a transport.
 */

/** The answer: send it signed in, send it anonymously, or do not send it. */
export type SignedInDecision =
  | { readonly send: 'signed-in' }
  | { readonly send: 'anonymous'; readonly reason: AnonymousReason }
  | { readonly send: 'refused'; readonly reason: string };

/**
 * Why a request that asked for the session went out without it. None of these
 * is an error: each is the public reading R74 falls back to.
 */
export type AnonymousReason =
  /** The request did not ask. */
  | 'NOT_ASKED'
  /** None stored, expired, unopenable here (R76), or refused earlier this run (R80). */
  | 'NO_SESSION'
  /** The session is not for this host (R74: its own hosts only). */
  | 'OTHER_HOST'
  /** A listing walk or a catch-up run: R75 says anonymous, whatever was asked. */
  | 'SCOPE';

export interface SignedInInput {
  readonly asked: boolean;
  /** A usable session exists for this source right now. */
  readonly sessionUsable: boolean;
  /** The session's hosts include this request's host. */
  readonly hostMatches: boolean;
  /** The caller's scope is one R75 allows signed-in reading in. */
  readonly scopeAllows: boolean;
  /** Signed-in requests already made this run. */
  readonly made: number;
  readonly maxPerRun: number;
}

/**
 * The order matters. A request that cannot be signed in for a reason outside
 * the adapter's control — no session, another host, a listing walk — goes out
 * anonymously, because that is exactly what it would have been before R74. Only
 * an adapter asking for more than the budget is refused outright: that is the
 * one case where "make it anyway, without the cookie" would hide the overrun.
 */
export function decideSignedIn(input: SignedInInput): SignedInDecision {
  if (!input.asked) {
    return { send: 'anonymous', reason: 'NOT_ASKED' };
  }
  if (!input.sessionUsable) {
    return { send: 'anonymous', reason: 'NO_SESSION' };
  }
  if (!input.hostMatches) {
    return { send: 'anonymous', reason: 'OTHER_HOST' };
  }
  if (!input.scopeAllows) {
    return { send: 'anonymous', reason: 'SCOPE' };
  }
  if (input.made >= input.maxPerRun) {
    return {
      send: 'refused',
      reason: `This run has already made its ${input.maxPerRun} signed-in requests (R75).`,
    };
  }
  return { send: 'signed-in' };
}

/**
 * How long a signed-in request must wait so that it starts at least
 * `minIntervalMs` after the previous one (R75). Zero when there was none.
 */
export function signedInWaitMs(
  lastAt: number | undefined,
  now: number,
  minIntervalMs: number,
): number {
  if (lastAt === undefined) {
    return 0;
  }
  return Math.max(0, lastAt + minIntervalMs - now);
}
