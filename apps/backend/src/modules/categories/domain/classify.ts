import {
  EVENT_TYPES,
  type CategoryRuleField,
  type CategoryRuleKind,
  type EventType,
} from '@compintel/contracts';

import { checkRegex, testBounded } from './regex-guard.js';
import { containsPhrase, normalizeTag, tokens } from './text.js';

/**
 * The deterministic rules engine (D-15, WP-15b step 3): an event, its sources'
 * tags and the active rules in; category assignments out. Pure — no database,
 * no clock, no model. Every assignment it makes can be printed as a sentence:
 * "the title contains the word *CTF*", "Devfolio tagged it *Blockchain*".
 *
 * Order-independent by construction: rules are sorted by (weight desc, id)
 * before anything is evaluated and the output is sorted by category id, so two
 * runs over the same input — in whatever order the rules were read — produce
 * byte-identical output.
 *
 * - KEYWORD matches one **whole** normalized word ("AI" never matches "Chair").
 * - PHRASE matches whole words in order ("machine learning").
 * - REGEX runs guarded (`regex-guard.ts`): compiled once, `iu`, input bounded.
 * - SOURCE_TAG compares a source's own tag, folded, with the pattern.
 * - EVENT_TYPE compares the event's type.
 *
 * A category's confidence is its matching rules' summed weight / 100, capped
 * at 1. A category whose matching rules weigh 0 in total is not assigned. A
 * SOURCE_TAG hit makes the one row `origin = SOURCE_TAG` — the source said so
 * itself — and any other hit `RULE`; either way it is one row per category.
 */

export interface ClassifierRule {
  readonly id: string;
  readonly categoryId: string;
  readonly kind: CategoryRuleKind;
  readonly pattern: string;
  readonly fields: CategoryRuleField;
  readonly weight: number;
}

export interface ClassifiableEvent {
  readonly title: string;
  readonly description: string | null;
  readonly eventType: EventType;
}

/** Where a rule matched — for the preview's "matched in" column. */
export type MatchedIn = 'TITLE' | 'DESCRIPTION' | 'TAGS' | 'EVENT_TYPE';

export interface ComputedAssignment {
  readonly categoryId: string;
  readonly origin: 'SOURCE_TAG' | 'RULE';
  /** The heaviest contributing rule of that origin (ties by id). */
  readonly ruleId: string;
  readonly confidence: number;
}

/** A rule ready to evaluate: its pattern normalized or compiled once. */
export interface PreparedRule extends ClassifierRule {
  readonly words: readonly string[];
  readonly tag: string;
  readonly regex: RegExp | undefined;
}

/** A rule that cannot be prepared (a stored REGEX that no longer passes the guard) is skipped. */
export function prepareRules(rules: readonly ClassifierRule[]): PreparedRule[] {
  const prepared: PreparedRule[] = [];
  for (const rule of rules) {
    let regex: RegExp | undefined;
    if (rule.kind === 'REGEX') {
      const verdict = checkRegex(rule.pattern);
      if (!verdict.ok) {
        continue;
      }
      regex = verdict.regex;
    }
    prepared.push({ ...rule, words: tokens(rule.pattern), tag: normalizeTag(rule.pattern), regex });
  }
  return prepared.sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The event, tokenized once for every rule. */
export interface PreparedEvent {
  readonly eventType: EventType;
  readonly title: string;
  readonly description: string;
  readonly titleWords: readonly string[];
  readonly descriptionWords: readonly string[];
  /** One word list per tag: a phrase never spans two tags. */
  readonly tagWords: readonly (readonly string[])[];
  readonly tags: ReadonlySet<string>;
  readonly tagText: string;
}

export function prepareEvent(
  event: ClassifiableEvent,
  sourceTags: readonly string[],
): PreparedEvent {
  const description = event.description ?? '';
  return {
    eventType: event.eventType,
    title: event.title,
    description,
    titleWords: tokens(event.title),
    descriptionWords: tokens(description),
    tagWords: sourceTags.map((tag) => tokens(tag)),
    tags: new Set(sourceTags.map(normalizeTag).filter((tag) => tag.length > 0)),
    tagText: sourceTags.join('\n'),
  };
}

const TEXT_FIELDS: Readonly<
  Record<CategoryRuleField, readonly Exclude<MatchedIn, 'EVENT_TYPE'>[]>
> = {
  TITLE: ['TITLE'],
  DESCRIPTION: ['DESCRIPTION'],
  TAGS: ['TAGS'],
  ALL: ['TITLE', 'DESCRIPTION', 'TAGS'],
};

function wordsOf(event: PreparedEvent, field: 'TITLE' | 'DESCRIPTION' | 'TAGS') {
  return field === 'TITLE'
    ? [event.titleWords]
    : field === 'DESCRIPTION'
      ? [event.descriptionWords]
      : event.tagWords;
}

function textOf(event: PreparedEvent, field: 'TITLE' | 'DESCRIPTION' | 'TAGS'): string {
  return field === 'TITLE'
    ? event.title
    : field === 'DESCRIPTION'
      ? event.description
      : event.tagText;
}

/** Where one rule matches the event, or `undefined`. The first field in title → description → tags order wins. */
export function matchRule(rule: PreparedRule, event: PreparedEvent): MatchedIn | undefined {
  switch (rule.kind) {
    case 'EVENT_TYPE':
      return rule.pattern === event.eventType ? 'EVENT_TYPE' : undefined;
    case 'SOURCE_TAG':
      return rule.tag.length > 0 && event.tags.has(rule.tag) ? 'TAGS' : undefined;
    case 'KEYWORD': {
      const word = rule.words.length === 1 ? rule.words[0] : undefined;
      if (word === undefined) return undefined;
      return TEXT_FIELDS[rule.fields].find((field) =>
        wordsOf(event, field).some((list) => list.includes(word)),
      );
    }
    case 'PHRASE':
      return TEXT_FIELDS[rule.fields].find((field) =>
        wordsOf(event, field).some((list) => containsPhrase(list, rule.words)),
      );
    case 'REGEX': {
      const regex = rule.regex;
      if (regex === undefined) return undefined;
      return TEXT_FIELDS[rule.fields].find((field) => testBounded(regex, textOf(event, field)));
    }
  }
}

interface Tally {
  weight: number;
  sourceTagRule: string | undefined;
  ruleRule: string | undefined;
}

/** Rounded so a confidence survives a JSON round trip and a REAL column unchanged. */
const confidenceOf = (weight: number): number => Math.round(Math.min(1, weight / 100) * 1e4) / 1e4;

export function classify(
  event: ClassifiableEvent,
  sourceTags: readonly string[],
  rules: readonly PreparedRule[],
): ComputedAssignment[] {
  const prepared = prepareEvent(event, sourceTags);
  const tallies = new Map<string, Tally>();
  for (const rule of rules) {
    if (matchRule(rule, prepared) === undefined) {
      continue;
    }
    const tally = tallies.get(rule.categoryId) ?? {
      weight: 0,
      sourceTagRule: undefined,
      ruleRule: undefined,
    };
    tally.weight += rule.weight;
    // `rules` is sorted heaviest first, so the first hit of each kind is the one to name.
    if (rule.kind === 'SOURCE_TAG') tally.sourceTagRule ??= rule.id;
    else tally.ruleRule ??= rule.id;
    tallies.set(rule.categoryId, tally);
  }
  return [...tallies.entries()]
    .filter(([, tally]) => tally.weight > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([categoryId, tally]) => ({
      categoryId,
      origin: tally.sourceTagRule === undefined ? ('RULE' as const) : ('SOURCE_TAG' as const),
      ruleId: (tally.sourceTagRule ?? tally.ruleRule)!,
      confidence: confidenceOf(tally.weight),
    }));
}

export interface RuleProblem {
  readonly unsafe: boolean;
  readonly message: string;
}

/** The write-time check of one rule's pattern for its kind; `undefined` when it is fine. */
export function validateRulePattern(
  kind: CategoryRuleKind,
  pattern: string,
): RuleProblem | undefined {
  switch (kind) {
    case 'KEYWORD':
      return tokens(pattern).length === 1
        ? undefined
        : { unsafe: false, message: 'A KEYWORD is exactly one word; use a PHRASE for several.' };
    case 'PHRASE':
      return tokens(pattern).length >= 1
        ? undefined
        : { unsafe: false, message: 'A PHRASE needs at least one word.' };
    case 'SOURCE_TAG':
      return normalizeTag(pattern).length > 0
        ? undefined
        : { unsafe: false, message: 'A SOURCE_TAG pattern is the tag, e.g. "blockchain".' };
    case 'EVENT_TYPE':
      return (EVENT_TYPES as readonly string[]).includes(pattern)
        ? undefined
        : { unsafe: false, message: `An EVENT_TYPE pattern is one of ${EVENT_TYPES.join(', ')}.` };
    case 'REGEX': {
      const verdict = checkRegex(pattern);
      return verdict.ok ? undefined : { unsafe: verdict.unsafe, message: verdict.message };
    }
  }
}
