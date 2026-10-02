import { normalizeTag } from './text.js';

/**
 * Event tags from source tags (ruling R87, D-15).
 *
 * A source labels its events — Devfolio's themes, CTFtime's format, Unstop's
 * filters, CLIST's resource — and those labels become the event's tags: the
 * tags filter, the FTS `tags` column and the tag-interest boost all read them.
 * No model is involved (D-15); what a tag *is* comes from the small map below.
 *
 * Pure: names in, tags out. The repository makes the rows.
 */

export type SourceTagKind = 'TECHNOLOGY' | 'THEME';

export interface DerivedTag {
  /** As first spelled by a source, trimmed — what a person reads. */
  readonly name: string;
  /** `normalizeTag(name)` — what is compared, and unique per kind. */
  readonly normalized: string;
  readonly kind: SourceTagKind;
}

/**
 * The seeded map: tags that name a technology a team builds *with*. Everything
 * else a source says — "Social Good", "Jeopardy", "Open Innovation" — is a
 * THEME, which is also the answer for anything this list has never heard of.
 * Kept short on purpose; the categories module, not this list, decides what an
 * event is *about*.
 */
export const TECHNOLOGY_TAGS: ReadonlySet<string> = new Set([
  'ai',
  'artificial intelligence',
  'ml',
  'machine learning',
  'ai/ml',
  'deep learning',
  'generative ai',
  'genai',
  'llm',
  'data science',
  'blockchain',
  'web3',
  'web',
  'web development',
  'web dev',
  'app development',
  'android',
  'ios',
  'mobile',
  'iot',
  'internet of things',
  'cloud',
  'devops',
  'ar/vr',
  'ar',
  'vr',
  'robotics',
  'embedded',
  'python',
  'javascript',
  'java',
  'c++',
  'rust',
  'go',
  'react',
  'flutter',
]);

/** Longest tag name stored; a sentence is not a tag. */
export const MAX_TAG_LENGTH = 40;

/** One tag per normalized name, in the order the sources first said them. */
export function deriveTags(sourceTags: readonly string[]): DerivedTag[] {
  const seen = new Map<string, DerivedTag>();
  for (const raw of sourceTags) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const normalized = normalizeTag(name);
    if (normalized.length === 0 || name.length > MAX_TAG_LENGTH || seen.has(normalized)) {
      continue;
    }
    seen.set(normalized, {
      name,
      normalized,
      kind: TECHNOLOGY_TAGS.has(normalized) ? 'TECHNOLOGY' : 'THEME',
    });
  }
  return [...seen.values()];
}
