import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const WORKSPACE_GLOBS = ['apps', 'packages', 'tools'];

interface Manifest {
  readonly file: string;
  readonly name: string;
  readonly scripts: Record<string, string>;
}

function readManifest(file: string): Manifest | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    return { file, name: parsed.name ?? file, scripts: parsed.scripts ?? {} };
  } catch {
    return undefined;
  }
}

/** Every workspace manifest, found the same way pnpm-workspace.yaml finds them. */
function manifests(): Manifest[] {
  const found = [readManifest(path.join(REPO_ROOT, 'package.json'))];
  for (const group of WORKSPACE_GLOBS) {
    const dir = path.join(REPO_ROOT, group);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry);
      if (statSync(child).isDirectory()) {
        found.push(readManifest(path.join(child, 'package.json')));
      }
    }
  }
  return found.filter((manifest): manifest is Manifest => manifest !== undefined);
}

describe('package scripts', () => {
  it('finds the workspace manifests it is meant to guard', () => {
    const names = manifests().map((manifest) => manifest.name);
    expect(names).toContain('@compintel/backend');
    expect(names).toContain('@compintel/contracts');
  });

  /**
   * §4.6 and ADR-0005: `drizzle-kit push` diffs the schema straight onto a live
   * database. It would skip the reviewed SQL, skip the pre-migration copy, and
   * silently drop the FTS5 tables and triggers drizzle-kit cannot see. There is
   * deliberately no script for it, and this test is what keeps it that way.
   */
  it('never offers drizzle-kit push', () => {
    const offenders = manifests().flatMap((manifest) =>
      Object.entries(manifest.scripts)
        .filter(([, command]) => command.includes('drizzle-kit push'))
        .map(([script]) => `${manifest.name}: ${script}`),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('does offer the generate scripts the workflow needs', () => {
    const backend = manifests().find((manifest) => manifest.name === '@compintel/backend');
    expect(backend?.scripts['db:generate']).toBe('drizzle-kit generate');
    expect(backend?.scripts['db:generate:custom']).toBe('drizzle-kit generate --custom');
  });
});
