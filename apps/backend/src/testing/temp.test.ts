import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { devRoot, makeTempDir, removeDirectory, testTempRoot } from './temp.js';

/**
 * Dev data lives in `%LOCALAPPDATA%\CompIntel-dev`, never in the repository and
 * never in the system temp folder, and removing it has to survive Windows
 * holding a handle for a moment after a process exits.
 */

describe('the dev data root', () => {
  it('is under CompIntel-dev and not inside the repository', () => {
    const root = testTempRoot();
    expect(root.startsWith(devRoot())).toBe(true);
    expect(root).toContain('CompIntel-dev');
    expect(path.relative(path.resolve('.'), root).startsWith('..')).toBe(true);
  });
});

describe('removeDirectory', () => {
  it('removes a populated directory and says so', () => {
    const dir = makeTempDir('remove');
    mkdirSync(path.join(dir, 'nested'), { recursive: true });
    writeFileSync(path.join(dir, 'nested', 'file.txt'), 'x');

    expect(removeDirectory(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('treats a directory that is already gone as success', () => {
    const dir = makeTempDir('remove-twice');
    expect(removeDirectory(dir)).toBe(true);
    expect(removeDirectory(dir)).toBe(true);
  });

  it('gives up at the deadline instead of hanging', () => {
    const dir = makeTempDir('remove-deadline');
    writeFileSync(path.join(dir, 'file.txt'), 'x');
    const startedAt = Date.now();
    // A real removal well inside the budget; the point is that it returns.
    expect(removeDirectory(dir, 50)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
