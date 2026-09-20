import {
  SCRAPEABLE_COMPLIANCE_STATUSES,
  type ComplianceStatus,
  type ScrapeErrorKind,
  type ScrapeMethod,
} from '@compintel/contracts';

import { isPathAllowed } from './paths.js';

/**
 * The compliance gate (§7.2 "enforced in code", ADR-0007, ruling R60).
 *
 * One pure function, called from two places that must never disagree: the
 * orchestrator asks it before opening a run, and the PoliteHttpClient asks it
 * again before every single request. The second call is not redundant — an
 * adapter builds URLs at run time, and the only honest way to know that none of
 * them leaves the allowance is to check each one.
 *
 * Nothing here does I/O, so every refusal in it is provable on a fake transport
 * rather than by making the request and seeing what happens (R60). That is the
 * point: "we do not call Devpost" is a statement about code that never runs, and
 * the only way to test code that never runs is to test the decision.
 */

/** Why a request was refused. Each one is a different sentence for a person. */
export const GATE_REFUSALS = [
  /** A10/R44: the wizard has not recorded `scraper.contactEmail`. */
  'SETUP_INCOMPLETE',
  /** The verdict is MANUAL_IMPORT_ONLY, PENDING_REVIEW or BLOCKED (D-26). */
  'NOT_APPROVED',
  /** Approved, but an administrator switched it off. */
  'DISABLED',
  /** Not https. §7.2 allows no plaintext and no other scheme. */
  'SCHEME_NOT_ALLOWED',
  /** Not GET or HEAD. Nothing in this app writes to somebody else's server. */
  'METHOD_NOT_ALLOWED',
  /** Outside `allowed_paths_json`, or inside one of its `!` denials. */
  'PATH_NOT_ALLOWED',
  /** robots.txt disallows it, or robots could not be read this run. */
  'ROBOTS_DISALLOWED',
  /** `max_requests_per_run` is spent; the rest continues next run (§7.2). */
  'REQUEST_CAP_REACHED',
] as const;
export type GateRefusal = (typeof GATE_REFUSALS)[number];

/**
 * What robots.txt says about this URL. `UNKNOWN` is "not fetched yet" and is not
 * a refusal — the client fetches robots and asks again. A robots fetch that
 * *timed out* is `DISALLOWED` for the rest of the run, because a host we cannot
 * ask is a host whose answer we do not have.
 */
export type RobotsVerdict = 'ALLOWED' | 'DISALLOWED' | 'UNKNOWN';

export interface GateInput {
  readonly complianceStatus: ComplianceStatus;
  readonly isEnabled: boolean;
  readonly allowedPaths: readonly string[];
  readonly robots: RobotsVerdict;
  readonly url: string;
  readonly method: ScrapeMethod;
  /** §7.2: no scraping runs before the setup wizard is finished. */
  readonly setupComplete: boolean;
  readonly requestsMade: number;
  readonly cap: number;
}

export type GateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly refusal: GateRefusal; readonly reason: string };

const ALLOW: GateDecision = { allowed: true };

function refuse(refusal: GateRefusal, reason: string): GateDecision {
  return { allowed: false, refusal, reason };
}

/**
 * Which `scrape_runs.error_kind` a refusal is recorded as (§6.2's closed enum).
 * Only robots gets its own kind; the rest are our policy, and §7.7 gives them
 * one message between them.
 */
export function refusalErrorKind(refusal: GateRefusal): ScrapeErrorKind {
  return refusal === 'ROBOTS_DISALLOWED' ? 'ROBOTS_DISALLOWED' : 'BLOCKED';
}

/**
 * May this exact request be made?
 *
 * The order is the order a person would want to be told about. "Setup is not
 * finished" and "this source is not approved" are facts about the installation
 * and outrank anything about the URL; the cap is last because it is the only
 * refusal that means "not right now" rather than "not ever".
 */
export function assessRequest(input: GateInput): GateDecision {
  if (!input.setupComplete) {
    return refuse(
      'SETUP_INCOMPLETE',
      'No scraping runs until the setup wizard has recorded a contact e-mail (scraper.contactEmail).',
    );
  }
  if (!SCRAPEABLE_COMPLIANCE_STATUSES.includes(input.complianceStatus)) {
    return refuse(
      'NOT_APPROVED',
      `The compliance verdict for this source is ${input.complianceStatus}, so it makes no requests at all.`,
    );
  }
  if (!input.isEnabled) {
    return refuse('DISABLED', 'This source is switched off.');
  }

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return refuse('PATH_NOT_ALLOWED', `Not a URL: ${input.url}`);
  }
  if (url.protocol !== 'https:') {
    return refuse('SCHEME_NOT_ALLOWED', `Only https is used; this URL is ${url.protocol}//.`);
  }
  if (input.method !== 'GET' && input.method !== 'HEAD') {
    return refuse(
      'METHOD_NOT_ALLOWED',
      `Only GET and HEAD are ever made; this is ${String(input.method)}.`,
    );
  }
  if (!isPathAllowed(url, input.allowedPaths)) {
    return refuse(
      'PATH_NOT_ALLOWED',
      `${url.host}${url.pathname} is outside this source's allowed paths.`,
    );
  }
  if (input.robots === 'DISALLOWED') {
    return refuse('ROBOTS_DISALLOWED', `robots.txt on ${url.host} disallows ${url.pathname}.`);
  }
  if (input.requestsMade >= input.cap) {
    return refuse(
      'REQUEST_CAP_REACHED',
      `This run has already made its ${input.cap} requests; the rest continues next run.`,
    );
  }
  return ALLOW;
}

/**
 * The effective per-host delay (A9/D-28): `max(3 s, source setting, Crawl-delay)`.
 *
 * The 3-second floor is not a default that a source setting replaces — it is a
 * floor, and a source configured to 500 ms still waits 3 seconds.
 */
export const MIN_DELAY_FLOOR_MS = 3_000;

export function effectiveDelayMs(
  sourceMinDelayMs: number,
  robotsCrawlDelaySeconds: number | undefined,
): number {
  const fromRobots =
    robotsCrawlDelaySeconds === undefined || !Number.isFinite(robotsCrawlDelaySeconds)
      ? 0
      : Math.round(robotsCrawlDelaySeconds * 1_000);
  return Math.max(MIN_DELAY_FLOOR_MS, Math.max(0, sourceMinDelayMs), Math.max(0, fromRobots));
}
