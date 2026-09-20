import { randomBytes } from 'node:crypto';
import { rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PathCheckReason, PathCheckResult } from '@compintel/contracts';

/**
 * Is this folder usable as a backup destination (ruling R43)?
 *
 * Four questions, in the order that makes the answer useful: does it exist, is
 * it a folder, can we actually write in it, and is there room. The writability
 * check is a real write and delete rather than `fs.access`, because on Windows
 * `access` reports the DACL and not what the filesystem will do — a network
 * share, a read-only removable drive and a folder under Controlled Folder
 * Access all pass `access` and then fail at 2 a.m. when the backup runs.
 *
 * The destination must also be outside the data directory: a backup inside the
 * thing being backed up is lost with it, and it would be copied into the next
 * backup, and the one after that.
 */

/** §14's pre-run check is "3 × last backup size"; with no backups yet, 1 GB. */
export const MIN_FREE_BYTES = 1024 * 1024 * 1024;

export interface PathCheckOptions {
  /** The process data directory; the destination may not be inside it. */
  readonly dataDir: string;
  readonly minFreeBytes?: number;
}

function refuse(
  resolvedPath: string,
  reason: PathCheckReason,
  freeBytes?: number,
): PathCheckResult {
  return {
    ok: false,
    reason,
    resolvedPath,
    ...(freeBytes === undefined ? {} : { freeBytes }),
  };
}

/** True when `candidate` is the directory itself or anything under it. */
export function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function freeBytesOf(directory: string): number | undefined {
  try {
    const stats = statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // An exotic filesystem that cannot answer is not a reason to refuse the
    // folder; the pre-run check in WP-28 asks again before every backup.
    return undefined;
  }
}

/** A real write, because that is the only thing that proves a folder is writable. */
function canWrite(directory: string): boolean {
  const probe = path.join(directory, `.compintel-write-probe-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(probe, 'compintel');
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // The probe was written but cannot be removed: the folder is writable,
      // which is what was asked. Leaving one 9-byte file is better than lying.
    }
  }
}

export function checkBackupPath(candidate: string, options: PathCheckOptions): PathCheckResult {
  const resolvedPath = path.resolve(candidate);

  let stats;
  try {
    stats = statSync(resolvedPath);
  } catch {
    return refuse(resolvedPath, 'MISSING');
  }
  if (!stats.isDirectory()) {
    return refuse(resolvedPath, 'NOT_A_DIRECTORY');
  }
  if (isInside(resolvedPath, options.dataDir)) {
    return refuse(resolvedPath, 'INSIDE_DATA_DIR');
  }
  if (!canWrite(resolvedPath)) {
    return refuse(resolvedPath, 'NOT_WRITABLE');
  }

  const freeBytes = freeBytesOf(resolvedPath);
  const minimum = options.minFreeBytes ?? MIN_FREE_BYTES;
  if (freeBytes !== undefined && freeBytes < minimum) {
    return refuse(resolvedPath, 'LOW_SPACE', freeBytes);
  }

  return { ok: true, resolvedPath, ...(freeBytes === undefined ? {} : { freeBytes }) };
}
