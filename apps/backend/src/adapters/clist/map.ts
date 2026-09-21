import { EventCandidate, type CandidateSeries, type ParseWarning } from '@compintel/contracts';

import { normalizeCandidate } from '../../domain/normalize/index.js';
import type { Clock } from '../../platform/time.js';
import type { ClistContest } from './schema.js';

/**
 * One CLIST contest → one `EventCandidate`. **Pure** (R52).
 *
 * An explicit allowlist, like CTFtime's: every field is read by name, so a key
 * CLIST adds never reaches the candidate. CLIST exposes no people at all, and
 * R50's `.strict()` would refuse one if it did.
 */

export interface ClistMapContext {
  readonly clock: Clock;
  readonly sourceKey: string;
  /** Computed over the whole listing by `domain/series`; absent for a one-off. */
  readonly series?: CandidateSeries | undefined;
}

/** Resources whose contests are not reliably online (ICPC regionals run on site). */
const NOT_ALWAYS_ONLINE: ReadonlySet<string> = new Set(['icpc.global', 'icpc.foundation']);

/** CLIST reports seconds; the timestamps win a disagreement of an hour or more. */
const DURATION_TOLERANCE_MS = 3_600_000;

export function clistExternalKey(id: number): string {
  return `clist:${String(id)}`;
}

export function mapClistContest(contest: ClistContest, ctx: ClistMapContext): EventCandidate {
  const resource = contest.resource.trim().toLowerCase();
  const extra: ParseWarning[] = [];
  const problems =
    contest.n_problems === null || contest.n_problems === undefined
      ? undefined
      : `Problems listed by CLIST: ${String(contest.n_problems)}.`;

  // CLIST states UTC by contract (no `timezone` parameter is sent), so the
  // instants are exact; the *event's* own zone is unknown and is not claimed.
  const { candidate } = normalizeCandidate(
    {
      sourceKey: ctx.sourceKey,
      externalKey: clistExternalKey(contest.id),
      url: `https://clist.by/contest/${String(contest.id)}/`,
      title: contest.event,
      organizerName: resource,
      description: problems,
      mode: NOT_ALWAYS_ONLINE.has(resource) ? undefined : 'online',
      startsAt: { structured: contest.start },
      endsAt: { structured: contest.end },
      officialUrl: contest.href,
      registrationUrl: contest.href,
      sourceTags: [resource],
    },
    { clock: ctx.clock, sourceTimezone: 'UTC', sourceEventType: 'CODING_CONTEST' },
  );

  extra.push({
    code: 'TIMEZONE_ASSUMED',
    field: 'timezone',
    message:
      'CLIST states times in UTC and names no local zone for the event; the times are exact and shown in UTC.',
  });
  if (candidate.startsAt !== undefined && candidate.endsAt !== undefined) {
    const actual = candidate.endsAt.at - candidate.startsAt.at;
    if (Math.abs(actual - contest.duration * 1000) >= DURATION_TOLERANCE_MS) {
      extra.push({
        code: 'DATE_DURATION_MISMATCH',
        field: 'endsAt',
        message: `CLIST states a duration of ${String(contest.duration)} s, but the start and end are ${String(actual / 1000)} s apart; the timestamps were kept.`,
      });
    }
  }

  // The zone is not a fact about the event, and a title-pattern hint is
  // superseded by the series verdict made over the whole listing.
  const { timezone: _zone, seriesHint: _hint, ...withoutZone } = candidate;
  const series = ctx.series;
  return EventCandidate.parse({
    ...withoutZone,
    organizerKind: { value: 'PLATFORM', confidence: 0.8, raw: resource },
    // No fee field and no team field: unknown, never zero.
    fee: { known: false, confidence: 0 },
    isRecurringRound: series?.isRecurringRound ?? false,
    ...(series?.isRecurringRound === true ? { seriesHint: series.name } : {}),
    ...(series === undefined ? {} : { series }),
    warnings: [...candidate.warnings, ...extra],
  });
}
