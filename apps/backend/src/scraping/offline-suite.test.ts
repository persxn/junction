import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Two properties of the source tree that are easier to prove by reading it than
 * by running it (the ACCEPTANCE block of WP-09a).
 *
 * **No test in `pnpm verify` opens an internet socket.** The only code that can
 * is `undiciFetcher`, behind the `Fetcher` seam; everything else takes a
 * transport as an argument. So the property reduces to "nothing but `main.ts`
 * references `undiciFetcher`", which is a grep — and a grep that keeps being
 * true as the codebase grows, unlike a reviewer's memory. (The suite also has no
 * outbound host names: the fakes answer for `example.test`, a reserved name that
 * resolves nowhere, and the two `node:http` servers bind 127.0.0.1.)
 *
 * **TLS validation is never disabled** (§4.8, D-28, ADR-0007). Eight of the 117
 * campus sites WP-02 surveyed have expired certificates, and the tempting fix is
 * one option away. There is no option, and this is what keeps it that way.
 */

const SOURCE_ROOT = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir: string = SOURCE_ROOT): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(child);
    }
    return entry.name.endsWith('.ts') ? [child] : [];
  });
}

/**
 * The file with its comments taken out. The prose in this codebase discusses
 * `undiciFetcher` and `rejectUnauthorized` by name — that is the point of it —
 * so the greps below have to look at code rather than at text about code.
 */
function read(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no test opens an internet socket', () => {
  it('references the real transport from exactly one file', () => {
    const referencing = sourceFiles().filter((file) => {
      const text = read(file);
      return (
        text.includes('undiciFetcher') &&
        !file.endsWith(path.join('scraping', 'http', 'undici-fetcher.ts')) &&
        !file.endsWith(path.join('scraping', 'http', 'index.ts')) &&
        !file.endsWith(path.join('scraping', 'offline-suite.test.ts'))
      );
    });
    expect(referencing.map((file) => path.relative(SOURCE_ROOT, file))).toEqual(['main.ts']);
  });

  it('never imports undici outside the one transport module', () => {
    const importers = sourceFiles().filter(
      (file) =>
        /from '(undici|undici\/.*)'/.test(read(file)) &&
        !file.endsWith(path.join('scraping', 'http', 'undici-fetcher.ts')),
    );
    expect(importers.map((file) => path.relative(SOURCE_ROOT, file))).toEqual([]);
  });

  it('has no test file that constructs a transport of its own', () => {
    const offenders = sourceFiles().filter(
      (file) => file.endsWith('.test.ts') && /\bglobalThis\.fetch\b|\bnew Agent\(/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('TLS validation is never disabled (§4.8, D-28)', () => {
  it.each([
    'rejectUnauthorized',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'checkServerIdentity',
    'insecureHTTPParser',
  ])('does not mention %s anywhere under src/', (needle) => {
    const offenders = sourceFiles().filter(
      (file) =>
        read(file).includes(needle) &&
        !file.endsWith(path.join('scraping', 'offline-suite.test.ts')),
    );
    expect(offenders.map((file) => path.relative(SOURCE_ROOT, file))).toEqual([]);
  });
});
