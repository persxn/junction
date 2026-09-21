import { z } from 'zod';

import { ComplianceStatus, ScrapeErrorKind } from './enums.js';
import { AdapterKind, SCRAPEABLE_COMPLIANCE_STATUSES, ScrapeOutcome } from './sources.js';

/**
 * Source freshness and health (WP-16b), and §7.7's failure table as code.
 *
 * It sits beside `sources.ts` rather than inside it because it answers a
 * different question: that file is what a source *is*, this one is how it is
 * *doing*. The sentences below are the one place a scrape outcome becomes
 * something a person reads, shared by the backend log, the API and the §16.1
 * popover so the same failure cannot be worded three ways.
 */

/**
 * One source's health as the §16.1 freshness popover shows it — icon **and**
 * label, never colour alone (§16.3).
 *
 * The four §7.7 outcomes a person can act on are separate values because they
 * ask for different things: `FAILING` is "something is wrong at the source",
 * `PAUSED_BY_POLICY` is "we are deliberately not asking" (D-26/D-30), and
 * `OFFLINE` is D-23's "offline is not a failure" — an info banner, not an error.
 */
export const SOURCE_HEALTHS = [
  'OK',
  'FAILING',
  'PAUSED_BY_POLICY',
  'OFFLINE',
  'NEVER_RUN',
] as const;
export const SourceHealth = z.enum(SOURCE_HEALTHS);
export type SourceHealth = z.infer<typeof SourceHealth>;

/**
 * One row of the freshness popover (§16.1, WP-16b).
 *
 * `complianceStatus` and `complianceNotes` are **omitted** for a professor
 * rather than nulled: §10.2 gives source administration to admins only, and a
 * null would say "there is a verdict and you may not see it" where the honest
 * answer is that the field is not part of their response at all.
 */
export const SourceStatusEntry = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    /** MANUAL and URL_IMPORT have no cadence; the §16.1 popover leaves them out. */
    adapter: AdapterKind,
    isEnabled: z.boolean(),
    health: SourceHealth,
    lastRunAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    /** Minutes since `lastSuccessAt`; null when there has never been one. */
    freshnessMinutes: z.int().min(0).nullable(),
    /** When the scheduler will try again — after a backoff, later than cadence. */
    nextAttemptAt: z.iso.datetime().nullable(),
    consecutiveFailures: z.int().min(0),
    lastOutcome: ScrapeOutcome.nullable(),
    lastErrorKind: ScrapeErrorKind.nullable(),
    /** The §7.7 sentence, ready to show. */
    message: z.string().min(1),
    /** D-32: shown with the source wherever its data is. */
    attributionText: z.string().nullable(),
    /** Admin only (§10.2); absent from a professor's response. */
    complianceStatus: ComplianceStatus.optional(),
    /** Admin only (§10.2); absent from a professor's response. */
    complianceNotes: z.string().optional(),
  })
  .strict();
export type SourceStatusEntry = z.infer<typeof SourceStatusEntry>;

/**
 * `GET /sources/status`. `updatedAt` is the newest successful run across every
 * source — what the top bar's "Updated 4 min ago" counts from (§16.1).
 */
export const SourceStatusResponse = z
  .object({
    sources: z.array(SourceStatusEntry),
    updatedAt: z.iso.datetime().nullable(),
    /** True while no source could be reached at all (D-23): an info banner, not an error. */
    offline: z.boolean(),
  })
  .strict();
export type SourceStatusResponse = z.infer<typeof SourceStatusResponse>;

/** Which health one finished run leaves a source in (§7.7). One place, so the popover and the log agree. */
export function sourceHealthOf(input: {
  readonly isEnabled: boolean;
  readonly complianceStatus: ComplianceStatus;
  readonly outcome: ScrapeOutcome | null;
  readonly errorKind: ScrapeErrorKind | null;
}): SourceHealth {
  if (!input.isEnabled || !SCRAPEABLE_COMPLIANCE_STATUSES.includes(input.complianceStatus)) {
    return 'PAUSED_BY_POLICY';
  }
  if (input.outcome === null) {
    return 'NEVER_RUN';
  }
  if (input.outcome === 'SKIPPED_OFFLINE') {
    return 'OFFLINE';
  }
  if (input.outcome === 'BLOCKED_BY_POLICY' || input.errorKind === 'ROBOTS_DISALLOWED') {
    return 'PAUSED_BY_POLICY';
  }
  if (input.outcome === 'FAILED' || input.outcome === 'SKIPPED_BACKOFF') {
    return 'FAILING';
  }
  return 'OK';
}
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
 * The adapters that are a person rather than a scraper (§6.2): a professor
 * typing an event in, or pasting a link. They have no cadence, no last success
 * and nothing to be failing at, so "how fresh is this data?" is not a question
 * they answer — the §16.1 popover leaves them out, and the admin screen that
 * lists every source keeps them.
 */
export const MANUAL_ADAPTERS: readonly AdapterKind[] = ['MANUAL', 'URL_IMPORT'];

export function isScrapedSource(adapter: AdapterKind): boolean {
  return !MANUAL_ADAPTERS.includes(adapter);
}
