import type { CategoryRuleKind, EventType } from '@compintel/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { expectGolden } from '../../../testing/golden.js';
import { CATEGORY_SEED_FILE } from '../../../testing/search.js';
import { loadCategorySeed } from '../seed.js';
import {
  classify,
  matchRule,
  prepareEvent,
  prepareRules,
  validateRulePattern,
  type ClassifiableEvent,
  type ClassifierRule,
} from './classify.js';

interface Sample {
  readonly title: string;
  readonly description?: string;
  readonly eventType?: EventType;
  readonly tags?: readonly string[];
}

/** Real event titles (and, where the source gives them, real tags). */
const SAMPLES: readonly Sample[] = [
  {
    title: 'Smart India Hackathon 2026',
    description: 'Problem statements on healthcare and sustainability.',
  },
  { title: 'ETHIndia 2026', tags: ['Blockchain', 'Web3'] },
  { title: 'Unfold 2026', tags: ['Blockchain', 'AI'] },
  { title: 'Build for Bharat – GenAI Hackathon' },
  { title: 'Amazon ML Challenge 2026', description: 'A machine learning challenge for students.' },
  { title: 'AI for Good Hackathon' },
  { title: 'Chair Design Sprint', description: 'Design a chair people want to sit in.' },
  { title: 'AIIMS MedTech Ideathon', eventType: 'IDEATHON' },
  { title: 'picoCTF 2026', eventType: 'CTF', tags: ['Jeopardy'] },
  { title: 'InCTF Nationals', eventType: 'CTF', tags: ['Attack-Defense'] },
  { title: 'Cyber Security Awareness Challenge', eventType: 'INNOVATION_CHALLENGE' },
  { title: 'Codeforces Round 987 (Div. 2)', eventType: 'CODING_CONTEST', tags: ['codeforces.com'] },
  { title: 'CodeChef Starters 150', eventType: 'CODING_CONTEST', tags: ['codechef.com'] },
  { title: 'ICPC Asia Kanpur Regional', eventType: 'CODING_CONTEST' },
  { title: 'Hacktoberfest 2026', description: 'Contribute to open source all October.' },
  { title: 'Google Summer of Code 2026' },
  { title: 'Flipkart GRiD 7.0 – Robotics Challenge', eventType: 'INNOVATION_CHALLENGE' },
  { title: 'IIT Bombay Techfest Robowars' },
  { title: 'Robocon India 2026' },
  {
    title: 'IoT Innovation Challenge by Intel',
    description: 'Internet of Things builds on Arduino.',
  },
  { title: 'UI/UX Design Challenge', tags: ['Design'] },
  { title: 'Designathon 2026' },
  { title: 'Datathon 2026', description: 'Data science and analytics on open datasets.' },
  { title: 'Kaggle Playground Series', tags: ['kaggle.com'] },
  { title: 'HackCBS 8.0', tags: ['No Restrictions'] },
  {
    title: 'Flutter Forward Mobile App Jam',
    description: 'Build a mobile app for Android and iOS.',
  },
  { title: 'Web Development Weekend', tags: ['Web'] },
  { title: 'Hack4Climate', description: 'Climate and sustainability hackathon.' },
];

const asEvent = (sample: Sample): ClassifiableEvent => ({
  title: sample.title,
  description: sample.description ?? null,
  eventType: sample.eventType ?? 'HACKATHON',
});

const rule = (
  kind: CategoryRuleKind,
  pattern: string,
  extra: Partial<ClassifierRule> = {},
): ClassifierRule => ({
  id: `rule-${kind}-${pattern}`,
  categoryId: 'cat-1',
  kind,
  pattern,
  fields: 'ALL',
  weight: 50,
  ...extra,
});

function matchTable(candidate: ClassifierRule): { title: string; matchedIn: string | null }[] {
  const [prepared] = prepareRules([candidate]);
  if (prepared === undefined) throw new Error('rule did not prepare');
  return SAMPLES.map((sample) => ({
    title: sample.title,
    matchedIn: matchRule(prepared, prepareEvent(asEvent(sample), sample.tags ?? [])) ?? null,
  }));
}

describe('rule kinds — goldens over real titles', () => {
  it('KEYWORD "ai" in the title', () => {
    expectGolden('categories/kind-keyword', matchTable(rule('KEYWORD', 'AI', { fields: 'TITLE' })));
  });
  it('PHRASE "machine learning"', () => {
    expectGolden('categories/kind-phrase', matchTable(rule('PHRASE', 'machine learning')));
  });
  it('REGEX \\brobo(tics|wars?|race)\\b in the title', () => {
    expectGolden(
      'categories/kind-regex',
      matchTable(rule('REGEX', '\\brobo(tics|wars?|race)\\b', { fields: 'TITLE' })),
    );
  });
  it('SOURCE_TAG "blockchain"', () => {
    expectGolden('categories/kind-source-tag', matchTable(rule('SOURCE_TAG', 'blockchain')));
  });
  it('EVENT_TYPE CTF', () => {
    expectGolden('categories/kind-event-type', matchTable(rule('EVENT_TYPE', 'CTF')));
  });
  it('the starter seed over every sample', () => {
    const seed = loadCategorySeed(CATEGORY_SEED_FILE);
    const rules = prepareRules(
      seed.categories.flatMap((category) =>
        category.rules.map((seedRule, index) => ({
          id: `${category.slug}#${String(index).padStart(2, '0')}`,
          categoryId: category.slug,
          ...seedRule,
        })),
      ),
    );
    expectGolden(
      'categories/seed-classification',
      SAMPLES.map((sample) => ({
        title: sample.title,
        categories: classify(asEvent(sample), sample.tags ?? [], rules),
      })),
    );
  });
});

describe('KEYWORD', () => {
  it('matches whole words only — "AI" never matches "Chair", "AIIMS" or "Maid"', () => {
    const [ai] = prepareRules([rule('KEYWORD', 'AI')]);
    if (ai === undefined) throw new Error('unprepared');
    const hit = (title: string) =>
      matchRule(ai, prepareEvent({ title, description: null, eventType: 'HACKATHON' }, []));
    expect(hit('Chair Design Sprint')).toBeUndefined();
    expect(hit('AIIMS MedTech Ideathon')).toBeUndefined();
    expect(hit('Maid Robot Challenge')).toBeUndefined();
    expect(hit('AI for Good')).toBe('TITLE');
    // Punctuation splits words, so "A.I." is "a" + "i": a PHRASE "a i" catches it.
    expect(hit('Build with A.I.')).toBeUndefined();
    expect(hit('AI-powered chairs')).toBe('TITLE');
  });

  it('is case- and diacritic-insensitive', () => {
    const [kw] = prepareRules([rule('KEYWORD', 'resume')]);
    if (kw === undefined) throw new Error('unprepared');
    const event = prepareEvent({ title: 'RÉSUMÉ hack', description: null, eventType: 'OTHER' }, []);
    expect(matchRule(kw, event)).toBe('TITLE');
  });
});

describe('field scoping', () => {
  it('a TITLE rule ignores the description; a DESCRIPTION rule ignores the title', () => {
    const event = prepareEvent(
      { title: 'Robotics Day', description: 'Bring a drone', eventType: 'HACKATHON' },
      ['iot'],
    );
    const [title, description, tags] = prepareRules([
      rule('KEYWORD', 'drone', { id: 'a', fields: 'TITLE' }),
      rule('KEYWORD', 'drone', { id: 'b', fields: 'DESCRIPTION' }),
      rule('KEYWORD', 'iot', { id: 'c', fields: 'TAGS' }),
    ]);
    expect(matchRule(title!, event)).toBeUndefined();
    expect(matchRule(description!, event)).toBe('DESCRIPTION');
    expect(matchRule(tags!, event)).toBe('TAGS');
  });

  it('a PHRASE never spans two tags', () => {
    const [phrase] = prepareRules([rule('PHRASE', 'open source', { fields: 'TAGS' })]);
    const split = prepareEvent({ title: 'x', description: null, eventType: 'OTHER' }, [
      'open',
      'source',
    ]);
    const whole = prepareEvent({ title: 'x', description: null, eventType: 'OTHER' }, [
      'Open Source',
    ]);
    expect(matchRule(phrase!, split)).toBeUndefined();
    expect(matchRule(phrase!, whole)).toBe('TAGS');
  });
});

describe('classify', () => {
  const rules: ClassifierRule[] = [
    {
      id: 'r1',
      categoryId: 'chain',
      kind: 'SOURCE_TAG',
      pattern: 'blockchain',
      fields: 'ALL',
      weight: 80,
    },
    { id: 'r2', categoryId: 'chain', kind: 'KEYWORD', pattern: 'web3', fields: 'ALL', weight: 70 },
    { id: 'r3', categoryId: 'ai', kind: 'KEYWORD', pattern: 'ai', fields: 'TITLE', weight: 30 },
    { id: 'r4', categoryId: 'ai', kind: 'KEYWORD', pattern: 'genai', fields: 'ALL', weight: 20 },
    { id: 'r5', categoryId: 'zero', kind: 'KEYWORD', pattern: 'web3', fields: 'ALL', weight: 0 },
  ];
  const event: ClassifiableEvent = {
    title: 'Web3 and AI Summit',
    description: 'GenAI meets chains',
    eventType: 'HACKATHON',
  };

  it('a source tag and a rule on the same category are one row, origin SOURCE_TAG', () => {
    const out = classify(event, ['Blockchain'], prepareRules(rules));
    expect(out.filter((row) => row.categoryId === 'chain')).toEqual([
      { categoryId: 'chain', origin: 'SOURCE_TAG', ruleId: 'r1', confidence: 1 },
    ]);
  });

  it('confidence is the summed weight / 100, capped at 1; a zero-weight hit assigns nothing', () => {
    const out = classify(event, [], prepareRules(rules));
    expect(out).toEqual([
      { categoryId: 'ai', origin: 'RULE', ruleId: 'r3', confidence: 0.5 },
      { categoryId: 'chain', origin: 'RULE', ruleId: 'r2', confidence: 0.7 },
    ]);
  });

  it('is order-independent: any permutation of the rules gives byte-identical output', () => {
    const expected = JSON.stringify(classify(event, ['Blockchain'], prepareRules(rules)));
    fc.assert(
      fc.property(fc.shuffledSubarray(rules, { minLength: rules.length }), (shuffled) => {
        expect(JSON.stringify(classify(event, ['Blockchain'], prepareRules(shuffled)))).toBe(
          expected,
        );
      }),
      { numRuns: 100 },
    );
  });

  it('skips a stored REGEX that no longer passes the guard rather than running it', () => {
    const prepared = prepareRules([rule('REGEX', '(a+)+$'), rule('KEYWORD', 'aaa', { id: 'k' })]);
    expect(prepared.map((r) => r.id)).toEqual(['k']);
  });
});

describe('validateRulePattern', () => {
  it('refuses a multi-word KEYWORD, an unknown EVENT_TYPE and an empty PHRASE', () => {
    expect(validateRulePattern('KEYWORD', 'machine learning')?.unsafe).toBe(false);
    expect(validateRulePattern('KEYWORD', 'ml')).toBeUndefined();
    expect(validateRulePattern('EVENT_TYPE', 'QUIZ')?.unsafe).toBe(false);
    expect(validateRulePattern('EVENT_TYPE', 'CTF')).toBeUndefined();
    expect(validateRulePattern('PHRASE', '!!!')?.unsafe).toBe(false);
    expect(validateRulePattern('SOURCE_TAG', 'ui/ux')).toBeUndefined();
  });

  it('marks a catastrophic REGEX unsafe and a broken one invalid', () => {
    expect(validateRulePattern('REGEX', '(a+)+$')?.unsafe).toBe(true);
    expect(validateRulePattern('REGEX', '(unclosed')?.unsafe).toBe(false);
    expect(validateRulePattern('REGEX', '\\bctf\\b')).toBeUndefined();
  });
});
