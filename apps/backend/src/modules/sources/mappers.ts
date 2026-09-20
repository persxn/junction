import {
  sourceStatusMessage,
  type ScrapeRunSummary,
  type SourceStatus,
  type SourceSummary,
} from '@compintel/contracts';

import type { ScrapeRunRow, SourceRow, SourceStateRow } from '../../db/schema/index.js';
import { APP_TIMEZONE } from '../../platform/time.js';
import { allowedPathsOf } from '../../scraping/source-row.js';

/** Rows → DTOs. One place, so the two read routes cannot disagree. */

function isoOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/**
 * `config_json` is deliberately not in `SourceSummary`: it holds per-adapter
 * settings and, for CLIST, where an API key would live, and §6.2 says source
 * API keys are never logged or exported.
 */
export function toSummary(source: SourceRow): SourceSummary {
  return {
    id: source.id,
    key: source.key,
    name: source.name,
    adapter: source.adapter,
    isEnabled: source.isEnabled,
    complianceStatus: source.complianceStatus,
    complianceNotes: source.complianceNotes,
    cadenceMinutes: source.cadenceMinutes,
    manualMinIntervalMinutes: source.manualMinIntervalMinutes,
    minDelayMs: source.minDelayMs,
    maxRequestsPerRun: source.maxRequestsPerRun,
    allowedPaths: [...allowedPathsOf(source)],
    attributionText: source.attributionText,
    trustRank: source.trustRank,
    version: source.version,
  };
}

export function toRunSummary(run: ScrapeRunRow, sourceKey: string): ScrapeRunSummary {
  return {
    id: run.id,
    sourceKey,
    trigger: run.trigger,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: isoOrNull(run.finishedAt),
    outcome: run.outcome,
    errorKind: run.errorKind,
    errorDetail: run.errorDetail,
    listingComplete: run.listingComplete,
    requestsMade: run.requestsMade,
    itemsSeen: run.itemsSeen,
    itemsNew: run.itemsNew,
    itemsUpdated: run.itemsUpdated,
    itemsUnchanged: run.itemsUnchanged,
    itemsInvalid: run.itemsInvalid,
    durationMs: run.durationMs,
  };
}

/** "3:45 PM" in the app's timezone — §7.7's wording, for §7.7's sentence. */
export function clockLabel(at: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: APP_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(at));
}

/**
 * The earliest a manual refresh is allowed (D-27's floor).
 *
 * It is measured from the **last run of any kind**, not from the last manual
 * one. The floor exists to protect the source's server, and a scheduled run a
 * minute ago cost it exactly as much as a manual one would have.
 */
export function nextManualRefreshAt(source: SourceRow, state: SourceStateRow): number | null {
  if (state.lastRunAt === null) {
    return null;
  }
  return state.lastRunAt + source.manualMinIntervalMinutes * 60_000;
}

export interface StatusInput {
  readonly source: SourceRow;
  readonly state: SourceStateRow;
  readonly latestRun: ScrapeRunRow | undefined;
  readonly now: number;
}

export function toStatus(input: StatusInput): SourceStatus {
  const { source, state, latestRun, now } = input;
  const freshnessMinutes =
    state.lastSuccessAt === null
      ? null
      : Math.max(0, Math.floor((now - state.lastSuccessAt) / 60_000));
  const nextAttemptAt = state.backoffUntil ?? state.nextDueAt;
  const outcome = latestRun?.outcome ?? null;
  return {
    source: toSummary(source),
    lastRunAt: isoOrNull(state.lastRunAt),
    lastSuccessAt: isoOrNull(state.lastSuccessAt),
    freshnessMinutes,
    nextAttemptAt: isoOrNull(nextAttemptAt),
    canRefreshAt: isoOrNull(nextManualRefreshAt(source, state)),
    consecutiveFailures: state.consecutiveFailures,
    lastOutcome: outcome,
    lastErrorKind: state.lastErrorKind,
    lastErrorMessage: state.lastErrorMessage,
    message: sourceStatusMessage({
      sourceName: source.name,
      // A source that has never run has nothing to report but its verdict.
      outcome: outcome ?? (source.isEnabled ? 'SUCCESS' : 'BLOCKED_BY_POLICY'),
      errorKind: state.lastErrorKind,
      freshnessMinutes,
      nextAttemptLabel: nextAttemptAt === null ? null : clockLabel(nextAttemptAt),
    }),
  };
}
