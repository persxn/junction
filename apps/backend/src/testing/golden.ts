import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect } from 'vitest';

/**
 * Golden-file comparison for the things M1 produces that are too big to assert
 * field by field: a normalized `EventCandidate`, a dedup score breakdown, a
 * compiled `EventQuery`, a ranking explanation.
 *
 * The rule that makes goldens useful rather than dangerous is that a **missing
 * golden file fails**. A helper that writes the file it did not find always
 * passes on the first run, which means the first run records whatever the code
 * did — bugs included — and nobody ever looks at it again. Recording is a
 * deliberate act: `UPDATE_GOLDEN=1 pnpm test`, and then the diff is in the
 * commit where a reviewer can see it.
 *
 * Keys are sorted on the way out, so a refactor that changes the order fields
 * are assigned in does not produce a diff, and a real change does.
 */

/** `apps/backend/test/fixtures`. Outside `src/`, so nothing ships it. */
export function fixturesDir(): string {
  return path.resolve(import.meta.dirname, '..', '..', 'test', 'fixtures');
}

/** Where `name` is recorded; `name` may contain `/` to group by source. */
export function goldenPath(name: string): string {
  return path.join(fixturesDir(), `${name}.golden.json`);
}

/** True when this run is allowed to rewrite goldens. */
export function updatingGoldens(): boolean {
  const flag = process.env.UPDATE_GOLDEN;
  return flag !== undefined && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false';
}

/**
 * JSON with object keys sorted at every depth and a trailing newline. Arrays
 * keep their order, because in a golden an array's order is usually the thing
 * under test.
 */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) {
      sorted[key] = sortKeys(item);
    }
  }
  return sorted;
}

/**
 * Compares `value` against `test/fixtures/<name>.golden.json`.
 *
 * With `UPDATE_GOLDEN=1` it writes the file instead and passes. Without it, a
 * file that is not there is a failure that says how to record it — never a
 * silent first run.
 */
export function expectGolden(name: string, value: unknown): void {
  const file = goldenPath(name);
  const actual = stableJson(value);

  if (updatingGoldens()) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, actual, 'utf8');
    return;
  }

  let expected: string;
  try {
    expected = readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `No golden file for "${name}" at ${path.relative(process.cwd(), file)}.\n` +
        'A golden is recorded on purpose, never by a first run that had nothing to compare to.\n' +
        'Check what the code produces, then record it with: UPDATE_GOLDEN=1 pnpm test',
    );
  }

  // `toBe` on two strings is what gives a readable line-by-line diff; comparing
  // the parsed objects would print one enormous inequality.
  expect(actual, `golden "${name}" (${path.relative(process.cwd(), file)})`).toBe(expected);
}
