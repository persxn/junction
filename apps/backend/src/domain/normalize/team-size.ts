import type { CandidateTeamSize } from '@compintel/contracts';

import type { WarningCollector } from './warnings.js';

/**
 * Team size (§7.3: `"1–4"`, `"up to 4"`, `"solo or teams of 2"`).
 *
 * Team size decides whether a professor can field anyone at all, so the same
 * rule applies as everywhere else: either bound may be unknown, and an unknown
 * bound is absent rather than 1. "Teams of up to 4" does not say a solo entry is
 * allowed, and filling in `min: 1` would be inventing permission.
 */

/** Words sources use for one person. */
const SOLO = /\b(?:solo|individual|single|alone|one\s+person)\b/i;

const PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly read: (match: RegExpMatchArray) => { min?: number; max?: number } | undefined;
  readonly confidence: number;
}[] = [
  // "1-4", "1 – 4", "2 to 5", "between 2 and 5" (members optional afterwards)
  {
    pattern: /\b(?:between\s+)?(\d{1,2})\s*(?:-|–|—|to|and)\s*(\d{1,2})\b/i,
    read: (m) => ({ min: Number(m[1]), max: Number(m[2]) }),
    confidence: 0.9,
  },
  // "up to 4", "maximum of 4", "max 4", "at most 4", "no more than 4"
  {
    pattern: /\b(?:up\s*to|max(?:imum)?(?:\s+of)?|at\s+most|no\s+more\s+than)\s*(\d{1,2})\b/i,
    read: (m) => ({ max: Number(m[1]) }),
    confidence: 0.9,
  },
  // "minimum 2", "at least 2", "min. 2"
  {
    pattern: /\b(?:min(?:imum)?\.?(?:\s+of)?|at\s+least)\s*(\d{1,2})\b/i,
    read: (m) => ({ min: Number(m[1]) }),
    confidence: 0.9,
  },
  // "teams of 4", "team of exactly 4", "4-member teams", "4 member team"
  {
    pattern: /\bteams?\s+of\s+(?:exactly\s+)?(\d{1,2})\b/i,
    read: (m) => ({ min: Number(m[1]), max: Number(m[1]) }),
    confidence: 0.85,
  },
  {
    pattern: /\b(\d{1,2})[\s-]*(?:member|person|people)\s+teams?\b/i,
    read: (m) => ({ min: Number(m[1]), max: Number(m[1]) }),
    confidence: 0.85,
  },
];

/** A size outside this is a misread number, not a team. */
const MAX_PLAUSIBLE = 50;

function plausible(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= MAX_PLAUSIBLE);
}

/**
 * Reads a team-size range from prose. `undefined` when nothing was said about
 * team size at all; a `known: false`-style result with only `text` when
 * something was said and no pattern matched.
 */
export function parseTeamSize(
  raw: string | undefined,
  warnings?: WarningCollector,
  field = 'teamSize',
): CandidateTeamSize | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = raw.trim();
  if (text.length === 0) {
    return undefined;
  }

  let min: number | undefined;
  let max: number | undefined;
  let confidence = 0;

  for (const { pattern, read, confidence: patternConfidence } of PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) {
      continue;
    }
    const read_ = read(match);
    if (read_ === undefined) {
      continue;
    }
    min ??= read_.min;
    max ??= read_.max;
    confidence = Math.max(confidence, patternConfidence);
  }

  // "solo or teams of 2" — the word says one is allowed, the phrase says two.
  const solo = SOLO.test(text);
  if (solo) {
    min = 1;
    max ??= 1;
    confidence = Math.max(confidence, 0.8);
  }

  if (min === undefined && max === undefined) {
    warnings?.add(
      'TEAM_SIZE_UNPARSEABLE',
      `Could not read a team size from "${text.slice(0, 60)}".`,
      field,
    );
    return { text, confidence: 0 };
  }
  if (!plausible(min) || !plausible(max) || (min !== undefined && max !== undefined && min > max)) {
    warnings?.add(
      'TEAM_SIZE_UNPARSEABLE',
      `"${text.slice(0, 60)}" gave an implausible team size; the wording is kept instead.`,
      field,
    );
    return { text, confidence: 0 };
  }

  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    text,
    confidence,
  };
}
