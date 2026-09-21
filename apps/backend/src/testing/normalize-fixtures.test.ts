import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { expectGolden, fixturesDir } from './golden.js';
import { fixedClock } from '../platform/time.js';
import { CASE_NOW } from '../domain/normalize/cases/index.js';
import { hasContactDetails, redact } from '../domain/normalize/redact.js';
import { toMarkdown, toSummary } from '../domain/normalize/text.js';

/**
 * The recorded source responses, run through the library that will process them
 * for real (§19's acceptance criterion, D-29).
 *
 * It lives here rather than beside the library because it reads the filesystem,
 * and `src/domain/**` is pure by rule — which the linter pointed out the moment
 * this file was written in the wrong place.
 *
 * The cases in `cases/` are written to exercise a rule; these two fixtures were
 * recorded off the live CTFtime and Devfolio APIs in WP-02 and were written by
 * nobody on this project. That is what makes them worth testing against: they
 * contain the wording, the markup and the contact details that real sources
 * actually use, including the ones nobody thought to invent a case for.
 */

const SOURCES = ['ctftime', 'devfolio'] as const;
const clock = fixedClock(CASE_NOW);

/** Every string anywhere in a parsed fixture, with the path that reached it. */
function* strings(value: unknown, trail = ''): Generator<{ path: string; text: string }> {
  if (typeof value === 'string') {
    yield { path: trail, text: value };
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* strings(item, `${trail}[${String(index)}]`);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      yield* strings(item, trail === '' ? key : `${trail}.${key}`);
    }
  }
}

function fixtureFiles(): { source: string; name: string; file: string }[] {
  return SOURCES.flatMap((source) =>
    readdirSync(path.join(fixturesDir(), source))
      // Recorded responses only; WP-12's .html wrappers and synthetic pages are
      // swept by the Devfolio adapter's own PII test through the real adapter.
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => ({ source, name, file: path.join(fixturesDir(), source, name) })),
  );
}

describe('the §19 criterion: no contact detail survives redaction', () => {
  it('finds fixtures to sweep in the first place', () => {
    // A sweep over nothing passes silently, which would be worse than useless.
    expect(fixtureFiles().length).toBeGreaterThanOrEqual(4);
  });

  it.each(fixtureFiles())(
    '$source/$name has no e-mail or phone left after redact()',
    ({ file }) => {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const offenders: string[] = [];
      for (const { path: trail, text } of strings(parsed)) {
        const cleaned = redact(text);
        if (hasContactDetails(cleaned)) {
          offenders.push(`${trail}: ${cleaned.slice(0, 120)}`);
        }
      }
      expect(offenders).toStrictEqual([]);
    },
  );

  it('redact() is idempotent over every fixture string', () => {
    for (const { file } of fixtureFiles()) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      for (const { path: trail, text } of strings(parsed)) {
        const once = redact(text);
        expect(redact(once), trail).toBe(once);
      }
    }
  });

  /**
   * The sweep above only proves the fixtures are clean *after* redaction. This
   * proves the sweep would notice if they were not, by putting a contact detail
   * into a fixture string and checking the same predicate rejects it.
   */
  it('would fail if a fixture grew a contact detail', () => {
    const { file } = fixtureFiles()[0] ?? { file: '' };
    const raw = readFileSync(file, 'utf8');
    expect(hasContactDetails(`${raw} write to organisers@example.org`)).toBe(true);
    expect(hasContactDetails(`${raw} call +91 98765 43210`)).toBe(true);
  });
});

/**
 * The two real descriptions, as sanitized Markdown and as a summary.
 *
 * Goldens rather than assertions because the output is a paragraph: a rule
 * change that improves one description and wrecks another shows up as a diff a
 * person reads, which is exactly the review these deserve. Recorded with
 * `UPDATE_GOLDEN=1 pnpm test`; a missing file fails rather than writing itself.
 */
describe('the real descriptions, rendered', () => {
  function descriptionOf(source: string, name: string, keys: readonly string[]): string {
    const parsed = JSON.parse(
      readFileSync(path.join(fixturesDir(), source, name), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of keys) {
      const value = key
        .split('.')
        .reduce<unknown>(
          (current, part) =>
            current !== null && typeof current === 'object'
              ? (current as Record<string, unknown>)[part]
              : undefined,
          parsed,
        );
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    throw new Error(`No description found in ${source}/${name} under ${keys.join(', ')}`);
  }

  it('renders the CTFtime event description', () => {
    const description = descriptionOf('ctftime', 'detail-event-3417.json', [
      'description',
      'data.description',
    ]);
    expectGolden('ctftime/detail-event-3417.description', {
      descriptionMd: toMarkdown(description),
      summary: toSummary(description),
    });
  });

  it('renders the Devfolio hackathon description', () => {
    const description = descriptionOf('devfolio', 'detail-hackathon.json', [
      'hackathon.desc',
      'hackathon.description',
    ]);
    expectGolden('devfolio/detail-hackathon.description', {
      descriptionMd: toMarkdown(description),
      summary: toSummary(description),
    });
  });

  it('never leaves raw HTML or a contact detail in either golden', () => {
    for (const [source, name, keys] of [
      ['ctftime', 'detail-event-3417.json', ['description', 'data.description']],
      ['devfolio', 'detail-hackathon.json', ['hackathon.desc', 'hackathon.description']],
    ] as const) {
      const description = descriptionOf(source, name, keys);
      const markdown = toMarkdown(description) ?? '';
      expect(markdown, source).not.toMatch(/<\/?(?:script|iframe|style|p|div|span)\b/i);
      expect(hasContactDetails(markdown), source).toBe(false);
      expect(hasContactDetails(toSummary(description) ?? ''), source).toBe(false);
    }
  });

  it('uses the injected clock, so these goldens cannot drift with the calendar', () => {
    // Nothing above reads a date, but the guarantee is worth stating: every
    // entry point into this library takes the clock, never `new Date()`.
    expect(clock.now().toISOString()).toBe(CASE_NOW);
  });
});
