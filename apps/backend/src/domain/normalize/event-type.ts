import type { EventType, Uncertain } from '@compintel/contracts';

import type { WarningCollector } from './warnings.js';

/**
 * What kind of competition this is (§7.3: "source type > rules ('ideathon',
 * CTFtime → CTF, CLIST → coding contest) > OTHER").
 *
 * The type drives the event-type policy (§7.4, D-31), which hides case
 * competitions, quizzes and cultural contests. That makes a wrong `OTHER` cheap
 * — the event is still there, just not classified — and a wrong `HACKATHON`
 * expensive, because it puts noise in the feed a professor has to wade through.
 * So the keyword rules are specific, ordered most-specific-first, and anything
 * unmatched falls to `OTHER` rather than to the nearest guess.
 */

/** A source's own category string, mapped straight onto the enum. */
const BY_SOURCE_TYPE: Record<string, EventType> = {
  hackathon: 'HACKATHON',
  hack: 'HACKATHON',
  ideathon: 'IDEATHON',
  'idea challenge': 'IDEATHON',
  'innovation challenge': 'INNOVATION_CHALLENGE',
  innovation: 'INNOVATION_CHALLENGE',
  challenge: 'INNOVATION_CHALLENGE',
  ctf: 'CTF',
  'capture the flag': 'CTF',
  jeopardy: 'CTF',
  'attack-defense': 'CTF',
  'attack-defence': 'CTF',
  contest: 'CODING_CONTEST',
  'coding contest': 'CODING_CONTEST',
  'programming contest': 'CODING_CONTEST',
  'competitive programming': 'CODING_CONTEST',
};

/**
 * Keyword rules, most specific first. Order is the whole design: "ideathon"
 * has to beat the "hack" substring in "HackIdea", and "capture the flag" has to
 * beat a bare "contest".
 */
const RULES: readonly { readonly pattern: RegExp; readonly type: EventType }[] = [
  { pattern: /\b(?:capture[\s-]the[\s-]flag|ctf)\b/i, type: 'CTF' },
  { pattern: /\bideathon|idea[\s-]?thon\b/i, type: 'IDEATHON' },
  { pattern: /\bhackathon|hack[\s-]?a[\s-]?thon\b/i, type: 'HACKATHON' },
  { pattern: /\binnovation\s+(?:challenge|contest|competition)\b/i, type: 'INNOVATION_CHALLENGE' },
  {
    pattern: /\b(?:codeforces|leetcode|codechef|atcoder|topcoder|icpc)\b/i,
    type: 'CODING_CONTEST',
  },
  {
    pattern:
      /\b(?:coding|programming|algorithm(?:ic)?)\s+(?:contest|competition|challenge|round)\b/i,
    type: 'CODING_CONTEST',
  },
  {
    pattern: /\b(?:weekly|biweekly|starters|div\.?\s*\d)\s*(?:contest|round)\b/i,
    type: 'CODING_CONTEST',
  },
  { pattern: /\bhackfest|buildathon|makeathon\b/i, type: 'HACKATHON' },
  { pattern: /\binnovation\b/i, type: 'INNOVATION_CHALLENGE' },
];

export interface EventTypeInputs {
  /** The source's own category, if it has one. */
  readonly sourceType?: string | undefined;
  /** Title plus tags plus description — wherever a keyword may be. */
  readonly text?: string | undefined;
  /** Some sources are single-purpose: CTFtime is always CTF. */
  readonly sourceDefault?: EventType | undefined;
}

export function parseEventType(
  inputs: EventTypeInputs,
  warnings?: WarningCollector,
): Uncertain<EventType> {
  if (inputs.sourceType !== undefined) {
    const key = inputs.sourceType.trim().toLowerCase();
    const direct = BY_SOURCE_TYPE[key];
    if (direct !== undefined) {
      return { value: direct, confidence: 1, raw: inputs.sourceType };
    }
    warnings?.add(
      'EVENT_TYPE_UNMAPPED',
      `The source's category "${inputs.sourceType.slice(0, 40)}" does not map to a known type; falling back to keywords.`,
      'eventType',
    );
  }

  const text = inputs.text ?? '';
  for (const { pattern, type } of RULES) {
    if (pattern.test(text)) {
      return { value: type, confidence: 0.8 };
    }
  }

  if (inputs.sourceDefault !== undefined) {
    return { value: inputs.sourceDefault, confidence: 0.9 };
  }
  return { value: 'OTHER', confidence: 1 };
}
