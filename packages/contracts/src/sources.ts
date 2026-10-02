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

/**
 * `source_state.credential_state` (R80): what the site said about the source's
 * API key. `INVALID` is a key it refused; `EXPIRED` is kept for a key a source
 * reports as lapsed. A refused session has its own state (`SourceSessionState`).
 */
export const CREDENTIAL_STATES = ['EXPIRED', 'INVALID'] as const;
export const CredentialState = z.enum(CREDENTIAL_STATES);
export type CredentialState = z.infer<typeof CredentialState>;

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
    /** R73: when the compliance verdict must be reviewed again; null when no date was set. */
    complianceReviewDueAt: z.int().nullable(),
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

/**
 * Whether the app currently holds the professor's own session for a source
 * (R74/D-34, WP-14).
 *
 * `EXPIRED` is a state of the source, not a failure: the site answered 401, 403
 * or a login redirect while a session was set, so the runs fall back to the
 * public pages and Source status says so until a new session is given.
 * `UNAVAILABLE` is the same answer for a different reason (ruling R76): the
 * session is stored, sealed, and this machine holds no key that opens it — a
 * backup restored elsewhere, another Windows account, a backend started by hand.
 * Nothing here is the cookie, and no route ever echoes one back.
 */
export const SOURCE_SESSION_STATES = ['NONE', 'ACTIVE', 'EXPIRED', 'UNAVAILABLE'] as const;
export const SourceSessionState = z.enum(SOURCE_SESSION_STATES);
export type SourceSessionState = z.infer<typeof SourceSessionState>;

export const SourceSessionStatus = z
  .object({
    /** Whether this source may hold a session at all (R74: Devfolio, Unstop). */
    supported: z.boolean(),
    isSet: z.boolean(),
    state: SourceSessionState,
    /** When the professor gave it to us. */
    capturedAt: z.int().nullable(),
    /** The last run that used it and was not refused. */
    lastVerifiedAt: z.int().nullable(),
    /** The source's own login page, for the packaged sign-in window. */
    loginUrl: z.url().optional(),
    /** Hosts the cookie may be sent to, and the only ones the window may load. */
    hosts: z.array(z.string().min(1)),
  })
  .strict();
export type SourceSessionStatus = z.infer<typeof SourceSessionStatus>;

/**
 * `PUT /admin/sources/:key/session` — the cookie header the professor copied
 * from their own browser, or that the packaged sign-in window captured for that
 * source's domain alone.
 */
export const SetSourceSessionRequest = z
  .object({
    /** A `Cookie:` header value: `name=value; name2=value2`. */
    cookie: z.string().trim().min(1).max(8192),
    /** Where it came from, for the audit row. The value is never audited. */
    capturedVia: z.enum(['PASTE', 'LOGIN_WINDOW']).default('PASTE'),
  })
  .strict();
export type SetSourceSessionRequest = z.infer<typeof SetSourceSessionRequest>;

/**
 * `GET /sources/connect-prompt` — whether the one-time "Connect your sources"
 * step is still owed (R74's product flow, R75's limits).
 *
 * It is one flag and a list, not a screen's worth of state: which sources can
 * hold a session is already `GET /sources`, and what the professor has done
 * about each one is already `GET /admin/sources/:key/session`. This answers only
 * "has this installation been through the step yet", so the step can be shown
 * once and then stay out of the way.
 */
export const SourceConnectPrompt = z
  .object({
    /** False once the professor has finished it or skipped it, for ever. */
    pending: z.boolean(),
    /** Source keys that may hold a session (R74), in list order. */
    keys: z.array(z.string().min(1)),
  })
  .strict();
export type SourceConnectPrompt = z.infer<typeof SourceConnectPrompt>;
