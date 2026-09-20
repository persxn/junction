import { gzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';

import { dataSubdir, type Config } from '../platform/config.js';
import { nowMs, systemClock, type Clock } from '../platform/time.js';

/**
 * Raw response snapshots (§7.8).
 *
 * The reason these exist is adapter breakage: when Devfolio changes its page
 * shape at 3 a.m., the useful artefact is the bytes that broke the parser, not a
 * stack trace. They are also how a fixture is regenerated without going back to
 * the source. Everything else about them is a retention policy, because they are
 * raw third-party data and there is no reason to keep any of it for long.
 *
 * Three limits, applied oldest-first in this order: **14 days**, **3 per
 * record**, **300 MB in total**. The per-record limit matters more than it
 * sounds — a listing that changes every run would otherwise fill the quota with
 * one event's history and evict everybody else's.
 */

/**
 * Directories under `<dataDir>` that a backup must skip. WP-28 consumes this;
 * it is one constant rather than a rule written twice, because a backup that
 * silently includes 300 MB of other people's HTML is the kind of thing nobody
 * notices until a restore.
 */
export const BACKUP_EXCLUDED_DIRS = ['snapshots'] as const;

/** §7.8: kept 14 days. */
export const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 3_600_000;

/** §7.8: at most three per source record. */
export const SNAPSHOT_MAX_PER_RECORD = 3;

/** §7.8: 300 MB across every source. */
export const SNAPSHOT_TOTAL_CAP_BYTES = 300 * 1024 * 1024;

/** `<dataDir>/snapshots`. */
export function snapshotsRoot(config: Config): string {
  return dataSubdir(config, 'snapshots');
}

/**
 * `2026-09-21T10:30:00.000Z` → `20260921T103000000Z`.
 *
 * A colon is not a legal character in a Windows file name and a raw ISO string
 * would produce files that cannot be created at all, so the separators come out.
 * The result still sorts chronologically as text, which is what the pruner
 * relies on.
 */
export function snapshotStamp(at: Date): string {
  return at.toISOString().replace(/[-:.]/g, '');
}

/** `<source>/<yyyy-MM>/<recordId>-<stamp>.json.gz`, relative to the root. */
export function snapshotRef(sourceKey: string, recordId: string, at: Date): string {
  const month = at.toISOString().slice(0, 7);
  return path.posix.join(sourceKey, month, `${recordId}-${snapshotStamp(at)}.json.gz`);
}

export interface PruneResult {
  readonly removed: number;
  readonly removedBytes: number;
  readonly keptBytes: number;
}

export interface SnapshotStoreOptions {
  readonly config: Config;
  readonly logger: Logger;
  readonly clock?: Clock;
}

interface SnapshotFile {
  readonly ref: string;
  readonly absolute: string;
  readonly recordId: string;
  readonly modifiedAt: number;
  readonly bytes: number;
}

export class SnapshotStore {
  readonly #root: string;
  readonly #logger: Logger;
  readonly #clock: Clock;

  constructor(options: SnapshotStoreOptions) {
    this.#root = snapshotsRoot(options.config);
    this.#logger = options.logger;
    this.#clock = options.clock ?? systemClock;
  }

  get root(): string {
    return this.#root;
  }

  /**
   * Writes one gzipped snapshot and returns its `raw_snapshot_ref`.
   *
   * A snapshot that cannot be written is logged and swallowed: it is a debugging
   * aid, and losing one is never a reason to fail a scrape that otherwise
   * worked.
   */
  write(sourceKey: string, recordId: string, body: Uint8Array): string | undefined {
    const ref = snapshotRef(sourceKey, recordId, this.#clock.now());
    const absolute = path.join(this.#root, ref);
    try {
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, gzipSync(body));
      return ref;
    } catch (error) {
      this.#logger.warn({ err: error, ref }, 'a raw snapshot could not be written');
      return undefined;
    }
  }

  /**
   * Applies §7.8's three limits, oldest first. Called at the end of every run,
   * so the quota is enforced by the thing that fills it rather than by a
   * separate cleanup job that might not be registered.
   */
  prune(): PruneResult {
    const files = this.#list().sort((a, b) => a.modifiedAt - b.modifiedAt);
    const now = nowMs(this.#clock);
    const doomed = new Set<string>();

    for (const file of files) {
      if (now - file.modifiedAt > SNAPSHOT_MAX_AGE_MS) {
        doomed.add(file.absolute);
      }
    }

    // Per record: keep the newest three of what the age limit left.
    const byRecord = new Map<string, SnapshotFile[]>();
    for (const file of files) {
      if (doomed.has(file.absolute)) {
        continue;
      }
      const bucket = byRecord.get(file.recordId) ?? [];
      bucket.push(file);
      byRecord.set(file.recordId, bucket);
    }
    for (const bucket of byRecord.values()) {
      for (const file of bucket.slice(0, Math.max(0, bucket.length - SNAPSHOT_MAX_PER_RECORD))) {
        doomed.add(file.absolute);
      }
    }

    // Total cap: still oldest first, over whatever survived the first two.
    let kept = files
      .filter((file) => !doomed.has(file.absolute))
      .reduce((sum, file) => sum + file.bytes, 0);
    for (const file of files) {
      if (kept <= SNAPSHOT_TOTAL_CAP_BYTES) {
        break;
      }
      if (doomed.has(file.absolute)) {
        continue;
      }
      doomed.add(file.absolute);
      kept -= file.bytes;
    }

    let removedBytes = 0;
    for (const file of files) {
      if (!doomed.has(file.absolute)) {
        continue;
      }
      try {
        rmSync(file.absolute, { force: true });
        removedBytes += file.bytes;
      } catch (error) {
        this.#logger.debug({ err: error, ref: file.ref }, 'a snapshot could not be removed');
      }
    }
    return { removed: doomed.size, removedBytes, keptBytes: kept };
  }

  /** Every snapshot under the root, with the record id read back out of the name. */
  #list(): SnapshotFile[] {
    const out: SnapshotFile[] = [];
    const walk = (dir: string, relative: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child = path.join(dir, entry.name);
        const childRef = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(child, childRef);
          continue;
        }
        if (!entry.name.endsWith('.json.gz')) {
          continue;
        }
        try {
          const stats = statSync(child);
          out.push({
            ref: childRef,
            absolute: child,
            recordId: recordIdOf(entry.name),
            modifiedAt: stats.mtimeMs,
            bytes: stats.size,
          });
        } catch {
          // Raced with another prune; nothing to do.
        }
      }
    };
    walk(this.#root, '');
    return out;
  }
}

/**
 * `<recordId>-<stamp>.json.gz` → `<recordId>`. The stamp has no hyphens (see
 * {@link snapshotStamp}), so the last hyphen is the separator even though a
 * UUIDv7 is full of them.
 */
export function recordIdOf(fileName: string): string {
  const base = fileName.replace(/\.json\.gz$/, '');
  const cut = base.lastIndexOf('-');
  return cut === -1 ? base : base.slice(0, cut);
}
