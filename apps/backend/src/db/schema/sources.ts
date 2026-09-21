import {
  ADAPTER_KINDS,
  COMPLIANCE_STATUSES,
  MATCH_METHODS,
  PRESENCES,
  SCRAPE_ERROR_KINDS,
  SCRAPE_OUTCOMES,
  SCRAPE_TRIGGERS,
  type AdapterKind,
  type ComplianceStatus,
  type MatchMethod,
  type Presence,
  type ScrapeErrorKind,
  type ScrapeOutcome,
  type ScrapeTrigger,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { events } from './events.js';

/** `'A', 'B'` — CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * Sources and ingestion (§6.2, §7.2, §7.6, R58, R59).
 *
 * Five tables, and the split between the first two is the one worth explaining.
 * `sources` is **policy**: the verdict a human reached by reading a site's Terms
 * (D-26), the paths that verdict allows, the delay and the cadence. It changes
 * when a person decides something. `source_state` is **health**: when the source
 * last ran, how many times in a row it has failed, and how long it is being left
 * alone for. It changes on every run.
 *
 * R59 is why the health half is here at all rather than in `job_state`. A
 * source's backoff is a politeness obligation towards somebody else's server,
 * and it has to survive a job being renamed, re-registered or dropped — which
 * `job_state` deliberately does not, since its row follows the code.
 */
export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    /** Stable slug — `ctftime`, `devfolio`. The adapter registry's key. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    adapter: text('adapter').$type<AdapterKind>().notNull(),
    /** Per-adapter configuration; API keys live here and are never exported. */
    configJson: text('config_json').notNull().default('{}'),
    /**
     * Off by default. A source is switched on when somebody has read its Terms
     * *and* an adapter exists for it, which is two separate facts.
     */
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(false),
    cadenceMinutes: integer('cadence_minutes').notNull(),
    manualMinIntervalMinutes: integer('manual_min_interval_minutes').notNull(),
    /** The source's share of A9's `max(3 s, this, robots Crawl-delay)`. */
    minDelayMs: integer('min_delay_ms').notNull().default(3_000),
    maxRequestsPerRun: integer('max_requests_per_run').notNull(),
    /** JSON array of host-qualified prefixes; see `domain/scraping/paths.ts`. */
    allowedPathsJson: text('allowed_paths_json').notNull().default('[]'),
    attributionText: text('attribution_text'),
    /** §7.5 field resolution: higher wins when two sources disagree. */
    trustRank: integer('trust_rank').notNull().default(0),
    complianceStatus: text('compliance_status').$type<ComplianceStatus>().notNull(),
    /** Why the verdict is what it is, quoting the Terms where they matter. */
    complianceNotes: text('compliance_notes').notNull().default(''),
    complianceReviewedAt: integer('compliance_reviewed_at'),
    /** Free text, not a user id: the reviewer may be a research document. */
    complianceReviewedBy: text('compliance_reviewed_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('sources_key_idx').on(table.key),
    check('sources_adapter_check', sql.raw(`"adapter" in (${quoted(ADAPTER_KINDS)})`)),
    check(
      'sources_compliance_status_check',
      sql.raw(`"compliance_status" in (${quoted(COMPLIANCE_STATUSES)})`),
    ),
    check('sources_cadence_minutes_check', sql.raw(`"cadence_minutes" >= 1`)),
    check('sources_min_delay_ms_check', sql.raw(`"min_delay_ms" >= 0`)),
    check('sources_max_requests_per_run_check', sql.raw(`"max_requests_per_run" >= 1`)),
    check('sources_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type SourceRow = typeof sources.$inferSelect;

/**
 * Per-source health (§6.2 `source_state`, R59). One row per source, written by
 * every run and read by Source status.
 */
export const sourceState = sqliteTable(
  'source_state',
  {
    sourceId: text('source_id')
      .primaryKey()
      .references(() => sources.id),
    lastRunAt: integer('last_run_at'),
    lastSuccessAt: integer('last_success_at'),
    nextDueAt: integer('next_due_at').notNull(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** While in the future, the source is left alone however due it is (§7.2). */
    backoffUntil: integer('backoff_until'),
    lastErrorKind: text('last_error_kind').$type<ScrapeErrorKind>(),
    lastErrorMessage: text('last_error_message'),
  },
  (table) => [
    index('source_state_next_due_at_idx').on(table.nextDueAt),
    check(
      'source_state_last_error_kind_check',
      sql.raw(`"last_error_kind" is null or "last_error_kind" in (${quoted(SCRAPE_ERROR_KINDS)})`),
    ),
    check('source_state_consecutive_failures_check', sql.raw(`"consecutive_failures" >= 0`)),
  ],
);
export type SourceStateRow = typeof sourceState.$inferSelect;

/**
 * One attempt at a source (§6.2 `scrape_runs`, §7.6, §7.7).
 *
 * The five item counters plus `listing_complete` are what makes §7.6 decidable
 * without a second table: "three consecutive complete runs that did not mention
 * this record" is a count over these rows, so a PARTIAL run counts for nothing
 * by construction rather than by a flag somebody has to remember to check.
 */
export const scrapeRuns = sqliteTable(
  'scrape_runs',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    trigger: text('trigger').$type<ScrapeTrigger>().notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    outcome: text('outcome').$type<ScrapeOutcome>().notNull(),
    errorKind: text('error_kind').$type<ScrapeErrorKind>(),
    errorDetail: text('error_detail'),
    /** A8: adapter-reported full walk within the caps. */
    listingComplete: integer('listing_complete', { mode: 'boolean' }).notNull().default(false),
    /**
     * Requests the *adapter* made, which is what `max_requests_per_run` caps.
     * robots.txt is a precondition rather than adapter work and is counted
     * separately, in the run's log line — see `scraping/http/robots.ts`.
     */
    requestsMade: integer('requests_made').notNull().default(0),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    itemsUpdated: integer('items_updated').notNull().default(0),
    itemsUnchanged: integer('items_unchanged').notNull().default(0),
    itemsInvalid: integer('items_invalid').notNull().default(0),
    durationMs: integer('duration_ms'),
  },
  (table) => [
    // Source status reads "the newest run for this source"; §7.6 counts complete
    // runs since a timestamp. Both are this index.
    index('scrape_runs_source_started_idx').on(table.sourceId, table.startedAt),
    check('scrape_runs_trigger_check', sql.raw(`"trigger" in (${quoted(SCRAPE_TRIGGERS)})`)),
    check('scrape_runs_outcome_check', sql.raw(`"outcome" in (${quoted(SCRAPE_OUTCOMES)})`)),
    check(
      'scrape_runs_error_kind_check',
      sql.raw(`"error_kind" is null or "error_kind" in (${quoted(SCRAPE_ERROR_KINDS)})`),
    ),
  ],
);
export type ScrapeRunRow = typeof scrapeRuns.$inferSelect;

/**
 * What one source says about one event (§6.2 `source_records`).
 *
 * `payload_json` is a validated `EventCandidate` and nothing else: an item that
 * does not validate is counted in `items_invalid` and **no row is written**, so
 * every row in this table is something the rest of the pipeline can rely on.
 *
 * `last_seen_at` and `last_fetched_at` mean different things and the difference
 * drives the `detail-refresh` job: *seen* is "the listing mentioned it", and
 * *fetched* is "we have its current content". A listing item whose hash changed
 * but whose detail fetch did not fit in this run's cap leaves
 * `last_fetched_at < last_seen_at`, which is exactly the query `detail-refresh`
 * runs.
 *
 * `event_id` stays null through WP-09a; matching into `events` is WP-10's.
 */
export const sourceRecords = sqliteTable(
  'source_records',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    /** The source's own identifier — a CTFtime event id, a Devfolio slug. */
    externalKey: text('external_key').notNull(),
    url: text('url').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    lastFetchedAt: integer('last_fetched_at').notNull(),
    /** SHA-256 of the canonical payload; a detail fetch happens when it moves. */
    contentHash: text('content_hash').notNull(),
    payloadJson: text('payload_json').notNull(),
    /** Path under `<dataDir>/snapshots`, or null once pruned (§7.8). */
    rawSnapshotRef: text('raw_snapshot_ref'),
    parseWarningsJson: text('parse_warnings_json').notNull().default('[]'),
    presence: text('presence').$type<Presence>().notNull().default('LISTED'),
    missingSince: integer('missing_since'),
    eventId: text('event_id').references(() => events.id),
    matchMethod: text('match_method').$type<MatchMethod>().notNull().default('NEW'),
    matchScore: real('match_score'),
    /**
     * The event this record was first linked to (WP-10, R66). A merge moves
     * `event_id` and leaves this alone, which is how an unmerge knows which
     * records to hand back. No FK, like the other provenance columns (R49).
     */
    originEventId: text('origin_event_id'),
  },
  (table) => [
    uniqueIndex('source_records_source_external_key_idx').on(table.sourceId, table.externalKey),
    index('source_records_presence_idx').on(table.sourceId, table.presence),
    index('source_records_event_id_idx').on(table.eventId),
    index('source_records_origin_event_id_idx').on(table.originEventId),
    // WP-14's URL import asks "do we already hold this page?".
    index('source_records_url_idx').on(table.url),
    check('source_records_presence_check', sql.raw(`"presence" in (${quoted(PRESENCES)})`)),
    check(
      'source_records_match_method_check',
      sql.raw(`"match_method" in (${quoted(MATCH_METHODS)})`),
    ),
  ],
);
export type SourceRecordRow = typeof sourceRecords.$inferSelect;

/**
 * Conditional-GET validators, keyed by URL (ruling R58).
 *
 * They belong to a URL rather than to a `source_records` row for two reasons:
 * listing URLs have no record at all, and detail URLs outnumber records once
 * pagination is involved. Keeping them here means a 304 costs no parse and no
 * write beyond `last_seen_at`, which over a 15-minute cadence is most of what
 * politeness actually buys.
 */
export const httpCache = sqliteTable('http_cache', {
  url: text('url').primaryKey(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  fetchedAt: integer('fetched_at').notNull(),
  /** SHA-256 of the body we last stored, so a 200 that changed nothing is free. */
  contentHash: text('content_hash').notNull(),
});
export type HttpCacheRow = typeof httpCache.$inferSelect;
