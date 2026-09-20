import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { expectGolden, fixturesDir, goldenPath, stableJson } from './golden.js';

/**
 * The golden helper, tested on goldens of its own. The temporary ones are
 * written under a `self-test/` prefix and removed afterwards, so a failed run
 * cannot leave a file behind that makes the next run pass.
 */

const SCRATCH = 'self-test/scratch';

afterEach(() => {
  delete process.env.UPDATE_GOLDEN;
  rmSync(goldenPath(SCRATCH), { force: true });
});

describe('expectGolden', () => {
  it('fails when the golden file does not exist, rather than writing it', () => {
    expect(() => {
      expectGolden(SCRATCH, { a: 1 });
    }).toThrow(/No golden file for "self-test\/scratch"/);
    expect(() => {
      expectGolden(SCRATCH, { a: 1 });
    }).toThrow(/UPDATE_GOLDEN=1/);
  });

  it('records with UPDATE_GOLDEN=1 and matches afterwards', () => {
    process.env.UPDATE_GOLDEN = '1';
    expectGolden(SCRATCH, { b: 2, a: 1 });
    delete process.env.UPDATE_GOLDEN;

    expect(readFileSync(goldenPath(SCRATCH), 'utf8')).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
    expectGolden(SCRATCH, { a: 1, b: 2 });
  });

  it('fails with a readable diff when a value changes', () => {
    process.env.UPDATE_GOLDEN = '1';
    expectGolden(SCRATCH, { title: 'Hack the North', mode: 'OFFLINE' });
    delete process.env.UPDATE_GOLDEN;

    let message = '';
    try {
      expectGolden(SCRATCH, { title: 'Hack the North', mode: 'ONLINE' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The comparison is string-to-string, so the report names the one line that
    // moved rather than printing two whole objects as unequal.
    expect(message).toContain('golden "self-test/scratch"');
    expect(message).toContain('OFFLINE');
    expect(message).toContain('ONLINE');
  });

  it('treats a falsy UPDATE_GOLDEN as off', () => {
    process.env.UPDATE_GOLDEN = '0';
    expect(() => {
      expectGolden(SCRATCH, { a: 1 });
    }).toThrow(/No golden file/);
  });
});

describe('stableJson', () => {
  it('sorts object keys at every depth but keeps array order', () => {
    expect(stableJson({ b: { d: 1, c: 2 }, a: [3, 1, 2] })).toBe(
      '{\n  "a": [\n    3,\n    1,\n    2\n  ],\n  "b": {\n    "c": 2,\n    "d": 1\n  }\n}\n',
    );
  });

  it('drops undefined and renders a Date as an ISO instant', () => {
    expect(stableJson({ a: undefined, b: new Date('2026-09-27T00:00:00.000Z') })).toBe(
      '{\n  "b": "2026-09-27T00:00:00.000Z"\n}\n',
    );
  });
});

describe('the recorded source fixtures', () => {
  const SOURCES = ['ctftime', 'devfolio'] as const;
  const researchDir = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'research',
    'fixtures',
  );

  /**
   * A recorded source response, as opposed to a golden this project produced.
   *
   * The two live in the same folder so a source's inputs and outputs are read
   * together, but only the recorded ones have a counterpart in `docs/research/`
   * — a golden is ours, and there is nothing for it to drift from.
   */
  const isRecordedResponse = (name: string): boolean => !name.endsWith('.golden.json');

  /**
   * WP-02 recorded these responses and `docs/research/` keeps them as evidence;
   * the adapters need a working copy inside the test tree. Two copies drift, so
   * this asserts they are byte-identical — a fixture edited on one side and not
   * the other fails here rather than in a WP-11 adapter test six weeks later.
   */
  it('are byte-identical to the research copies in docs/', () => {
    for (const source of SOURCES) {
      const research = path.join(researchDir, source);
      const working = path.join(fixturesDir(), source);
      const names = readdirSync(research).sort();

      expect(names.length, `${source} has fixtures`).toBeGreaterThan(0);
      // Still an exact comparison, so a recorded response deleted from the test
      // tree fails; goldens are excluded because they have no research copy.
      expect(
        readdirSync(working).filter(isRecordedResponse).sort(),
        `${source} file list`,
      ).toStrictEqual(names);

      for (const name of names) {
        expect(
          readFileSync(path.join(working, name)),
          `${source}/${name} differs from the docs/research copy`,
        ).toStrictEqual(readFileSync(path.join(research, name)));
      }
    }
  });

  it('parse as JSON, so an adapter test starts from something real', () => {
    for (const source of SOURCES) {
      for (const name of readdirSync(path.join(fixturesDir(), source))) {
        const raw = readFileSync(path.join(fixturesDir(), source, name), 'utf8');
        expect(() => JSON.parse(raw) as unknown, `${source}/${name}`).not.toThrow();
      }
    }
  });
});
