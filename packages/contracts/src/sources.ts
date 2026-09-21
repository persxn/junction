import { z } from 'zod';

import {
  COMPLIANCE_STATUSES,
  ComplianceStatus,
  SCRAPE_ERROR_KINDS,
  ScrapeErrorKind,
} from './enums.js';
import { Uuid7 } from './ids.js';

/**
 * Sources and scrape runs (§6.2 "Sources & ingestion", §7.1, §7.2, §7.6, §7.7).
 *
 * Everything the ingestion pipeline writes to the database, reports in a log
 * line or shows on the Source status screen agrees on the strings in this file.
 * As with the event vocabulary, each enum is one source of truth for three
 * things: the TEXT + CHECK constraint in migration 0005, the zod shape the API
 * validates against, and the union the UI switches on.
 *
 * `ComplianceStatus` and `ScrapeErrorKind` already existed in `enums.ts` — they
 * were written with the WP-02 verdicts, before there was a table to put them in
 * — and are re-exported here so source code has one import.
 */

export { COMPLIANCE_STATUSES, ComplianceStatus, SCRAPE_ERROR_KINDS, ScrapeErrorKind };

/**
 * `sources.adapter` (§6.2). Which code reads this source, not which protocol it
 * speaks: `CTFTIME_API` and `CLIST_API` are both JSON over HTTPS and share
 * nothing else. `MANUAL` and `URL_IMPORT` are sources with no adapter at all —
 * a professor is the transport — and exist so an event created by hand still
 * has a row in `source_records` to point at.
 */
export const ADAPTER_KINDS = [
  'CTFTIME_API',
  'CLIST_API',
  'DEVPOST',
  'DEVFOLIO',
  'UNSTOP',
  'CONFIGURED_LISTING',
  'MANUAL',
  'URL_IMPORT',
] as const;
export const AdapterKind = z.enum(ADAPTER_KINDS);
export type AdapterKind = z.infer<typeof AdapterKind>;

/**
 * `scrape_runs.trigger` (§6.2). The same three values as `JobTrigger`, because a
 * scheduled scrape writes a `job_state` row and a `scrape_runs` row and the two
 * have to say the same thing about why it ran.
 */
export const SCRAPE_TRIGGERS = ['SCHEDULE', 'MANUAL', 'STARTUP_CATCHUP'] as const;
export const ScrapeTrigger = z.enum(SCRAPE_TRIGGERS);
export type ScrapeTrigger = z.infer<typeof ScrapeTrigger>;

/**
 * `scrape_runs.outcome` (§6.2). Three of these are deliberately *not* failures:
 * `SKIPPED_OFFLINE` is D-23 ("offline is not a failure"), `SKIPPED_BACKOFF` is
 * the politeness ladder doing its job, and `BLOCKED_BY_POLICY` is us refusing to
 * make a request — none of them says anything went wrong at the source.
 */
export const SCRAPE_OUTCOMES = [
  'SUCCESS',
  'PARTIAL',
  'FAILED',
  'SKIPPED_OFFLINE',
  'SKIPPED_BACKOFF',
  'BLOCKED_BY_POLICY',
] as const;
export const ScrapeOutcome = z.enum(SCRAPE_OUTCOMES);
export type ScrapeOutcome = z.infer<typeof ScrapeOutcome>;

/** Outcomes that count against `source_state.consecutive_failures` (R59). */
export const FAILING_SCRAPE_OUTCOMES: readonly ScrapeOutcome[] = ['FAILED'];

/**
 * `source_records.presence` (§7.6). `MISSING` means three consecutive *complete*
 * listing runs did not mention the record; it never means cancelled, which only
 * a source statement or a person can decide. `GONE` is a record the source
 * answered 404/410 for.
 */
export const PRESENCES = ['LISTED', 'MISSING', 'GONE'] as const;
export const Presence = z.enum(PRESENCES);
export type Presence = z.infer<typeof Presence>;

/** How a `source_records` row found its `event_id` (§6.2, §7.5; WP-10 fills it). */
export const MATCH_METHODS = ['URL', 'AUTO_SCORE', 'MANUAL', 'NEW'] as const;
export const MatchMethod = z.enum(MATCH_METHODS);
export type MatchMethod = z.infer<typeof MatchMethod>;

/** Only GET and HEAD are ever made (§7.2); nothing here writes to a source. */
export const SCRAPE_METHODS = ['GET', 'HEAD'] as const;
export const ScrapeMethod = z.enum(SCRAPE_METHODS);
export type ScrapeMethod = z.infer<typeof ScrapeMethod>;

/** A source runs only when its verdict is one of these two (§7.2, D-26). */
export const SCRAPEABLE_COMPLIANCE_STATUSES: readonly ComplianceStatus[] = [
  'APPROVED',
  'APPROVED_WITH_LIMITS',
];

/**
 * One source as the API reports it. `configJson` is deliberately absent: it
 * holds per-adapter settings and, for CLIST, the shape an API key would go in,
 * and §6.2 says source API keys are never exported.
 */
export const SourceSummary = z
  .object({
    id: Uuid7,
    key: z.string().min(1),
    name: z.string().min(1),
    adapter: AdapterKind,
    isEnabled: z.boolean(),
    complianceStatus: ComplianceStatus,
    complianceNotes: z.string(),
    /** Minutes between scheduled runs (D-27). */
    cadenceMinutes: z.int().min(1),
    /** Floor between manual refreshes (D-27). */
    manualMinIntervalMinutes: z.int().min(0),
    /** The source's own share of `max(3 s, this, robots Crawl-delay)` (A9). */
    minDelayMs: z.int().min(0),
    maxRequestsPerRun: z.int().min(1),
    /** Host-qualified prefixes; nothing outside them is ever requested (§7.2). */
    allowedPaths: z.array(z.string()),
    attributionText: z.string().nullable(),
    /** Higher is more trusted when sources disagree (§7.5). */
    trustRank: z.int(),
    version: z.int().min(1),
  })
  .strict();
export type SourceSummary = z.infer<typeof SourceSummary>;

/**
 * One finished run, as a row and as a log line (§6.2 `scrape_runs`).
 *
 * The five item counters are the run's whole story: `itemsInvalid` being
 * non-zero with a `SUCCESS` outcome is §7's "one bad item never fails a run",
 * and is exactly what an admin needs to see to know an adapter is drifting.
 */
export const ScrapeRunSummary = z
  .object({
    id: Uuid7,
    sourceKey: z.string().min(1),
    trigger: ScrapeTrigger,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    outcome: ScrapeOutcome,
    errorKind: ScrapeErrorKind.nullable(),
    errorDetail: z.string().nullable(),
    /** Adapter-reported full walk within the caps (A8) — MISSING needs three. */
    listingComplete: z.boolean(),
    requestsMade: z.int().min(0),
    itemsSeen: z.int().min(0),
    itemsNew: z.int().min(0),
    itemsUpdated: z.int().min(0),
    itemsUnchanged: z.int().min(0),
    itemsInvalid: z.int().min(0),
    durationMs: z.int().min(0).nullable(),
  })
  .strict();
export type ScrapeRunSummary = z.infer<typeof ScrapeRunSummary>;

/**
 * What the Source status list shows (§7.7, WP-16b). `message` is the §7.7
 * sentence for the last outcome, built once here so the backend log, the API and
 * the screen cannot word the same failure three ways.
 */
export const SourceStatus = z
  .object({
    source: SourceSummary,
    lastRunAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    /** Minutes since `lastSuccessAt`; null when there has never been one. */
    freshnessMinutes: z.int().min(0).nullable(),
    /** When the scheduler will try again — after a backoff, later than cadence. */
    nextAttemptAt: z.iso.datetime().nullable(),
    /** Earliest a manual refresh is allowed (D-27's floor). */
    canRefreshAt: z.iso.datetime().nullable(),
    consecutiveFailures: z.int().min(0),
    lastOutcome: ScrapeOutcome.nullable(),
    lastErrorKind: ScrapeErrorKind.nullable(),
    lastErrorMessage: z.string().nullable(),
    /** The §7.7 sentence, ready to show. */
    message: z.string().min(1),
  })
  .strict();
export type SourceStatus = z.infer<typeof SourceStatus>;

export const SourceListResponse = z.object({ sources: z.array(SourceSummary) }).strict();
export type SourceListResponse = z.infer<typeof SourceListResponse>;

export const SourceStatusResponse = z.object({ sources: z.array(SourceStatus) }).strict();
export type SourceStatusResponse = z.infer<typeof SourceStatusResponse>;

/**
 * What an admin may change about a source. `complianceStatus` is **not** here
 * and never will be: a verdict comes from reading a site's Terms (D-26), which
 * is a human act recorded in `docs/research/source-feasibility.md`, not a toggle
 * on a screen.
 */
export const UpdateSourceRequest = z
  .object({
    isEnabled: z.boolean().optional(),
    cadenceMinutes: z.int().min(1).max(10_080).optional(),
    manualMinIntervalMinutes: z.int().min(0).max(1_440).optional(),
    minDelayMs: z.int().min(0).max(600_000).optional(),
    maxRequestsPerRun: z.int().min(1).max(500).optional(),
    /** §6.1's optimistic concurrency; a stale one is a 409. */
    version: z.int().min(1),
  })
  .strict();
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequest>;

export const SourceResponse = z.object({ source: SourceSummary }).strict();
export type SourceResponse = z.infer<typeof SourceResponse>;

/** The answer to `POST /admin/sources/:key/refresh`. */
export const SourceRefreshResult = z
  .object({
    run: ScrapeRunSummary,
    status: SourceStatus,
  })
  .strict();
export type SourceRefreshResult = z.infer<typeof SourceRefreshResult>;

/**
 * §7.7's table, as code.
 *
 * The spec gives one sentence per failure kind with a source name and a time in
 * it; this builds that sentence from the same three inputs the row has, so the
 * log line, the API and WP-16b's screen cannot drift. Wording is the spec's,
 * with the examples' Devfolio replaced by the actual source.
 */
export interface SourceMessageInput {
  readonly sourceName: string;
  readonly outcome: ScrapeOutcome;
  readonly errorKind: ScrapeErrorKind | null;
  /** Minutes since the last success; null when there has never been one. */
  readonly freshnessMinutes: number | null;
  /** Local time of the next attempt, already formatted (e.g. "3:45 PM"). */
  readonly nextAttemptLabel: string | null;
}

function lastUpdate(freshnessMinutes: number | null): string {
  if (freshnessMinutes === null) {
    return 'There has been no successful update yet.';
  }
  if (freshnessMinutes < 60) {
    return `Last successful update ${freshnessMinutes} min ago.`;
  }
  const hours = Math.floor(freshnessMinutes / 60);
  return `Last successful update ${hours} h ago.`;
}

/** The one place a scrape outcome becomes something a person reads (§7.7). */
export function sourceStatusMessage(input: SourceMessageInput): string {
  const { sourceName: name } = input;
  if (input.outcome === 'SKIPPED_OFFLINE') {
    return `You're offline. Showing events from the last update. ${lastUpdate(input.freshnessMinutes)}`;
  }
  if (input.outcome === 'BLOCKED_BY_POLICY') {
    return `Updates from ${name} are disabled by policy.`;
  }
  if (input.outcome === 'SKIPPED_BACKOFF') {
    const when = input.nextAttemptLabel;
    return `${name} is being given a rest after repeated failures.${when === null ? '' : ` Next attempt at ${when}.`}`;
  }
  if (input.outcome === 'SUCCESS') {
    return `${name} is up to date.`;
  }
  if (input.outcome === 'PARTIAL') {
    return `${name} updated, but part of its listing could not be read.`;
  }
  switch (input.errorKind) {
    case 'RATE_LIMITED':
      return `${name} asked us to slow down.${
        input.nextAttemptLabel === null ? '' : ` Next attempt at ${input.nextAttemptLabel}.`
      }`;
    case 'ROBOTS_DISALLOWED':
      return `Updates from ${name} are disabled by policy.`;
    case 'BLOCKED':
    case 'TLS':
      return `${name}'s website has an invalid security certificate (or refuses automated readers), so it is skipped.`;
    case 'SCHEMA_CHANGED':
    case 'PARSE':
      return `${name}'s page format changed, so its updates are paused. Administrators have been notified.`;
    default:
      return `Couldn't reach ${name}. ${lastUpdate(input.freshnessMinutes)}`;
  }
}

/**
 * `PUT /admin/sources/:key/credential` (WP-11). Both halves required; the body is
 * never echoed back, logged or exported — the answer is only whether it is set.
 */
export const SetSourceCredentialRequest = z
  .object({
    username: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(500),
  })
  .strict();
export type SetSourceCredentialRequest = z.infer<typeof SetSourceCredentialRequest>;

/** `GET /admin/sources/:key/credential`: whether it is set, and nothing else. */
export const SourceCredentialStatus = z.object({ isSet: z.boolean() }).strict();
export type SourceCredentialStatus = z.infer<typeof SourceCredentialStatus>;
